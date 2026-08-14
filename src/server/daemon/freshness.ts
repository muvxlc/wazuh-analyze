import { listSourceCoverage, listStaleSources } from "../source-coverage/service";
import { writeAuditEvent } from "../audit/audit-service";
import { setQueuePhase } from "./progress";
import type { Database } from "../db/types";

export const FRESHNESS_QUEUE = "check-source-freshness";

/**
 * Check all enabled sources against their freshness SLA and record stale ones
 * in the audit log. Non-fatal: a failed source or DB hiccup logs, never throws.
 */
export async function checkSourceFreshness(db: Database, jobId?: string): Promise<{
  checked: number;
  stale: number;
}> {
  await setQueuePhase(db, FRESHNESS_QUEUE, "source-coverage", "loading", { jobId });

  const [allSources, staleSources] = await Promise.all([
    listSourceCoverage(db, { enabled: true, limit: 500 }),
    listStaleSources(db),
  ]);
  const staleKeys = new Set(staleSources.map((s) => s.sourceKey));
  const stale = allSources.filter((s) => staleKeys.has(s.sourceKey));

  for (const source of stale) {
    await writeAuditEvent(db, {
      actorUserId: null,
      targetType: "source",
      targetId: source.sourceKey,
      action: "system.health",
      ipAddress: null,
      userAgent: null,
      requestId: `freshness-check-${jobId ?? "manual"}`,
      detail: {
        queue: FRESHNESS_QUEUE,
        sourceType: source.sourceType,
        sourceStale: true,
        lastSuccessAt: source.lastSuccessAt,
        lastError: source.lastError ?? null,
        freshnessSlaMs: source.freshnessSlaMs,
      },
    });
  }

  await setQueuePhase(db, FRESHNESS_QUEUE, "source-coverage", "completed", {
    jobId,
    detail: `${stale.length}/${allSources.length} stale`,
  });
  return { checked: allSources.length, stale: stale.length };
}
