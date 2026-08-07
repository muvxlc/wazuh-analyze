import "server-only";

import { and, eq, gte, isNull, like, or, sql } from "drizzle-orm";
import type { Database } from "../db/types";
import * as schema from "../db/schema";
import type { ActorContext } from "../authorization/permissions";
import { requirePermission } from "../authorization/require";
import { AppError } from "../errors";
import { writeAuditEvent } from "../audit/audit-service";
import type { AiVerdict } from "../ai/analysis";
import type { AlertRecord } from "../alerts/types";
import type { RequestMetadata } from "../http/request-metadata";
import { proposeAction } from "../actions/action-service";

/**
 * Generate a sequential IR case number `IR<YYMMDD><NNN>` scoped per UTC day.
 * Two-digit year/day-of-month with zero-padded running number (001-999).
 */
export async function generateIncidentNumber(db: Database, now: Date = new Date()): Promise<string> {
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const prefix = `IR${yy}${mm}${dd}`;

  const rows = await db
    .select({ number: schema.incidents.incidentNumber })
    .from(schema.incidents)
    .where(like(schema.incidents.incidentNumber, `${prefix}%`));

  let max = 0;
  for (const row of rows) {
    const suffix = row.number?.slice(prefix.length);
    const n = suffix ? Number.parseInt(suffix, 10) : 0;
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

interface IncidentDraftFields {
  sourceIp?: string;
  destinationIp?: string;
  destinationPort?: string;
  protocol?: string;
  agentName?: string;
  deviceName?: string;
}

function extractFields(alert: Pick<AlertRecord, "rawPayload" | "agentName">): IncidentDraftFields {
  const payload = (alert.rawPayload && typeof alert.rawPayload === "object")
    ? alert.rawPayload as Record<string, unknown>
    : {};
  const data = payload.data as Record<string, unknown> | undefined;
  const decoder = payload.decoder as Record<string, unknown> | undefined;
  return {
    sourceIp: (data?.srcip as string) ?? (decoder?.srcip as string) ?? undefined,
    destinationIp: (data?.dstip as string) ?? (decoder?.dstip as string) ?? undefined,
    destinationPort: (data?.dstport as string) ?? undefined,
    protocol: (data?.protocol as string) ?? (decoder?.proto as string) ?? undefined,
    agentName: alert.agentName ?? undefined,
    deviceName: (payload.location as string) ?? undefined,
  };
}

function buildDraftDescription(alert: AlertRecord, verdict: AiVerdict): string {
  const f = extractFields(alert);
  const lines: string[] = ["##Identification##"];
  lines.push(`Source IP: ${f.sourceIp ?? "-"}`);
  lines.push(`Destination IP: ${f.destinationIp ?? "-"}`);
  lines.push(`Destination Port: ${f.destinationPort ?? "-"}`);
  lines.push(`Protocol: ${f.protocol ?? "-"}`);
  lines.push(`Agent: ${f.agentName ?? "-"}`);
  lines.push(`Device: ${f.deviceName ?? "-"}`);

  lines.push("", "##Threat Information##");
  lines.push(`AI Summary: ${verdict.summary}`);
  if (verdict.severity) lines.push(`Severity: ${verdict.severity}`);
  if (verdict.rootCause) lines.push(`Root Cause: ${verdict.rootCause}`);
  if (verdict.observedEvidence && verdict.observedEvidence.length > 0) {
    lines.push("Evidence:");
    for (const item of verdict.observedEvidence) lines.push(`- ${item}`);
  }
  if (verdict.mitreAttack && verdict.mitreAttack.length > 0) {
    lines.push("MITRE ATT&CK:");
    for (const t of verdict.mitreAttack) lines.push(`- ${t.techniqueId}${t.techniqueName ? ` (${t.techniqueName})` : ""}`);
  }

  const actions = verdict.recommendedActions ?? verdict.remediation ?? [];
  if (actions.length > 0) {
    lines.push("", "##Solution/Workaround##");
    actions.forEach((item, i) => lines.push(`${i + 1}) ${item}`));
  }
  return lines.join("\n");
}

/**
 * Escalate a single alert to a structured IR case. Links the alert and stores the AI verdict as
 * the incident description. Requires incidents.manage.
 */
export async function draftIncidentFromAlert(
  db: Database,
  actor: ActorContext,
  alert: AlertRecord,
  verdict: AiVerdict,
  meta: RequestMetadata,
): Promise<{ incidentId: string; incidentNumber: string }> {
  requirePermission(actor.permissions, "incidents.manage");

  const result = await db.transaction(async (tx) => {
    const incidentNumber = await generateIncidentNumber(tx);
    const severity =
      verdict.severity === "critical" ? "critical"
      : verdict.severity === "high" ? "high"
      : verdict.severity === "medium" ? "medium"
      : verdict.severity === "low" ? "low"
      : "medium";

    const [incident] = await tx
      .insert(schema.incidents)
      .values({
        incidentNumber,
        title: verdict.summary.slice(0, 200),
        description: buildDraftDescription(alert, verdict),
        status: "open",
        severity,
        agentId: alert.agentId,
        ruleId: alert.ruleId,
      })
      .returning({ id: schema.incidents.id, incidentNumber: schema.incidents.incidentNumber });

    if (!incident) throw new AppError("incident_create_failed", 500);

    await tx
      .insert(schema.incidentAlerts)
      .values({ incidentId: incident.id, alertId: alert.id })
      .onConflictDoNothing({ target: [schema.incidentAlerts.incidentId, schema.incidentAlerts.alertId] });

    await tx.insert(schema.incidentEvents).values({
      incidentId: incident.id,
      toStatus: "open",
      actorUserId: actor.userId,
      metadata: { source: "ir_draft", incidentNumber } as Record<string, unknown>,
    });

    await writeAuditEvent(tx, {
      actorUserId: actor.userId,
      targetType: "incident",
      targetId: incident.id,
      action: "incident.create",
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      detail: { incidentNumber, alertId: alert.id },
    });

    return { incidentId: incident.id, incidentNumber: incident.incidentNumber ?? incidentNumber };
  });

  // Auto-propose isolation if the verdict is critical/high and action permissions exist.
  // Using a try-catch so permission errors don't fail the incident creation.
  if ((verdict.severity === "critical" || verdict.severity === "high") && !verdict.likelyFalsePositive) {
    const f = extractFields(alert);
    const ipToIsolate = f.sourceIp;
    if (ipToIsolate) {
      try {
        await proposeAction(db, actor, {
          incidentId: result.incidentId,
          command: "firewall-drop",
          payload: { arguments: [ipToIsolate], agents: [alert.agentId] },
          reason: `AI auto-proposed isolation for Source IP ${ipToIsolate} based on high-severity finding: ${verdict.summary.slice(0, 100)}...`,
        }, meta);
      } catch (err) {
        if (process.env.NODE_ENV !== "test") {
          console.error("Failed to auto-propose isolation:", err);
        }
      }
    }
  }

  return result;
}

/**
 * Backfill an existing correlated incident with an IR number and AI-drafted description when one is
 * missing. Idempotent: no-op if an incidentNumber is already set.
 */
export async function assignIncidentNumberIfMissing(
  db: Database,
  incidentId: string,
): Promise<string | null> {
  const [existing] = await db
    .select({ incidentNumber: schema.incidents.incidentNumber })
    .from(schema.incidents)
    .where(eq(schema.incidents.id, incidentId))
    .limit(1);
  if (!existing) throw new AppError("incident_not_found", 404);
  if (existing.incidentNumber) return existing.incidentNumber;

  const incidentNumber = await generateIncidentNumber(db);
  await db
    .update(schema.incidents)
    .set({ incidentNumber })
    .where(and(eq(schema.incidents.id, incidentId), isNull(schema.incidents.incidentNumber)));
  return incidentNumber;
}
