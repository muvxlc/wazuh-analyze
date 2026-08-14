import "server-only";

import { z } from "zod";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { assertCsrfSafe } from "../../../../server/auth/csrf";
import { requirePermission } from "../../../../server/authorization/require";
import { toErrorResponse } from "../../../../server/http/error-response";
import { getRequestMetadata } from "../../../../server/http/request-metadata";
import { createAiConnection, listAiConnections } from "../../../../server/ai/connections";

const connectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  provider: z.enum(["lm_studio", "openai_compatible"]),
  baseUrl: z.string().url().max(500),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().max(1_000).nullable().optional(),
  timeoutMs: z.number().int().positive().max(600_000).default(120_000),
  isDefault: z.boolean().default(false),
});

function token(request: Request): string | null {
  return request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
}

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(db, token(request));
    requirePermission(user.permissions, "settings.manage");
    return Response.json({ data: await listAiConnections(db) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(db, token(request));
    requirePermission(user.permissions, "settings.manage");
    const parsed = connectionSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "invalid_input", requestId } }, { status: 422 });
    const connection = await createAiConnection(
      db,
      { ...parsed.data, apiKey: parsed.data.apiKey ?? null },
      user.id,
      getRequestMetadata(request),
      config.settingsEncryptionKey,
    );
    return Response.json({ data: connection, requestId }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
