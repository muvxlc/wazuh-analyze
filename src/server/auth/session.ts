import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

import * as schema from "../db/schema";
import type { Database, DatabaseTransaction } from "../db/types";

const IDLE_MS = 12 * 60 * 60 * 1000;
const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiry(now: Date): { idle: Date; absolute: Date } {
  return { idle: new Date(now.getTime() + IDLE_MS), absolute: new Date(now.getTime() + ABSOLUTE_MS) };
}

export async function createSession(
  db: Database | DatabaseTransaction,
  userId: string,
  now = new Date(),
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = createSessionToken();
  const { idle, absolute } = sessionExpiry(now);
  const [row] = await db.insert(schema.sessions).values({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt: idle,
    absoluteExpiresAt: absolute,
    lastUsedAt: now,
  }).returning({ id: schema.sessions.id, expiresAt: schema.sessions.expiresAt });
  return { token, sessionId: row.id, expiresAt: row.expiresAt };
}

export async function revokeSession(db: Database | DatabaseTransaction, token: string, now = new Date()): Promise<void> {
  await db.update(schema.sessions).set({ revokedAt: now }).where(and(
    eq(schema.sessions.tokenHash, hashSessionToken(token)),
    isNull(schema.sessions.revokedAt),
  ));
}

export async function revokeSessionsByUserId(db: Database | DatabaseTransaction, userId: string, now = new Date()): Promise<void> {
  await db.update(schema.sessions).set({ revokedAt: now }).where(and(
    eq(schema.sessions.userId, userId),
    isNull(schema.sessions.revokedAt),
  ));
}

export async function revokeSessionsByRoleId(db: Database | DatabaseTransaction, role: string, now = new Date()): Promise<void> {
  await db.execute(sql`
    UPDATE ${schema.sessions}
    SET revoked_at = ${now}
    WHERE ${schema.sessions.userId} IN (
      SELECT ${schema.users.id} FROM ${schema.users} WHERE ${schema.users.role} = ${role}
    )
    AND ${schema.sessions.revokedAt} IS NULL
  `);
}

export async function rotateSession(
  db: Database | DatabaseTransaction,
  userId: string,
  now = new Date(),
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  await revokeSessionsByUserId(db, userId, now);
  return createSession(db, userId, now);
}

export async function readSession(db: Database | DatabaseTransaction, token: string, now = new Date()) {
  const [row] = await db.select().from(schema.sessions).where(and(
    eq(schema.sessions.tokenHash, hashSessionToken(token)),
    isNull(schema.sessions.revokedAt),
    gt(schema.sessions.expiresAt, now),
    gt(schema.sessions.absoluteExpiresAt, now),
  )).limit(1);
  return row ?? null;
}
