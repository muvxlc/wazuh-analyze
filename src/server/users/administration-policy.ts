import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { AppError } from "../errors";
import type { Database, DatabaseTransaction } from "../db/types";
import * as schema from "../db/schema";
import type { ActorContext } from "../authorization/permissions";
import { requirePermission } from "../authorization/require";
import { writeAuditEvent } from "../audit/audit-service";
import type { RequestMetadata } from "../http/request-metadata";
import type { UserSummary } from "./user-service";
import type { AuditEventInput } from "../audit/types";

export interface UpdateUserAccessInput {
  userId: string;
  role?: "super_admin" | "admin" | "user";
  isActive?: boolean;
}

async function lockUserRow(
  tx: DatabaseTransaction,
  userId: string,
): Promise<{ id: string; role: string; isActive: boolean }> {
  const result = await tx.execute(
    sql`SELECT id, role, is_active FROM ${schema.users} WHERE id = ${userId} FOR UPDATE`,
  );

  if (result.rowCount === 0) {
    throw new AppError("not_found", 404);
  }

  return {
    id: result.rows[0].id as string,
    role: result.rows[0].role as string,
    isActive: result.rows[0].is_active as boolean,
  };
}

async function countActiveSuperAdmins(
  tx: DatabaseTransaction,
  excludeUserId: string,
): Promise<number> {
  // Lock all active super_admin rows to prevent TOCTOU:
  // concurrent transactions cannot bypass the last-super-admin check.
  await tx.execute(
    sql`SELECT id FROM ${schema.users} WHERE role = 'super_admin' AND is_active = true FOR UPDATE`,
  );

  const result = await tx.execute(
    sql`SELECT COUNT(*)::int AS count FROM ${schema.users} WHERE role = 'super_admin' AND is_active = true AND id != ${excludeUserId}`,
  );

  return result.rows[0].count as number;
}

export async function updateUserAccess(
  db: Database,
  actor: ActorContext,
  input: UpdateUserAccessInput,
  metadata: RequestMetadata,
): Promise<UserSummary> {
  return db.transaction(async (tx) => {
    // Actor must have users.manage to change any user's access
    requirePermission(actor.permissions, "users.manage");

    // Lock the target user row to prevent race conditions
    const target = await lockUserRow(tx, input.userId);

    // If target is or is becoming a super_admin, actor needs super_admins.manage
    const touchesSuperAdmin =
      target.role === "super_admin" || input.role === "super_admin";
    if (touchesSuperAdmin) {
      requirePermission(actor.permissions, "super_admins.manage");
    }

    // Prevent demoting or deactivating the last active super admin
    if (target.role === "super_admin") {
      const isDemotion =
        input.role !== "super_admin" && input.role !== undefined;
      const isDeactivation = input.isActive === false;
      if (isDemotion || isDeactivation) {
        const remaining = await countActiveSuperAdmins(tx, input.userId);
        if (remaining === 0) {
          throw new AppError("last_super_admin", 409);
        }
      }
    }

    // Apply access mutation
    const updates: Partial<typeof schema.users.$inferInsert> = {};
    if (input.role !== undefined) {
      updates.role = input.role;
    }
    if (input.isActive !== undefined) {
      updates.isActive = input.isActive;
    }
    updates.updatedAt = new Date();

    await tx
      .update(schema.users)
      .set(updates)
      .where(eq(schema.users.id, input.userId))
      .execute();

    // Write audit event in same transaction
    const auditAction: AuditEventInput["action"] =
      input.role !== undefined ? "user.role.update" : "user.status.update";

    await writeAuditEvent(tx, {
      actorUserId: actor.userId,
      targetType: "user",
      targetId: input.userId,
      action: auditAction,
      ipAddress: metadata.ip,
      userAgent: metadata.userAgent,
      requestId: metadata.requestId,
      detail: {
        fromRole: target.role,
        toRole: input.role ?? target.role,
        fromActive: target.isActive,
        toActive: input.isActive ?? target.isActive,
      },
    });

    // Return updated user summary
    const result = await tx
      .select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        role: schema.users.role,
        locale: schema.users.locale,
        isActive: schema.users.isActive,
      })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1);

    const row = result[0]!;
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      role: row.role as UserSummary["role"],
      locale: row.locale as UserSummary["locale"],
      isActive: row.isActive,
    };
  });
}
