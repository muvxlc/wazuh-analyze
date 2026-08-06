import "server-only";

import type { Database } from "../db/types";
import { eq } from "drizzle-orm";
import { reports } from "../db/schema";
import { getSocMetrics } from "../dashboard/soc-metrics";
import { enqueueNotification } from "../daemon/queue";

export const QUEUE_WEEKLY_REPORT = "weekly-soc-report";

/** Aggregate 7-day SOC metrics and enqueue a report notification. */
export async function runWeeklyReport(
  db: Database,
  targetReportId?: string,
): Promise<void> {
  const SYSTEM_ACTOR = { userId: null, role: "admin" as const, permissions: new Set(["dashboard.read"]) };
  const metrics = await getSocMetrics(db, SYSTEM_ACTOR, "7d");

  const summary = [
    `MTTD: ${metrics.mttdSeconds ? Math.round(metrics.mttdSeconds / 60) + " min" : "n/a"}`,
    `MTTR: ${metrics.mttrSeconds ? Math.round(metrics.mttrSeconds / 60) + " min" : "n/a"}`,
    `False-positive rate: ${metrics.falsePositiveRate ? Math.round(metrics.falsePositiveRate * 100) + "%" : "n/a"}`,
    `Incident backlog: ${metrics.incidentBacklog}`,
    `Top agent: ${metrics.topAgents[0]?.agentName ?? "n/a"} (${metrics.topAgents[0]?.count ?? 0} alerts)`,
  ].join("\n");

  await enqueueNotification({
    type: "report.weekly",
    targetId: "system",
    title: `Weekly SOC report (${new Date().toISOString().slice(0, 10)})`,
    summary,
  });

  // ponytail: per-report schedule targeting + channel selection deferred; single global weekly report for now
  if (targetReportId) {
    await db.update(reports).set({
      lastRunAt: new Date(),
      status: "completed",
    }).where(eq(reports.id, targetReportId));
  }
}
