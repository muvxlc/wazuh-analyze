import { and, desc, eq, sql } from "drizzle-orm";

import type { Database } from "../db/types";
import * as schema from "../db/schema";
import { AppError } from "../errors";

/** Max allowed freshnessSlaMs — 24 hours in ms. */
const MAX_FRESHNESS_SLA_MS = 86_400_000;
/** Max allowed parseErrorCount — 2^31 - 1 (int32 upper bound). */
const MAX_PARSE_ERRORS = 2_147_483_647;
/** Hard cap on lastError text length. */
const MAX_ERROR_LEN = 512;
/** Hard cap on credentialScope text length. */
const MAX_CRED_SCOPE_LEN = 256;

/** Source coverage entry — what the caller sees. */
export interface SourceCoverageEntry {
  id: string;
  sourceKey: string;
  sourceType: "deployment" | "feed" | "manual" | "api";
  endpoint: string | null;
  credentialScope: string;
  enabled: boolean;
  lastSuccessAt: Date | null;
  lastEventAt: Date | null;
  itemCount: number | null;
  parseErrorCount: number;
  freshnessSlaMs: number | null;
  contractVersion: string | null;
  lastError: string | null;
  updatedAt: Date;
  createdByUserId: string | null;
  createdAt: Date;
}

type Row = typeof schema.sourceCoverage.$inferSelect;

