import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { requirePermission } from "../../../server/authorization/require";
import { toErrorResponse } from "../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../server/auth/cookies";
import { getPgBoss } from "../../../server/daemon/pg-boss";
import {
  QUEUE_ANALYZE_ALERT,
  QUEUE_DISPATCH_NOTIFICATION,
  QUEUE_EXECUTE_ACTION,
  QUEUE_WEEKLY_REPORT,
} from "../../../server/daemon/queue";
import { PERMISSIONS } from "../../../server/authorization/permissions";

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, PERMISSIONS.queuesRead);

    const pgBoss = await getPgBoss(config);
    const queues = await pgBoss.getQueues([
      QUEUE_ANALYZE_ALERT,
      QUEUE_DISPATCH_NOTIFICATION,
      QUEUE_EXECUTE_ACTION,
      QUEUE_WEEKLY_REPORT,
    ]);

    const result = Object.fromEntries(queues.map((q) => [q.name, q]));

    return Response.json({ data: { queues: result } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
