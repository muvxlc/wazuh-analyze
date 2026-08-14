import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export const sourceCoverageTypeEnum = pgEnum("source_coverage_type", [
  "deployment",
  "feed",
  "manual",
  "api",
]);

export const sourceCoverage = pgTable(
  "source_coverage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Unique identifier for this source (e.g. "wazuh-central" or "feed-1001"). */
    sourceKey: text("source_key").notNull(),
    /** How this source is provisioned. */
    sourceType: sourceCoverageTypeEnum("source_type").notNull(),
    /** Endpoint URL — may contain host+port but MUST NOT contain secrets/tokens. */
    endpoint: text("endpoint"),
    /**
     * Non-secret descriptor of how credentials are provisioned (e.g. "api-key-in-env",
     * "iam-role", "tls-mutual"). Must never store the actual secret value.
     */
    credentialScope: text("credential_scope").notNull(),
    /** Whether this source is actively polled / ingested. */
    enabled: boolean("enabled").default(true).notNull(),
    /** Timestamp of the most recent successful ingestion cycle. */
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    /** Timestamp of the most recent event seen (success OR failure). */
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    /** Item count from the last successful sync. */
    itemCount: integer("item_count"),
    /** Cumulative parse errors from ingest cycles. */
    parseErrorCount: integer("parse_error_count").default(0).notNull(),
    /**
     * Expected freshness window in milliseconds. null = no SLA configured.
     * Validated on write: 0 <= x <= 86_400_000 (24h).
     */
    freshnessSlaMs: integer("freshness_sla_ms"),
    /** Schema / contract version the source claims to speak. */
    contractVersion: text("contract_version"),
    /** Most recent error message (truncated by service to 512 chars). */
    lastError: text("last_error"),
    /** When the row was last updated (maintained by service, not null). */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("source_coverage_key_idx").on(table.sourceKey),
    index("source_coverage_type_idx").on(table.sourceType),
    index("source_coverage_enabled_idx").on(table.enabled),
    index("source_coverage_freshness_idx").on(
      table.freshnessSlaMs,
      table.lastSuccessAt,
    ),
  ],
);
