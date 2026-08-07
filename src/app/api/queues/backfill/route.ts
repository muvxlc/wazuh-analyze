import { z } from "zod";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { requirePermission } from "../../../../server/authorization/require";
import { toErrorResponse } from "../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { enqueuePendingAlerts } from "../../../../server/daemon/backfill";
import { PERMISSIONS } from "../../../../server/authorization/permissions";

const bodySchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
});

export async function POST(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, PERMISSIONS.queuesManage);

    const raw = await request.json().catch(() => ({}));
    const input = bodySchema.parse(raw);

    const enqueued = await enqueuePendingAlerts(db, input.limit);

    return Response.json({ data: { enqueued } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
