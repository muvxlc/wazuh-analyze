import "server-only";

import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { requirePermission } from "../../../server/authorization/require";
import { SESSION_COOKIE } from "../../../server/auth/cookies";
import { toErrorResponse } from "../../../server/http/error-response";
import { listMitreTechniques } from "../../../server/mitre/service";

export async function GET(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, "mitre.read");

    const range = new URL(request.url).searchParams.get("range") ?? "30d";
    const techniques = await listMitreTechniques(db, range);

    return Response.json(
      { data: { range, techniques } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
