import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { requirePermission } from "../../../server/authorization/require";
import { SESSION_COOKIE } from "../../../server/auth/cookies";
import { toErrorResponse } from "../../../server/http/error-response";
import { createWazuhClient } from "../../../server/wazuh/adapter";
import { getAgentSnapshot } from "../../../server/wazuh/agent-service";

export async function GET(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, "agents.read");

    const client = createWazuhClient(config.wazuh);
    const snapshot = await getAgentSnapshot(db, client);

    return Response.json({ data: snapshot }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
