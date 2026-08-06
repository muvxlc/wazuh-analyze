import { asc, eq } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "../db/types";
import * as schema from "../db/schema";
import type { ActorContext } from "../authorization/permissions";
import { requirePermission } from "../authorization/require";
import type { AlertDetail, AlertStatus } from "./types";
import { mapAlertRow } from "./alert-repository";
import { writeAuditEvent } from "../audit/audit-service";
import type { AuditEventInput } from "../audit/types";

// Explicit valid transition matrix. New targets must be added here.
type ValidFrom = "open" | "acknowledged" | "resolved";
type TransitionTarget = "acknowledged" | "resolved" | "open";

const TRANSITION_MAP: Record<
  TransitionTarget,
  {
    status: AlertStatus;
    atField: "acknowledgedAt" | "resolvedAt" | null;
    byField: "acknowledgedByUserId" | "resolvedByUserId" | null;
    validFrom: Readonly<ValidFrom[]>;
  }
> = {
  acknowledged: {
    status: "acknowledged",
    atField: "acknowledgedAt",
    byField: "acknowledgedByUserId",
    validFrom: ["open"],
  },
  resolved: {
    status: "resolved",
    atField: "resolvedAt",
    byField: "resolvedByUserId",
    validFrom: ["open", "acknowledged"],
  },
  open: {
    status: "open",
    atField: null,
    byField: null,
    validFrom: ["acknowledged", "resolved"],
  },
};

const PERMISSION_BY_TARGET: Record<TransitionTarget, string> = {
  acknowledged: "alerts.acknowledge",
  resolved: "alerts.resolve",
  open: "alerts.reopen",
};

const ACTION_BY_TARGET: Record<TransitionTarget, "alert.acknowledge" | "alert.resolve" | "alert.reopen"> = {
  acknowledged: "alert.acknowledge",
  resolved: "alert.resolve",
  open: "alert.reopen",
};

export interface TransitionInput {
  alertId: string;
  to: TransitionTarget;
}

// Exported matrix for unit tests without DB.
export function getTransitionMatrix(): Record<TransitionTarget, { status: AlertStatus; validFrom: readonly string[] }> {
  return Object.fromEntries(
    Object.entries(TRANSITION_MAP).map(([target, entry]) => [
      target,
      { status: entry.status, validFrom: entry.validFrom },
    ]),
  ) as Record<TransitionTarget, { status: AlertStatus; validFrom: readonly string[] }>;
}

export async function transitionAlert(
  db: Database,
  actor: ActorContext,
  input: TransitionInput,
  metadata: { requestId: string; ip: string | null; userAgent: string | null },
): Promise<AlertDetail> {
  const permission = PERMISSION_BY_TARGET[input.to];
  requirePermission(actor.permissions, permission);

  return db.transaction(async (tx) => {
    // Row lock before any idempotency check — prevents concurrent duplicate events.
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

    // Idempotency first: self-transition returns existing detail without new event.
    if (currentStatus === target.status) {
      const timeline = await fetchTimeline(tx, alert.id);
      return {
        ...mapAlertRow(alert),
        timeline,
      };
    }

    // Validate: reject invalid source→target pairs explicitly.
    if (!target.validFrom.includes(currentStatus as ValidFrom)) {
      throw new Error(
        `cannot transition alert from ${currentStatus} to ${input.to}`,
      );
    }

    // Perform transition.
    const now = new Date();
    const updateFields: Record<string, unknown> = {};

    // Set target timestamp/by.
    if (target.atField) updateFields[target.atField] = now;
    if (target.byField) updateFields[target.byField] = actor.userId;

    // Clear stale timestamps and by-IDs when reopening (open has no by-field).
    if (input.to === "open") {
      updateFields.acknowledgedAt = null;
      updateFields.acknowledgedByUserId = null;
      updateFields.resolvedAt = null;
      updateFields.resolvedByUserId = null;
    }

    await tx
      .update(schema.alerts)
      .set({ status: target.status, ...updateFields })
      .where(eq(schema.alerts.id, input.alertId));

    // fromStatus is null only when transitioning from open.
    const fromStatus = currentStatus === "open" ? null : currentStatus;

    await tx.insert(schema.alertEvents).values({
      alertId: input.alertId,
      fromStatus,
      toStatus: target.status,
      actorUserId: actor.userId,
      occurredAt: now,
      metadata: { requestId: metadata.requestId } as Record<string, unknown>,
    });

    const auditEvent: AuditEventInput = {
      actorUserId: actor.userId,
      targetType: "alert",
      targetId: input.alertId,
      action: ACTION_BY_TARGET[input.to],
      ipAddress: metadata.ip,
      userAgent: metadata.userAgent,
      requestId: metadata.requestId,
      detail: { fromStatus: currentStatus, toStatus: target.status },
    };
    await writeAuditEvent(tx, auditEvent);

    // Fetch updated alert and timeline.
    const [updatedAlert] = await tx
      .select()
      .from(schema.alerts)
      .where(eq(schema.alerts.id, input.alertId))
      .limit(1);

    const timeline = await fetchTimeline(tx, updatedAlert!.id);

    return {
      ...mapAlertRow(updatedAlert!),
      timeline,
    };
  });
}

async function fetchTimeline(
  tx: DatabaseTransaction,
  alertId: string,
): Promise<
  Array<{
    id: string;
    fromStatus: AlertStatus | null;
    toStatus: AlertStatus;
    actorUserId: string | null;
    occurredAt: Date;
    metadata: Record<string, unknown>;
  }>
> {
  const events = await tx
    .select()
    .from(schema.alertEvents)
    .where(eq(schema.alertEvents.alertId, alertId))
    .orderBy(asc(schema.alertEvents.occurredAt));
  return events.map((e) => ({
    id: e.id,
    fromStatus: e.fromStatus as AlertStatus | null,
    toStatus: e.toStatus as AlertStatus,
    actorUserId: e.actorUserId,
    occurredAt: e.occurredAt,
    metadata: e.metadata as Record<string, unknown>,
  }));
}
