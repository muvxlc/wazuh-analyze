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
import { fetchApprovedActions, markActionExecuted } from "../actions/action-service";
import { executeAction } from "../actions/action-executor";
import { runWeeklyReport } from "../reports/report-job";
import { setQueuePhase } from "./progress";

export const QUEUE_WEEKLY_REPORT = "weekly-soc-report";

export const QUEUE_ANALYZE_ALERT = "analyze-alert";
export const QUEUE_DISPATCH_NOTIFICATION = "dispatch-notification";
export const QUEUE_EXECUTE_ACTION = "execute-action";

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

  // Ensure queues exist before workers attach, avoiding race conditions on fresh DBs.
  await pgBoss.createQueue(QUEUE_ANALYZE_ALERT).catch(() => {});
  await pgBoss.createQueue(QUEUE_DISPATCH_NOTIFICATION).catch(() => {});
  await pgBoss.createQueue(QUEUE_EXECUTE_ACTION).catch(() => {});
  await pgBoss.createQueue(QUEUE_WEEKLY_REPORT).catch(() => {});

  // ponytail: Local AI models easily run out of context/memory with parallel queries. Restrict analysis queue to process 1 job at a time.
  await pgBoss.work(QUEUE_ANALYZE_ALERT, { localConcurrency: 1, batchSize: 1 }, async (jobs: JobBatch<{ alertId: string }>) => {
    const effConfig = await resolveEffectiveConfig(bg.db, config);
    for (const job of jobs) {
      const alertId = job.data.alertId;
      console.log(`[Queue:analyze] alert ${alertId}`);
      const metadata: RequestMetadata = {
        requestId: randomUUID(),
        ip: "127.0.0.1",
        userAgent: "Wazuh SOC Queue",
      };
      try {
        await setQueuePhase(bg.db, QUEUE_ANALYZE_ALERT, alertId, "loading", { jobId: job.id });
        await runAlertAnalysis(bg.db, SYSTEM_ACTOR, alertId, { enrich: true }, metadata, effConfig);
        await correlateAlert(bg.db, alertId);
        await setQueuePhase(bg.db, QUEUE_ANALYZE_ALERT, alertId, "completed", { jobId: job.id });
      } catch (err) {
        await setQueuePhase(bg.db, QUEUE_ANALYZE_ALERT, alertId, "failed", { jobId: job.id, detail: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    }
  });

  await pgBoss.work(QUEUE_DISPATCH_NOTIFICATION, async (jobs: JobBatch<{ event: NotificationEvent }>) => {
    const encryptionKey = process.env.SETTINGS_ENCRYPTION_KEY;
    if (!encryptionKey) return;
    for (const job of jobs) {
      await dispatchNotification(bg.db, job.data.event, encryptionKey);
    }
  });

  await pgBoss.work(QUEUE_EXECUTE_ACTION, async (jobs: JobBatch<{ actionId: string }>) => {
    for (const job of jobs) {
      const actionId = job.data.actionId;
      console.log(`[Queue:action] Executing action ${actionId}`);
      // Fetch action details directly to ensure it's still approved
      const actions = await fetchApprovedActions(bg.db, 100);
      const action = actions.find((a) => a.id === actionId);
      if (!action) {
        console.log(`[Queue:action] Action ${actionId} not found or not approved`);
        continue;
      }
      try {
        await executeAction(config, { command: action.command, payload: action.payload as Record<string, unknown> });
        await markActionExecuted(bg.db, actionId, { success: true });
      } catch (err) {
        console.error(`[Queue:action] Action ${actionId} failed:`, err);
        const error = err instanceof Error ? err.message : String(err);
        await markActionExecuted(bg.db, actionId, { success: false, error });
        throw err; // Trigger pg-boss retry
      }
    }
  });

  await pgBoss.work(QUEUE_WEEKLY_REPORT, async () => {
    console.log("[Queue:report] Generating weekly report");
    await runWeeklyReport(bg.db);
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

export async function enqueueActionExecution(
  actionId: string,
): Promise<void> {
  const config = loadConfig(process.env);
  const pgBoss = await getPgBoss(config);
  await pgBoss.send(QUEUE_EXECUTE_ACTION, { actionId }, {
    singletonKey: `action:${actionId}`,
    singletonSeconds: 60 * 5,
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 60 * 5,
  });
}
