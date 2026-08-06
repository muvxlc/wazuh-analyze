import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Local IOC (indicator of compromise) cache for Threat Intel lookups.
 * Multi-source aggregation; each lookup writes a fresh merged row.
 * ponytail: TTL purge job + generated columns for indicator hashes when this table grows.
 */
export type IocType = "ip" | "hash" | "domain";

export const iocCache = pgTable(
  "ioc_cache",
  {
    indicator: text("indicator").primaryKey(),
    type: text("type").notNull(),
    abuseScore: doublePrecision("abuse_score"),
    abuseCategory: text("abuse_category"),
    pulseCount: integer("pulse_count"),
    sources: text("sources").array().default([]).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
    ttlDays: integer("ttl_days").default(30).notNull(),
  },
  (table) => [
    index("ioc_cache_indicator_type_idx").on(table.indicator, table.type),
    index("ioc_cache_fetched_idx").on(table.fetchedAt),
  ],
);

export type IocCacheRow = typeof iocCache.$inferSelect;
export type NewIocCacheRow = typeof iocCache.$inferInsert;
