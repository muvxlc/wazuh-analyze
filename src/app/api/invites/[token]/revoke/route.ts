import { eq } from "drizzle-orm";
import { createDatabase } from "../../../../../server/db/client";
import { loadConfig } from "../../../../../server/config";
import { authenticateRequest } from "../../../../../server/auth/authenticate";
import { requirePermission } from "../../../../../server/authorization/require";
import { assertCsrfSafe } from "../../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../../server/http/error-response";
import * as schema from "../../../../../server/db/schema";
import { SESSION_COOKIE } from "../../../../../server/auth/cookies";
import { writeAuditEvent } from "../../../../../server/audit/audit-service";
import { getRequestMetadata } from "../../../../../server/http/request-metadata";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const config = loadConfig(process.env); const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const sessionToken = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, sessionToken); requirePermission(user.permissions, "invites.manage");
    const { token } = await context.params;
    await db.update(schema.invites).set({ revokedAt: new Date() }).where(eq(schema.invites.id, token));
    await writeAuditEvent(db, { actorUserId: user.id, targetType: "invite", targetId: token, action: "user.status.update", ipAddress: getRequestMetadata(request).ip, userAgent: getRequestMetadata(request).userAgent, requestId: getRequestMetadata(request).requestId, detail: { revoked: true } });
    return new Response(null, { status: 204 });
  } catch (error) { return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID()); } finally { await pool.end(); }
}
