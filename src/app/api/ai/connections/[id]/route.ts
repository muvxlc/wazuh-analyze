import "server-only";

import { z } from "zod";
import { createDatabase } from "../../../../../server/db/client";
import { loadConfig } from "../../../../../server/config";
import { authenticateRequest } from "../../../../../server/auth/authenticate";
import { SESSION_COOKIE } from "../../../../../server/auth/cookies";
import { assertCsrfSafe } from "../../../../../server/auth/csrf";
import { requirePermission } from "../../../../../server/authorization/require";
import { toErrorResponse } from "../../../../../server/http/error-response";
import { getRequestMetadata } from "../../../../../server/http/request-metadata";
import { deleteAiConnection, updateAiConnection } from "../../../../../server/ai/connections";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    provider: z.enum(["lm_studio", "openai_compatible"]).optional(),
    baseUrl: z.string().url().max(500).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    apiKey: z.string().max(1_000).nullable().optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

function token(request: Request): string | null {
  return request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { id } = await context.params;
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(db, token(request));
    requirePermission(user.permissions, "settings.manage");
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "invalid_input", requestId } }, { status: 422 });
    const connection = await updateAiConnection(
      db,
      id,
      parsed.data,
      user.id,
      getRequestMetadata(request),
      config.settingsEncryptionKey,
    );
    return Response.json({ data: connection, requestId }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { id } = await context.params;
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(db, token(request));
    requirePermission(user.permissions, "settings.manage");
    await deleteAiConnection(db, id, user.id, getRequestMetadata(request));
    return Response.json({ data: { deleted: id }, requestId }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
