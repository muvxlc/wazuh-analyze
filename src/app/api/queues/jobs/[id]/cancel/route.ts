import "server-only";

import { sql } from "drizzle-orm";
import { createDatabase } from "../../../../../../server/db/client";
import { loadConfig } from "../../../../../../server/config";
import { authenticateRequest } from "../../../../../../server/auth/authenticate";
import { SESSION_COOKIE } from "../../../../../../server/auth/cookies";
import { assertCsrfSafe } from "../../../../../../server/auth/csrf";
import { requirePermission } from "../../../../../../server/authorization/require";
import { toErrorResponse } from "../../../../../../server/http/error-response";
import { getPgBoss } from "../../../../../../server/daemon/pg-boss";
import { PERMISSIONS } from "../../../../../../server/authorization/permissions";
import { AppError } from "../../../../../../server/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { id } = await context.params;
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, PERMISSIONS.queuesManage);

    const result = await db.execute(sql`SELECT name FROM boss.job WHERE id = ${id}`);
    const rows = (result && typeof result === "object" && "rows" in result ? result.rows : result) as Array<{ name: string }>;
    const row = rows[0];
    if (!row) throw new AppError("queue_job_not_found", 404);

    const pgBoss = await getPgBoss(config);
    await pgBoss.cancel(row.name, id);

    return Response.json({ data: { cancelled: id } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
