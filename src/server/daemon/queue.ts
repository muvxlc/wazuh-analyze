import { PgBoss } from "pg-boss";
import type { Job } from "pg-boss";
import { eq, sql } from "drizzle-orm";

type JobBatch<Data> = Job<Data>[];
import { AppConfig, loadConfig } from "../config";
import { getPgBoss } from "./pg-boss";
import { createDatabase } from "../db/client";
import * as schema from "../db/schema";
import { ActorContext } from "../authorization/permissions";
import { resolveEffectiveConfig } from "../settings/service";
import { runAlertAnalysis } from "../ai/analyze-service";
import { correlateAlert } from "../incidents/correlator";
import { draftIncidentFromAlert } from "../incidents/ir-draft";
import { getAlertDetail } from "../alerts/query";
import { dispatchNotification } from "../notifications/dispatcher";
import { writeAuditEvent } from "../audit/audit-service";
import { randomUUID } from "crypto";
import { RequestMetadata } from "../http/request-metadata";
import { NotificationEvent } from "../notifications/render";
import { fetchApprovedActions, markActionExecuted } from "../actions/action-service";
import { executeAction } from "../actions/action-executor";
import { runWeeklyReport } from "../reports/report-job";
import { setQueuePhase } from "./progress";
import { refreshAbuseIpDbBlacklist } from "../ti/abuseipdb";
import { DbTiCache } from "../ti/store";

export const QUEUE_WEEKLY_REPORT = "weekly-soc-report";

export const QUEUE_ANALYZE_ALERT = "analyze-alert";
export const QUEUE_DISPATCH_NOTIFICATION = "dispatch-notification";
export const QUEUE_EXECUTE_ACTION = "execute-action";
export const QUEUE_SYNC_ABUSEIPDB = "sync-abuseipdb";

export const SYSTEM_ACTOR: ActorContext = {
  userId: null,
  role: "admin",
  permissions: new Set(["alerts.analyze", "alerts.details", "incidents.manage", "notifications.manage"]),
};

/**
 * Register all background queues. Retry/backoff configured per-queue at send time.
 */
let registration: Promise<void> | null = null;

export function registerQueues(
  pgBoss: PgBoss,
  config: AppConfig,
): Promise<void> {
  if (registration) return registration;
  registration = registerQueuesInternal(pgBoss, config).catch((error) => {
    registration = null;
    throw error;
  });
  return registration;
}

