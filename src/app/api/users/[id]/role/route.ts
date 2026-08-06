import { z } from "zod";
import { createDatabase } from "../../../../../server/db/client";
import { loadConfig } from "../../../../../server/config";
import { authenticateRequest } from "../../../../../server/auth/authenticate";
import { assertCsrfSafe } from "../../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../../server/http/error-response";
import { updateUserAccess } from "../../../../../server/users/administration-policy";
import { getRequestMetadata } from "../../../../../server/http/request-metadata";
import { revokeSessionsByUserId, createSession } from "../../../../../server/auth/session";
import { SESSION_COOKIE, sessionCookieOptions } from "../../../../../server/auth/cookies";

const roleSchema = z.object({ role: z.enum(["super_admin", "admin", "user"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const config = loadConfig(process.env); const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const actor = await authenticateRequest(db, token);
    const { id } = await context.params;
    const parsed = roleSchema.safeParse(await request.json()); if (!parsed.success) return Response.json({ error: { code: "invalid_input" } }, { status: 422 });
    const updated = await updateUserAccess(db, { userId: actor.id, role: actor.role, permissions: new Set(actor.permissions) }, { userId: id, role: parsed.data.role }, getRequestMetadata(request));
    await revokeSessionsByUserId(db, id);
    const isSelfDemotion = id === actor.id && actor.role === "super_admin" && parsed.data.role !== "super_admin";
    if (id === actor.id && !isSelfDemotion) {
      const session = await createSession(db, actor.id);
      const opts = sessionCookieOptions(config.nodeEnv);
      return Response.json({ data: { user: updated } }, { headers: { "set-cookie": `${SESSION_COOKIE}=${session.token}; Path=${opts.path}; Max-Age=604800; HttpOnly; SameSite=${opts.sameSite}${opts.secure ? "; Secure" : ""}` } });
    }
    if (isSelfDemotion) {
      const opts = sessionCookieOptions(config.nodeEnv);
      return Response.json({ data: { user: updated } }, { headers: { "set-cookie": `${SESSION_COOKIE}=; Path=${opts.path}; Max-Age=0; HttpOnly; SameSite=${opts.sameSite}${opts.secure ? "; Secure" : ""}` } });
    }
    return Response.json({ data: { user: updated } });
  } catch (error) { return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID()); } finally { await pool.end(); }
}
