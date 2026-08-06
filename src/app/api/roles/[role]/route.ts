import { z } from "zod";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { requirePermission } from "../../../../server/authorization/require";
import { assertCsrfSafe } from "../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { getRequestMetadata } from "../../../../server/http/request-metadata";
import {
  updateRolePermissions,
} from "../../../../server/role-permissions/service";
import { revokeSessionsByRoleId } from "../../../../server/auth/session";
import { PERMISSIONS } from "../../../../server/authorization/permissions";

const KNOWN_PERMISSIONS = Object.values(PERMISSIONS) as [string, ...string[]];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ role: string }> },
): Promise<Response> {
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

    const { role } = await context.params;

    // Zod validates role enum at runtime
    const parsed = z
      .object({
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

    // Validate role is a known role (not super_admin for safety)
    if (!["admin", "user"].includes(role)) {
      return Response.json({ error: { code: "invalid_role", requestId } }, { status: 400 });
    }

    const metadata = getRequestMetadata(request);
    await updateRolePermissions(db, user.id, { role: role as "admin" | "user", overrides: parsed.data.overrides }, user.permissions.has("roles.manage"), metadata);

    // Invalidate sessions for all users with the affected role
    await revokeSessionsByRoleId(db, role);

    return Response.json({ data: { success: true } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
