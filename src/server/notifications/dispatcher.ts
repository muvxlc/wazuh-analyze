import "server-only";

import { and, eq } from "drizzle-orm";

import type { Database } from "../db/types";
import type { AppConfig } from "../config";
import { createDatabase } from "../db/client";
import {
  notificationChannels,
  notificationDeliveries,
  notificationRules,
} from "../db/schema/notifications";
import { writeAuditEvent } from "../audit/audit-service";
import { decryptSecret, type EncryptedPayload } from "../settings/encryption";
import { createNotifier, type NotifierConfig } from "./notifier";
import { renderNotification, type NotificationEvent } from "./render";

export interface DispatchOptions {
  fetchFn?: typeof fetch;
  actorUserId?: string | null;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// ponytail: No queue engine or external worker yet; failure isolation handled by Promise-level catch per channel.
export async function dispatchNotification(
  db: Database,
  event: NotificationEvent,
  encryptionKey: string,
  options: DispatchOptions = {},
): Promise<void> {
  const activeRules = await db
    .select({
      rule: notificationRules,
      channel: notificationChannels,
    })
    .from(notificationRules)
    .innerJoin(
      notificationChannels,
      eq(notificationRules.channelId, notificationChannels.id),
    )
    .where(
      and(
        eq(notificationRules.eventType, event.type),
        eq(notificationRules.enabled, true),
        eq(notificationChannels.enabled, true),
      ),
    );

  if (!activeRules.length) return;

  const rendered = renderNotification(event);
  const eventSevNum = event.severity !== undefined ? Number(event.severity) : NaN;

  await Promise.all(
    activeRules.map(async ({ rule, channel }) => {
      try {
        if (rule.severityThreshold !== null && rule.severityThreshold !== undefined) {
          if (Number.isNaN(eventSevNum) || eventSevNum < rule.severityThreshold) {
            return;
          }
        }

        let config: NotifierConfig;
        try {
          const decrypted = decryptSecret(channel.config as unknown as EncryptedPayload, encryptionKey);
          config = JSON.parse(decrypted) as NotifierConfig;
        } catch (err) {
          await logDelivery(db, rule.id, channel.id, event, {
            success: false,
            error: `Decryption/config error: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }

        const notifier = createNotifier(channel.type, config);
        const result = await notifier.send(rendered, options.fetchFn);

        await logDelivery(db, rule.id, channel.id, event, result);

        if (result.success) {
          await writeAuditEvent(db, {
            actorUserId: options.actorUserId ?? null,
            targetType: "notification_delivery",
            targetId: channel.id,
            action: "notification.send",
            ipAddress: options.ipAddress ?? null,
            userAgent: options.userAgent ?? null,
            requestId: options.requestId ?? "bg-dispatch",
            detail: { channelName: channel.name, channelType: channel.type, eventType: event.type },
          });
        }
      } catch (err) {
        // Fallback error containment per channel
        await logDelivery(db, rule.id, channel.id, event, {
          success: false,
          error: `Unhandled dispatch exception: ${err instanceof Error ? err.message : String(err)}`,
        }).catch(() => {/* silence failure log DB error in fire-and-forget */});
      }
    }),
  );
}

async function logDelivery(
  db: Database,
  ruleId: string | null,
  channelId: string,
  event: NotificationEvent,
  result: { success: boolean; statusCode?: number; error?: string },
) {
  await db.insert(notificationDeliveries).values({
    ruleId,
    channelId,
    eventType: event.type,
    targetType: event.type.startsWith("alert") ? "alert" : "incident",
    targetId: event.targetId,
    status: result.success ? "sent" : "failed",
    statusCode: result.statusCode ?? null,
    error: result.error ?? null,
  });
}

