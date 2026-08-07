import { PgBoss } from "pg-boss";
import type { Job } from "pg-boss";

type JobBatch<Data> = Job<Data>[];
import { AppConfig, loadConfig } from "../config";
import { getPgBoss } from "./pg-boss";
import { createDatabase } from "../db/client";
import { ActorContext } from "../authorization/permissions";
import { resolveEffectiveConfig } from "../settings/service";
import { runAlertAnalysis } from "../ai/analyze-service";
import { correlateAlert } from "../incidents/correlator";
import { dispatchNotification } from "../notifications/dispatcher";
import { randomUUID } from "crypto";
import { RequestMetadata } from "../http/request-metadata";
import { NotificationEvent } from "../notifications/render";

export const QUEUE_ANALYZE_ALERT = "analyze-alert";
export const QUEUE_DISPATCH_NOTIFICATION = "dispatch-notification";

export const SYSTEM_ACTOR: ActorContext = {
  userId: null,
  role: "admin",
  permissions: new Set(["alerts.analyze", "alerts.details", "incidents.manage", "notifications.manage"]),
};

/**
 * Register all background queues. Retry/backoff configured per-queue at send time.
 */
export async function registerQueues(
  pgBoss: PgBoss,
  config: AppConfig,
): Promise<void> {
  const bg = createDatabase(config.databaseUrl);

  await pgBoss.work(QUEUE_ANALYZE_ALERT, async (jobs: JobBatch<{ alertId: string }>) => {
    const effConfig = await resolveEffectiveConfig(bg.db, config);
    for (const job of jobs) {
      const alertId = job.data.alertId;
      console.log(`[Queue:analyze] alert ${alertId}`);
      const metadata: RequestMetadata = {
        requestId: randomUUID(),
        ip: "127.0.0.1",
        userAgent: "Wazuh SOC Queue",
      };
      await runAlertAnalysis(bg.db, SYSTEM_ACTOR, alertId, { enrich: true }, metadata, effConfig);
      await correlateAlert(bg.db, alertId);
    }
  });

  await pgBoss.work(QUEUE_DISPATCH_NOTIFICATION, async (jobs: JobBatch<{ event: NotificationEvent }>) => {
    const encryptionKey = process.env.SETTINGS_ENCRYPTION_KEY;
    if (!encryptionKey) return;
    for (const job of jobs) {
      await dispatchNotification(bg.db, job.data.event, encryptionKey);
    }
  });

  console.log("[PgBoss] Queues registered");
}

/** Idempotent enqueue: singletonKey dedupes within TTL window. */
export async function enqueueAlertAnalysis(
  alertId: string,
): Promise<void> {
  const config = loadConfig(process.env);
  const pgBoss = await getPgBoss(config);
  await pgBoss.send(QUEUE_ANALYZE_ALERT, { alertId }, {
    singletonKey: `analyze:${alertId}`,
    singletonSeconds: 60 * 30, // 30 min dedupe window
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 60 * 30,
  });
}

export async function enqueueNotification(
  event: NotificationEvent,
): Promise<void> {
  const config = loadConfig(process.env);
  const pgBoss = await getPgBoss(config);
  await pgBoss.send(QUEUE_DISPATCH_NOTIFICATION, { event }, {
    singletonKey: `notify:${event.type}:${event.targetId}`,
    singletonSeconds: 60 * 10,
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 60 * 10,
  });
}
