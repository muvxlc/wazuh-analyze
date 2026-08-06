import { eq, or } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "../db/types";
import * as schema from "../db/schema";
import type { NormalizedAlertInput, AlertRecord, AlertStatus } from "./types";
import { createAlertFingerprint } from "./fingerprint";

export async function persistAlert(
  db: Database | DatabaseTransaction,
  input: NormalizedAlertInput,
): Promise<{ alert: AlertRecord; inserted: boolean }> {
  const withFingerprint: NormalizedAlertInput = {
    ...input,
    fingerprint: input.fingerprint || createAlertFingerprint(input),
  };

  // Insert inside a (sub)transaction. On a 23505 unique violation only the
  // savepoint rolls back, leaving the caller's outer transaction usable for
  // the dedup lookup. Keeps persistAlert race-safe while still returning the
  // existing AlertRecord to direct callers.
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.alerts)
        .values({
          wazuhEventId: withFingerprint.wazuhEventId,
          fingerprint: withFingerprint.fingerprint,
          wazuhTimestamp: withFingerprint.wazuhTimestamp,
          agentId: withFingerprint.agentId,
          agentName: withFingerprint.agentName,
          agentIp: withFingerprint.agentIp,
          ruleId: withFingerprint.ruleId,
          ruleDescription: withFingerprint.ruleDescription,
          level: withFingerprint.level,
          groups: withFingerprint.groups,
          compliance: withFingerprint.compliance,
          rawPayload: withFingerprint.rawPayload,
        })
        .returning()
        .execute();

      return { alert: mapAlertRow(row), inserted: true };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Savepoint/transaction rolled back — lookup the existing row.
    const existing = await findExistingAlert(db, withFingerprint);
    return { alert: existing as AlertRecord, inserted: false };
  }
}

/**
 * Lookup an existing alert by fingerprint or wazuhEventId after a unique
 * constraint violation. Both columns carry unique indexes.
 */
async function findExistingAlert(
  db: Database | DatabaseTransaction,
  input: NormalizedAlertInput,
): Promise<AlertRecord | null> {
  const conditions = [eq(schema.alerts.fingerprint, input.fingerprint)];
  if (input.wazuhEventId) {
    conditions.push(eq(schema.alerts.wazuhEventId, input.wazuhEventId));
  }
  const [row] = await db
    .select()
    .from(schema.alerts)
    .where(or(...conditions))
    .limit(1);
  return row ? mapAlertRow(row) : null;
}

export function mapAlertRow(row: (typeof schema.alerts.$inferSelect)): AlertRecord {
  return {
    id: row.id,
    wazuhEventId: row.wazuhEventId,
    fingerprint: row.fingerprint,
    wazuhTimestamp: row.wazuhTimestamp,
    ingestedAt: row.ingestedAt,
    agentId: row.agentId,
    agentName: row.agentName,
    agentIp: row.agentIp,
    ruleId: row.ruleId,
    ruleDescription: row.ruleDescription,
    level: row.level,
    groups: row.groups,
    compliance: row.compliance as Record<string, unknown>,
    status: row.status as AlertStatus,
    acknowledgedAt: row.acknowledgedAt,
    acknowledgedByUserId: row.acknowledgedByUserId,
    resolvedAt: row.resolvedAt,
    resolvedByUserId: row.resolvedByUserId,
    rawPayload: row.rawPayload,
  };
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
