import { z } from "zod";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { assertCsrfSafe } from "../../../../server/auth/csrf";
import { getIncidentDetail } from "../../../../server/incidents/query";
import { setIncidentAssignee } from "../../../../server/incidents/workflow";
import { toErrorResponse } from "../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";

const patchSchema = z.object({
  assigneeUserId: z.union([z.string().uuid(), z.null()]),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(
      db,
      request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null,
    );
    const { id } = await context.params;
    return Response.json(
      {
        data: await getIncidentDetail(
          db,
          { userId: user.id, role: user.role, permissions: new Set(user.permissions) },
          id,
        ),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}

export async function PATCH(
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
    const { assigneeUserId } = patchSchema.parse(await request.json());
    const data = await setIncidentAssignee(
      db,
      { userId: user.id, role: user.role, permissions: new Set(user.permissions) },
      id,
      assigneeUserId,
      {
        requestId,
        ip: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
      },
    );
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
