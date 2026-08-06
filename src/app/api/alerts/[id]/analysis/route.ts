import { z } from "zod";
import { createDatabase } from "../../../../../server/db/client";
import { loadConfig } from "../../../../../server/config";
import { authenticateRequest } from "../../../../../server/auth/authenticate";
import { runAlertAnalysis, listAlertAnalyses } from "../../../../../server/ai/analyze-service";
import { assertCsrfSafe } from "../../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../../server/auth/cookies";

const bodySchema = z.object({
  connectionId: z.string().uuid().optional(),
  enrich: z.boolean().optional(),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(db, request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null);
    const { id } = await context.params;
    const actor = { userId: user.id, role: user.role, permissions: new Set(user.permissions) };
    const data = await listAlertAnalyses(db, actor, id);
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(db, request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null);
    const { id } = await context.params;
    const body = request.body ? bodySchema.parse(await request.json().catch(() => ({}))) : {};
    const actor = { userId: user.id, role: user.role, permissions: new Set(user.permissions) };
    const metadata = { requestId, ip: request.headers.get("x-forwarded-for"), userAgent: request.headers.get("user-agent") };
    const data = await runAlertAnalysis(db, actor, id, body, metadata, config.settingsEncryptionKey);
    return Response.json({ data }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
