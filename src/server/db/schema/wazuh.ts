import {
  type AnyPgColumn,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export const webhookReplayKeys = pgTable(
  "webhook_replay_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    keyHash: text("key_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("webhook_replay_keys_key_hash_unique").on(table.keyHash),
    index("webhook_replay_keys_expires_at_idx").on(table.expiresAt),
  ],
);

export const agentSnapshots = pgTable(
  "agent_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
    agents: jsonb("agents").notNull(),
    sourceMetadata: jsonb("source_metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("agent_snapshots_synced_at_idx").on(table.syncedAt.desc())],
);

export const agentTags = pgTable(
  "agent_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: text("agent_id").notNull(),
    tag: text("tag").notNull(),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agent_tags_agent_tag_unique").on(table.agentId, table.tag),
    index("agent_tags_agent_id_idx").on(table.agentId),
    index("agent_tags_tag_idx").on(table.tag),
  ],
);
