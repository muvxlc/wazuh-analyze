import "server-only";

import { sql } from "drizzle-orm";
import { createDatabase } from "../../../../../server/db/client";
import { loadConfig } from "../../../../../server/config";
import { authenticateRequest } from "../../../../../server/auth/authenticate";
import { assertCsrfSafe } from "../../../../../server/auth/csrf";
import { requirePermission } from "../../../../../server/authorization/require";
import { toErrorResponse } from "../../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../../server/auth/cookies";
import { getPgBoss } from "../../../../../server/daemon/pg-boss";
import { PERMISSIONS } from "../../../../../server/authorization/permissions";
import {
  QUEUE_ANALYZE_ALERT,
  QUEUE_ANALYZE_VULNERABILITY,
  QUEUE_DISPATCH_NOTIFICATION,
  QUEUE_EXECUTE_ACTION,
  QUEUE_WEEKLY_REPORT,
} from "../../../../../server/daemon/queue";

const QUEUE_NAMES = [
  QUEUE_ANALYZE_ALERT,
  QUEUE_ANALYZE_VULNERABILITY,
  QUEUE_DISPATCH_NOTIFICATION,
  QUEUE_EXECUTE_ACTION,
  QUEUE_WEEKLY_REPORT,
] as const;

const MAX = 500;

// Retries (or resumes, for cancelled) every failed/expired/cancelled job, optionally scoped to one queue.
export async function POST(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(
      db,
      request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null,
    );
    requirePermission(user.permissions, PERMISSIONS.queuesManage);

    const { searchParams } = new URL(request.url);
    const queueParam = searchParams.get("queue");
    const queueFilter = queueParam && QUEUE_NAMES.includes(queueParam as any) ? queueParam : null;

    // ponytail: scope to a single queue when requested to avoid cross-queue blast radius.
    const nameClause = queueFilter
      ? sql`name = ${queueFilter}`
      : sql`name IN (${sql.join(QUEUE_NAMES.map((n) => sql`${n}`), sql`, `)})`;

    const result = await db.execute(sql`
      SELECT id, name, state::text AS state
      FROM boss.job
      WHERE ${nameClause}
        AND state IN ('failed', 'expired', 'cancelled')
      ORDER BY created_on DESC
      LIMIT ${MAX}
    `);
    const rows = (result && typeof result === "object" && "rows" in result ? result.rows : result) as Array<{
      id: string;
      name: string;
      state: string;
    }>;

    const pgBoss = await getPgBoss(config);
    let retried = 0;
    for (const row of rows) {
      try {
        if (row.state === "cancelled") {
          await pgBoss.resume(row.name, row.id);
        } else {
          await pgBoss.retry(row.name, row.id);
        }
        retried++;
      } catch {
        // Continue; per-job failures are reported via the final count delta.
      }
    }

    return Response.json(
      { data: { retried, matched: rows.length } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
