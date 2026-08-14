import "server-only";

import { z } from "zod";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { assertCsrfSafe } from "../../../../server/auth/csrf";
import { requirePermission } from "../../../../server/authorization/require";
import { toErrorResponse } from "../../../../server/http/error-response";
import { notificationRules } from "../../../../server/db/schema/notifications";

const createRuleSchema = z.object({
  eventType: z.enum(["alert.high_severity", "incident.created", "incident.escalated", "incident.opened", "verdict.confident_real"]),
  severityThreshold: z.number().int().positive().max(100).nullable().optional(),
  channelId: z.string().uuid(),
  enabled: z.boolean().default(true),
});

function token(request: Request): string | null {
  return request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
}

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(db, token(request));
    requirePermission(user.permissions, "notifications.manage");
    const rules = await db.select().from(notificationRules);
    return Response.json({ data: rules }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(db, token(request));
    requirePermission(user.permissions, "notifications.manage");
    const parsed = createRuleSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "invalid_input", requestId } }, { status: 422 });

    const [rule] = await db
      .insert(notificationRules)
      .values({
        eventType: parsed.data.eventType,
        severityThreshold: parsed.data.severityThreshold ?? null,
        channelId: parsed.data.channelId,
        enabled: parsed.data.enabled,
      })
      .returning();

    return Response.json({ data: rule }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
