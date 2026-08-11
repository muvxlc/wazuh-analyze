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
import { fetchAgentSca } from "../../../server/wazuh/inventory";

interface ScaPolicy {
  policy_id?: string;
  name?: string;
  references?: string;
  pass?: number;
  fail?: number;
  total_checks?: number;
  score?: number;
}

interface PolicyAggregate {
  policyId: string;
  name: string;
  references: string | null;
  pass: number;
  fail: number;
  totalChecks: number;
  score: number;
  agentCount: number;
}

function extractPcaPolicies(payload: unknown): ScaPolicy[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: { affected_items?: unknown } }).data;
  const items = data?.affected_items;
  return Array.isArray(items) ? (items as ScaPolicy[]).filter((p) => p && typeof p.policy_id === "string") : [];
}

export async function GET(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, "compliance.read");

    const effective = await resolveEffectiveConfig(db, config);
    const client = createWazuhClient(effective.wazuh);
    const snapshot = await getAgentSnapshot(db, client);

    // Fetch SCA per active agent; aggregate policy scores across the fleet.
    const activeAgents = snapshot.agents.filter((a) => a.status === "active");
    const perAgent = await Promise.all(
      activeAgents.map(async (agent) => {
        const payload = await fetchAgentSca(effective.wazuh, agent.id);
        return extractPcaPolicies(payload);
      }),
    );

    const byPolicy = new Map<string, PolicyAggregate>();
    for (const policies of perAgent) {
      for (const p of policies) {
        const id = p.policy_id as string;
        const existing = byPolicy.get(id);
        if (existing) {
          existing.pass += p.pass ?? 0;
          existing.fail += p.fail ?? 0;
          existing.totalChecks += p.total_checks ?? 0;
          existing.agentCount += 1;
          // Keep the highest observed score as the representative floor.
          if ((p.score ?? 0) > existing.score) existing.score = p.score ?? 0;
        } else {
          byPolicy.set(id, {
            policyId: id,
            name: p.name ?? id,
            references: typeof p.references === "string" && p.references ? p.references : null,
            pass: p.pass ?? 0,
            fail: p.fail ?? 0,
            totalChecks: p.total_checks ?? 0,
            score: p.score ?? 0,
            agentCount: 1,
          });
        }
      }
    }

    const policies = Array.from(byPolicy.values()).sort((a, b) => b.fail - a.fail || b.totalChecks - a.totalChecks);

    return Response.json(
      { data: { policies, agentsScanned: activeAgents.length, stale: snapshot.stale } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
