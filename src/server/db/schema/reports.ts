import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export const reportStatusEnum = pgEnum("report_status", ["scheduled", "running", "completed", "failed"]);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    schedule: text("schedule").notNull(), // cron expression
    channel: text("channel"), // notification channel id (null = store only)
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    status: reportStatusEnum("status").default("scheduled").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("reports_status_idx").on(table.status),
    index("reports_next_run_idx").on(table.nextRunAt),
  ],
);