function mapRow(row: Row): SourceCoverageEntry {
  return {
    id: row.id,
    sourceKey: row.sourceKey,
    sourceType: row.sourceType,
    endpoint: row.endpoint,
    credentialScope: row.credentialScope,
    enabled: row.enabled,
    lastSuccessAt: row.lastSuccessAt,
    lastEventAt: row.lastEventAt,
    itemCount: row.itemCount,
    parseErrorCount: row.parseErrorCount ?? 0,
    freshnessSlaMs: row.freshnessSlaMs,
    contractVersion: row.contractVersion,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

/**
 * Upsert source coverage by sourceKey.
 * On insert: creates new row with current timestamps.
 * On conflict (update): preserves analyst-captured state (lastSuccessAt, enabled,
 * itemCount) and only overwrites operational fields (endpoint, credentialScope,
 * contractVersion, lastError, updatedAt, parseErrorCount + increment).
 */
export async function upsertSourceCoverage(
  db: Database,
  input: {
    sourceKey: string;
    sourceType: "deployment" | "feed" | "manual" | "api";
    endpoint?: string | null;
    credentialScope: string;
    enabled?: boolean | null;
    itemCount?: number | null;
    parseErrorCount?: number | null;
    freshnessSlaMs?: number | null;
    contractVersion?: string | null;
    lastError?: string | null;
    createdByUserId?: string | null;
  },
): Promise<SourceCoverageEntry> {
  if (!input.sourceKey || !input.credentialScope) {
    throw new AppError("bad_request", 400, {
      reason: "sourceKey and credentialScope required",
    });
  }

  if (input.credentialScope.length > MAX_CRED_SCOPE_LEN) {
    throw new AppError("bad_request", 400, {
      reason: `credentialScope exceeds ${MAX_CRED_SCOPE_LEN} chars`,
    });
  }

  // Never allow raw secrets in credentialScope — reject anything that looks like
  // a token/secret value (best-effort heuristic at the trust boundary).
  if (/[:=]\s*[A-Za-z0-9+/]{20,}/.test(input.credentialScope)) {
    throw new AppError("bad_request", 400, {
      reason: "credentialScope must not contain raw secrets (key=value/token patterns rejected)",
    });
  }

  if (input.endpoint !== undefined && input.endpoint !== null) {
    if (input.endpoint.length > 2048) {
      throw new AppError("bad_request", 400, { reason: "endpoint exceeds 2048 chars" });
    }
  }

  const now = new Date();
  const truncatedError =
    input.lastError !== undefined && input.lastError !== null
      ? input.lastError.slice(0, MAX_ERROR_LEN)
      : null;

  const [row] = await db
    .insert(schema.sourceCoverage)
    .values({
      sourceKey: input.sourceKey,
      sourceType: input.sourceType,
      endpoint: input.endpoint ?? null,
      credentialScope: input.credentialScope,
      enabled: input.enabled ?? true,
      lastSuccessAt: null,
      lastEventAt: now,
      itemCount: input.itemCount ?? null,
      parseErrorCount: input.parseErrorCount ?? 0,
      freshnessSlaMs: input.freshnessSlaMs ?? null,
      contractVersion: input.contractVersion ?? null,
      lastError: truncatedError,
      updatedAt: now,
      createdByUserId: input.createdByUserId ?? null,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.sourceCoverage.sourceKey],
      set: {
        endpoint: sql`excluded.endpoint`,
        credentialScope: sql`excluded.credential_scope`,
        // Preserve analyst-captured state: do NOT overwrite enabled, lastSuccessAt,
        // itemCount from the excluded row.
        lastEventAt: sql`excluded.last_event_at`,
        parseErrorCount: sql`excluded.parse_error_count + source_coverage.parse_error_count`,
        freshnessSlaMs: sql`excluded.freshness_sla_ms`,
        contractVersion: sql`excluded.contract_version`,
        lastError: sql`excluded.last_error`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning();

  return mapRow(row);
}

/**
 * Mark a source as successfully ingested — updates lastSuccessAt, lastEventAt,
 * and increments parseErrorCount by 0 (no-op counter), while preserving all
 * other analyst state.
 */
export async function recordIngestSuccess(
  db: Database,
  sourceKey: string,
  opts: {
    itemCount?: number | null;
    lastError?: string | null;
  } = {},
): Promise<SourceCoverageEntry> {
  if (!sourceKey) {
    throw new AppError("bad_request", 400, { reason: "sourceKey required" });
  }

  const now = new Date();
  const truncatedError =
    opts.lastError !== undefined && opts.lastError !== null
      ? opts.lastError.slice(0, MAX_ERROR_LEN)
      : null;

  const [row] = await db
    .update(schema.sourceCoverage)
    .set({
      lastSuccessAt: now,
      lastEventAt: now,
      itemCount: opts.itemCount ?? null,
      lastError: truncatedError,
      updatedAt: now,
    })
    .where(eq(schema.sourceCoverage.sourceKey, sourceKey))
    .returning();

  if (!row) {
    throw new AppError("not_found", 404, { sourceKey });
  }
  return mapRow(row);
}

/**
 * Mark a source as having a failure event — updates lastEventAt and lastError
 * but does NOT touch lastSuccessAt (preserves the last-good timestamp).
 */
export async function recordIngestFailure(
  db: Database,
  sourceKey: string,
  error: string,
): Promise<SourceCoverageEntry> {
  if (!sourceKey || !error) {
    throw new AppError("bad_request", 400, { reason: "sourceKey and error required" });
  }

  const now = new Date();
  const truncatedError = error.slice(0, MAX_ERROR_LEN);

  const [row] = await db
    .update(schema.sourceCoverage)
    .set({
      lastEventAt: now,
      lastError: truncatedError,
      parseErrorCount: sql`${schema.sourceCoverage.parseErrorCount} + 1`,
      updatedAt: now,
    })
    .where(eq(schema.sourceCoverage.sourceKey, sourceKey))
    .returning();

  if (!row) {
    throw new AppError("not_found", 404, { sourceKey });
  }
  return mapRow(row);
}

/**
 * Toggle enabled flag on a source. Preserves all other state.
 */
export async function setSourceEnabled(
  db: Database,
  sourceKey: string,
  enabled: boolean,
): Promise<SourceCoverageEntry> {
  if (!sourceKey) {
    throw new AppError("bad_request", 400, { reason: "sourceKey required" });
  }

  const [row] = await db
    .update(schema.sourceCoverage)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(schema.sourceCoverage.sourceKey, sourceKey))
    .returning();

  if (!row) {
    throw new AppError("not_found", 404, { sourceKey });
  }
  return mapRow(row);
}

/**
 * Configure freshness SLA on a source. Validates bounds (0–24h in ms).
 */
export async function setFreshnessSla(
  db: Database,
  sourceKey: string,
  freshnessSlaMs: number,
): Promise<SourceCoverageEntry> {
  if (!sourceKey) {
    throw new AppError("bad_request", 400, { reason: "sourceKey required" });
  }
  if (
    !Number.isFinite(freshnessSlaMs) ||
    freshnessSlaMs < 0 ||
    freshnessSlaMs > MAX_FRESHNESS_SLA_MS
  ) {
    throw new AppError("bad_request", 400, {
      reason: `freshnessSlaMs must be 0-${MAX_FRESHNESS_SLA_MS} ms`,
      value: freshnessSlaMs,
    });
  }

  const [row] = await db
    .update(schema.sourceCoverage)
    .set({ freshnessSlaMs, updatedAt: new Date() })
    .where(eq(schema.sourceCoverage.sourceKey, sourceKey))
    .returning();

  if (!row) {
    throw new AppError("not_found", 404, { sourceKey });
  }
  return mapRow(row);
}

/**
 * Calculate stale sources — those whose lastSuccessAt is older than their
 * configured freshnessSlaMs, or that have never succeeded when SLA is set.
 */
export async function listStaleSources(
  db: Database,
): Promise<SourceCoverageEntry[]> {
  const rows = await db
    .select()
    .from(schema.sourceCoverage)
    .where(
      sql`${schema.sourceCoverage.enabled} = true AND (
        (${schema.sourceCoverage.lastSuccessAt} IS NULL AND ${schema.sourceCoverage.freshnessSlaMs} IS NOT NULL)
        OR (${schema.sourceCoverage.lastSuccessAt} IS NOT NULL AND ${schema.sourceCoverage.lastSuccessAt} < now() - (${schema.sourceCoverage.freshnessSlaMs}::integer || 'ms')::interval)
      )`,
    )
    .orderBy(desc(schema.sourceCoverage.lastEventAt))
    .limit(200);

  return rows.map(mapRow);
}

/**
 * List sources with optional filters.
 */
export async function listSourceCoverage(
  db: Database,
  opts: {
    limit?: number;
    sourceType?: "deployment" | "feed" | "manual" | "api";
    enabled?: boolean | null;
    staleOnly?: boolean;
  } = {},
): Promise<SourceCoverageEntry[]> {
  const conditions: Array<ReturnType<typeof eq>> = [];
  if (opts.sourceType) {
    conditions.push(eq(schema.sourceCoverage.sourceType, opts.sourceType));
  }
  if (opts.enabled !== undefined && opts.enabled !== null) {
    conditions.push(eq(schema.sourceCoverage.enabled, opts.enabled));
  }

  let rows;
  if (opts.staleOnly) {
    rows = await db
      .select()
      .from(schema.sourceCoverage)
      .where(
        sql`${schema.sourceCoverage.enabled} = true AND (
          (${schema.sourceCoverage.lastSuccessAt} IS NULL AND ${schema.sourceCoverage.freshnessSlaMs} IS NOT NULL)
          OR (${schema.sourceCoverage.lastSuccessAt} IS NOT NULL AND ${schema.sourceCoverage.lastSuccessAt} < now() - (${schema.sourceCoverage.freshnessSlaMs}::integer || 'ms')::interval)
        )`,
      )
      .orderBy(desc(schema.sourceCoverage.lastEventAt))
      .limit(opts.limit ?? 100);
  } else {
    rows = await db
      .select()
      .from(schema.sourceCoverage)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.sourceCoverage.lastEventAt))
      .limit(opts.limit ?? 100);
  }

  return rows.map(mapRow);
}
