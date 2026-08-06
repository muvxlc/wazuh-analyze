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
import { notificationChannels } from "../../../../server/db/schema/notifications";
import { encryptSecret } from "../../../../server/settings/encryption";

const createChannelSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["discord", "telegram"]),
  webhookUrl: z.string().url().max(1000).optional(),
  botToken: z.string().max(500).optional(),
  chatId: z.string().max(100).optional(),
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
    const channels = await db.select().from(notificationChannels);
    const sanitized = channels.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      enabled: c.enabled,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
    return Response.json({ data: sanitized }, { headers: { "cache-control": "no-store" } });
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
    const parsed = createChannelSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "invalid_input", requestId } }, { status: 422 });

    const secretConfig =
      parsed.data.type === "discord"
        ? { webhookUrl: parsed.data.webhookUrl }
        : { botToken: parsed.data.botToken, chatId: parsed.data.chatId };

    const encrypted = encryptSecret(JSON.stringify(secretConfig), config.settingsEncryptionKey);
    const [inserted] = await db
      .insert(notificationChannels)
      .values({
        name: parsed.data.name,
        type: parsed.data.type,
        config: encrypted,
        enabled: parsed.data.enabled,
        createdByUserId: user.id,
      })
      .returning();

    return Response.json(
      { data: { id: inserted!.id, name: inserted!.name, type: inserted!.type, enabled: inserted!.enabled } },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
