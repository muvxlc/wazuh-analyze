import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "../db/types";
import * as schema from "../db/schema";
import type { ActorContext } from "../authorization/permissions";
import { requirePermission } from "../authorization/require";
import type { AlertDetail, AlertStatus } from "./types";
import { mapAlertRow } from "./alert-repository";
import { writeAuditEvent } from "../audit/audit-service";
import type { AuditEventInput } from "../audit/types";

type TransitionTarget = "acknowledged" | "resolved";

const TRANSITION_MAP: Record<TransitionTarget, { status: AlertStatus; atField: "acknowledgedAt" | "resolvedAt"; byField: "acknowledgedByUserId" | "resolvedByUserId" }> = {
  acknowledged: { status: "acknowledged", atField: "acknowledgedAt", byField: "acknowledgedByUserId" },
  resolved: { status: "resolved", atField: "resolvedAt", byField: "resolvedByUserId" },
};

export async function transitionAlert(
  db: Database,
  actor: ActorContext,
  input: { alertId: string; to: TransitionTarget },
  metadata: { requestId: string; ip: string | null; userAgent: string | null },
): Promise<AlertDetail> {
  const permission = input.to === "acknowledged" ? "alerts.acknowledge" : "alerts.resolve";
  requirePermission(actor.permissions, permission);

  return db.transaction(async (tx) => {
    // Fetch current alert state with row lock for concurrent idempotency safety
    const [alert] = await tx
      .select()
      .from(schema.alerts)
      .where(eq(schema.alerts.id, input.alertId))
      .limit(1)
      .for("update")
      .execute();

    if (!alert) {
      throw new Error(`alert not found: ${input.alertId}`);
    }

    const target = TRANSITION_MAP[input.to];
    const currentStatus = alert.status as AlertStatus;

    // Idempotency: if already in target status, return existing detail without new event
    if (currentStatus === target.status) {
      const timeline = await tx
        .select()
        .from(schema.alertEvents)
        .where(eq(schema.alertEvents.alertId, alert.id))
        .orderBy(asc(schema.alertEvents.occurredAt));
      return {
        ...mapAlertRow(alert),
        timeline: timeline.map((e) => ({
          id: e.id,
          fromStatus: e.fromStatus as AlertStatus | null,
          toStatus: e.toStatus as AlertStatus,
          actorUserId: e.actorUserId,
          occurredAt: e.occurredAt,
          metadata: e.metadata as Record<string, unknown>,
        })),
      };
    }

    // Perform transition
    const now = new Date();
    const updateFields: Record<string, unknown> = {
      [target.atField]: now,
      [target.byField]: actor.userId,
    };
    await tx
      .update(schema.alerts)
      .set({ status: target.status, ...updateFields })
      .where(eq(schema.alerts.id, input.alertId));

    // Insert alert_event (from status only if not open)
    await tx.insert(schema.alertEvents).values({
      alertId: input.alertId,
      fromStatus: currentStatus === "open" ? null : currentStatus,
      toStatus: target.status,
      actorUserId: actor.userId,
      occurredAt: now,
      metadata: { requestId: metadata.requestId } as Record<string, unknown>,
    });

    // Insert audit_event in same transaction
    const auditEvent: AuditEventInput = {
      actorUserId: actor.userId,
      targetType: "alert",
      targetId: input.alertId,
      action: input.to === "acknowledged" ? "alert.acknowledge" : "alert.resolve",
      ipAddress: metadata.ip,
      userAgent: metadata.userAgent,
      requestId: metadata.requestId,
      detail: { fromStatus: currentStatus, toStatus: target.status },
    };
    await writeAuditEvent(tx, auditEvent);

    // Fetch updated alert and timeline
    const [updatedAlert] = await tx
      .select()
      .from(schema.alerts)
      .where(eq(schema.alerts.id, input.alertId))
      .limit(1);

    const timeline = await tx
      .select()
      .from(schema.alertEvents)
      .where(eq(schema.alertEvents.alertId, updatedAlert!.id))
      .orderBy(asc(schema.alertEvents.occurredAt));

    return {
      ...mapAlertRow(updatedAlert!),
      timeline: timeline.map((e) => ({
        id: e.id,
        fromStatus: e.fromStatus as AlertStatus | null,
        toStatus: e.toStatus as AlertStatus,
        actorUserId: e.actorUserId,
        occurredAt: e.occurredAt,
        metadata: e.metadata as Record<string, unknown>,
      })),
    };
  });
}
