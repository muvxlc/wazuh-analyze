import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { toErrorResponse } from "../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../server/auth/cookies";
import { requirePermission } from "../../../server/authorization/require";
import { listAllTags } from "../../../server/wazuh/agent-tags";

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(
      db,
      request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null,
    );
    requirePermission(user.permissions, "agents.read");

    const tags = await listAllTags(db);
    return Response.json({ data: { tags } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
