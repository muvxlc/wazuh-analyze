import "server-only";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { assertCsrfSafe } from "../../../../server/auth/csrf";
import { requirePermission } from "../../../../server/authorization/require";
import { toErrorResponse } from "../../../../server/http/error-response";
import { notificationChannels, notificationDeliveries } from "../../../../server/db/schema/notifications";
import { decryptSecret, type EncryptedPayload } from "../../../../server/settings/encryption";
import { createNotifier, type NotifierConfig } from "../../../../server/notifications/notifier";

const testSchema = z.object({
  channelId: z.string().uuid(),
});

function token(request: Request): string | null {
  return request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
}

export async function POST(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(db, token(request));
    requirePermission(user.permissions, "notifications.manage");

    const parsed = testSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "invalid_input", requestId } }, { status: 422 });

    const [channel] = await db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.id, parsed.data.channelId));
    if (!channel) return Response.json({ error: { code: "not_found", requestId } }, { status: 404 });

    const decrypted = decryptSecret(channel.config as unknown as EncryptedPayload, config.settingsEncryptionKey);
    const notifierConfig = JSON.parse(decrypted) as NotifierConfig;
    const notifier = createNotifier(channel.type, notifierConfig);

    const result = await notifier.send({
      title: "🔔 [Test Notification]",
      body: "This is a test notification sent from the Wazuh Dashboard Settings.",
      severity: "N/A",
      url: config.appUrl.toString(),
    });

    await db.insert(notificationDeliveries).values({
      ruleId: null,
      channelId: channel.id,
      eventType: "verdict.confident_real",
      targetType: "test",
      targetId: "manual-test",
      status: result.success ? "sent" : "failed",
      statusCode: result.statusCode ?? null,
      error: result.error ?? null,
    });

    if (!result.success) {
      return Response.json({ error: { code: "transmission_failed", message: result.error, requestId } }, { status: 502 });
    }

    return Response.json({ data: { success: true }, requestId }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
