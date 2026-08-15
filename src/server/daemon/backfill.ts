import { sql, asc } from "drizzle-orm";
import type { Database } from "../db/types";
import { alerts, alertAnalyses } from "../db/schema";
import { enqueueAlertAnalysis, shouldAnalyzeAlert, QUEUE_ANALYZE_ALERT } from "./queue";
import { setQueuePhase } from "./progress";
import { loadConfig } from "../config";

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

  const config = loadConfig(process.env);
  let enqueued = 0;
  for (const row of rows) {
    const gate = await shouldAnalyzeAlert(db, config, row.id);
    if (!gate.shouldAnalyze) continue;
    await setQueuePhase(db, QUEUE_ANALYZE_ALERT, row.id, "queued");
    await enqueueAlertAnalysis(row.id).catch(() => {});
    enqueued++;
  }
  return enqueued;
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
