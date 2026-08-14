import { createDatabase } from "../../../../../server/db/client";
import { loadConfig } from "../../../../../server/config";
import { authenticateRequest } from "../../../../../server/auth/authenticate";
import { getAlertDetail } from "../../../../../server/alerts/query";
import { toErrorResponse } from "../../../../../server/http/error-response";
import { searchIndexerEvents, parseSearchParams } from "../../../../../server/wazuh/indexer-search";
import { SESSION_COOKIE } from "../../../../../server/auth/cookies";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(
      db,
      request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null,
    );
    const { id } = await context.params;
    const alert = await getAlertDetail(db, { userId: user.id, role: user.role, permissions: new Set(user.permissions) }, id);

    const params = parseSearchParams(new URL(request.url).searchParams);
    // Do not allow caller-supplied agentId; always use the alert's own agent.
    const searchParams = params.agentId ? { ...params, agentId: alert.agentId ?? undefined } : params;
    const events = await searchIndexerEvents(config.wazuh, searchParams);

    return Response.json({ data: events }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