async function registerQueuesInternal(
  pgBoss: PgBoss,
  config: AppConfig,
): Promise<void> {
  const bg = createDatabase(config.databaseUrl);

  // Ensure queues exist before workers attach, avoiding race conditions on fresh DBs.
  await pgBoss.createQueue(QUEUE_ANALYZE_ALERT).catch(() => {});
  await pgBoss.createQueue(QUEUE_DISPATCH_NOTIFICATION).catch(() => {});
  await pgBoss.createQueue(QUEUE_EXECUTE_ACTION).catch(() => {});
  await pgBoss.createQueue(QUEUE_WEEKLY_REPORT).catch(() => {});
  await pgBoss.createQueue(QUEUE_SYNC_ABUSEIPDB).catch(() => {});

  // ponytail: Local AI models easily run out of context/memory with parallel queries. Restrict analysis queue to process 1 job at a time.
  await pgBoss.work(QUEUE_ANALYZE_ALERT, { localConcurrency: 1, batchSize: 1 }, async (jobs: JobBatch<{ alertId: string; connectionId?: string; enrich?: boolean; force?: boolean }>) => {
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
        const analysis = await runAlertAnalysis(bg.db, SYSTEM_ACTOR, alertId, { connectionId: job.data.connectionId, enrich: job.data.enrich, force: job.data.force ?? false }, metadata, effConfig);
        const v = analysis.verdict;

        // FP-memory soft-suppress bookkeeping: audit every match + bump the
        // signature counter. The likelyFalsePositive flag set inside
        // runAlertAnalysis already steers the IR-draft gate below away from
        // auto-drafting — this block only records that a match happened.
        if (analysis.fpSuppressedSignatureId) {
          const signatureId = analysis.fpSuppressedSignatureId;
          // Audit + counter bump together so a crash between them can't record a
          // match in the audit log without bumping the counter (cosmetic parity).
          await bg.db.transaction(async (tx) => {
            await writeAuditEvent(tx, {
              actorUserId: SYSTEM_ACTOR.userId,
              targetType: "alert",
              targetId: alertId,
              action: "alert.fp_suppress",
              ipAddress: metadata.ip,
              userAgent: metadata.userAgent,
              requestId: metadata.requestId,
              detail: {
                signatureId: signatureId,
                reason: "fp-memory match",
              },
            });
            await tx
              .update(schema.fpSignatures)
              .set({
                matchCount: sql`${schema.fpSignatures.matchCount} + 1`,
                lastMatchedAt: new Date(),
              })
              .where(eq(schema.fpSignatures.id, signatureId));
          });
        }

        let autoDrafted = false;
        const enrichment = analysis.enrichment;
        const tiBad = enrichment?.iocLookups.some((ti) =>
          (ti.abuseScore ?? 0) >= 80 || /malware|c&c|botnet/i.test(ti.abuseCategory ?? ""),
        ) ?? false;
        const freqCount = enrichment?.networkFrequency?.count ?? 0;
        // ponytail: socAutoCreateIncident=false only gates the IR-draft path here; the correlateAlert fallback at line 98 remains independent (separate existing behavior).
        const corroboration = effConfig.socAutoIncidentRequireCorroboration ? (tiBad || freqCount > 10) : true;
        if (effConfig.socAutoCreateIncident && v.confidence >= effConfig.socAutoIncidentMinConfidence && !v.likelyFalsePositive && corroboration) {
          console.log(`[Queue:analyze] Alert ${alertId} passed Auto-IR gate (conf=${v.confidence}, ti=${tiBad}, freq=${freqCount}). Drafting incident.`);
          const alert = await getAlertDetail(bg.db, SYSTEM_ACTOR, alertId);
          await draftIncidentFromAlert(bg.db, SYSTEM_ACTOR, alert, v, metadata);
          autoDrafted = true;
        }

        if (!autoDrafted) {
          await correlateAlert(bg.db, alertId);
        }
        await setQueuePhase(bg.db, QUEUE_ANALYZE_ALERT, alertId, "completed", { jobId: job.id });
      } catch (err) {
        const e = err as { message?: string; code?: string; details?: { reason?: string; validationIssue?: string } };
        const detail = [e.code ?? (err instanceof Error ? err.message : String(err)), e.details?.reason, e.details?.validationIssue]
          .filter(Boolean)
          .join(": ");
        await setQueuePhase(bg.db, QUEUE_ANALYZE_ALERT, alertId, "failed", { jobId: job.id, detail });
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

  await pgBoss.work(QUEUE_SYNC_ABUSEIPDB, async (jobs: JobBatch<Record<string, unknown>>) => {
    const jobId = jobs[0]?.id;
    const effConfig = await resolveEffectiveConfig(bg.db, config);
    const key = effConfig.ti?.abuseipdbKey;
    if (!key) {
      console.log("[Queue:sync-abuseipdb] No AbuseIPDB API key configured; skipping");
      return;
    }
    console.log("[Queue:sync-abuseipdb] Syncing AbuseIPDB blacklist");
    const cache = new DbTiCache(bg.db);
    try {
      await setQueuePhase(bg.db, QUEUE_SYNC_ABUSEIPDB, "abuseipdb", "loading", { jobId });
      const count = await refreshAbuseIpDbBlacklist(key, cache);
      console.log(`[Queue:sync-abuseipdb] Synced ${count} IPs`);
      await setQueuePhase(bg.db, QUEUE_SYNC_ABUSEIPDB, "abuseipdb", "completed", { jobId, detail: `${count} IPs` });
    } catch (err) {
      const e = err as { message?: string; code?: string; cause?: { code?: string; message?: string } };
      const cause = e.cause ? ` cause=${e.cause.code ?? e.cause.message ?? String(e.cause)}` : "";
      const code = e.code ? ` code=${e.code}` : "";
      const detail = `${e.message ?? String(err)}${code}${cause}`;
      console.error("[Queue:sync-abuseipdb] Sync failed:", detail, err);
      await setQueuePhase(bg.db, QUEUE_SYNC_ABUSEIPDB, "abuseipdb", "failed", { jobId, detail });
    }
  });

  console.log("[PgBoss] Queues registered");
}

/** Enqueue analysis. Manual reruns bypass singleton dedupe; backfill stays idempotent. */
export async function enqueueAlertAnalysis(
  alertId: string,
  options: { force?: boolean; connectionId?: string; enrich?: boolean } = {},
): Promise<void> {
  const config = loadConfig(process.env);
  const pgBoss = await getPgBoss(config);
  await registerQueues(pgBoss, config);
  const { force, ...analysisOptions } = options;
  await pgBoss.send(QUEUE_ANALYZE_ALERT, { alertId, ...analysisOptions, force: force ?? false }, {
    ...(force ? {} : {
      singletonKey: `analyze:${alertId}`,
      singletonSeconds: 60 * 30,
    }),
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
