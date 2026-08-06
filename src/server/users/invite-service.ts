import "server-only";

import { and, eq, isNull, gt } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { AppError } from "../errors";
import { writeAuditEvent } from "../audit/audit-service";
import type { RequestMetadata } from "../http/request-metadata";
import { hashPassword } from "../auth/password";
import { hashSessionToken, createSession } from "../auth/session";
import type { Role } from "../authorization/permissions";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function acceptInvite(
  db: Database,
  input: { token: string; displayName: string; password: string },
  metadata: RequestMetadata,
  now = new Date(),
): Promise<{ userId: string; session: Awaited<ReturnType<typeof createSession>> }> {
  return db.transaction(async (tx) => {
    const [invite] = await tx.select().from(schema.invites).where(and(
      eq(schema.invites.tokenHash, hashSessionToken(input.token)),
      isNull(schema.invites.acceptedAt),
      isNull(schema.invites.revokedAt),
      gt(schema.invites.expiresAt, now),
    )).limit(1).for("update");
    if (!invite) {
      const [used] = await tx.select({ acceptedAt: schema.invites.acceptedAt }).from(schema.invites).where(eq(schema.invites.tokenHash, hashSessionToken(input.token))).limit(1);
      if (used?.acceptedAt !== null) {
        throw new AppError("invite_already_used", 400);
      }
      throw new AppError("invalid_invite", 400);
    }
    const normalizedEmail = invite.normalizedEmail;
    const existing = await tx.select({ id: schema.users.id }).from(schema.users)
      .where(eq(schema.users.normalizedEmail, normalizedEmail)).limit(1);
    if (existing.length > 0) throw new AppError("email_already_registered", 409);

    const passwordHash = await hashPassword(input.password);
    const [user] = await tx.insert(schema.users).values({
      email: normalizedEmail, normalizedEmail, displayName: input.displayName,
      passwordHash, role: invite.intendedRole, locale: "en", isActive: true,
    }).returning({ id: schema.users.id });
    const session = await createSession(tx, user.id, now);
    await tx.update(schema.invites).set({ acceptedAt: now, acceptedByUserId: user.id }).where(eq(schema.invites.id, invite.id));
    await writeAuditEvent(tx, {
      actorUserId: user.id, targetType: "invite", targetId: invite.id,
      action: "invite.accept", ipAddress: metadata.ip, userAgent: metadata.userAgent,
      requestId: metadata.requestId, detail: {},
    });
    return { userId: user.id, session };
  });
}

export async function createInvite(
  db: Database,
  input: { email: string; role: Role; createdByUserId: string },
  metadata: RequestMetadata,
  now = new Date(),
): Promise<{ token: string; inviteId: string; expiresAt: Date }> {
  const token = createInviteToken();
  const normalizedEmail = normalizeEmail(input.email);
  const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  const [invite] = await db.insert(schema.invites).values({
    email: input.email.trim(), normalizedEmail, intendedRole: input.role,
    tokenHash: hashSessionToken(token), createdByUserId: input.createdByUserId, expiresAt,
  }).returning({ id: schema.invites.id });
  await writeAuditEvent(db, {
    actorUserId: input.createdByUserId, targetType: "invite", targetId: invite.id,
    action: "user.create", ipAddress: metadata.ip, userAgent: metadata.userAgent,
    requestId: metadata.requestId, detail: { role: input.role },
  });
  return { token, inviteId: invite.id, expiresAt };
}
