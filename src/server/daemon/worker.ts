import { AppConfig } from "../config";
import { getPgBoss, stopPgBoss } from "./pg-boss";
import { registerQueues, QUEUE_WEEKLY_REPORT, QUEUE_SYNC_ABUSEIPDB } from "./queue";
import { createDatabase } from "../db/client";
import { enqueuePendingAlerts } from "./backfill";

let isRunning = false;

export async function startWorker(config: AppConfig) {
  if (isRunning) return;
  isRunning = true;

  const boss = await getPgBoss(config);
  await registerQueues(boss, config);

  // Weekly SOC report: Mondays 09:00 (server-local cron). Idempotent — schedule() upserts.
  await boss.schedule(QUEUE_WEEKLY_REPORT, "0 2 * * 1", {}, { tz: "UTC" });

  // Daily AbuseIPDB blacklist sync. Idempotent — schedule() upserts.
  await boss.schedule(QUEUE_SYNC_ABUSEIPDB, "0 0 * * *", {}, { tz: "UTC" });

  // Auto-backfill: enqueue alerts lacking analysis. Non-blocking, small batch.
  // ponytail: batch 50 keeps local LM Studio from being flooded on cold start.
  try {
    const bg = createDatabase(config.databaseUrl);
    void enqueuePendingAlerts(bg.db, 50)
      .then((n) => { if (n > 0) console.log(`[Worker] Backfilled ${n} pending alerts`); })
      .catch((err) => console.error("[Worker] Backfill failed:", err));
  } catch (err) {
    console.error("[Worker] Backfill init failed:", err);
  }

  console.log("[Worker] Started");
}

export async function stopWorker() {
  if (!isRunning) return;
  console.log("[Worker] Stopping...");
  await stopPgBoss();
  isRunning = false;
}
