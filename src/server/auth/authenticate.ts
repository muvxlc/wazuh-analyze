import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { AppError } from "../errors";
import * as schema from "../db/schema";
import type { Database } from "../db/types";
import type { Role, Locale, Permission } from "../authorization/permissions";
import { resolvePermissions } from "../authorization/resolve";
import { readSession } from "./session";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  locale: Locale;
  permissions: ReadonlySet<Permission>;
  sessionId: string;
}

export async function authenticateRequest(db: Database, token: string | null): Promise<AuthenticatedUser> {
  if (!token) throw new AppError("unauthenticated", 401);
  const session = await readSession(db, token);
  if (!session) throw new AppError("unauthenticated", 401);
  const [user] = await db.select().from(schema.users).where(and(
    eq(schema.users.id, session.userId),
    eq(schema.users.isActive, true),
  )).limit(1);
  if (!user) throw new AppError("unauthenticated", 401);

  // Fetch both user-level and role-level overrides
  const userOverrides = await db.select({ permission: schema.permissionOverrides.permission, effect: schema.permissionOverrides.effect })
    .from(schema.permissionOverrides).where(eq(schema.permissionOverrides.userId, user.id));
  const roleOverrides = await db.select({ permission: schema.rolePermissionOverrides.permission, effect: schema.rolePermissionOverrides.effect })
    .from(schema.rolePermissionOverrides).where(eq(schema.rolePermissionOverrides.role, user.role));

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    locale: user.locale,
    permissions: new Set(resolvePermissions({ role: user.role, overrides: userOverrides, roleOverrides })),
    sessionId: session.id,
  };
}
