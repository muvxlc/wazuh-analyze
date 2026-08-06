import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { getSocMetrics, parseSocRange } from "../../../../server/dashboard/soc-metrics";
import { toErrorResponse } from "../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    const range = parseSocRange(new URL(request.url).searchParams.get("range") ?? undefined);
    const data = await getSocMetrics(
      db,
      { userId: user.id, role: user.role, permissions: new Set(user.permissions) },
      range,
    );
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
