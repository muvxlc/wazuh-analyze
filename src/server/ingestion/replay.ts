import "server-only";

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

import * as schema from "../db/schema";
import type { Database, DatabaseTransaction } from "../db/types";
import { AppError } from "../errors";
import type { RawEventRecord } from "../wazuh/indexer-search";
import type { WazuhConfig } from "../wazuh/types";
import type { Database as DBType } from "../db/types";
import { searchIndexerEvents } from "../wazuh/indexer-search";
import { persistAlert } from "../alerts/alert-repository";
import { createAlertFingerprint } from "../alerts/fingerprint";
import { insertDeadLetter } from "./dead-letter";

// ── Replay key helpers (preserved from original) ────────────────────────────

/**
 * Compute replay-key hash from `<timestamp>\n<signature>` literal bytes.
 * This is the canonical key for the webhook_replay_keys unique index.
 */
export function computeReplayKeyHash(
  timestamp: string,
  signature: string,
): string {
  const input = `${timestamp}\n${signature}`;
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Insert a replay key row within the current transaction.
 * Maps the 23505 unique-constraint violation to a 409 replay-rejected AppError.
 */
export async function insertReplayKey(
  tx: DatabaseTransaction,
  args: {
    keyHash: string;
    expiresAt: Date;
  },
): Promise<void> {
  try {
    await tx.insert(schema.webhookReplayKeys).values({
      keyHash: args.keyHash,
      expiresAt: args.expiresAt,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("replay_rejected", 409);
    }
    throw error;
  }
}

/**
 * Confirm a replay row exists (used by idempotent GET-style probes — not the
 * ingestion path, but exposed for test parity and future GET endpoint).
 */
export async function findReplayKey(
  db: Database,
  keyHash: string,
): Promise<{ id: string; keyHash: string; expiresAt: Date } | null> {
  const [row] = await db
    .select({
      id: schema.webhookReplayKeys.id,
      keyHash: schema.webhookReplayKeys.keyHash,
      expiresAt: schema.webhookReplayKeys.expiresAt,
    })
    .from(schema.webhookReplayKeys)
    .where(eq(schema.webhookReplayKeys.keyHash, keyHash))
    .limit(1);

  return row ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    code?: string;
    cause?: { code?: string };
    details?: { code?: string };
  };
  return e.code === "23505" || e.cause?.code === "23505" || e.details?.code === "23505";
}

// ── Replay from indexer (Phase 1 DLQ) ───────────────────────────────────────

const MAX_INDEXER_BATCH = 50;

export function eventToNormalized(event: RawEventRecord): import("../alerts/types").NormalizedAlertInput {
  const wazuhTimestamp = event.wazuhTimestamp
    ? new Date(event.wazuhTimestamp)
    : new Date();
  if (Number.isNaN(wazuhTimestamp.getTime())) {
    throw new Error("invalid wazuh_timestamp");
  }
  return {
    wazuhEventId: event.id || null,
    fingerprint: "", // computed below via createAlertFingerprint fallback
    wazuhTimestamp,
    agentId: event.agentId || null,
    agentName: null,
    agentIp: null,
    ruleId: event.ruleId || null,
    ruleDescription: event.description || "",
    level: event.level ?? 0,
    groups: [],
    compliance: {},
    rawPayload: {
      id: event.id,
      agent_id: event.agentId,
      rule_id: event.ruleId,
      level: event.level,
      description: event.description,
      status: event.status,
      "@timestamp": event.wazuhTimestamp,
      ingested_at: event.ingestedAt,
      highlights: event.highlights,
    },
  };
}

export interface ReplayIndexerAlertsOpts {
  db: DBType;
  config: WazuhConfig;
  /** ISO-8601 start (inclusive); defaults to 24h ago. */
  since?: string;
  /** Max events to attempt; clamped to [1, 100]. Default 20. */
  limit?: number;
  /** Max dead-letter inserts before short-circuiting. Default 20. */
  maxDeadLetters?: number;
}

export interface ReplayIndexerAlertsResult {
  attempted: number;
  inserted: number;
  duplicates: number;
  deadLettersInserted: number;
}

/**
 * Replay alert ingestion from Wazuh indexer for the phase-1 dead-letter queue.
 *
 * Phase 1 scope:
 *   - Fetch events from indexer (bounded by `limit`, `since`).
 *   - Normalize + idempotently persist via existing alert flow (fingerprint dedup).
 *   - On normalization or persist failure, record a dead-letter row.
 *   - Bounded: clamps limit to [1, 100], uses fixed 10s fetch timeout via indexer.
 *
 * Not in scope (Phase 2+):
 *   - Dead-letter retry daemon / worker loop.
 *   - API routes / UI for DLQ management.
 *   - Exponential backoff, partial retries, or DLQ sweep.
 */
export async function replayIndexerAlerts(
  opts: ReplayIndexerAlertsOpts,
): Promise<ReplayIndexerAlertsResult> {
  const {
    db,
    config,
    since,
    limit = 20,
    maxDeadLetters = 20,
  } = opts;

  const boundedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const boundedMaxDL = Math.min(Math.max(Number(maxDeadLetters) || 20, 1), 100);

  const from = since ? new Date(since).toISOString() : undefined;

  const result: ReplayIndexerAlertsResult = {
    attempted: 0,
    inserted: 0,
    duplicates: 0,
    deadLettersInserted: 0,
  };

  try {
    let cursor = from;
    let batchProcessed = 0;
    while (batchProcessed < boundedLimit) {
      const batchSize = Math.min(MAX_INDEXER_BATCH, boundedLimit - batchProcessed);
      const searchResponse = await searchIndexerEvents(config, {
        from: cursor,
        size: batchSize,
      });

      if (searchResponse.events.length === 0) break;

      for (const event of searchResponse.events) {
        if (batchProcessed >= boundedLimit) break;
        batchProcessed++;
        result.attempted++;
        if (result.deadLettersInserted >= boundedMaxDL) break;

        let normalized: import("../alerts/types").NormalizedAlertInput;
        try {
          normalized = eventToNormalized(event);
        } catch (err) {
          await insertDeadLetter({
            db,
            source: "indexer_replay",
            text: `replay normalize failed for event ${event.id}: ${err instanceof Error ? err.message : String(err)}`,
            rawPayload: { eventId: event.id, event },
            errorReason: err instanceof Error ? err.message : String(err),
          });
          result.deadLettersInserted++;
          continue;
        }

        normalized.fingerprint = createAlertFingerprint(normalized);

        try {
          const persistResult = await persistAlert(db, normalized);
          if (persistResult.inserted) {
            result.inserted++;
          } else {
            result.duplicates++;
          }
        } catch (err) {
          await insertDeadLetter({
            db,
            source: "indexer_replay",
            text: `replay persist failed for event ${event.id}: ${err instanceof Error ? err.message : String(err)}`,
            rawPayload: { eventId: event.id, normalized },
            errorReason: err instanceof Error ? err.message : String(err),
          });
          result.deadLettersInserted++;
        }
      }

      // Advance cursor past the last processed event (inclusive) so the next
      // batch continues forward.
      const lastEvent = searchResponse.events[searchResponse.events.length - 1];
      if (lastEvent?.wazuhTimestamp) {
        const lastTs = new Date(lastEvent.wazuhTimestamp);
        if (!Number.isNaN(lastTs.getTime())) {
          cursor = new Date(lastTs.getTime() + 1).toISOString();
        }
      }
    }
  } catch (err) {
    // Indexer fetch failure — surface as Error; do NOT insert DL row for the
    // fetch itself (Phase 2 daemon will surface this).
    throw new Error(
      `replay indexer search failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return result;
}
