import { z } from "zod";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../../../../server/db/client";
import { loadConfig } from "../../../../../server/config";
import { authenticateRequest } from "../../../../../server/auth/authenticate";
import { requirePermission } from "../../../../../server/authorization/require";
import { assertCsrfSafe } from "../../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../../server/http/error-response";
import { getRequestMetadata } from "../../../../../server/http/request-metadata";
import { writeAuditEvent } from "../../../../../server/audit/audit-service";
import { revokeSessionsByUserId, createSession } from "../../../../../server/auth/session";
import { SESSION_COOKIE, sessionCookieOptions } from "../../../../../server/auth/cookies";
import * as schema from "../../../../../server/db/schema";
import { AppError } from "../../../../../server/errors";

const overrideSchema = z.array(z.object({ permission: z.string(), effect: z.enum(["allow", "deny"]) }));

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const config = loadConfig(process.env); const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const actor = await authenticateRequest(db, token); requirePermission(actor.permissions, "overrides.manage");
    const { id } = await context.params;
    const parsed = overrideSchema.safeParse(await request.json()); if (!parsed.success) return Response.json({ error: { code: "invalid_input" } }, { status: 422 });
    await db.transaction(async (tx) => {
      const [user] = await tx.select({ id: schema.users.id, role: schema.users.role }).from(schema.users).where(eq(schema.users.id, id)).for("update");
      if (!user) throw new AppError("not_found", 404);
      if (user.role === "super_admin") requirePermission(actor.permissions, "super_admins.manage");
      await tx.delete(schema.permissionOverrides).where(eq(schema.permissionOverrides.userId, id));
      if (parsed.data.length > 0) {
        await tx.insert(schema.permissionOverrides).values(parsed.data.map((item) => ({ userId: id, permission: item.permission, effect: item.effect, createdByUserId: actor.id })));
      }
      await writeAuditEvent(tx, { actorUserId: actor.id, targetType: "user", targetId: id, action: "user.role.update", ipAddress: getRequestMetadata(request).ip, userAgent: getRequestMetadata(request).userAgent, requestId: getRequestMetadata(request).requestId, detail: { overrides: parsed.data } });
    });
    await revokeSessionsByUserId(db, id);
    if (id === actor.id) {
      const session = await createSession(db, actor.id);
      const opts = sessionCookieOptions(config.nodeEnv);
      return Response.json({ data: { success: true } }, { headers: { "set-cookie": `${SESSION_COOKIE}=${session.token}; Path=${opts.path}; Max-Age=604800; HttpOnly; SameSite=${opts.sameSite}${opts.secure ? "; Secure" : ""}` } });
    }
    return Response.json({ data: { success: true } });
  } catch (error) { return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID()); } finally { await pool.end(); }
}
