import { z } from "zod";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { listAlerts } from "../../../../server/alerts/query";
import { toErrorResponse } from "../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";

// Members of a single alert group: (agentId, ruleId, level) within [since, until].
const membersSchema = z.object({
  agentId: z.string().optional(),
  ruleId: z.string().optional(),
  level: z.coerce.number().int().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(db, request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null);
    const parsed = membersSchema.parse(Object.fromEntries(new URL(request.url).searchParams));

    const actor = { userId: user.id, role: user.role, permissions: new Set(user.permissions) };

    const data = await listAlerts(db, actor, {
      agentId: parsed.agentId,
      ruleId: parsed.ruleId,
      levelMin: parsed.level,
      levelMax: parsed.level,
      since: parsed.since ? new Date(parsed.since) : undefined,
      until: parsed.until ? new Date(parsed.until) : undefined,
      cursor: parsed.cursor,
      limit: parsed.limit,
    });

    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally { await pool.end(); }
}
