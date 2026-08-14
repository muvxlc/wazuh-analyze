import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const aiConnectionProviderEnum = pgEnum("ai_connection_provider", ["lm_studio", "openai_compatible"]);

export const aiConnections = pgTable("ai_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  provider: aiConnectionProviderEnum("provider").notNull(),
  baseUrl: text("base_url").notNull(),
  model: text("model").notNull(),
  apiKey: jsonb("api_key"),
  timeoutMs: integer("timeout_ms").notNull().default(120_000),
  isDefault: boolean("is_default").notNull().default(false),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
