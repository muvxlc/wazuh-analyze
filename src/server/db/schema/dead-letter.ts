import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  index,
  uuid,
} from "drizzle-orm/pg-core";

// ponytail: status enum expanded to "retrying"/"dead" when daemon + DLQ worker are built (Phase 2).
export const deadLetterStatusEnum = pgEnum("dead_letter_status", [
  "open",
  "retrying",
  "dead",
]);

export const deadLetters = pgTable(
  "dead_letters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Source system — e.g. 'wazuh_webhook' or 'indexer_replay'. */
    source: text("source").notNull(),
    /** Human-readable summary of what was attempted. Max 200 chars. */
    text: text("text").notNull(),
    /** Raw payload that caused the failure, bounded to 64 KB by CHECK. */
    rawPayload: jsonb("raw_payload").notNull(),
    /** First error reason captured at insertion time. Max 1024 chars. */
    errorReason: text("error_reason").notNull(),
    /** When the original attempt failed. */
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
    /** When this row was last retried (null until first retry). */
    retriedAt: timestamp("retried_at", { withTimezone: true }),
    /** Most recent error on retry; overwritten on each retry attempt. */
    lastError: text("last_error"),
    /** Current lifecycle status. Defaults to 'open'. */
    status: deadLetterStatusEnum("status").default("open").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("dead_letters_status_idx").on(table.status),
    index("dead_letters_source_idx").on(table.source),
    index("dead_letters_created_idx").on(table.createdAt.desc()),
    index("dead_letters_attempted_idx").on(table.attemptedAt.desc()),
  ],
);
