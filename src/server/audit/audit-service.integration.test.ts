import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { describe, expect, it, afterAll, beforeEach } from "vitest";

import { createDatabase } from "../db/client";
import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import { writeAuditEvent } from "./audit-service";
import type { AuditEventInput } from "./types";

const TEST_CONNECTION =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:55432/wazuh_dashboard_test";

describe("writeAuditEvent", () => {
  let db: Database;
  let pool: ReturnType<typeof createTestPool>;
  let userId: string;

  beforeEach(async () => {
    pool = createTestPool();
    db = drizzle(pool, { schema });
    await resetTestDatabase(pool);

    const [user] = await db
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
    userId = user.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("writes audit event to database", async () => {
    const event: AuditEventInput = {
      actorUserId: userId,
      targetType: "user",
      targetId: userId,
      action: "user.role.update",
      ipAddress: "127.0.0.1",
      userAgent: "test-agent",
      requestId: "req-1",
      detail: { from: "admin", to: "user" },
    };

    await writeAuditEvent(db, event);

    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "user.role.update"));

    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorUserId).toBe(userId);
    expect(audits[0]!.targetType).toBe("user");
    expect(audits[0]!.targetId).toBe(userId);
    expect(audits[0]!.action).toBe("user.role.update");
    expect(audits[0]!.ipAddress).toBe("127.0.0.1");
    expect(audits[0]!.userAgent).toBe("test-agent");
    expect(audits[0]!.requestId).toBe("req-1");
    expect(audits[0]!.detail).toEqual({ from: "admin", to: "user" });
  });

  it("works inside a transaction", async () => {
    const event: AuditEventInput = {
      actorUserId: userId,
      targetType: null,
      targetId: null,
      action: "system.health",
      ipAddress: null,
      userAgent: null,
      requestId: "req-2",
      detail: { status: "ok" },
    };

    await db.transaction(async (tx) => {
      await writeAuditEvent(tx, event);
    });

    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "system.health"));

    expect(audits).toHaveLength(1);
  });

  it("rolls back when transaction is aborted", async () => {
    const event: AuditEventInput = {
      actorUserId: userId,
      targetType: null,
      targetId: null,
      action: "system.health",
      ipAddress: null,
      userAgent: null,
      requestId: "req-3",
      detail: {},
    };

    await expect(
      db.transaction(async (tx) => {
        await writeAuditEvent(tx, event);
        throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");

    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "system.health"));

    expect(audits).toHaveLength(0);
  });
});
