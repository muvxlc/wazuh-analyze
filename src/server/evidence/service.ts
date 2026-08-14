import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";

import type { Database } from "../db/types";
import * as schema from "../db/schema";
import { AppError } from "../errors";

/** Hard upper bound matching DB CHECK constraint. */
const MAX_CONTENT_BYTES = 65_536;
/** Max provenanceEndpoint length. */
const MAX_ENDPOINT_LEN = 2048;

export interface EvidenceRecord {
  id: string;
  alertId: string | null;
  incidentId: string | null;
  evidenceType: "ioc" | "log" | "note" | "network" | "threat_intel";
  title: string;
  content: unknown;
  provenanceEndpoint: string | null;
  eventAt: Date | null;
  retrievedAt: Date;
  contentHash: string;
  contentSize: number;
  validated: boolean;
  validatedByUserId: string | null;
  validatedAt: Date | null;
  createdByUserId: string | null;
  createdAt: Date;
}

type Row = typeof schema.evidenceRecords.$inferSelect;

function mapRow(row: Row): EvidenceRecord {
  return {
    id: row.id,
    alertId: row.alertId,
    incidentId: row.incidentId,
    evidenceType: row.evidenceType,
    title: row.title,
    content: row.content,
    provenanceEndpoint: row.provenanceEndpoint,
    eventAt: row.eventAt,
    retrievedAt: row.retrievedAt,
    contentHash: row.contentHash,
    contentSize: row.contentSize ?? 0,
    validated: row.validated,
    validatedByUserId: row.validatedByUserId,
    validatedAt: row.validatedAt,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

/**
 * Validate exactly one of alertId or incidentId is provided and both reference
 * existing rows in their respective tables. Returns the matched ID.
 */
async function validateScopedIds(
  db: Database,
  input: { alertId?: string | null; incidentId?: string | null },
): Promise<{ alertId: string | null; incidentId: string | null }> {
  const hasAlert = !!input.alertId;
  const hasIncident = !!input.incidentId;

  if (!hasAlert && !hasIncident) {
    throw new AppError("bad_request", 400, {
      reason: "exactly one of alertId or incidentId required",
    });
  }
  if (hasAlert && hasIncident) {
    throw new AppError("bad_request", 400, {
      reason: "alertId and incidentId are mutually exclusive",
    });
  }

  if (hasAlert) {
    const [found] = await db
      .select({ id: schema.alerts.id })
      .from(schema.alerts)
      .where(eq(schema.alerts.id, input.alertId!))
      .limit(1);
    if (!found) {
      throw new AppError("not_found", 404, { id: input.alertId, table: "alerts" });
    }
  }

  if (hasIncident) {
    const [found] = await db
      .select({ id: schema.incidents.id })
      .from(schema.incidents)
      .where(eq(schema.incidents.id, input.incidentId!))
      .limit(1);
    if (!found) {
      throw new AppError("not_found", 404, { id: input.incidentId, table: "incidents" });
    }
  }

  return {
    alertId: input.alertId ?? null,
    incidentId: input.incidentId ?? null,
  };
}

/** Compute SHA-256 of canonical JSON + byte length. Returns [hashHex, byteCount]. */
function hashAndSize(content: unknown): [string, number] {
  const canonical = JSON.stringify(content);
  const bytes = Buffer.byteLength(canonical, "utf8");
  const hash = createHash("sha256").update(canonical).digest("hex");
  return [hash, bytes];
}

/** Create a new evidence record. Mutually exclusive: exactly one of alertId/incidentId. */
export async function createEvidenceRecord(
  db: Database,
  input: {
    evidenceType: "ioc" | "log" | "note" | "network" | "threat_intel";
    title: string;
    content: unknown;
    provenanceEndpoint?: string | null;
    eventAt?: Date | null;
    alertId?: string | null;
    incidentId?: string | null;
    createdByUserId?: string | null;
  },
): Promise<EvidenceRecord> {
  if (!input.title || !input.evidenceType) {
    throw new AppError("bad_request", 400, {
      reason: "title and evidenceType required",
    });
  }

  const scoped = await validateScopedIds(db, input);

  const [hashHex, byteLen] = hashAndSize(input.content);
  if (byteLen > MAX_CONTENT_BYTES) {
    throw new AppError("bad_request", 400, {
      reason: `content exceeds ${MAX_CONTENT_BYTES} bytes`,
      byteLen,
    });
  }

  if (
    input.provenanceEndpoint !== undefined &&
    input.provenanceEndpoint !== null &&
    input.provenanceEndpoint.length > MAX_ENDPOINT_LEN
  ) {
    throw new AppError("bad_request", 400, {
      reason: "provenanceEndpoint exceeds 2048 chars",
    });
  }

  const now = new Date();
  const [row] = await db
    .insert(schema.evidenceRecords)
    .values({
      alertId: scoped.alertId,
      incidentId: scoped.incidentId,
      evidenceType: input.evidenceType,
      title: input.title,
      content: input.content,
      provenanceEndpoint: input.provenanceEndpoint ?? null,
      eventAt: input.eventAt ?? null,
      retrievedAt: now,
      contentHash: hashHex,
      contentSize: byteLen,
      createdByUserId: input.createdByUserId ?? null,
      validated: false,
    })
    .returning();

  return mapRow(row);
}

/** Optional caller-supplied scope; when set, the record must belong to it. */
export type EvidenceScope = { alertId?: string | null; incidentId?: string | null };

/** Assert the record's own scope matches the caller-supplied scope, else 404. */
function assertScopeMatch(
  row: { alertId: string | null; incidentId: string | null },
  scope: EvidenceScope | undefined,
): void {
  if (!scope) return;
  const expectedAlert = scope.alertId ?? null;
  const expectedIncident = scope.incidentId ?? null;
  if (row.alertId !== expectedAlert || row.incidentId !== expectedIncident) {
    throw new AppError("not_found", 404, { id: "row scope mismatch" });
  }
}

/** Mark an evidence record validated by a user. Sets validatedAt. */
export async function validateEvidenceRecord(
  db: Database,
  id: string,
  validatedByUserId: string,
  scope?: EvidenceScope,
): Promise<EvidenceRecord> {
  const [row] = await db
    .update(schema.evidenceRecords)
    .set({ validated: true, validatedByUserId, validatedAt: new Date() })
    .where(eq(schema.evidenceRecords.id, id))
    .returning();

  if (!row) {
    throw new AppError("not_found", 404, { id });
  }
  assertScopeMatch(row, scope);
  return mapRow(row);
}

/** Delete an evidence record by id. Returns void; throws 404 if missing. */
export async function deleteEvidenceRecord(
  db: Database,
  id: string,
  scope?: EvidenceScope,
): Promise<void> {
  const [row] = await db
    .delete(schema.evidenceRecords)
    .where(eq(schema.evidenceRecords.id, id))
    .returning({ id: schema.evidenceRecords.id, alertId: schema.evidenceRecords.alertId, incidentId: schema.evidenceRecords.incidentId });

  if (!row) {
    throw new AppError("not_found", 404, { id });
  }
  assertScopeMatch(row, scope);
}

/** List evidence records, optionally scoped to an alert or incident. */
export async function listEvidenceRecords(
  db: Database,
  opts: {
    limit?: number;
    alertId?: string | null;
    incidentId?: string | null;
    evidenceType?: "ioc" | "log" | "note" | "network" | "threat_intel";
    validated?: boolean | null;
  } = {},
): Promise<EvidenceRecord[]> {
  const conditions: Array<ReturnType<typeof eq>> = [];
  if (opts.alertId) {
    conditions.push(eq(schema.evidenceRecords.alertId, opts.alertId));
  }
  if (opts.incidentId) {
    conditions.push(eq(schema.evidenceRecords.incidentId, opts.incidentId));
  }
  if (opts.evidenceType) {
    conditions.push(eq(schema.evidenceRecords.evidenceType, opts.evidenceType));
  }
  if (opts.validated === true) {
    conditions.push(eq(schema.evidenceRecords.validated, true));
  } else if (opts.validated === false) {
    conditions.push(eq(schema.evidenceRecords.validated, false));
  }

  const rows = await db
    .select()
    .from(schema.evidenceRecords)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.evidenceRecords.createdAt))
    .limit(opts.limit ?? 100);

  return rows.map(mapRow);
}
