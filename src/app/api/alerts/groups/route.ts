import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { toErrorResponse } from "../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { sql } from "drizzle-orm";
import * as schema from "../../../../server/db/schema";
import { createWazuhClient } from "../../../../server/wazuh/adapter";
import { indexAgentGroups } from "../../../../server/wazuh/agent-groups";
import { resolveEffectiveConfig } from "../../../../server/settings/service";

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(db, request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null);
    const rows = await db
      .select({ group: schema.alerts.groups })
      .from(schema.alerts)
      .where(sql`array_length(${schema.alerts.groups}, 1) > 0`);
    const dbGroups = new Set(
      rows.flatMap((row) => Array.isArray(row.group) ? row.group.filter((g): g is string => typeof g === "string") : []),
    );

    const effective = await resolveEffectiveConfig(db, config);
    const client = createWazuhClient(effective.wazuh);
    const agents = await client.listAgents().catch(() => []);
    const liveIndex = indexAgentGroups(agents);
    const liveGroups = new Set(liveIndex.groups);

    const groups = Array.from(new Set([...dbGroups, ...liveGroups])).sort();
    return Response.json({ data: { groups } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
