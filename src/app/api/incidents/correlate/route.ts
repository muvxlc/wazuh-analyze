import { z } from "zod";
import { asc, desc, eq, gte } from "drizzle-orm";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { correlateAlert } from "../../../../server/incidents/correlator";
import * as schema from "../../../../server/db/schema";
import { assertCsrfSafe } from "../../../../server/auth/csrf";
import { requirePermission } from "../../../../server/authorization/require";
import { toErrorResponse } from "../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";

const bodySchema = z.object({
  alertId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ponytail: basic on-demand scan over recent high-severity open alerts without job schedulers. Add a cron background job when real-time correlation grows behind ingestion.
export async function POST(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(
      db,
      request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null,
    );
    requirePermission(new Set(user.permissions), "incidents.manage");

    let body: z.infer<typeof bodySchema> = { limit: 20 };
    const text = await request.text();
    if (text) {
      body = bodySchema.parse(JSON.parse(text));
    }

    const targetAlertIds: string[] = [];
    if (body.alertId) {
      targetAlertIds.push(body.alertId);
    } else {
      const recents = await db
        .select({ id: schema.alerts.id })
        .from(schema.alerts)
        .where(gte(schema.alerts.level, 7))
        .orderBy(desc(schema.alerts.wazuhTimestamp))
        .limit(body.limit);
      for (const row of recents) {
        targetAlertIds.push(row.id);
      }
    }

    let checked = 0;
    let created = 0;
    let matched = 0;

    for (const alertId of targetAlertIds) {
      checked++;
      const res = await correlateAlert(db, alertId);
      if (res) {
        matched++;
        if (res.created) created++;
      }
    }

    return Response.json(
      { data: { checked, matched, created } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
