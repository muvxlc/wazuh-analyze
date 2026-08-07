import { sql } from "drizzle-orm";
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
import { countPendingAlerts } from "../../../server/daemon/backfill";

const QUEUE_NAMES = [
  QUEUE_ANALYZE_ALERT,
  QUEUE_DISPATCH_NOTIFICATION,
  QUEUE_EXECUTE_ACTION,
  QUEUE_WEEKLY_REPORT,
] as const;

interface JobRow {
  id: string;
  name: string;
  state: string;
  retry_count: number;
  created_on: string | Date;
  started_on: string | Date | null;
  completed_on: string | Date | null;
  data: Record<string, unknown> | null;
}

interface CountRow { name: string; state: string; count: number; }
interface SeriesRow { hour: string | Date; name: string; total: number; }

function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, PERMISSIONS.queuesRead);

    const pgBoss = await getPgBoss(config);
    const queues = await pgBoss.getQueues([...QUEUE_NAMES]);
    const result = Object.fromEntries(queues.map((q) => [q.name, q]));

    const [jobResult, countResult, seriesResult, progressResult, pendingAlerts] = await Promise.all([
      db.execute(sql`
        SELECT id, name, state::text, retry_count, created_on, started_on, completed_on, data
        FROM boss.job
        WHERE name IN (${sql.join(QUEUE_NAMES.map((name) => sql`${name}`), sql`, `)})
        ORDER BY created_on DESC
        LIMIT 50
      `),
      db.execute(sql`
        SELECT name, state::text, count(*)::int AS count
        FROM boss.job
        WHERE name IN (${sql.join(QUEUE_NAMES.map((name) => sql`${name}`), sql`, `)})
          AND created_on >= now() - interval '24 hours'
        GROUP BY name, state
      `),
      db.execute(sql`
        SELECT date_trunc('hour', created_on) AS hour, name, count(*)::int AS total
        FROM boss.job
        WHERE name IN (${sql.join(QUEUE_NAMES.map((name) => sql`${name}`), sql`, `)})
          AND created_on >= now() - interval '24 hours'
        GROUP BY 1, 2
        ORDER BY 1
      `),
      db.execute(sql`
        SELECT queue_name, entity_id, phase, status, started_at, updated_at
        FROM queue_progress
        WHERE status = 'running'
        ORDER BY updated_at DESC
        LIMIT 20
      `),
      countPendingAlerts(db),
    ]);

    const countRows = asRows<CountRow>(countResult);
    const perQueue = Object.fromEntries(QUEUE_NAMES.map((name) => [name, {
      completed: countRows.find((r) => r.name === name && r.state === "completed")?.count ?? 0,
      failed: countRows.find((r) => r.name === name && r.state === "failed")?.count ?? 0,
      running: countRows.find((r) => r.name === name && r.state === "active")?.count ?? 0,
      pending: countRows.filter((r) => r.name === name && ["created", "retry", "retrying"].includes(r.state)).reduce((n, r) => n + r.count, 0),
    }]));
    const completed = Object.values(perQueue).reduce((n, q) => n + q.completed, 0);
    const failed = Object.values(perQueue).reduce((n, q) => n + q.failed, 0);
    const running = Object.values(perQueue).reduce((n, q) => n + q.running, 0);
    const processed = completed + failed;

    const recentJobs = asRows<JobRow>(jobResult).map((job) => ({
      id: job.id,
      queue: job.name,
      state: job.state,
      retryCount: job.retry_count,
      entityId: typeof job.data?.alertId === "string" ? job.data.alertId : typeof job.data?.actionId === "string" ? job.data.actionId : null,
      createdAt: job.created_on,
      startedAt: job.started_on,
      completedAt: job.completed_on,
    }));

    return Response.json({
      data: {
        queues: result,
        metrics: { pendingAlerts, perQueue, totals: { completed, failed, running, processed, successRate: processed ? Math.round((completed / processed) * 100) : 100 } },
        recentJobs,
        series: asRows<SeriesRow>(seriesResult).map((row) => ({ hour: row.hour, queue: row.name, total: row.total })),
        running: asRows<Record<string, unknown>>(progressResult),
      },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
