import "server-only";

import { sql } from "drizzle-orm";
import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { requirePermission } from "../../../server/authorization/require";
import { SESSION_COOKIE } from "../../../server/auth/cookies";
import { toErrorResponse } from "../../../server/http/error-response";

export async function GET(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, "compliance.read");

    const range = new URL(request.url).searchParams.get("range") ?? "30d";
    const interval = range === "7d" ? "7 days" : range === "90d" ? "90 days" : "30 days";
    const result = await db.execute<{
      framework: string;
      control: string;
      count: number;
    }>(sql`
      SELECT
        lower(framework.key) AS framework,
        control.value AS control,
        COUNT(*)::int AS count
      FROM alerts AS a
      CROSS JOIN LATERAL jsonb_each(a.compliance) AS framework(key, value)
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(framework.value) = 'array' THEN framework.value ELSE jsonb_build_array(framework.value) END
      ) AS control(value)
      WHERE a.wazuh_timestamp >= NOW() - ${sql.raw(`INTERVAL '${interval}'`)}
      GROUP BY framework.key, control.value
      ORDER BY count DESC, framework.key, control.value
    `);

    const frameworks = new Map<string, { controls: Array<{ control: string; count: number }>; total: number }>();
    for (const row of result.rows) {
      const current = frameworks.get(row.framework) ?? { controls: [], total: 0 };
      const count = Number(row.count);
      current.controls.push({ control: row.control, count });
      current.total += count;
      frameworks.set(row.framework, current);
    }

    return Response.json(
      { data: { range, frameworks: Array.from(frameworks, ([framework, value]) => ({ framework, ...value })) } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
