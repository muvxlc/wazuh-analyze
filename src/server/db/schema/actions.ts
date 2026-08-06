import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { incidents } from "./incidents";
import { users } from "./users";

export const actionStatusEnum = pgEnum("action_status", [
  "proposed",
  "approved",
  "executed",
  "rejected",
]);

export const actions = pgTable(
  "actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    status: actionStatusEnum("status").default("proposed").notNull(),
    command: text("command").notNull(),
    payload: jsonb("payload").default({}).notNull(),
    reason: text("reason").notNull(),
    proposedByUserId: uuid("proposed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("actions_incident_idx").on(table.incidentId),
    index("actions_status_idx").on(table.status),
  ],
);

export const actionApprovalDecisionEnum = pgEnum("action_approval_decision", ["approve", "reject"]);

export const actionApprovals = pgTable(
  "action_approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actionId: uuid("action_id")
      .notNull()
      .references(() => actions.id, { onDelete: "cascade" }),
    approverUserId: uuid("approver_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decision: actionApprovalDecisionEnum("decision").notNull(), // 'approve' | 'reject'
    note: text("note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("action_approvals_action_idx").on(table.actionId),
  ],
);
