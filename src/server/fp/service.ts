import { desc, eq } from "drizzle-orm";

import type { Database } from "../db/types";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import type { ActorContext } from "../authorization/permissions";
import { requirePermission } from "../authorization/require";
import { writeAuditEvent } from "../audit/audit-service";
import { buildSignatureKey } from "./signature";

// FP (false-positive) memory CRUD. Mirrors the transitionAlert pattern: every
// mutation runs inside a transaction and writes an audit event. Signature keys
// are derived ONLY from (ruleId, agentId, level) — never srcip (see signature.ts).
// These rows only soft-suppress downstream gates (notify / auto-IR-draft); they
// never drop, hide, or auto-resolve alerts. Enforcement of severity floor +
// expiry lives in check.ts (shouldApplyFp), invoked at analysis time.

const FP_PERMISSION = "alerts.manage_fp";

export interface FpActorMetadata {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

export interface FpSignaturePublic {
  id: string;
  signatureKey: string;
  ruleId: string | null;
  agentId: string | null;
  level: number | null;
  reason: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  expiresAt: Date;
  lastMatchedAt: Date | null;
  matchCount: number;
  enabled: boolean;
}

type FpRow = typeof schema.fpSignatures.$inferSelect;

function mapRow(row: FpRow): FpSignaturePublic {
  return {
    id: row.id,
    signatureKey: row.signatureKey,
    ruleId: row.ruleId,
    agentId: row.agentId,
    level: row.level,
    reason: row.reason,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastMatchedAt: row.lastMatchedAt,
    matchCount: row.matchCount,
    enabled: row.enabled,
  };
}

const MS_PER_DAY = 86_400_000;

/**
 * Create or renew an FP signature from an alert. Re-marking an existing
 * signature key renews it (onConflictDoUpdate) rather than erroring — the
 * unique index on signatureKey is the identity boundary.
 */
export async function createFpSignature(
  db: Database,
  actor: ActorContext,
  input: { alertId: string; reason?: string; ttlDays: number },
  metadata: FpActorMetadata,
): Promise<FpSignaturePublic> {
  requirePermission(actor.permissions, FP_PERMISSION);

  return db.transaction(async (tx) => {
    const [alert] = await tx
      .select({
        ruleId: schema.alerts.ruleId,
        agentId: schema.alerts.agentId,
        level: schema.alerts.level,
      })
      .from(schema.alerts)
      .where(eq(schema.alerts.id, input.alertId))
      .limit(1)
      .for("update")
      .execute();

    if (!alert) {
      throw new AppError("not_found", 404, { alertId: input.alertId });
    }

    const signatureKey = buildSignatureKey(alert.ruleId, alert.agentId, alert.level);
    if (!signatureKey) {
      // No ruleId => no signature. Refuse to suppress generic noise.
      throw new AppError("bad_request", 400, {
        reason: "alert has no ruleId; cannot derive FP signature",
      });
    }

    const expiresAt = new Date(Date.now() + input.ttlDays * MS_PER_DAY);

    const [row] = await tx
      .insert(schema.fpSignatures)
      .values({
        signatureKey,
        ruleId: alert.ruleId,
        agentId: alert.agentId,
        level: alert.level,
        reason: input.reason ?? null,
        createdByUserId: actor.userId,
        expiresAt,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: schema.fpSignatures.signatureKey,
        set: {
          reason: input.reason ?? null,
          expiresAt,
          enabled: true,
          createdByUserId: actor.userId,
        },
      })
      .returning();

    await writeAuditEvent(tx, {
      actorUserId: actor.userId,
      targetType: "alert",
      targetId: input.alertId,
      action: "fp_signature.create",
      ipAddress: metadata.ip,
      userAgent: metadata.userAgent,
      requestId: metadata.requestId,
      detail: {
        signatureId: row.id,
        signatureKey: row.signatureKey,
        ruleId: row.ruleId,
        agentId: row.agentId,
        level: row.level,
        expiresAt: row.expiresAt.toISOString(),
      },
    });

    return mapRow(row);
  });
}

export async function listFpSignatures(
  db: Database,
  limit = 200,
): Promise<FpSignaturePublic[]> {
  const rows = await db
    .select()
    .from(schema.fpSignatures)
    .orderBy(desc(schema.fpSignatures.createdAt))
    .limit(limit);
  return rows.map(mapRow);
}

/** Hard delete. Returns void; throws 404 if the row never existed. */
export async function deleteFpSignature(
  db: Database,
  actor: ActorContext,
  id: string,
  metadata: FpActorMetadata,
): Promise<void> {
  requirePermission(actor.permissions, FP_PERMISSION);

  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(schema.fpSignatures)
      .where(eq(schema.fpSignatures.id, id))
      .returning({
        id: schema.fpSignatures.id,
        signatureKey: schema.fpSignatures.signatureKey,
      });

    if (!row) {
      throw new AppError("not_found", 404, { signatureId: id });
    }

    await writeAuditEvent(tx, {
      actorUserId: actor.userId,
      targetType: "fp_signature",
      targetId: id,
      action: "fp_signature.delete",
      ipAddress: metadata.ip,
      userAgent: metadata.userAgent,
      requestId: metadata.requestId,
      detail: { signatureId: row.id, signatureKey: row.signatureKey },
    });
  });
}

/** Extend expiry + re-enable. ttlDays comes from effective config at the route layer. */
export async function renewFpSignature(
  db: Database,
  actor: ActorContext,
  id: string,
  ttlDays: number,
  metadata: FpActorMetadata,
): Promise<FpSignaturePublic> {
  requirePermission(actor.permissions, FP_PERMISSION);

  return db.transaction(async (tx) => {
    const expiresAt = new Date(Date.now() + ttlDays * MS_PER_DAY);
    const [row] = await tx
      .update(schema.fpSignatures)
      .set({ expiresAt, enabled: true })
      .where(eq(schema.fpSignatures.id, id))
      .returning();

    if (!row) {
      throw new AppError("not_found", 404, { signatureId: id });
    }

    await writeAuditEvent(tx, {
      actorUserId: actor.userId,
      targetType: "fp_signature",
      targetId: id,
      action: "fp_signature.renew",
      ipAddress: metadata.ip,
      userAgent: metadata.userAgent,
      requestId: metadata.requestId,
      detail: {
        signatureId: row.id,
        signatureKey: row.signatureKey,
        expiresAt: row.expiresAt.toISOString(),
      },
    });

    return mapRow(row);
  });
}
