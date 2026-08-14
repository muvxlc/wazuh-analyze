import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { getDashboardSummary } from "../../../../server/dashboard/dashboard-service";
import { toErrorResponse } from "../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { createWazuhClient } from "../../../../server/wazuh/adapter";
import { resolveEffectiveConfig } from "../../../../server/settings/service";

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    const effective = await resolveEffectiveConfig(db, config);
    const data = await getDashboardSummary(db, { userId: user.id, role: user.role, permissions: new Set(user.permissions) }, {
      wazuh: createWazuhClient(effective.wazuh),
      wazuhConfig: effective.wazuh,
    });
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
