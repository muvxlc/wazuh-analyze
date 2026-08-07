import { sql, asc } from "drizzle-orm";
import type { Database } from "../db/types";
import { alerts, alertAnalyses } from "../db/schema";
import { enqueueAlertAnalysis, QUEUE_ANALYZE_ALERT } from "./queue";
import { setQueuePhase } from "./progress";

/**
 * Find alerts without an analysis record and enqueue them for analysis.
 * Safe to re-run: enqueueAlertAnalysis dedupes via singletonKey (30 min).
 */
export async function enqueuePendingAlerts(db: Database, limit = 100): Promise<number> {
  const rows = await db
    .select({ id: alerts.id })
    .from(alerts)
    .leftJoin(alertAnalyses, sql`${alertAnalyses.alertId} = ${alerts.id}`)
    .where(sql`${alertAnalyses.id} IS NULL`)
    .orderBy(asc(alerts.ingestedAt))
    .limit(limit);

  for (const row of rows) {
    await setQueuePhase(db, QUEUE_ANALYZE_ALERT, row.id, "queued");
    await enqueueAlertAnalysis(row.id).catch(() => {});
  }
  return rows.length;
}

/** Count alerts that still lack an analysis record (for metrics card). */
export async function countPendingAlerts(db: Database): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(alerts)
    .leftJoin(alertAnalyses, sql`${alertAnalyses.alertId} = ${alerts.id}`)
    .where(sql`${alertAnalyses.id} IS NULL`);
  return row?.count ?? 0;
}
