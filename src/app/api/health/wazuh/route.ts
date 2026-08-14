import { loadConfig } from "../../../../server/config";
import { checkIndexerHealth, checkWazuhHealth } from "../../../../server/health/health-service";
import { createWazuhClient } from "../../../../server/wazuh/adapter";
import { toErrorResponse } from "../../../../server/http/error-response";
import { createDatabase } from "../../../../server/db/client";
import { resolveEffectiveConfig } from "../../../../server/settings/service";

export async function GET(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const effective = await resolveEffectiveConfig(db, config);
    const client = createWazuhClient(effective.wazuh);
    const [wazuh, indexer] = await Promise.all([
      checkWazuhHealth(client),
      checkIndexerHealth(effective.wazuh),
    ]);
    const overall = wazuh.status === "ok" && indexer.status === "ok" ? "ok" : "down";
    return Response.json({ wazuh, indexer, status: overall }, {
      status: overall === "ok" ? 200 : 503,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    void pool.end();
  }
}
