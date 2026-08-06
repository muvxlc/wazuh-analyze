import { eq } from "drizzle-orm";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { requirePermission } from "../../../../server/authorization/require";
import { toErrorResponse } from "../../../../server/http/error-response";
import * as schema from "../../../../server/db/schema";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { AppError } from "../../../../server/errors";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const config = loadConfig(process.env); const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const actor = await authenticateRequest(db, token); requirePermission(actor.permissions, "users.read");
    const { id } = await context.params;
    const [user] = await db.select({ id: schema.users.id, email: schema.users.email, displayName: schema.users.displayName, role: schema.users.role, locale: schema.users.locale, isActive: schema.users.isActive, createdAt: schema.users.createdAt, updatedAt: schema.users.updatedAt }).from(schema.users).where(eq(schema.users.id, id));
    if (!user) throw new AppError("not_found", 404);
    const overrides = await db.select({ id: schema.permissionOverrides.id, permission: schema.permissionOverrides.permission, effect: schema.permissionOverrides.effect }).from(schema.permissionOverrides).where(eq(schema.permissionOverrides.userId, id));
    return Response.json({ data: { ...user, overrides } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID()); } finally { await pool.end(); }
}
