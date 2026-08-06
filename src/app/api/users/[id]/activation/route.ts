import { z } from "zod";
import { createDatabase } from "../../../../../server/db/client";
import { loadConfig } from "../../../../../server/config";
import { authenticateRequest } from "../../../../../server/auth/authenticate";
import { assertCsrfSafe } from "../../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../../server/http/error-response";
import { updateUserAccess } from "../../../../../server/users/administration-policy";
import { getRequestMetadata } from "../../../../../server/http/request-metadata";
import { revokeSessionsByUserId } from "../../../../../server/auth/session";
import { SESSION_COOKIE } from "../../../../../server/auth/cookies";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const config = loadConfig(process.env); const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const actor = await authenticateRequest(db, token); const { id } = await context.params;
    const parsed = z.object({ isActive: z.boolean() }).safeParse(await request.json()); if (!parsed.success) return Response.json({ error: { code: "invalid_input" } }, { status: 422 });
    const updated = await updateUserAccess(db, { userId: actor.id, role: actor.role, permissions: new Set(actor.permissions) }, { userId: id, isActive: parsed.data.isActive }, getRequestMetadata(request));
    await revokeSessionsByUserId(db, id);
    const headers = id === actor.id && !parsed.data.isActive ? { "set-cookie": `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${config.nodeEnv === "development" ? "" : "; Secure"}` } : undefined;
    return Response.json({ data: { user: updated } }, headers ? { headers } : undefined);
  } catch (error) { return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID()); } finally { await pool.end(); }
}
