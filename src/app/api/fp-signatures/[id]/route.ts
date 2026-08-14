import { z } from "zod";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { assertCsrfSafe } from "../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { resolveEffectiveConfig } from "../../../../server/settings/service";
import { deleteFpSignature, renewFpSignature } from "../../../../server/fp/service";

const renewSchema = z.object({
  ttlDays: z.number().int().positive().max(90).optional(),
});

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(
      db,
      request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null,
    );
    const { id } = await context.params;
    await deleteFpSignature(
      db,
      { userId: user.id, role: user.role, permissions: new Set(user.permissions) },
      id,
      {
        requestId,
        ip: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
      },
    );

    return Response.json({ data: { id } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(
      db,
      request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null,
    );
    const { id } = await context.params;
    const body = renewSchema.parse(await request.json());
    const eff = await resolveEffectiveConfig(db, config);
    const signature = await renewFpSignature(
      db,
      { userId: user.id, role: user.role, permissions: new Set(user.permissions) },
      id,
      body.ttlDays ?? eff.fpMemoryTtlDays,
      {
        requestId,
        ip: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
      },
    );

    return Response.json({ data: signature }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
