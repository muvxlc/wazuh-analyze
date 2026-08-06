import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

// ponytail: delivery retry/exponential-backoff sweep is Phase 5; rows stay as audit surface until then.
export const notificationChannelTypeEnum = pgEnum("notification_channel_type", [
  "discord",
  "telegram",
]);

export const notificationEventTypeEnum = pgEnum("notification_event_type", [
  "alert.high_severity",
  "incident.created",
  "incident.escalated",
  "verdict.confident_real",
  "report.weekly",
]);

export const notificationDeliveryStatusEnum = pgEnum("notification_delivery_status", [
  "sent",
  "failed",
]);

export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    type: notificationChannelTypeEnum("type").notNull(),
    // Encrypted via encryptSecret at rest: {webhookUrl} | {botToken, chatId}.
    config: jsonb("config").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // indexes declared in migration SQL 0010_notifications.sql
);

export const notificationRules = pgTable(
  "notification_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventType: notificationEventTypeEnum("event_type").notNull(),
    severityThreshold: integer("severity_threshold"),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ruleId: uuid("rule_id").references(() => notificationRules.id, {
      onDelete: "set null",
    }),
    channelId: uuid("channel_id").references(() => notificationChannels.id, {
      onDelete: "cascade",
    }),
    eventType: notificationEventTypeEnum("event_type").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    status: notificationDeliveryStatusEnum("status").notNull(),
    statusCode: integer("status_code"),
    error: text("error"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);
