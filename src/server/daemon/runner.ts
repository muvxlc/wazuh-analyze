import { AppConfig } from "../config";
import { createDatabase } from "../db/client";
import { ActorContext } from "../authorization/permissions";
import { resolveEffectiveConfig } from "../settings/service";
import { analyzeBacklog } from "./analyzer-job";

// Module-level singleton
let isRunning = false;
let stopRequested = false;
let loopPromise: Promise<void> | null = null;
let bgDb: ReturnType<typeof createDatabase> | null = null;

const SYSTEM_ACTOR: ActorContext = {
  userId: "system-daemon",
  role: "admin",
  permissions: new Set(["alerts.analyze", "alerts.details", "incidents.manage", "notifications.manage"]),
};

const SLEEP_INTERVAL_MS = 10000; // 10s base loop

export function isDaemonRunning(): boolean {
  return isRunning;
}

export function startDaemon(config: AppConfig) {
  if (isRunning) return;
  isRunning = true;
  stopRequested = false;
  bgDb = createDatabase(config.databaseUrl);

  // Fire and keep reference
  loopPromise = daemonLoop(config).catch((err) => {
    console.error("[Daemon] Fatal error in loop:", err);
    isRunning = false;
  });

  console.log("[Daemon] Started");
}

export async function stopDaemon() {
  if (!isRunning) return;
  console.log("[Daemon] Stop requested, draining...");
  stopRequested = true;

  if (loopPromise) {
    await loopPromise;
  }

  if (bgDb) {
    await bgDb.pool.end();
    bgDb = null;
  }

  isRunning = false;
  console.log("[Daemon] Stopped");
}

async function daemonLoop(config: AppConfig) {
  if (!bgDb) return;

  while (!stopRequested) {
    try {
      // 1. Resolve effective settings from DB
      const effConfig = await resolveEffectiveConfig(bgDb.db, config);

      // 2. Run jobs if enabled
      if (effConfig.socAutoAnalyze) {
        await analyzeBacklog(bgDb.db, SYSTEM_ACTOR, effConfig, () => stopRequested);
      }

    } catch (err) {
      console.error("[Daemon] Tick error:", err);
    }

    // Sleep with interruption check
    await sleepWithInterrupt(SLEEP_INTERVAL_MS, () => stopRequested);
  }
}

function sleepWithInterrupt(ms: number, isInterrupted: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (isInterrupted() || Date.now() - start >= ms) {
        clearInterval(interval);
        resolve();
      }
    }, 500); // Check every 500ms
  });
}
