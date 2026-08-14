import "server-only";

import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { requirePermission } from "../../../../server/authorization/require";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { toErrorResponse } from "../../../../server/http/error-response";
import { getPgBoss } from "../../../../server/daemon/pg-boss";
import { QUEUE_SYNC_ABUSEIPDB } from "../../../../server/daemon/queue";

import { resolveEffectiveConfig } from "../../../../server/settings/service";

export async function POST(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, "settings.manage");

    const effective = await resolveEffectiveConfig(db, config);
    if (!effective.ti?.abuseipdbKey) {
      return Response.json({ error: { code: "abuseipdb_not_configured" } }, { status: 422 });
    }

    const boss = await getPgBoss(effective);
    const jobId = await boss.send(QUEUE_SYNC_ABUSEIPDB, {}, {
      singletonKey: "sync-abuseipdb:manual",
      singletonSeconds: 300,
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 900,
    });

    return Response.json({ data: { queued: true, jobId } }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
