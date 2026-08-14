import { z } from "zod";
import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { listAlerts, listAlertGroups } from "../../../server/alerts/query";
import { toErrorResponse } from "../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../server/auth/cookies";
import { createWazuhClient } from "../../../server/wazuh/adapter";
import {
  indexAgentGroups,
  resolveAgentIdsForGroups,
  mergeAgentGroups,
} from "../../../server/wazuh/agent-groups";
import { resolveEffectiveConfig } from "../../../server/settings/service";

const querySchema = z.object({
  search: z.string().optional(), agentId: z.string().optional(), agentIds: z.string().optional().transform((value) => value ? value.split(",").map((id) => id.trim()).filter(Boolean) : undefined), ruleId: z.string().optional(),
  levelMin: z.coerce.number().int().optional(), levelMax: z.coerce.number().int().optional(),
  status: z.enum(["open", "acknowledged", "resolved"]).optional(),
  groups: z.string().optional().transform((value) => value ? value.split(",").map((group) => group.trim()).filter(Boolean) : undefined),
  tags: z.string().optional().transform((value) => value ? value.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().optional(),
  group: z.coerce.boolean().optional(),
  windowMinutes: z.coerce.number().int().min(1).max(1440).optional(),
});

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(db, request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null);
    const parsed = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));

    const effective = await resolveEffectiveConfig(db, config);
    const client = createWazuhClient(effective.wazuh);
    const agents = await client.listAgents().catch(() => []);
    const index = indexAgentGroups(agents);

    let agentIds = parsed.agentIds;
    if (parsed.groups?.length && !agentIds) {
      agentIds = resolveAgentIdsForGroups(index, parsed.groups);
    }

    const actor = { userId: user.id, role: user.role, permissions: new Set(user.permissions) };

    if (parsed.group) {
      const groups = await listAlertGroups(db, actor, {
        ...parsed,
        agentIds,
        groups: agentIds ? undefined : parsed.groups,
      });
      return Response.json({ data: groups }, { headers: { "cache-control": "no-store" } });
    }

    const data = await listAlerts(db, actor, {
      ...parsed,
      agentIds,
      groups: agentIds ? undefined : parsed.groups,
    });

    if (index.byAgentId.size > 0) {
      data.items = mergeAgentGroups(data.items, index);
    }

    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally { await pool.end(); }
}
