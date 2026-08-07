import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { alerts } from "./alerts";
import { users } from "./users";

// ponytail: status enums match standard SOC lifecycle without complex custom workflows. Add custom status table when requested.
export const incidentStatusEnum = pgEnum("incident_status", [
  "open",
  "investigating",
  "mitigated",
  "resolved",
]);

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    incidentNumber: text("incident_number").unique(),
    title: text("title").notNull(),
    description: text("description"),
    status: incidentStatusEnum("status").default("open").notNull(),
    severity: text("severity").default("medium").notNull(),
    agentId: text("agent_id"),
    ruleId: text("rule_id"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    metadata: jsonb("metadata").default({}).notNull(),
  },
  (table) => [
    index("incidents_status_idx").on(table.status),
    index("incidents_agent_idx").on(table.agentId),
    index("incidents_rule_idx").on(table.ruleId),
    index("incidents_created_idx").on(table.createdAt.desc()),
    index("incidents_correlator_idx").on(table.agentId, table.ruleId, table.status, table.createdAt.desc()),
  ],
);

export const incidentAlerts = pgTable(
  "incident_alerts",
  {
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("incident_alerts_unique_idx").on(table.incidentId, table.alertId),
    index("incident_alerts_incident_idx").on(table.incidentId),
    index("incident_alerts_alert_idx").on(table.alertId),
  ],
);

export const incidentEvents = pgTable(
  "incident_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    fromStatus: incidentStatusEnum("from_status"),
    toStatus: incidentStatusEnum("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
  },
  (table) => [
    index("incident_events_incident_occurred_idx").on(table.incidentId, table.occurredAt.desc()),
  ],
);
