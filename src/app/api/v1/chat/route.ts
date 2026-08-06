import "server-only";

import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { requirePermission } from "../../../../server/authorization/require";
import { assertCsrfSafe } from "../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { createDatabase } from "../../../../server/db/client";
import { z } from "zod";
import { createChatProvider, listAiConnections, resolveAiConnection } from "../../../../server/ai/connections";

const requestSchema = z.object({
  system_prompt: z.string().min(1).max(8_000),
  input: z.string().min(1).max(32_000),
  connection_id: z.string().uuid().nullable().optional(),
});

export async function POST(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, "chat.use");

    const parsed = requestSchema.parse(await request.json());

    const resolved = await resolveAiConnection(db, parsed.connection_id ?? null, config.settingsEncryptionKey);
    const provider = createChatProvider({
      provider: resolved.provider,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
      apiKey: resolved.apiKey,
      timeoutMs: resolved.timeoutMs,
    });
    const content = await provider.chat(parsed.system_prompt, parsed.input);
    return Response.json({ data: { content }, requestId }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, "chat.use");
    const connections = await listAiConnections(db);
    return Response.json({ data: connections }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
