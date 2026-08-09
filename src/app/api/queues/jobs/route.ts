import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { requirePermission } from "../../../../server/authorization/require";
import { toErrorResponse } from "../../../../server/http/error-response";
import { PERMISSIONS } from "../../../../server/authorization/permissions";
import {
  QUEUE_ANALYZE_ALERT,
  QUEUE_DISPATCH_NOTIFICATION,
  QUEUE_EXECUTE_ACTION,
  QUEUE_WEEKLY_REPORT,
} from "../../../../server/daemon/queue";

const QUEUE_NAMES = [
  QUEUE_ANALYZE_ALERT,
  QUEUE_DISPATCH_NOTIFICATION,
  QUEUE_EXECUTE_ACTION,
  QUEUE_WEEKLY_REPORT,
] as const;

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, PERMISSIONS.queuesRead);

    const { searchParams } = new URL(request.url);
    const limit = z.coerce.number().min(1).max(100).catch(50).parse(searchParams.get("limit"));
    const offset = z.coerce.number().min(0).catch(0).parse(searchParams.get("offset"));
    const queue = searchParams.get("queue");
    const state = searchParams.get("state");

    let conditions = sql`name IN (${sql.join(QUEUE_NAMES.map((name) => sql`${name}`), sql`, `)})`;
    if (queue && QUEUE_NAMES.includes(queue as any)) {
      conditions = sql`${conditions} AND name = ${queue}`;
    }
    if (state) {
      conditions = sql`${conditions} AND state = CAST(${state} AS boss.job_state)`;
    }

    const jobResult = await db.execute(sql`
      SELECT id, name, state::text, retry_count, created_on, started_on, completed_on, data
      FROM boss.job
      WHERE ${conditions}
      ORDER BY created_on DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countResult = await db.execute(sql`
      SELECT count(*)::int AS count
      FROM boss.job
      WHERE ${conditions}
    `);
    const rows = <T>(value: unknown): T[] => {
      if (Array.isArray(value)) return value as T[];
      if (value && typeof value === "object" && "rows" in value && Array.isArray((value as { rows: unknown }).rows)) {
        return (value as { rows: T[] }).rows;
      }
      return [];
    };
    const totalCount = rows<{ count: number }>(countResult)[0]?.count ?? 0;

    const jobs = rows<any>(jobResult).map((job) => ({
      id: job.id,
      queue: job.name,
      state: job.state,
      retryCount: job.retry_count,
      entityId: typeof job.data?.alertId === "string" ? job.data.alertId : typeof job.data?.actionId === "string" ? job.data.actionId : null,
      createdAt: job.created_on,
      startedAt: job.started_on,
      completedAt: job.completed_on,
    }));

    return Response.json(
      { data: jobs, meta: { total: totalCount, limit, offset } },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
