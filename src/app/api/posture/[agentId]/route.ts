import "server-only";

import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { requirePermission } from "../../../../server/authorization/require";
import { resolveEffectiveConfig } from "../../../../server/settings/service";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { toErrorResponse } from "../../../../server/http/error-response";
import {
  fetchAgentSca,
  fetchRootcheck,
  fetchSyscheck,
} from "../../../../server/wazuh/inventory";

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, "vulnerabilities.read");

    const { agentId } = await params;
    const effective = await resolveEffectiveConfig(db, config);

    const [sca, syscheck, rootcheck] = await Promise.all([
      fetchAgentSca(effective.wazuh, agentId),
      fetchSyscheck(effective.wazuh, agentId),
      fetchRootcheck(effective.wazuh, agentId),
    ]);

    return Response.json(
      { data: { agentId, sca, syscheck, rootcheck } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
