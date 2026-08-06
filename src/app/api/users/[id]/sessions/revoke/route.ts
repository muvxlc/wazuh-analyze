import { eq } from "drizzle-orm";
import { createDatabase } from "../../../../../../server/db/client";
import { loadConfig } from "../../../../../../server/config";
import { authenticateRequest } from "../../../../../../server/auth/authenticate";
import { requirePermission } from "../../../../../../server/authorization/require";
import { assertCsrfSafe } from "../../../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../../../server/http/error-response";
import { revokeSessionsByUserId } from "../../../../../../server/auth/session";
import { getRequestMetadata } from "../../../../../../server/http/request-metadata";
import { writeAuditEvent } from "../../../../../../server/audit/audit-service";
import { SESSION_COOKIE } from "../../../../../../server/auth/cookies";
import * as schema from "../../../../../../server/db/schema";
import { AppError } from "../../../../../../server/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const config = loadConfig(process.env); const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const actor = await authenticateRequest(db, token); requirePermission(actor.permissions, "sessions.revoke");
    const { id } = await context.params;
    await db.transaction(async (tx) => {
      const [user] = await tx.select({ id: schema.users.id, role: schema.users.role }).from(schema.users).where(eq(schema.users.id, id));
      if (!user) throw new AppError("not_found", 404);
      if (user.role === "super_admin") requirePermission(actor.permissions, "super_admins.manage");
      await revokeSessionsByUserId(tx, id);
      await writeAuditEvent(tx, { actorUserId: actor.id, targetType: "user", targetId: id, action: "user.status.update", ipAddress: getRequestMetadata(request).ip, userAgent: getRequestMetadata(request).userAgent, requestId: getRequestMetadata(request).requestId, detail: { revokedSessions: true } });
    });
    const headers = id === actor.id ? { "set-cookie": `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${config.nodeEnv === "development" ? "" : "; Secure"}` } : undefined;
    return new Response(null, { status: 204, headers });
  } catch (error) { return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID()); } finally { await pool.end(); }
}
