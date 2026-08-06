import { AppConfig } from "../config";
import { getPgBoss, stopPgBoss } from "./pg-boss";
import { registerQueues, QUEUE_WEEKLY_REPORT } from "./queue";

let isRunning = false;

export async function startWorker(config: AppConfig) {
  if (isRunning) return;
  isRunning = true;

  const boss = await getPgBoss(config);
  await registerQueues(boss, config);

  // Weekly SOC report: Mondays 09:00 (server-local cron). Idempotent — schedule() upserts.
  await boss.schedule(QUEUE_WEEKLY_REPORT, "0 2 * * 1", {}, { tz: "UTC" });

  console.log("[Worker] Started");
}

export async function stopWorker() {
  if (!isRunning) return;
  console.log("[Worker] Stopping...");
  await stopPgBoss();
  isRunning = false;
}
