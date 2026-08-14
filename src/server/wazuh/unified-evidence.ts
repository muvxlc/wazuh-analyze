import "server-only";

import { z } from "zod";

/**
 * Minimal normalized evidence contract for webhook/API/Indexer pipeline.
 * Single source of truth for upstream ingestion and downstream consumers.
 */

export const MAX_STRING_LENGTH = 512;
export const MAX_SOURCE_ID_LENGTH = 256;
export const MAX_FIELDS_BYTES = 4096;

export type EvidenceProvenance = "webhook" | "api" | "indexer" | "manual" | "integration";

const EvidenceProvenanceEnum = z.enum(["webhook", "api", "indexer", "manual", "integration"]) satisfies z.ZodType<EvidenceProvenance>;

// Refine rejects blank strings, then transform trims. Refine runs before trim
// so "   " fails min(1) instead of becoming "".
function TrimmedString(min = 1, max = MAX_STRING_LENGTH) {
  return z
    .string()
    .refine((s) => s.trim().length >= min, { message: `must not be blank (min ${min})` })
    .transform((s) => s.trim())
    .refine((s) => s.length <= max, { message: `must be <= ${max} chars` });
}

export const EvidenceSchema = z.object({
  source: TrimmedString(1, MAX_STRING_LENGTH),
  sourceId: TrimmedString(1, MAX_SOURCE_ID_LENGTH),
  entityType: TrimmedString(1, MAX_STRING_LENGTH),
  agentId: TrimmedString(1, MAX_SOURCE_ID_LENGTH),
  eventTime: z.string().datetime({ offset: true }),
  retrievedAt: z.string().datetime({ offset: true }).default(() => new Date().toISOString()),
  provenance: EvidenceProvenanceEnum,
  /**
   * Arbitrary field bag. Values must be string | number | boolean | null.
   * Non-primitive values fall through to catch (empty record) since Zod v4
   * does not prune object values inside z.record().
   */
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export type Evidence = z.infer<typeof EvidenceSchema>;

export class EvidenceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EvidenceError";
  }
}
const BOUND_STRING_LENGTH = MAX_STRING_LENGTH;
const BOUND_SOURCE_ID_LENGTH = MAX_SOURCE_ID_LENGTH;

function boundString(value: unknown, maxLength = BOUND_STRING_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function boundSourceId(value: unknown): string | undefined {
  return boundString(value, BOUND_SOURCE_ID_LENGTH);
}

function coerceDateTime(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
      const d = new Date(trimmed);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) return value.toISOString();
  }
  return undefined;
}

// Deterministic list of key substrings to redact (case-insensitive match).
const REDACT_KEY_PATTERNS = [
  "api_key",
  "apikey",
  "api-key",
  "access_token",
  "accesstoken",
  "access-token",
  "auth_token",
  "authtoken",
  "auth-token",
  "secret",
  "password",
  "passwd",
  "credential",
  "token",
  "private_key",
  "privatekey",
  "private-key",
];

function shouldRedactKey(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACT_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

function redactFields(fields: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (shouldRedactKey(key)) {
      if (typeof value === "string" && value.length > 0) {
        out[key] = "[REDACTED]";
        continue;
      }
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (value === null) {
      out[key] = null;
    }
    // drop non-serializable values silently
  }
  return out;
}

function truncateFieldsBytes(fields: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  const serialized = JSON.stringify(fields);
  if (serialized.length <= MAX_FIELDS_BYTES) return fields;
  // trim values to fit budget; worst case ~JSON envelope overhead per key
  const budgetPerValue = Math.max(0, Math.floor((MAX_FIELDS_BYTES - 4) / Math.max(1, Object.keys(fields).length)) - 2);
  const trimmed: Record<string, string | number | boolean | null> = {};
  let used = 0;
  for (const [key, value] of Object.entries(fields)) {
    const keyLen = JSON.stringify(key).length;
    if (typeof value === "string") {
      const truncated = value.slice(0, Math.max(0, budgetPerValue));
      const entry = JSON.stringify({ [key]: truncated }).length;
      if (used + entry > MAX_FIELDS_BYTES) break;
      trimmed[key] = truncated;
      used += entry;
    } else {
      const entry = JSON.stringify({ [key]: value }).length;
      if (used + entry > MAX_FIELDS_BYTES) break;
      trimmed[key] = value;
      used += entry;
    }
  }
  return trimmed;
}

export function parseEvidence(raw: unknown): Evidence {
  const result = EvidenceSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  throw new EvidenceError("EVIDENCE_PARSE_ERROR", `Invalid evidence: ${result.error.message}`);
}

export function buildEvidence(input: {
  source: unknown;
  sourceId: unknown;
  entityType: unknown;
  agentId: unknown;
  eventTime: unknown;
  retrievedAt?: unknown;
  provenance: EvidenceProvenance;
  fields: Record<string, unknown>;
}): Evidence {
  const source = boundString(input.source);
  const sourceId = boundSourceId(input.sourceId);
  const entityType = boundString(input.entityType);
  const agentId = boundSourceId(input.agentId);
  const eventTime = coerceDateTime(input.eventTime);
  const retrievedAt = coerceDateTime(input.retrievedAt ?? new Date());

  if (!source || !sourceId || !entityType || !agentId || !eventTime || !retrievedAt) {
    throw new EvidenceError(
      "EVIDENCE_BUILD_ERROR",
      `Missing required field: source=${!!source} sourceId=${!!sourceId} entityType=${!!entityType} agentId=${!!agentId} eventTime=${!!eventTime} retrievedAt=${!!retrievedAt}`,
    );
  }

  const cleaned = redactFields(input.fields);
  const bounded = truncateFieldsBytes(cleaned);

  return {
    source,
    sourceId,
    entityType,
    agentId,
    eventTime,
    retrievedAt,
    provenance: input.provenance,
    fields: bounded,
  };
}

/**
 * Deterministic hash of evidence core identity (source + sourceId + entityType + agentId).
 * Useful for deduplication keys without leaking eventTime/fields content.
 */
export function evidenceIdentityKey(e: Evidence): string {
  return `${e.source}|${e.sourceId}|${e.entityType}|${e.agentId}`;
}
