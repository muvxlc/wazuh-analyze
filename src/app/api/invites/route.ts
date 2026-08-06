import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { requirePermission } from "../../../server/authorization/require";
import { assertCsrfSafe } from "../../../server/auth/csrf";
import { toErrorResponse } from "../../../server/http/error-response";
import { createInvite } from "../../../server/users/invite-service";
import { getRequestMetadata } from "../../../server/http/request-metadata";
import * as schema from "../../../server/db/schema";
import { SESSION_COOKIE } from "../../../server/auth/cookies";

const inviteSchema = z.object({ email: z.string().email(), role: z.enum(["admin", "user"]).default("user") });
function token(request: Request) { return request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null; }

export async function GET(request: Request): Promise<Response> {
  const config = loadConfig(process.env); const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(db, token(request)); requirePermission(user.permissions, "invites.manage");
    const invites = await db.select({ id: schema.invites.id, email: schema.invites.email, intendedRole: schema.invites.intendedRole, expiresAt: schema.invites.expiresAt, createdAt: schema.invites.createdAt, acceptedAt: schema.invites.acceptedAt, revokedAt: schema.invites.revokedAt }).from(schema.invites);
    return Response.json({ data: { invites } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID()); } finally { await pool.end(); }
}

export async function POST(request: Request): Promise<Response> {
  const config = loadConfig(process.env); const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(db, token(request)); requirePermission(user.permissions, "invites.manage");
    const parsed = inviteSchema.safeParse(await request.json()); if (!parsed.success) return Response.json({ error: { code: "invalid_input" } }, { status: 422 });
    const created = await createInvite(db, { ...parsed.data, createdByUserId: user.id }, getRequestMetadata(request));
    return Response.json({ data: { inviteId: created.inviteId, expiresAt: created.expiresAt, url: new URL(`/invite/${created.token}`, config.appUrl).toString() } }, { status: 201 });
  } catch (error) { return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID()); } finally { await pool.end(); }
}
