import { asc, eq } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "../db/types";
import * as schema from "../db/schema";
import type { ActorContext } from "../authorization/permissions";
import { requirePermission } from "../authorization/require";
import type { IncidentDetail, IncidentStatus } from "./types";
import { writeAuditEvent } from "../audit/audit-service";
import type { AuditEventInput, AuditAction } from "../audit/types";

type ValidFrom = "open" | "investigating" | "mitigated" | "resolved";
type TransitionTarget = "investigating" | "mitigated" | "resolved" | "open";

// ponytail: straightforward transition matrix for Incident lifecycle. All state shifts gated by incidents.manage.
const TRANSITION_MAP: Record<
  TransitionTarget,
  {
    status: IncidentStatus;
    validFrom: Readonly<ValidFrom[]>;
  }
> = {
  investigating: {
    status: "investigating",
    validFrom: ["open", "mitigated", "resolved"],
  },
  mitigated: {
    status: "mitigated",
    validFrom: ["open", "investigating"],
  },
  resolved: {
    status: "resolved",
    validFrom: ["open", "investigating", "mitigated"],
  },
  open: {
    status: "open",
    validFrom: ["investigating", "mitigated", "resolved"],
  },
};

const ACTION_BY_TARGET: Record<TransitionTarget, AuditAction> = {
  investigating: "incident.investigate",
  mitigated: "incident.mitigate",
  resolved: "incident.resolve",
  open: "incident.reopen",
};

export interface IncidentTransitionInput {
  incidentId: string;
  to: TransitionTarget;
}

export function getIncidentTransitionMatrix(): Record<TransitionTarget, { status: IncidentStatus; validFrom: readonly string[] }> {
  return Object.fromEntries(
    Object.entries(TRANSITION_MAP).map(([target, entry]) => [
      target,
      { status: entry.status, validFrom: entry.validFrom },
    ]),
  ) as Record<TransitionTarget, { status: IncidentStatus; validFrom: readonly string[] }>;
}

export async function transitionIncident(
  db: Database,
  actor: ActorContext,
  input: IncidentTransitionInput,
  metadata: { requestId: string; ip: string | null; userAgent: string | null },
): Promise<IncidentDetail> {
  requirePermission(actor.permissions, "incidents.manage");

  return db.transaction(async (tx) => {
    // Row lock before idempotency check to prevent concurrent races.
    const [incident] = await tx
      .select()
      .from(schema.incidents)
      .where(eq(schema.incidents.id, input.incidentId))
      .limit(1)
      .for("update")
      .execute();

    if (!incident) {
      throw new Error(`incident not found: ${input.incidentId}`);
    }

    const target = TRANSITION_MAP[input.to];
    const currentStatus = incident.status as IncidentStatus;

    // Idempotency: returning current state without new event if unchanged.
    if (currentStatus === target.status) {
      const timeline = await fetchIncidentTimeline(tx, incident.id);
      return {
        ...incident,
        status: currentStatus,
        timeline,
      };
    }

    if (!target.validFrom.includes(currentStatus as ValidFrom)) {
      throw new Error(`cannot transition incident from ${currentStatus} to ${input.to}`);
    }

    const now = new Date();
    const updateFields: Record<string, unknown> = { updatedAt: now };

    // Resolve stamps closedAt; any other transition clears it (reopening from resolved).
    if (target.status === "resolved") {
      updateFields.closedAt = now;
    } else {
      updateFields.closedAt = null;
    }

    await tx
      .update(schema.incidents)
      .set({ status: target.status, ...updateFields })
      .where(eq(schema.incidents.id, input.incidentId));

    // Incident lifecycle has no synthetic initial status; fromStatus always present.
    const fromStatus = currentStatus;

    await tx.insert(schema.incidentEvents).values({
      incidentId: input.incidentId,
      fromStatus,
      toStatus: target.status,
      actorUserId: actor.userId,
      occurredAt: now,
      metadata: { requestId: metadata.requestId } as Record<string, unknown>,
    });

    const auditEvent: AuditEventInput = {
      actorUserId: actor.userId,
      targetType: "incident",
      targetId: input.incidentId,
      action: ACTION_BY_TARGET[input.to],
      ipAddress: metadata.ip,
      userAgent: metadata.userAgent,
      requestId: metadata.requestId,
      detail: { fromStatus: currentStatus, toStatus: target.status },
    };
    await writeAuditEvent(tx, auditEvent);

    const [updated] = await tx
      .select()
      .from(schema.incidents)
      .where(eq(schema.incidents.id, input.incidentId))
      .limit(1);

    const timeline = await fetchIncidentTimeline(tx, updated!.id);

    return {
      ...updated!,
      status: updated!.status as IncidentStatus,
      timeline,
    };
  });
}

async function fetchIncidentTimeline(
  tx: DatabaseTransaction,
  incidentId: string,
): Promise<IncidentDetail["timeline"]> {
  const events = await tx
    .select()
    .from(schema.incidentEvents)
    .where(eq(schema.incidentEvents.incidentId, incidentId))
    .orderBy(asc(schema.incidentEvents.occurredAt));
  return events.map((e) => ({
    id: e.id,
    fromStatus: e.fromStatus as IncidentStatus | null,
    toStatus: e.toStatus as IncidentStatus,
    actorUserId: e.actorUserId,
    occurredAt: e.occurredAt,
    metadata: e.metadata as Record<string, unknown>,
  }));
}
