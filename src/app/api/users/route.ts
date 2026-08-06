import { z } from "zod";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { requirePermission } from "../../../server/authorization/require";
import { assertCsrfSafe } from "../../../server/auth/csrf";
import { toErrorResponse } from "../../../server/http/error-response";
import * as schema from "../../../server/db/schema";
import { SESSION_COOKIE } from "../../../server/auth/cookies";
import { currentUser } from "../../../server/auth/current-user";

export async function GET(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(db, request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null);
    requirePermission(user.permissions, "users.read");
    const users = await db.select({ id: schema.users.id, email: schema.users.email, displayName: schema.users.displayName, role: schema.users.role, locale: schema.users.locale, isActive: schema.users.isActive, createdAt: schema.users.createdAt, updatedAt: schema.users.updatedAt }).from(schema.users);
    return Response.json({ data: { users } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally { await pool.end(); }
}
