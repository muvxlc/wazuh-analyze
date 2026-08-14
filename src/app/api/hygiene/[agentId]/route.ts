import "server-only";

import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { requirePermission } from "../../../../server/authorization/require";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { toErrorResponse } from "../../../../server/http/error-response";
import {
  fetchPackages,
  fetchProcesses,
  fetchPorts,
  fetchServices,
  fetchSyscollector,
} from "../../../../server/wazuh/inventory";
import { resolveEffectiveConfig } from "../../../../server/settings/service";

export async function GET(request: Request, ctx: { params: Promise<{ agentId: string }> }): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, "posture.read");

    const { agentId } = await ctx.params;
    const effective = await resolveEffectiveConfig(db, config);
    const wcfg = effective.wazuh;

    const [hardware, os, packages, processes, ports, services] = await Promise.all([
      fetchSyscollector(wcfg, agentId, "hardware").catch(() => null),
      fetchSyscollector(wcfg, agentId, "os").catch(() => null),
      fetchPackages(wcfg, agentId).catch(() => null),
      fetchProcesses(wcfg, agentId).catch(() => null),
      fetchPorts(wcfg, agentId).catch(() => null),
      fetchServices(wcfg, agentId).catch(() => null),
    ]);

    return Response.json(
      { data: { agentId, hardware, os, packages, processes, ports, services } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
