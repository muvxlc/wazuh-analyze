import "server-only";

import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/types";
import type { AppConfig } from "../config";
import type { WazuhConfig } from "../wazuh/types";
import * as schema from "../db/schema";
import type { ActorContext } from "../authorization/permissions";
import { requirePermission } from "../authorization/require";
import { getAlertDetail } from "../alerts/query";
import { createChatProvider, resolveAiConnection, type ChatProvider } from "./connections";
import { analyzeAlert, type AiVerdict } from "./analysis";
import { buildAnalysisContext, type AnalysisContext, type ContextDeps } from "../enrichment/context-builder";
import { buildTiProviders, globalTiCache, type TiProvider } from "../ti/provider";
import { writeAuditEvent } from "../audit/audit-service";
import { dispatchNotificationBackground } from "../notifications/dispatcher";
import type { RequestMetadata } from "../http/request-metadata";

export interface AnalyzeOptions {
  connectionId?: string;
  /** Default true; set false to skip Wazuh/TI/correlation enrichment. */
  enrich?: boolean;
}

export interface AnalyzeDependencies {
  provider?: ChatProvider;
  /** Override enrichment fetchers (tests). When absent, derived from `config`. */
  contextDeps?: ContextDeps;
}

/** Accepts either a raw encryption key (legacy callers) or a full config object. */
export type AnalyzeConfig = string | Pick<AppConfig, "settingsEncryptionKey" | "wazuh" | "ti">;

export async function runAlertAnalysis(
  db: Database,
  actor: ActorContext,
  alertId: string,
  options: AnalyzeOptions = {},
  metadata: RequestMetadata,
  config: AnalyzeConfig,
  deps: AnalyzeDependencies = {},
): Promise<{ id: string; alertId: string; verdict: AiVerdict }> {
  requirePermission(actor.permissions, "alerts.analyze");

  const encryptionKey =
    typeof config === "string" ? config : config.settingsEncryptionKey;

  const alert = await getAlertDetail(db, actor, alertId);
  const conn = await resolveAiConnection(db, options.connectionId ?? null, encryptionKey);

  const provider =
    deps.provider ??
    createChatProvider({
      provider: conn.provider,
      baseUrl: conn.baseUrl,
      apiKey: conn.apiKey,
      model: conn.model,
      timeoutMs: conn.timeoutMs,
    });

  // Enrichment is best-effort: any failure falls back to alert-only analysis.
  let context: AnalysisContext | undefined;
  if (options.enrich !== false) {
    try {
      const contextDeps = deps.contextDeps ?? (await buildContextDeps(config));
      context = await buildAnalysisContext(
        {
          alertId,
          agentId: alert.agentId,
          ruleId: alert.ruleId,
          wazuhTimestamp: alert.wazuhTimestamp,
          groups: alert.groups,
          level: alert.level,
          rawPayload: alert.rawPayload,
        },
        { db, ...contextDeps },
      );
    } catch {
      // Swallow — analysis must still produce a verdict without enrichment.
      context = undefined;
    }
  }

  const startTime = Date.now();
  const verdict = await analyzeAlert(provider, alert, conn.timeoutMs, context);
  const latencyMs = Date.now() - startTime;

  const [row] = await db
    .insert(schema.alertAnalyses)
    .values({
      alertId,
      aiConnectionId: conn.id,
      provider: conn.provider,
      model: conn.model,
      verdict: verdict as unknown as Record<string, unknown>,
      latencyMs,
      enrichmentsUsed: context?.enrichmentsUsed ?? [],
      iocLookups: (context?.iocLookups ?? []) as unknown as Record<string, unknown>,
      createdByUserId: actor.userId,
    })
    .returning({ id: schema.alertAnalyses.id });

  await writeAuditEvent(db, {
    actorUserId: actor.userId,
    targetType: "alert",
    targetId: alertId,
    action: "alert.analyze",
    ipAddress: metadata.ip,
    userAgent: metadata.userAgent,
    requestId: metadata.requestId,
    detail: { analysisId: row.id, connectionId: conn.id, model: conn.model },
  });

  if (!verdict.likelyFalsePositive && typeof verdict.confidence === "number" && verdict.confidence >= 0.8) {
    const dbUrl = typeof config === "string" ? process.env.DATABASE_URL : process.env.DATABASE_URL;
    dispatchNotificationBackground(
      {
        type: "verdict.confident_real",
        targetId: alertId,
        severity: alert.level,
        title: verdict.summary ?? `AI verdict on alert ${alert.ruleId ?? alertId}`,
        summary: verdict.summary,
      },
      dbUrl,
      encryptionKey,
    );
  }

  return { id: row.id, alertId, verdict };
}

/** Builds enrichment dependencies from config. Legacy string-key callers get no deps. */
async function buildContextDeps(config: AnalyzeConfig): Promise<ContextDeps> {
  if (typeof config === "string") return {};
  const wazuh: WazuhConfig | undefined = config.wazuh;
  const tiSlice = config.ti;
  const deps: ContextDeps = {};
  if (wazuh) deps.wazuh = { config: wazuh };
  if (tiSlice) {
    const providers: TiProvider[] = await buildTiProviders(tiSlice);
    if (providers.length > 0) {
      deps.ti = { providers, cache: globalTiCache };
    }
  }
  return deps;
}

export async function listAlertAnalyses(
  db: Database,
  actor: ActorContext,
  alertId: string,
): Promise<Array<{ id: string; alertId: string; provider: string; model: string; verdict: AiVerdict; createdAt: string; createdByUserId: string | null }>> {
  requirePermission(actor.permissions, "alerts.details");
  // Ensure alert exists and actor has access via getAlertDetail throwing Not Found/Forbidden if invalid
  await getAlertDetail(db, actor, alertId);

  const rows = await db
    .select({
      id: schema.alertAnalyses.id,
      alertId: schema.alertAnalyses.alertId,
      provider: schema.alertAnalyses.provider,
      model: schema.alertAnalyses.model,
      verdict: schema.alertAnalyses.verdict,
      createdAt: schema.alertAnalyses.createdAt,
      createdByUserId: schema.alertAnalyses.createdByUserId,
    })
    .from(schema.alertAnalyses)
    .where(eq(schema.alertAnalyses.alertId, alertId))
    .orderBy(desc(schema.alertAnalyses.createdAt));

  return rows.map((r) => ({
    id: r.id,
    alertId: r.alertId,
    provider: r.provider,
    model: r.model,
    verdict: r.verdict as AiVerdict,
    createdAt: r.createdAt.toISOString(),
    createdByUserId: r.createdByUserId,
  }));
}
