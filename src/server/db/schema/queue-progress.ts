import { pgTable, text, timestamp, index, uuid } from "drizzle-orm/pg-core";

export const queueProgress = pgTable(
  "queue_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    queueName: text("queue_name").notNull(),
    entityId: text("entity_id").notNull(),
    jobId: text("job_id"),
    phase: text("phase").notNull(),
    status: text("status").default("running").notNull(),
    detail: text("detail"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    entityIdx: index("queue_progress_entity_idx").on(t.queueName, t.entityId),
  })
);
