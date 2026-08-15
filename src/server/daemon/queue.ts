import { PgBoss } from "pg-boss";
import type { Job } from "pg-boss";
import { eq, sql, desc, and, lt, gt, isNull } from "drizzle-orm";

type JobBatch<Data> = Job<Data>[];
import { AppConfig, loadConfig } from "../config";
import { getPgBoss } from "./pg-boss";
import { createDatabase } from "../db/client";
import * as schema from "../db/schema";
import { ActorContext } from "../authorization/permissions";
import { resolveEffectiveConfig } from "../settings/service";
import { getSettingByKey } from "../settings/repository";
import type { Database } from "../db/types";
import { runAlertAnalysis } from "../ai/analyze-service";
import { runVulnerabilityAnalysis } from "../ai/vulnerability-analyze-service";
import { correlateAlert } from "../incidents/correlator";
import { draftIncidentFromAlert } from "../incidents/ir-draft";
import { draftIncidentFromVulnerabilityAnalysis } from "../incidents/vulnerability-draft";
import { getAlertDetail } from "../alerts/query";
import { dispatchNotification } from "../notifications/dispatcher";
import type { NotificationEvent } from "../notifications/render";
import { fetchVulnerabilityById, fetchAgentVulnerabilities } from "../wazuh/indexer";
import { writeAuditEvent } from "../audit/audit-service";
import { decryptSecret } from "../settings/encryption";
import { randomUUID } from "crypto";
import { RequestMetadata } from "../http/request-metadata";
import { fetchApprovedActions, markActionExecuted } from "../actions/action-service";
import { executeAction } from "../actions/action-executor";
import { runWeeklyReport } from "../reports/report-job";
import { setQueuePhase } from "./progress";
import { refreshAbuseIpDbBlacklist } from "../ti/abuseipdb";
import { DbTiCache } from "../ti/store";
import { checkSourceFreshness, FRESHNESS_QUEUE } from "./freshness";
import { retrySingleDeadLetter } from "../ingestion/dead-letter-retry";
import { getRuleMitreTechniques } from "../mitre/rule-map";
import { listDeadLetters } from "../ingestion/dead-letter";

export const QUEUE_WEEKLY_REPORT = "weekly-soc-report";

export const QUEUE_ANALYZE_ALERT = "analyze-alert";
export const QUEUE_DISPATCH_NOTIFICATION = "dispatch-notification";
export const QUEUE_EXECUTE_ACTION = "execute-action";
export const QUEUE_SYNC_ABUSEIPDB = "sync-abuseipdb";
export const QUEUE_ANALYZE_VULNERABILITY = "analyze-vulnerability";
export const QUEUE_CHECK_SOURCE_FRESHNESS = "check-source-freshness";
export const QUEUE_RETRY_DEAD_LETTERS = "retry-dead-letters";

