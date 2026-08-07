import { AppConfig } from "../config";
import { getPgBoss, stopPgBoss } from "./pg-boss";
import { registerQueues, QUEUE_ANALYZE_ALERT } from "./queue";

let isRunning = false;

export async function startWorker(config: AppConfig) {
  if (isRunning) return;
  isRunning = true;

  const boss = await getPgBoss(config);
  await registerQueues(boss, config);

  // ponytail: schedule periodic alert sweeps here if needed (e.g. boss.schedule)
  // For now, enqueueAlertAnalysis is triggered directly from alert ingest route.

  console.log("[Worker] Started");
}

export async function stopWorker() {
  if (!isRunning) return;
  console.log("[Worker] Stopping...");
  await stopPgBoss();
  isRunning = false;
}
