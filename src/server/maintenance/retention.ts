import { asc, inArray, lte } from "drizzle-orm";
import type { Database } from "../db/types";
import * as schema from "../db/schema";

export interface DeleteExpiredAlertsInput {
  before: Date;
  batchSize: number;
}

/**
 * Bounded retention: selects expired alert IDs using FOR UPDATE SKIP LOCKED
 * to prevent concurrent workers from processing the same rows.
 * Returns the number of rows deleted in this invocation.
 */
export async function deleteExpiredAlerts(
  db: Database,
  input: DeleteExpiredAlertsInput,
): Promise<number> {
  const { before, batchSize } = input;

  return db.transaction(async (tx) => {
    // Select expired IDs with FOR UPDATE SKIP LOCKED for concurrency safety
    const batch = await tx
      .select({ id: schema.alerts.id })
      .from(schema.alerts)
      .where(lte(schema.alerts.ingestedAt, before))
      .orderBy(asc(schema.alerts.ingestedAt))
      .limit(batchSize)
      .for("update", { skipLocked: true })
      .execute();

    if (batch.length === 0) {
      return 0;
    }

    const ids = batch.map((row) => row.id);

    // Delete alert_events first (cascade would also work, but explicit is clearer)
    await tx
      .delete(schema.alertEvents)
      .where(inArray(schema.alertEvents.alertId, ids));

    // Delete alerts
    const result = await tx
      .delete(schema.alerts)
      .where(inArray(schema.alerts.id, ids));

    return batch.length;
  });
}
