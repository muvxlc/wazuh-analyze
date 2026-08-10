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
    requirePermission(user.permissions, "mitre.read");

    const range = new URL(request.url).searchParams.get("range") ?? "30d";
    const interval = range === "7d" ? "7 days" : range === "90d" ? "90 days" : "30 days";
    const result = await db.execute<{
      technique_id: string;
      technique_name: string | null;
      tactic: string | null;
      count: number;
    }>(sql`
      WITH latest AS (
        SELECT DISTINCT ON (alert_id) verdict
        FROM alert_analyses
        WHERE created_at >= NOW() - ${sql.raw(`INTERVAL '${interval}'`)}
        ORDER BY alert_id, created_at DESC
      )
      SELECT
        m.elem->>'techniqueId' AS technique_id,
        m.elem->>'techniqueName' AS technique_name,
        m.elem->>'tactic' AS tactic,
        COUNT(*)::int AS count
      FROM latest, jsonb_array_elements(latest.verdict->'mitreAttack') AS m(elem)
      WHERE m.elem->>'techniqueId' IS NOT NULL
      GROUP BY technique_id, technique_name, tactic
      ORDER BY count DESC, technique_id
    `);

    return Response.json(
      { data: { range, techniques: result.rows.map((row) => ({ techniqueId: row.technique_id, techniqueName: row.technique_name, tactic: row.tactic, count: Number(row.count) })) } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
