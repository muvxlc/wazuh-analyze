import { AppConfig } from "../config";
import { getPgBoss, stopPgBoss } from "./pg-boss";
import { registerQueues, QUEUE_WEEKLY_REPORT, QUEUE_SYNC_ABUSEIPDB, QUEUE_ANALYZE_VULNERABILITY, QUEUE_CHECK_SOURCE_FRESHNESS, QUEUE_RETRY_DEAD_LETTERS, enqueueVulnerabilityAnalysis } from "./queue";
import { createDatabase } from "../db/client";
import * as schema from "../db/schema";
import { enqueuePendingAlerts } from "./backfill";
import { fetchAgentVulnerabilities } from "../wazuh/indexer";
import { desc } from "drizzle-orm";

// globalThis flag: dev HMR re-runs module code, resetting module-level state
// and letting a fresh startWorker spin up a new pg-boss pool without the old
// one ever being closed. Survives reloads so only ONE worker per Node process.
const GLOBAL_WORKER_KEY = "__wazuhWorkerStarted__";
function workerStarted(): boolean {
  return (globalThis as Record<string, unknown>)[GLOBAL_WORKER_KEY] === true;
}
function markWorkerStarted(): void {
  (globalThis as Record<string, unknown>)[GLOBAL_WORKER_KEY] = true;
}

export async function startWorker(config: AppConfig) {
  if (workerStarted()) return;
  markWorkerStarted();

  const boss = await getPgBoss(config);
  await registerQueues(boss, config);

  // Weekly SOC report: Mondays 09:00 (server-local cron). Idempotent — schedule() upserts.
  await boss.schedule(QUEUE_WEEKLY_REPORT, "0 2 * * 1", {}, { tz: "UTC" });

  // Daily AbuseIPDB blacklist sync. Idempotent — schedule() upserts.
  await boss.schedule(QUEUE_SYNC_ABUSEIPDB, "0 0 * * *", {}, { tz: "UTC" });

  // Hourly source freshness check. Idempotent — schedule() upserts.
  await boss.schedule(QUEUE_CHECK_SOURCE_FRESHNESS, "23 * * * *", {}, { tz: "UTC" });

  // DLQ retry sweep every 10 minutes. Idempotent — schedule() upserts.
  await boss.schedule(QUEUE_RETRY_DEAD_LETTERS, "*/10 * * * *", {}, { tz: "UTC" });

  // Auto-backfill: enqueue alerts lacking analysis. Non-blocking, small batch.
  // ponytail: batch 50 keeps local LM Studio from being flooded on cold start.
  try {
    const bg = createDatabase(config.databaseUrl);
    void enqueuePendingAlerts(bg.db, 50)
      .then((n) => { if (n > 0) console.log(`[Worker] Backfilled ${n} pending alerts`); })
      .catch((err) => console.error("[Worker] Backfill failed:", err));
  } catch (err) {
    console.error("[Worker] Backfill failed:", err);
  }

  // Scheduled bounded vulnerability scan: non-blocking, enumerate High/Critical vulns
  // from the Indexer snapshot and enqueue analysis for each. Reuses fetchAgentVulnerabilities
  // + agent snapshot pattern. Catch + log; never block startup.
  // ponytail: bounded to 50 to match alert backfill cadence; raise when workload justifies.
  try {
    const bg = createDatabase(config.databaseUrl);
    const wazuh = config.wazuh;
    if (wazuh?.indexer) {
      void bg.db
        .select({ agents: schema.agentSnapshots.agents })
        .from(schema.agentSnapshots)
        .orderBy(desc(schema.agentSnapshots.syncedAt))
        .limit(1)
        .then(async (rows) => {
          // agent_snapshots.agents is jsonb; skip if malformed.
          if (!rows.length) return;
          // ponytail: agent_snapshots.agents shape assumed array of { id: string }.
          // If shape differs, adjust here — not a migration-critical path.
          const agents = rows[0].agents as unknown[];
          if (!Array.isArray(agents)) return;
          for (const agent of agents.slice(0, 50)) {
            const agentId = typeof agent === "object" && agent && "id" in agent
              ? String(agent.id)
              : null;
            if (!agentId) continue;
            try {
              const vulns = await fetchAgentVulnerabilities(wazuh, agentId, 50);
              for (const v of vulns) {
                const sev = (v.severity ?? "").toLowerCase();
                if ((sev === "high" || sev === "critical") && v.sourceId) {
                  await enqueueVulnerabilityAnalysis(agentId, v.sourceId).catch(() => {});
                }
              }
            } catch (err) {
              console.error(`[Worker] vulnerability scan agent ${agentId} failed:`, err);
            }
          }
        })
        .catch((err) => console.error("[Worker] vulnerability scan init failed:", err));
    }
  } catch (err) {
    console.error("[Worker] vulnerability scan init failed:", err);
  }

  console.log("[Worker] Started");
}

export async function stopWorker() {
  console.log("[Worker] Stopping...");
  await stopPgBoss();
  (globalThis as Record<string, unknown>)[GLOBAL_WORKER_KEY] = false;
}
