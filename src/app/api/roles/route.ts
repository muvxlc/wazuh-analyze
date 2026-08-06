import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { requirePermission } from "../../../server/authorization/require";
import { toErrorResponse } from "../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../server/auth/cookies";
import { ROLE_DEFAULTS } from "../../../server/authorization/role-defaults";

export async function GET(request: Request): Promise<Response> {
  const config = loadConfig(process.env); const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token); requirePermission(user.permissions, "roles.read");
    const roles = Object.entries(ROLE_DEFAULTS).map(([role, defaults]) => ({ role, permissions: defaults }));
    return Response.json({ data: { roles } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID()); } finally { await pool.end(); }
}