export const SYSTEM_ACTOR: ActorContext = {
  userId: null,
  role: "admin",
  permissions: new Set(["alerts.analyze", "alerts.details", "incidents.manage", "notifications.manage", "vulnerabilities.analyze"]),
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
  await pgBoss.createQueue(QUEUE_ANALYZE_VULNERABILITY).catch(() => {});
  await pgBoss.createQueue(QUEUE_DISPATCH_NOTIFICATION).catch(() => {});
  await pgBoss.createQueue(QUEUE_EXECUTE_ACTION).catch(() => {});
  await pgBoss.createQueue(QUEUE_WEEKLY_REPORT).catch(() => {});
  await pgBoss.createQueue(QUEUE_SYNC_ABUSEIPDB).catch(() => {});
  await pgBoss.createQueue(QUEUE_CHECK_SOURCE_FRESHNESS).catch(() => {});
  await pgBoss.createQueue(QUEUE_RETRY_DEAD_LETTERS).catch(() => {});

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

  // ponytail: vulnerability analysis queue mirrors the alert queue pattern: singleton dedupe, retry/backoff, 1-concurrency.
  await pgBoss.work(QUEUE_ANALYZE_VULNERABILITY, { localConcurrency: 1, batchSize: 1 }, async (jobs: JobBatch<{ agentId: string; sourceId: string; connectionId?: string; force?: boolean }>) => {
    for (const job of jobs) {
      const { agentId, sourceId, connectionId, force } = job.data;
      console.log(`[Queue:vuln] ${agentId}/${sourceId} force=${force ?? false}`);
      const metadata: RequestMetadata = {
        requestId: randomUUID(),
        ip: "127.0.0.1",
        userAgent: "Wazuh SOC Queue",
      };
      try {
        await setQueuePhase(bg.db, QUEUE_ANALYZE_VULNERABILITY, sourceId, "loading", { jobId: job.id });
        const effConfig = await resolveEffectiveConfig(bg.db, config);
        if (!effConfig.socAutoAnalyzeVulnerabilities) {
          console.log(`[Queue:vuln] auto-analyze disabled for ${agentId}/${sourceId}; skipping`);
          await setQueuePhase(bg.db, QUEUE_ANALYZE_VULNERABILITY, sourceId, "completed", { jobId: job.id });
          continue;
        }
        // Re-fetch from Indexer to ensure record still exists and severity is current.
        const record = await fetchVulnerabilityById(effConfig.wazuh, agentId, sourceId);
        if (!record) {
          console.log(`[Queue:vuln] record gone for ${agentId}/${sourceId}; skipping`);
          await setQueuePhase(bg.db, QUEUE_ANALYZE_VULNERABILITY, sourceId, "completed", { jobId: job.id });
          continue;
        }
        // Auto path gates to Wazuh High/Critical only.
        const severityNormalized = (record.severity ?? "").toLowerCase();
        if (severityNormalized !== "high" && severityNormalized !== "critical") {
          console.log(`[Queue:vuln] severity=${record.severity} not in {high,critical}; skipping`);
          await setQueuePhase(bg.db, QUEUE_ANALYZE_VULNERABILITY, sourceId, "completed", { jobId: job.id });
          continue;
        }
        const result = await runVulnerabilityAnalysis(
          bg.db,
          SYSTEM_ACTOR,
          { agentId, sourceId, connectionId, force: force ?? false },
          metadata,
          { settingsEncryptionKey: effConfig.settingsEncryptionKey, wazuh: effConfig.wazuh },
        );
        await setQueuePhase(bg.db, QUEUE_ANALYZE_VULNERABILITY, sourceId, "completed", { jobId: job.id });
        // T9 auto-incident draft — mirrors alert Auto-IR gate above.
        // Corroboration for vulns = AI verdict severity agrees (high/critical)
        // with the Wazuh High/Critical gate; no TI/frequency signal exists here.
        const v = result.verdict;
        const vulnCorroboration = effConfig.socAutoIncidentRequireCorroboration
          ? v.severity === "high" || v.severity === "critical"
          : true;
        if (effConfig.socAutoCreateIncident && v.confidence >= effConfig.socAutoIncidentMinConfidence && vulnCorroboration) {
          console.log(`[Queue:vuln] ${agentId}/${sourceId} passed Auto-IR gate (conf=${v.confidence}, sev=${v.severity}). Drafting incident.`);
          try {
            await draftIncidentFromVulnerabilityAnalysis(bg.db, SYSTEM_ACTOR, { agentId, sourceId }, { cve: result.cve });
          } catch (err) {
            console.error(`[Queue:vuln] auto-incident draft failed for ${agentId}/${sourceId}:`, err);
          }
        }
        // Fire-and-forget notification enqueue.
        enqueueNotification({
          type: "vulnerability.analysis_completed",
          targetId: sourceId,
          agentId,
          sourceId,
          cve: result.cve,
          severity: result.verdict.severity,
          title: result.cve,
          summary: result.verdict.sections?.summaryImpact?.en,
          sections: result.verdict.sections as NonNullable<NotificationEvent["sections"]>,
        }).catch((err) => console.error("[Queue:vuln] notification enqueue failed:", err));
      } catch (err) {
        const e = err as { message?: string; code?: string; details?: { reason?: string; validationIssue?: string } };
        const detail = [e.code ?? (err instanceof Error ? err.message : String(err)), e.details?.reason, e.details?.validationIssue]
          .filter(Boolean)
          .join(": ");
        await setQueuePhase(bg.db, QUEUE_ANALYZE_VULNERABILITY, sourceId, "failed", { jobId: job.id, detail });
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

  await pgBoss.work(QUEUE_CHECK_SOURCE_FRESHNESS, async (jobs: JobBatch<Record<string, unknown>>) => {
    const jobId = jobs[0]?.id;
    console.log("[Queue:check-source-freshness] Checking source freshness");
    try {
      const result = await checkSourceFreshness(bg.db, jobId);
      console.log(`[Queue:check-source-freshness] ${result.stale}/${result.checked} stale`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[Queue:check-source-freshness] Check failed:", detail, err);
      await setQueuePhase(bg.db, QUEUE_CHECK_SOURCE_FRESHNESS, "source-coverage", "failed", { jobId, detail }).catch(() => {});
    }
  });

  // Periodic DLQ retry: sweep a bounded batch of 'open' dead letters through
  // retrySingleDeadLetter. Atomic claim means concurrent runs can't double-process.
  await pgBoss.work(QUEUE_RETRY_DEAD_LETTERS, async (jobs: JobBatch<Record<string, unknown>>) => {
    const jobId = jobs[0]?.id;
    console.log("[Queue:retry-dead-letters] Sweeping open dead letters");
    try {
      // Release claims stranded by a crash between claim and release (claim
      // marks retrying; a crash leaves the row retrying forever). Rows claimed
      // >10 min ago are safe to reset — a live retry finishes well under that.
      await bg.db
        .update(schema.deadLetters)
        .set({ status: "open" })
        .where(and(
          eq(schema.deadLetters.status, "retrying"),
          lt(schema.deadLetters.retriedAt, new Date(Date.now() - 10 * 60 * 1000)),
        ));

      const page = await listDeadLetters({ db: bg.db, status: "open", limit: 20 });
      if (page.items.length > 0) {
        let recovered = 0, failed = 0;
        for (const item of page.items) {
          const result = await retrySingleDeadLetter(bg.db, item.id);
          if (!result) continue; // already claimed by concurrent run
          if (result.status === "failed") failed++; else recovered++;
        }
        console.log(`[Queue:retry-dead-letters] ${recovered} recovered, ${failed} failed`);
        await setQueuePhase(bg.db, QUEUE_RETRY_DEAD_LETTERS, "dead-letters", "completed", { jobId, detail: `${recovered} recovered, ${failed} failed` });
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[Queue:retry-dead-letters] Sweep failed:", detail, err);
      await setQueuePhase(bg.db, QUEUE_RETRY_DEAD_LETTERS, "dead-letters", "failed", { jobId, detail }).catch(() => {});
    }
  });

  console.log("[PgBoss] Queues registered");
}

/**
 * Burst suppression: skip enqueue when this alert's (ruleId, agentId) already
 * has a successful analysis within the cooldown window (default 60 min).
 * Flood rules (e.g. rule 533 netstat) otherwise enqueue one AI call per
 * alert instance; this collapses a ×60 burst to a single analysis per window.
 * `force` bypasses (manual rerun). Window is set per-rule via system_settings
 * key `analyzeCooldownSeconds` (JSON map ruleId -> seconds); global default
 * 3600. Best-effort: any failure falls through to enqueue.
 */
export async function isRecentAnalysisForRule(db: Database, alertId: string, encryptionKey: string): Promise<boolean> {
  const [alert] = await db
    .select({ ruleId: schema.alerts.ruleId, agentId: schema.alerts.agentId })
    .from(schema.alerts)
    .where(eq(schema.alerts.id, alertId))
    .limit(1);
  if (!alert?.ruleId) return false;

  const rows = await getSettingByKey(db, "analyzeCooldownSeconds");
  const raw = rows?.value;
  let cooldownMs = 60 * 60 * 1000;
  if (raw) {
    try {
      // updateSettings encrypts all values; decrypt before parsing.
      const decrypted = raw && typeof raw === "object" && "iv" in raw
        ? JSON.parse(decryptSecret(raw as Parameters<typeof decryptSecret>[0], encryptionKey))
        : raw;
      const rec = (typeof decrypted === "string" ? JSON.parse(decrypted) : decrypted) as Record<string, number>;
      const override = rec[alert.ruleId] ?? rec["*"];
      if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
        cooldownMs = override * 1000;
      }
    } catch {
      // malformed value → fall back to default window
    }
  }
  if (cooldownMs === 0) return false;

  const since = new Date(Date.now() - cooldownMs);
  const [recent] = await db
    .select({ id: schema.alertAnalyses.id })
    .from(schema.alertAnalyses)
    .innerJoin(schema.alerts, eq(schema.alertAnalyses.alertId, schema.alerts.id))
    .where(and(
      eq(schema.alerts.ruleId, alert.ruleId),
      alert.agentId ? eq(schema.alerts.agentId, alert.agentId) : isNull(schema.alerts.agentId),
      gt(schema.alertAnalyses.createdAt, since),
    ))
    .limit(1);
  return !!recent;
}

/**
 * Analysis scope gate: deny tags → allow tags → min level, in that precedence
 * order. Deny wins if any deny tag matches; an allow list (when non-empty) must
 * match or the alert is skipped outright; otherwise the level gate applies.
 * `force` bypasses the whole gate (enforced by the `if (!force)` wrapper).
 * Best-effort: any failure returns allow so enqueue still happens.
 */
export async function shouldAnalyzeAlert(
  db: Database,
  config: AppConfig,
  alertId: string,
): Promise<{ shouldAnalyze: boolean; reason: "deny-tag" | "no-allow-match" | "below-level" | null }> {
  const [alert] = await db
    .select({ level: schema.alerts.level, ruleId: schema.alerts.ruleId, rawPayload: schema.alerts.rawPayload })
    .from(schema.alerts)
    .where(eq(schema.alerts.id, alertId))
    .limit(1);
  if (!alert) return { shouldAnalyze: true, reason: null };

  const scopeRows = await getSettingByKey(db, "analysisTagScope");
  const scopeRaw = scopeRows?.value;
  let scope: { allowTags?: string[]; denyTags?: string[] } = {};
  if (scopeRaw) {
    try {
      // updateSettings encrypts all values; decrypt before parsing.
      const decrypted = scopeRaw && typeof scopeRaw === "object" && "iv" in scopeRaw
        ? JSON.parse(decryptSecret(scopeRaw as Parameters<typeof decryptSecret>[0], config.settingsEncryptionKey))
        : scopeRaw;
      scope = (typeof decrypted === "string" ? JSON.parse(decrypted) : decrypted) as { allowTags?: string[]; denyTags?: string[] };
    } catch {
      // malformed value → treat scope as empty
    }
  }
  const normalize = (tag: string) => tag.trim().toUpperCase();
  const denyTags = (scope.denyTags ?? []).map(normalize).filter(Boolean);
  const allowTags = (scope.allowTags ?? []).map(normalize).filter(Boolean);

  const techniques = new Set(getRuleMitreTechniques(alert.ruleId, alert.rawPayload).map((t) => t.techniqueId.toUpperCase()));
  if (denyTags.some((tag) => techniques.has(tag))) return { shouldAnalyze: false, reason: "deny-tag" };
  if (allowTags.length > 0) {
    return allowTags.some((tag) => techniques.has(tag))
      ? { shouldAnalyze: true, reason: null }
      : { shouldAnalyze: false, reason: "no-allow-match" };
  }

  const minRows = await getSettingByKey(db, "socAutoAnalyzeMinLevel");
  const minRaw = minRows?.value;
  let minLevel = config.socAutoAnalyzeMinLevel;
  if (minRaw) {
    try {
      const decrypted = minRaw && typeof minRaw === "object" && "iv" in minRaw
        ? JSON.parse(decryptSecret(minRaw as Parameters<typeof decryptSecret>[0], config.settingsEncryptionKey))
        : minRaw;
      const parsed = typeof decrypted === "string" ? JSON.parse(decrypted) : decrypted;
      if (typeof parsed === "number" && Number.isFinite(parsed)) minLevel = parsed;
    } catch {
      // malformed value → fall back to config default
    }
  }
  return alert.level < minLevel
    ? { shouldAnalyze: false, reason: "below-level" }
    : { shouldAnalyze: true, reason: null };
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
  if (!force) {
    const { db, pool } = createDatabase(config.databaseUrl);
    try {
      const gate = await shouldAnalyzeAlert(db, config, alertId);
      if (!gate.shouldAnalyze) {
        console.log(`[Queue:analyze] scope skip ${alertId} (${gate.reason})`);
        return;
      }
      const skippable = await isRecentAnalysisForRule(db, alertId, config.settingsEncryptionKey);
      if (skippable) {
        console.log(`[Queue:analyze] rule-cooldown skip ${alertId} (recent analysis for same rule+agent)`);
        return;
      }
    } catch (err) {
      // Cooldown is best-effort — never block enqueue on a lookup failure.
      console.error("[Queue:analyze] rule-cooldown lookup failed; enqueueing", err);
    } finally {
      await pool.end();
    }
  }
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

/** Enqueue vulnerability auto-analysis. Singleton per agent+source; manual reruns pass force=true. */
export async function enqueueVulnerabilityAnalysis(
  agentId: string,
  sourceId: string,
  options: { force?: boolean; connectionId?: string } = {},
): Promise<void> {
  const config = loadConfig(process.env);
  const pgBoss = await getPgBoss(config);
  await registerQueues(pgBoss, config);
  await pgBoss.send(QUEUE_ANALYZE_VULNERABILITY, { agentId, sourceId, ...options, force: options.force ?? false }, {
    ...(options.force ? {} : {
      singletonKey: `analyze-vuln:${agentId}:${sourceId}`,
      singletonSeconds: 60 * 30,
    }),
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 60 * 30,
  });
}
