import { z } from "zod";
import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { toErrorResponse } from "../../../server/http/error-response";
import { requirePermission } from "../../../server/authorization/require";
import { SESSION_COOKIE } from "../../../server/auth/cookies";
import { listDeadLetters } from "../../../server/ingestion/dead-letter";

const querySchema = z.object({
  status: z.enum(["open", "retrying", "dead"]).optional(),
  source: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(64).optional(),
});

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(
      db,
      request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null,
    );
    requirePermission(user.permissions, "settings.manage");

    const parsed = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const data = await listDeadLetters({
      db,
      status: parsed.status,
      source: parsed.source,
      limit: parsed.limit,
      cursor: parsed.cursor,
    });
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
