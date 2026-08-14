import "server-only";

import { and, desc, eq, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { AppError } from "../errors";

const MAX_TEXT_LEN = 200;
const MAX_ERROR_REASON_LEN = 1024;
const MAX_PAYLOAD_BYTES = 65_536;

function truncateText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : "";
}

function assertObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("dead_letter_invalid_payload", 422);
  }
  return value as Record<string, unknown>;
}

/** Keys that commonly carry secret material — redact these by name. */
const SECRET_KEY_PATTERN = /(?:^|_)(?:api[_-]?key|secret|token|password|passwd|credential|authorization|auth)(?:$|_)/i;

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  // Redact by key name only — never by value shape, so legitimate long
  // base64/hex alert fields (hashes, signatures) are preserved.
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      safe[key] = "[REDACTED]";
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

function payloadByteSize(payload: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(payload), "utf8");
  } catch {
    return Infinity;
  }
}

export interface InsertDeadLetterArgs {
  db: Database;
  source: string;
  text: string;
  rawPayload: unknown;
  errorReason: string;
  attemptedAt?: Date;
}

/**
 * Insert a dead-letter row. Bounded: rejects oversized text / payload.
 * Sanitizes raw payload to drop high-entropy secret-looking values before persisting.
 */
export async function insertDeadLetter(args: InsertDeadLetterArgs): Promise<{ id: string }> {
  const { db, source, text: textInput, rawPayload, errorReason, attemptedAt = new Date() } = args;

  const boundedSource = truncateText(source, MAX_TEXT_LEN);
  const boundedText = truncateText(textInput, MAX_TEXT_LEN);
  const boundedReason = truncateText(errorReason, MAX_ERROR_REASON_LEN);

  if (!boundedSource) throw new AppError("dead_letter_empty_source", 422);
  if (!boundedText) throw new AppError("dead_letter_empty_text", 422);
  if (!boundedReason) throw new AppError("dead_letter_empty_reason", 422);

  const payload = assertObject(rawPayload);
  // Bound-check the ORIGINAL payload first: sanitization drops secret-looking
  // values and must not let an oversized payload slip through.
  const originalByteSize = payloadByteSize(payload);
  if (originalByteSize > MAX_PAYLOAD_BYTES) {
    throw new AppError("dead_letter_payload_too_large", 422);
  }
  const sanitized = sanitizePayload(payload);
  const byteSize = payloadByteSize(sanitized);
  if (byteSize > MAX_PAYLOAD_BYTES) {
    throw new AppError("dead_letter_payload_too_large", 422);
  }

  const [row] = await db
    .insert(schema.deadLetters)
    .values({
      id: randomUUID(),
      source: boundedSource,
      text: boundedText,
      rawPayload: sanitized,
      errorReason: boundedReason,
      attemptedAt,
      status: "open",
    })
    .returning({ id: schema.deadLetters.id });

  return { id: row.id };
}

export interface ListDeadLettersOpts {
  db: Database;
  status?: string;
  source?: string;
  limit?: number;
  cursor?: string;
}

export interface DeadLetterRow {
  id: string;
  source: string;
  text: string;
  rawPayload: unknown;
  errorReason: string;
  attemptedAt: Date;
  retriedAt: Date | null;
  lastError: string | null;
  status: string;
  createdAt: Date;
}

/**
 * List dead letters with optional status/source filters, cursor-based pagination.
 */
export async function listDeadLetters(opts: ListDeadLettersOpts): Promise<{
  items: DeadLetterRow[];
  nextCursor: string | null;
}> {
  const { db, status, source, limit = 20, cursor } = opts;
  const boundedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

  const conditions: Array<ReturnType<typeof eq> | unknown> = [];
  if (status) conditions.push(eq(schema.deadLetters.status, status as "open" | "retrying" | "dead"));
  if (source) conditions.push(eq(schema.deadLetters.source, truncateText(source, MAX_TEXT_LEN)));
  if (cursor) {
    const cursorDate = new Date(cursor);
    if (!Number.isNaN(cursorDate.getTime())) {
      conditions.push(lt(schema.deadLetters.createdAt, cursorDate));
    }
  }

  const whereClause = conditions.length > 0
    ? conditions.length === 1 ? conditions[0] : { and: conditions }
    : undefined;

  const rows = await db
    .select()
    .from(schema.deadLetters)
    .where(whereClause as any)
    .orderBy(desc(schema.deadLetters.createdAt))
    .limit(boundedLimit);

  const nextCursor = rows.length === boundedLimit
    ? rows[rows.length - 1].createdAt.toISOString()
    : null;

  return {
    items: rows.map((r) => ({
      id: r.id,
      source: r.source,
      text: r.text,
      rawPayload: r.rawPayload,
      errorReason: r.errorReason,
      attemptedAt: r.attemptedAt,
      retriedAt: r.retriedAt ?? null,
      lastError: r.lastError ?? null,
      status: r.status,
      createdAt: r.createdAt,
    })),
    nextCursor,
  };
}

export interface RetryDeadLetterArgs {
  db: Database;
  id: string;
}

/**
 * Mark a dead letter as 'retrying', clear lastError, and return it for caller to process.
 * Row must be in 'open' status to retry.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function retryDeadLetter(args: RetryDeadLetterArgs): Promise<DeadLetterRow | null> {
  const { db, id } = args;

  if (!UUID_PATTERN.test(id)) {
    return null;
  }

  // Atomic claim: only a row still in 'open' can be claimed, so two concurrent
  // retryDeadLetter calls cannot both process the same row.
  const [row] = await db
    .update(schema.deadLetters)
    .set({
      status: "retrying",
      retriedAt: new Date(),
      lastError: null,
    })
    .where(and(eq(schema.deadLetters.id, id), eq(schema.deadLetters.status, "open")))
    .returning();

  if (!row) return null;

  return {
    id: row.id,
    source: row.source,
    text: row.text,
    rawPayload: row.rawPayload,
    errorReason: row.errorReason,
    attemptedAt: row.attemptedAt,
    retriedAt: row.retriedAt,
    lastError: row.lastError,
    status: row.status,
    createdAt: row.createdAt,
  };
}
