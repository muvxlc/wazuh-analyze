import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { alerts } from "./alerts";
import { aiConnections } from "./ai-connections";
import { users } from "./users";

// Append-only 1:N — latest verdict per alert = ORDER BY created_at DESC LIMIT 1.
// ponytail: no retention; old rows accumulate. Add a cleanup job before this table gets large.
export const alertAnalyses = pgTable(
  "alert_analyses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    aiConnectionId: uuid("ai_connection_id").references(() => aiConnections.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    verdict: jsonb("verdict").notNull(),
    tokensUsed: integer("tokens_used"),
    latencyMs: integer("latency_ms"),
    enrichmentsUsed: text("enrichments_used").array().default([]).notNull(),
    iocLookups: jsonb("ioc_lookups").default([]).notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("alert_analyses_alert_created_idx").on(table.alertId, table.createdAt.desc()),
    index("alert_analyses_created_idx").on(table.createdAt.desc()),
  ],
);
