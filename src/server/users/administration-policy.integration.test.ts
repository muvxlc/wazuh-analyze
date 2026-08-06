import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { describe, expect, it, afterAll, beforeEach } from "vitest";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import { updateUserAccess } from "./administration-policy";
import type { ActorContext } from "../authorization/permissions";
import type { RequestMetadata } from "../http/request-metadata";

const TEST_CONNECTION =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:55432/wazuh_dashboard_test";

describe("updateUserAccess", () => {
  let db: Database;
  let pool: ReturnType<typeof createTestPool>;
  let actor: ActorContext;
  let metadata: RequestMetadata;
  let adminId: string;
  let userId: string;
  let superAdminId: string;

  beforeEach(async () => {
    pool = createTestPool();
    db = drizzle(pool, { schema });
    await resetTestDatabase(pool);

    // Insert test users
    const [superAdmin] = await db
      .insert(schema.users)
      .values({
        email: "super@example.com",
        normalizedEmail: "super@example.com",
        displayName: "Super Admin",
        passwordHash: "hash-super",
        role: "super_admin",
        locale: "en",
        isActive: true,
      })
      .returning({ id: schema.users.id });
    superAdminId = superAdmin.id;

    const [admin] = await db
      .insert(schema.users)
      .values({
        email: "admin@example.com",
        normalizedEmail: "admin@example.com",
        displayName: "Admin",
        passwordHash: "hash-admin",
        role: "admin",
        locale: "en",
        isActive: true,
      })
      .returning({ id: schema.users.id });
    adminId = admin.id;

    const [user] = await db
      .insert(schema.users)
      .values({
        email: "user@example.com",
        normalizedEmail: "user@example.com",
        displayName: "User",
        passwordHash: "hash-user",
        role: "user",
        locale: "en",
        isActive: true,
      })
      .returning({ id: schema.users.id });
    userId = user.id;

    actor = {
      userId: adminId,
      role: "admin",
      permissions: new Set([
        "dashboard.read",
        "alerts.read",
        "alerts.list",
        "alerts.details",
        "alerts.acknowledge",
        "alerts.resolve",
        "agents.read",
        "agents.list",
        "users.read",
        "users.manage",
        "invites.manage",
        "roles.read",
        "sessions.revoke",
        "audit.read",
      ]),
    };

    metadata = {
      requestId: "req-test-1",
      ip: "127.0.0.1",
      userAgent: "test-agent",
    };
  });

  afterAll(async () => {
    await pool.end();
  });

  it("prevents demoting the last active super admin", async () => {
    // Only one super_admin exists (superAdminId). Demoting them should fail.
    const superAdminActor: ActorContext = {
      userId: superAdminId,
      role: "super_admin",
      permissions: new Set([
        "dashboard.read",
        "users.manage",
        "super_admins.manage",
      ]),
    };

    await expect(
      updateUserAccess(db, superAdminActor, {
        userId: superAdminId,
        role: "admin",
      }, metadata),
    ).rejects.toMatchObject({ code: "last_super_admin" });
  });

  it("rejects when actor lacks users.manage", async () => {
    const userActor: ActorContext = {
      userId: userId,
      role: "user",
      permissions: new Set(["dashboard.read", "alerts.read", "alerts.list", "alerts.details", "agents.read", "agents.list"]),
    };

    await expect(
      updateUserAccess(db, userActor, {
        userId: adminId,
        role: "admin",
      }, metadata),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects when non-super_admin changes super_admin role", async () => {
    await expect(
      updateUserAccess(db, actor, {
        userId: superAdminId,
        role: "admin",
      }, metadata),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("commits role change and audit event in one transaction", async () => {
    const superAdminActor: ActorContext = {
      userId: superAdminId,
      role: "super_admin",
      permissions: new Set(["dashboard.read", "users.manage", "super_admins.manage"]),
    };

    const result = await updateUserAccess(db, superAdminActor, {
      userId: adminId,
      role: "user",
    }, metadata);

    expect(result.role).toBe("user");
    expect(result.id).toBe(adminId);

    // Verify audit event was written
    const auditEvents = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.targetId, adminId));

    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.action).toBe("user.role.update");
  });

  it("rolls back access mutation when audit insert fails", async () => {
    // Add a constraint that will always fail on audit insert
    await pool.query(
      `ALTER TABLE audit_events ADD CONSTRAINT task3_rollback_test CHECK (false)`,
    );

    const superAdminActor: ActorContext = {
      userId: superAdminId,
      role: "super_admin",
      permissions: new Set(["dashboard.read", "users.manage", "super_admins.manage"]),
    };

    await expect(
      updateUserAccess(db, superAdminActor, {
        userId: adminId,
        role: "user",
      }, metadata),
    ).rejects.toThrow();

    // Verify the access mutation was rolled back
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, adminId),
    });
    expect(user?.role).toBe("admin");

    // Remove the constraint
    await pool.query(
      `ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS task3_rollback_test`,
    );
  });

  it("rejects when target user does not exist", async () => {
    await expect(
      updateUserAccess(db, actor, {
        userId: "00000000-0000-0000-0000-000000000000",
        role: "admin",
      }, metadata),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("deactivates user successfully", async () => {
    const superAdminActor: ActorContext = {
      userId: superAdminId,
      role: "super_admin",
      permissions: new Set(["dashboard.read", "users.manage", "super_admins.manage"]),
    };

    const result = await updateUserAccess(db, superAdminActor, {
      userId: userId,
      isActive: false,
    }, metadata);

    expect(result.isActive).toBe(false);
  });

  it("prevents deactivating the last active super admin", async () => {
    const superAdminActor: ActorContext = {
      userId: superAdminId,
      role: "super_admin",
      permissions: new Set([
        "dashboard.read",
        "users.manage",
        "super_admins.manage",
      ]),
    };

    await expect(
      updateUserAccess(db, superAdminActor, {
        userId: superAdminId,
        isActive: false,
      }, metadata),
    ).rejects.toMatchObject({ code: "last_super_admin" });
  });
});
