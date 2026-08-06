import "server-only";

import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/types";
import * as schema from "../db/schema";
import type { ActorContext } from "../authorization/permissions";
import { requirePermission } from "../authorization/require";
import { getAlertDetail } from "../alerts/query";
import { createChatProvider, resolveAiConnection, type ChatProvider } from "./connections";
import { analyzeAlert, type AiVerdict } from "./analysis";
import { writeAuditEvent } from "../audit/audit-service";
import type { RequestMetadata } from "../http/request-metadata";

export interface AnalyzeOptions {
  connectionId?: string;
  enrich?: boolean;
}

export interface AnalyzeDependencies {
  provider?: ChatProvider;
}

export async function runAlertAnalysis(
  db: Database,
  actor: ActorContext,
  alertId: string,
  options: AnalyzeOptions = {},
  metadata: RequestMetadata,
  encryptionKey: string,
  deps: AnalyzeDependencies = {},
): Promise<{ id: string; alertId: string; verdict: AiVerdict }> {
  requirePermission(actor.permissions, "alerts.analyze");

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

  const startTime = Date.now();
  const verdict = await analyzeAlert(provider, alert, conn.timeoutMs);
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
      enrichmentsUsed: options.enrich ? ["wazuh"] : [],
      iocLookups: [],
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

  return { id: row.id, alertId, verdict };
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
