import { z } from "zod";
import { createDatabase } from "../../../../../server/db/client";
import { loadConfig } from "../../../../../server/config";
import { authenticateRequest } from "../../../../../server/auth/authenticate";
import { transitionAlert } from "../../../../../server/alerts/workflow";
import { assertCsrfSafe } from "../../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../../server/auth/cookies";

const bodySchema = z.object({ to: z.enum(["acknowledged", "resolved"]) });
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env); const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(db, request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null);
    const { id } = await context.params;
    const body = bodySchema.parse(await request.json());
    const data = await transitionAlert(db, { userId: user.id, role: user.role, permissions: new Set(user.permissions) }, { alertId: id, to: body.to }, { requestId, ip: request.headers.get("x-forwarded-for"), userAgent: request.headers.get("user-agent") });
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return toErrorResponse(error, requestId); } finally { await pool.end(); }
}
