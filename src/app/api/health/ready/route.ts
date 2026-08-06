import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { checkReadiness } from "../../../../server/health/health-service";
import { toErrorResponse } from "../../../../server/http/error-response";

export async function GET(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const status = await checkReadiness(db);
    return Response.json(status, {
      status: status.status === "ok" ? 200 : 503,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
