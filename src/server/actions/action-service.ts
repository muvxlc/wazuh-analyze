import "server-only";

import { and, eq } from "drizzle-orm";
import type { Database } from "../db/types";
import { ActorContext } from "../authorization/permissions";
import { requirePermission } from "../authorization/require";
import { AppError } from "../errors";
import { writeAuditEvent } from "../audit/audit-service";
import { actions, actionApprovals } from "../db/schema";
import { randomUUID } from "crypto";

export interface ProposeActionInput {
  incidentId: string;
  command: string;
  payload?: Record<string, unknown>;
  reason: string;
}

export interface RequestMetadata {
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function proposeAction(db: Database, actor: ActorContext, input: ProposeActionInput, meta: RequestMetadata = {}): Promise<{ id: string }> {
  requirePermission(actor.permissions, "actions.propose");
  const [row] = await db.insert(actions).values({
    incidentId: input.incidentId,
    command: input.command,
    payload: input.payload ?? {},
    reason: input.reason,
    status: "proposed",
    proposedByUserId: actor.userId,
  }).returning({ id: actions.id });
  await writeAuditEvent(db, {
    actorUserId: actor.userId,
    targetType: "action",
    targetId: row.id,
    action: "action.propose",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    requestId: meta.requestId ?? randomUUID(),
    detail: { command: input.command, incidentId: input.incidentId },
  });
  return { id: row.id };
}

export async function approveAction(db: Database, actor: ActorContext, actionId: string, decision: "approve" | "reject", note?: string, meta: RequestMetadata = {}): Promise<void> {
  requirePermission(actor.permissions, "actions.approve");
  if (!actor.userId) throw new AppError("action_actor_required", 400, { message: "User actor required" });
  const [existing] = await db.select().from(actions).where(eq(actions.id, actionId)).limit(1);
  if (!existing) throw new AppError("action_not_found", 404, { message: "Action not found" });
  if (existing.status !== "proposed") throw new AppError("action_not_proposed", 409, { message: `Action already ${existing.status}` });
  await db.transaction(async (tx) => {
    await tx.insert(actionApprovals).values({ actionId, approverUserId: actor.userId as string, decision, note: note ?? null });
    await tx.update(actions).set({ status: decision === "approve" ? "approved" : "rejected", updatedAt: new Date() }).where(eq(actions.id, actionId));
  });
  await writeAuditEvent(db, {
    actorUserId: actor.userId,
    targetType: "action",
    targetId: actionId,
    action: "action.approve",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    requestId: meta.requestId ?? randomUUID(),
    detail: { decision, note: note ?? null },
  });
}

export async function listIncidentActions(db: Database, incidentId: string) {
  return db.select().from(actions).where(eq(actions.incidentId, incidentId));
}

export async function fetchApprovedActions(db: Database, limit = 10) {
  return db.select().from(actions).where(eq(actions.status, "approved")).limit(limit);
}

export async function markActionExecuted(db: Database, actionId: string, result: { success: boolean; error?: string }) {
  await db.update(actions).set({
    status: result.success ? "executed" : "approved",
    updatedAt: new Date(),
  }).where(and(eq(actions.id, actionId), eq(actions.status, "approved")));
}
