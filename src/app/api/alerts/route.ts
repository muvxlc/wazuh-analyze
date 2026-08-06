import { z } from "zod";
import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { listAlerts } from "../../../server/alerts/query";
import { toErrorResponse } from "../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../server/auth/cookies";

const querySchema = z.object({
  search: z.string().optional(), agentId: z.string().optional(), ruleId: z.string().optional(),
  levelMin: z.coerce.number().int().optional(), levelMax: z.coerce.number().int().optional(),
  status: z.enum(["open", "acknowledged", "resolved"]).optional(), cursor: z.string().optional(),
  limit: z.coerce.number().int().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(db, request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null);
    const parsed = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const data = await listAlerts(db, { userId: user.id, role: user.role, permissions: new Set(user.permissions) }, parsed);
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally { await pool.end(); }
}
