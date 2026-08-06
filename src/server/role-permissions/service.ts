import "server-only";

import { eq } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "../db/types";
import * as schema from "../db/schema";
import type { Role, OverrideEffect, Permission } from "../authorization/permissions";
import { ROLES } from "../authorization/permissions";
import { ROLE_DEFAULTS } from "../authorization/role-defaults";
import { writeAuditEvent } from "../audit/audit-service";
import type { AuditEventInput } from "../audit/types";

export interface RolePermissionOverride {
  permission: Permission;
  effect: OverrideEffect;
}

export interface RolePermissionRow {
  permission: string;
  effect: "allow" | "deny";
}

export interface UpdateRolePermissionsInput {
  role: Role;
  overrides: RolePermissionOverride[];
}

export async function fetchRoleOverrides(
  db: Database,
  role: Role,
): Promise<RolePermissionRow[]> {
  const result = await db
    .select({
      permission: schema.rolePermissionOverrides.permission,
      effect: schema.rolePermissionOverrides.effect,
    })
    .from(schema.rolePermissionOverrides)
    .where(eq(schema.rolePermissionOverrides.role, role));
  return result;
}

export async function fetchAllRoleOverrides(
  db: Database,
): Promise<Map<Role, RolePermissionRow[]>> {
  const roles = new Map<Role, RolePermissionRow[]>();
  for (const role of ROLES) {
    const result = await fetchRoleOverrides(db, role);
    roles.set(role, result);
  }
  return roles;
}

export async function updateRolePermissions(
  db: Database,
  actorUserId: string,
  input: UpdateRolePermissionsInput,
  hasRolesManage: boolean,
  metadata: { requestId: string; ip: string | null; userAgent: string | null },
): Promise<void> {
  const { role, overrides } = input;

  if (!ROLES.includes(role)) {
    throw new Error(`Unknown role: ${role}`);
  }

  // Only super_admins can manage role permissions
  if (!hasRolesManage) {
    throw new Error("forbidden");
  }

  // Super_admin role cannot be managed by anyone (safety invariant)
  if (role === "super_admin") {
    throw new Error("forbidden");
  }

  // Validate all permissions are known
  const knownPermissions = new Set(Object.values(ROLE_DEFAULTS).flat());
  for (const override of overrides) {
    if (!knownPermissions.has(override.permission)) {
      throw new Error(`unknown_permission: ${override.permission}`);
    }
  }

  await db.transaction(async (tx) => {
    // Remove existing overrides for this role
    await tx
      .delete(schema.rolePermissionOverrides)
      .where(eq(schema.rolePermissionOverrides.role, role));

    // Insert new overrides
    if (overrides.length > 0) {
      await tx.insert(schema.rolePermissionOverrides).values(
        overrides.map((item) => ({
          role,
          permission: item.permission,
          effect: item.effect,
          createdByUserId: actorUserId,
        })),
      );
    }

    // Write audit event
    await writeAuditEvent(tx, {
      actorUserId: actorUserId,
      targetType: "role",
      targetId: role,
      action: "role_permission.update",
      ipAddress: metadata.ip,
      userAgent: metadata.userAgent,
      requestId: metadata.requestId,
      detail: { role, overrides },
    } as AuditEventInput);
  });
}

// ponytail: extract to schema validation when permission catalogue grows or becomes dynamic.
