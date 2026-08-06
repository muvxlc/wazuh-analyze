import { z } from "zod";
import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { requirePermission } from "../../../server/authorization/require";
import { assertCsrfSafe } from "../../../server/auth/csrf";
import { toErrorResponse } from "../../../server/http/error-response";
import { ROLE_DEFAULTS } from "../../../server/authorization/role-defaults";
import { SESSION_COOKIE } from "../../../server/auth/cookies";
import { getRequestMetadata } from "../../../server/http/request-metadata";
import {
  fetchAllRoleOverrides,
  updateRolePermissions,
} from "../../../server/role-permissions/service";
import { revokeSessionsByRoleId } from "../../../server/auth/session";
import { PERMISSIONS } from "../../../server/authorization/permissions";

const KNOWN_PERMISSIONS = Object.values(PERMISSIONS) as [string, ...string[]];

export async function GET(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token =
      request.headers
        .get("cookie")
        ?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, "roles.read");
    const roleOverrides = await fetchAllRoleOverrides(db);
    const roles = Object.entries(ROLE_DEFAULTS).map(([role, defaults]) => ({
      role,
      defaults: [...defaults],
      overrides: roleOverrides.get(role as keyof typeof ROLE_DEFAULTS) ?? [],
      isEditable: role !== "super_admin",
    }));
    return Response.json({ data: { roles } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const token =
      request.headers
        .get("cookie")
        ?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, "roles.manage");

    const parsed = z
      .object({
        role: z.enum(["admin", "user"]),
        overrides: z.array(
          z.object({
            permission: z.enum(KNOWN_PERMISSIONS),
            effect: z.enum(["allow", "deny"]),
          }),
        ),
      })
      .safeParse(await request.json());

    if (!parsed.success) {
      return Response.json({ error: { code: "invalid_input", requestId } }, { status: 422 });
    }

    const metadata = getRequestMetadata(request);
    await updateRolePermissions(db, user.id, parsed.data, user.permissions.has("roles.manage"), metadata);

    // Invalidate sessions for all users with the affected role
    await revokeSessionsByRoleId(db, parsed.data.role);

    return Response.json({ data: { success: true } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
