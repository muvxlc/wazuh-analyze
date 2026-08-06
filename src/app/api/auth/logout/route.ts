import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { revokeSession } from "../../../../server/auth/session";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { assertCsrfSafe } from "../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../server/http/error-response";

export async function POST(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
    if (token) await revokeSession(db, token);
    return new Response(null, { status: 204, headers: { "set-cookie": `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${config.nodeEnv === "development" ? "" : "; Secure"}` } });
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
