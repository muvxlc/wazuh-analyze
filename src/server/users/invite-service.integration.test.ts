import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { describe, expect, it, beforeEach, afterAll } from "vitest";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import { acceptInvite, createInvite, createInviteToken } from "./invite-service";
import { hashSessionToken } from "../auth/session";
import type { RequestMetadata } from "../http/request-metadata";

const pool = createTestPool();

const metadata: RequestMetadata = {
  requestId: "req-test",
  ip: "127.0.0.1",
  userAgent: "test-agent",
};

describe("invite-service integration", () => {
  let db: Database;
  let creatorId: string;

  beforeEach(async () => {
    db = drizzle(pool, { schema });
    await resetTestDatabase(pool);

    const [creator] = await db
      .insert(schema.users)
      .values({
        email: "admin@example.com",
        normalizedEmail: "admin@example.com",
        displayName: "Admin",
        passwordHash: "hash-admin",
        role: "super_admin",
        locale: "en",
        isActive: true,
      })
      .returning({ id: schema.users.id });
    creatorId = creator.id!;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates an invite token and stores only its hash", async () => {
    const result = await createInvite(db, {
      email: "new@example.com",
      role: "admin",
      createdByUserId: creatorId,
    }, metadata);

    expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.token).not.toBeNull();

    const [invite] = await db
      .select({ tokenHash: schema.invites.tokenHash })
      .from(schema.invites)
      .where(eq(schema.invites.id, result.inviteId));

    expect(invite?.tokenHash).toBeDefined();
    expect(invite!.tokenHash).not.toContain(result.token);
  });

  it("accepts a valid invite and creates the user", async () => {
    const inviteResult = await createInvite(db, {
      email: "new@example.com",
      role: "admin",
      createdByUserId: creatorId,
    }, metadata);

    const sessionResult = await acceptInvite(db, {
      token: inviteResult.token,
      displayName: "New User",
      password: "validPassword123!",
    }, metadata);

    expect(sessionResult.userId).toBeDefined();
    expect(sessionResult.session.token).toMatch(/^[A-Za-z0-9_-]+$/);

    const [user] = await db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, sessionResult.userId));
    expect(user?.role).toBe("admin");
  });

  it("rejects a already-used invite", async () => {
    const inviteResult = await createInvite(db, {
      email: "new@example.com",
      role: "admin",
      createdByUserId: creatorId,
    }, metadata);

    await acceptInvite(db, {
      token: inviteResult.token,
      displayName: "New User",
      password: "validPassword123!",
    }, metadata);

    await expect(
      acceptInvite(db, {
        token: inviteResult.token,
        displayName: "New User",
        password: "validPassword123!",
      }, metadata),
    ).rejects.toMatchObject({ code: "invite_already_used" });
  });

  it("rejects an expired invite", async () => {
    // Insert invite with past expiry using a real hashed token
    const token = createInviteToken();
    await db.insert(schema.invites).values({
      email: "expired@example.com",
      normalizedEmail: "expired@example.com",
      intendedRole: "admin",
      tokenHash: hashSessionToken(token),
      createdByUserId: creatorId,
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    await expect(
      acceptInvite(db, {
        token,
        displayName: "Expired User",
        password: "validPassword123!",
      }, metadata),
    ).rejects.toMatchObject({ code: "invalid_invite" });
  });

  it("rejects invite for already-registered email", async () => {
    await db.insert(schema.users).values({
      email: "new@example.com",
      normalizedEmail: "new@example.com",
      displayName: "Existing",
      passwordHash: "hash-existing",
      role: "user",
      locale: "en",
      isActive: true,
    });

    const inviteResult = await createInvite(db, {
      email: "new@example.com",
      role: "admin",
      createdByUserId: creatorId,
    }, metadata);

    await expect(
      acceptInvite(db, {
        token: inviteResult.token,
        displayName: "Duplicate",
        password: "validPassword123!",
      }, metadata),
    ).rejects.toMatchObject({ code: "email_already_registered" });
  });
});
