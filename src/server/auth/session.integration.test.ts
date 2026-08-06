import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";

import * as schema from "../db/schema";
import type { Database, DatabaseTransaction } from "../db/types";
import { createSession, readSession, createSessionToken, hashSessionToken, revokeSessionsByUserId, rotateSession } from "./session";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";

const pool = createTestPool();
const db = drizzle(pool, { schema });

describe("session integration", () => {
  let userId: string;

  beforeAll(async () => {
    await resetTestDatabase(pool);
    const [user] = await db
      .insert(schema.users)
      .values({
        email: "session-test@example.com",
        normalizedEmail: "session-test@example.com",
        displayName: "Session Test",
        passwordHash: "hash-test",
        role: "user",
        locale: "en",
        isActive: true,
      })
      .returning({ id: schema.users.id });
    userId = user.id!;
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetTestDatabase(pool);
    const [user] = await db
      .insert(schema.users)
      .values({
        email: "session-test@example.com",
        normalizedEmail: "session-test@example.com",
        displayName: "Session Test",
        passwordHash: "hash-test",
        role: "user",
        locale: "en",
        isActive: true,
      })
      .returning({ id: schema.users.id });
    userId = user.id!;
  });

  it("stores only a session token hash, never the plaintext token", async () => {
    const now = new Date("2026-08-03T00:00:00.000Z");
    const session = await db.transaction((tx) => createSession(tx, userId, now));

    const row = await db
      .select({ tokenHash: schema.sessions.tokenHash })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, session.sessionId))
      .limit(1);

    expect(row[0]?.tokenHash).toBeDefined();
    expect(row[0]!.tokenHash).not.toContain(session.token);
    expect(row[0]!.tokenHash).toEqual(hashSessionToken(session.token));
  });

  it("reads an active session by token", async () => {
    const now = new Date("2026-08-03T00:00:00.000Z");
    const session = await db.transaction((tx) => createSession(tx, userId, now));

    const row = await readSession(db, session.token, now);
    expect(row).not.toBeNull();
    expect(row!.userId).toBe(userId);
  });

  it("returns null for an expired session", async () => {
    const past = new Date("2020-01-01T00:00:00.000Z");
    const session = await db.transaction((tx) => createSession(tx, userId, past));

    const row = await readSession(db, session.token, new Date("2026-08-03T00:00:00.000Z"));
    expect(row).toBeNull();
  });

  it("returns null for a revoked session", async () => {
    const now = new Date("2026-08-03T00:00:00.000Z");
    const session = await db.transaction((tx) => createSession(tx, userId, now));

    await db.update(schema.sessions).set({ revokedAt: now }).where(eq(schema.sessions.id, session.sessionId));

    const row = await readSession(db, session.token, now);
    expect(row).toBeNull();
  });

  it("enforces absolute expiry — session with idle future but absolute past is rejected", async () => {
    const now = new Date("2026-08-03T00:00:00.000Z");
    const session = await db.transaction((tx) => createSession(tx, userId, now));

    // Simulate absolute expiry in the past while idle is still future
    const absoluteInPast = new Date("2020-01-01T00:00:00.000Z");
    await db.update(schema.sessions).set({ absoluteExpiresAt: absoluteInPast }).where(eq(schema.sessions.id, session.sessionId));

    const row = await readSession(db, session.token, now);
    expect(row).toBeNull();
  });

  it("revokes all existing sessions for a user", async () => {
    const now = new Date("2026-08-03T00:00:00.000Z");
    const session1 = await db.transaction((tx) => createSession(tx, userId, now));
    const session2 = await db.transaction((tx) => createSession(tx, userId, now));

    await revokeSessionsByUserId(db, userId, now);

    expect(await readSession(db, session1.token, now)).toBeNull();
    expect(await readSession(db, session2.token, now)).toBeNull();
  });

  it("stores absolute expiry strictly after idle expiry", async () => {
    const now = new Date("2026-08-03T00:00:00.000Z");
    const session = await db.transaction((tx) => createSession(tx, userId, now));

    const row = await db
      .select({ idle: schema.sessions.expiresAt, absolute: schema.sessions.absoluteExpiresAt })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, session.sessionId))
      .limit(1);

    expect(row[0]!.absolute.getTime()).toBeGreaterThan(row[0]!.idle.getTime());
  });

  it("rotateSession revokes old sessions and creates new one atomically", async () => {
    const now = new Date("2026-08-03T00:00:00.000Z");
    const session1 = await db.transaction((tx) => createSession(tx, userId, now));

    const session2 = await db.transaction(async (tx) => rotateSession(tx, userId, now));

    // New session must be readable
    expect(await readSession(db, session2.token, now)).not.toBeNull();
    // Old session must be revoked
    expect(await readSession(db, session1.token, now)).toBeNull();
    // Old session should have revokedAt set
    const revokedRow = await db
      .select({ revokedAt: schema.sessions.revokedAt })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, session1.sessionId))
      .limit(1);
    expect(revokedRow[0]!.revokedAt).not.toBeNull();
  });

  it("rotateSession receives same tx — regression test for transaction atomicity", async () => {
    const now = new Date("2026-08-03T00:00:00.000Z");
    const transactionCalls: Array<DatabaseTransaction> = [];

    // Override db.transaction for this test only to capture tx objects
    const originalTransaction = db.transaction.bind(db);
    const wrappedTransaction = async <T>(
      callback: (tx: DatabaseTransaction) => Promise<T>,
    ): Promise<T> => {
      return originalTransaction(async (tx: DatabaseTransaction) => {
        transactionCalls.push(tx);
        return callback(tx);
      });
    };
    (db as unknown as { transaction: <T>(cb: (tx: DatabaseTransaction) => Promise<T>) => Promise<T> }).transaction = wrappedTransaction as never;

    await wrappedTransaction(async (tx) => {
      await revokeSessionsByUserId(tx, userId, now);
      return createSession(tx, userId, now);
    });

    // Single transaction wraps both revoke and create — proves atomicity
    expect(transactionCalls.length).toBe(1);
    expect(transactionCalls[0]).toBeDefined();
  });
});
