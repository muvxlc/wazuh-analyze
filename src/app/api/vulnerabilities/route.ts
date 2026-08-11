import "server-only";

import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { requirePermission } from "../../../server/authorization/require";
import { resolveEffectiveConfig } from "../../../server/settings/service";
import { SESSION_COOKIE } from "../../../server/auth/cookies";
import { toErrorResponse } from "../../../server/http/error-response";
import { createWazuhClient } from "../../../server/wazuh/adapter";
import { getAgentSnapshot } from "../../../server/wazuh/agent-service";
import { fetchAgentVulnerabilities } from "../../../server/wazuh/indexer";

export async function GET(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, "vulnerabilities.read");

    const effective = await resolveEffectiveConfig(db, config);
    const client = createWazuhClient(effective.wazuh);
    const snapshot = await getAgentSnapshot(db, client);
    const results = await Promise.all(snapshot.agents.map(async (agent) => {
      try {
        const vulnerabilities = await fetchAgentVulnerabilities(effective.wazuh, agent.id, 20);
        return { vulnerabilities: vulnerabilities.map((v) => ({ ...v, agentId: agent.id, agentName: agent.name })), error: false };
      } catch (error) {
        console.error(`[Vulnerabilities] Indexer fetch failed for agent ${agent.id}:`, error);
        return { vulnerabilities: [], error: true };
      }
    }));
    const rows = results.flatMap((result) => result.vulnerabilities);
    rows.sort((a, b) => (b.cvss_score ?? 0) - (a.cvss_score ?? 0));
    return Response.json(
      { data: { vulnerabilities: rows, agents: snapshot.agents, indexerConfigured: Boolean(effective.wazuh.indexer), indexerError: results.some((result) => result.error), stale: snapshot.stale } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
