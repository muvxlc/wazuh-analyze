import { loadConfig } from "../../../../server/config";
import { checkWazuhHealth } from "../../../../server/health/health-service";
import { createWazuhClient } from "../../../../server/wazuh/adapter";
import { toErrorResponse } from "../../../../server/http/error-response";

export async function GET(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  try {
    const client = createWazuhClient(config.wazuh);
    const status = await checkWazuhHealth(client);
    return Response.json(status, {
      status: status.status === "ok" ? 200 : 503,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  }
}
