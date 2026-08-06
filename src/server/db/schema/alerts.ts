import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { isNotNull } from "drizzle-orm";

import { users } from "./users";

export const alertStatusEnum = pgEnum("alert_status", [
  "open",
  "acknowledged",
  "resolved",
]);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    wazuhEventId: text("wazuh_event_id"),
    fingerprint: text("fingerprint").notNull(),
    wazuhTimestamp: timestamp("wazuh_timestamp", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
    agentId: text("agent_id"),
    agentName: text("agent_name"),
    agentIp: text("agent_ip"),
    ruleId: text("rule_id"),
    ruleDescription: text("rule_description").notNull(),
    level: integer("level").notNull(),
    groups: text("groups").array().default([]).notNull(),
    compliance: jsonb("compliance").default({}).notNull(),
    status: alertStatusEnum("status").default("open").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedByUserId: uuid("acknowledged_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    rawPayload: jsonb("raw_payload").notNull(),
  },
  (table) => [
    uniqueIndex("alerts_wazuh_event_id_unique")
      .on(table.wazuhEventId)
      .where(isNotNull(table.wazuhEventId)),
    uniqueIndex("alerts_fingerprint_unique").on(table.fingerprint),
    index("alerts_cursor_idx").on(table.ingestedAt.desc(), table.id.desc()),
    index("alerts_level_idx").on(table.level),
    index("alerts_status_idx").on(table.status),
    index("alerts_agent_idx").on(table.agentId, table.agentName),
    index("alerts_rule_idx").on(table.ruleId),
    index("alerts_wazuh_timestamp_idx").on(table.wazuhTimestamp.desc()),
  ],
);

export const alertEvents = pgTable(
  "alert_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    alertId: uuid("alert_id").notNull().references(() => alerts.id, { onDelete: "cascade" }),
    fromStatus: alertStatusEnum("from_status"),
    toStatus: alertStatusEnum("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
  },
  (table) => [
    index("alert_events_alert_occurred_idx").on(table.alertId, table.occurredAt.desc()),
  ],
);
