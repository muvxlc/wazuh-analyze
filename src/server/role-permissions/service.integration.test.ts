import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import {
  fetchRoleOverrides,
  fetchAllRoleOverrides,
  updateRolePermissions,
} from "./service";
import type { ActorContext } from "../authorization/permissions";

describe("role-permissions service", () => {
  let db: Database;
  let pool: ReturnType<typeof createTestPool>;
  let superAdminId: string;
  let adminId: string;

  const superAdminActor: ActorContext = {
    userId: "super-admin",
    role: "super_admin",
    permissions: new Set(["roles.manage", "super_admins.manage"]),
  };

  const adminActor: ActorContext = {
    userId: "admin",
    role: "admin",
    permissions: new Set(["roles.read"]),
  };

  beforeEach(async () => {
    pool = createTestPool();
    db = drizzle(pool, { schema });
    await resetTestDatabase(pool);

    const [sa] = await db
      .insert(schema.users)
      .values({
        email: "super@example.com",
        normalizedEmail: "super@example.com",
        displayName: "Super Admin",
        passwordHash: "hash",
        role: "super_admin",
        locale: "en",
        isActive: true,
      })
      .returning({ id: schema.users.id });
    superAdminId = sa.id;

    const [a] = await db
      .insert(schema.users)
      .values({
        email: "admin@example.com",
        normalizedEmail: "admin@example.com",
        displayName: "Admin",
        passwordHash: "hash",
        role: "admin",
        locale: "en",
        isActive: true,
      })
      .returning({ id: schema.users.id });
    adminId = a.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("fetchRoleOverrides", () => {
    it("returns empty array when no overrides exist", async () => {
      const result = await fetchRoleOverrides(db, "admin");
      expect(result).toEqual([]);
    });

    it("returns overrides for a role", async () => {
      await db.insert(schema.rolePermissionOverrides).values([
        { role: "admin", permission: "users.manage", effect: "deny", createdByUserId: superAdminId },
        { role: "admin", permission: "audit.read", effect: "allow", createdByUserId: superAdminId },
      ]);
      const result = await fetchRoleOverrides(db, "admin");
      expect(result).toHaveLength(2);
      expect(result.find((r) => r.permission === "users.manage")!.effect).toBe("deny");
    });
  });

  describe("fetchAllRoleOverrides", () => {
    it("returns map with all three roles", async () => {
      const result = await fetchAllRoleOverrides(db);
      expect(result.has("super_admin")).toBe(true);
      expect(result.has("admin")).toBe(true);
      expect(result.has("user")).toBe(true);
    });
  });

  describe("updateRolePermissions", () => {
    it("rejects when actor lacks roles.manage", async () => {
      await expect(
        updateRolePermissions(db, adminId, {
          role: "admin",
          overrides: [],
        }, false, { requestId: "req-1", ip: null, userAgent: null }),
      ).rejects.toThrow("forbidden");
    });

    it("rejects updating super_admin role", async () => {
      await expect(
        updateRolePermissions(db, superAdminId, {
          role: "super_admin",
          overrides: [],
        }, true, { requestId: "req-1", ip: null, userAgent: null }),
      ).rejects.toThrow("forbidden");
    });

    it("writes overrides and audit event", async () => {
      await updateRolePermissions(db, superAdminId, {
        role: "admin",
        overrides: [
          { permission: "users.manage", effect: "deny" },
          { permission: "audit.read", effect: "allow" },
        ],
      }, true, { requestId: "req-1", ip: "127.0.0.1", userAgent: "test" });

      const overrides = await db
        .select()
        .from(schema.rolePermissionOverrides)
        .where(eq(schema.rolePermissionOverrides.role, "admin"));

      expect(overrides).toHaveLength(2);
      expect(overrides.find((o) => o.permission === "users.manage")!.effect).toBe("deny");

      const audits = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, "role_permission.update"));

      expect(audits).toHaveLength(1);
      expect(audits[0]!.detail).toEqual(expect.objectContaining({ role: "admin" }));
    });

    it("replaces existing overrides", async () => {
      await db.insert(schema.rolePermissionOverrides).values([
        { role: "admin", permission: "users.read", effect: "allow", createdByUserId: superAdminId },
      ]);

      await updateRolePermissions(db, superAdminId, {
        role: "admin",
        overrides: [{ permission: "users.manage", effect: "deny" }],
      }, true, { requestId: "req-1", ip: null, userAgent: null });

      const overrides = await db
        .select()
        .from(schema.rolePermissionOverrides)
        .where(eq(schema.rolePermissionOverrides.role, "admin"));

      expect(overrides).toHaveLength(1);
      expect(overrides[0]!.permission).toBe("users.manage");
    });
  });
});
