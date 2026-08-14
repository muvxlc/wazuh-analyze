import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { alerts } from "./alerts";
import { incidents } from "./incidents";
import { users } from "./users";

/** Allowlisted evidence types. */
export const evidenceTypeEnum = pgEnum("evidence_type", [
  "ioc",
  "log",
  "note",
  "network",
  "threat_intel",
]);

/** Max JSON content size — hard bound enforced at both DB and app layer. */
const MAX_CONTENT_BYTES = 65_536;

export const evidenceRecords = pgTable(
  "evidence_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    alertId: uuid("alert_id").references(() => alerts.id, {
      onDelete: "set null",
    }),
    incidentId: uuid("incident_id").references(() => incidents.id, {
      onDelete: "set null",
    }),
    evidenceType: evidenceTypeEnum("evidence_type").notNull(),
    title: text("title").notNull(),
    /** Bounded allowlisted/redacted JSON content. Max 65536 bytes enforced by CHECK + app. */
    content: jsonb("content").notNull(),
    /** Source endpoint this evidence was retrieved from (e.g. "https://api.example.com"). */
    provenanceEndpoint: text("provenance_endpoint"),
    /** Event timestamp — when the source event occurred (ISO string or null). */
    eventAt: timestamp("event_at", { withTimezone: true }),
    /** Retrieval timestamp — when this record was collected (auto-set on create). */
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    /** SHA-256 hex of the canonical JSON content for integrity verification. */
    contentHash: text("content_hash").notNull(),
    /** Byte size of the stored content JSON for audit/billing. */
    contentSize: integer("content_size").notNull(),
    validated: boolean("validated").default(false).notNull(),
    validatedByUserId: uuid("validated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("evidence_records_alert_idx").on(table.alertId),
    index("evidence_records_incident_idx").on(table.incidentId),
    index("evidence_records_type_idx").on(table.evidenceType),
    index("evidence_records_created_idx").on(table.createdAt.desc()),
    index("evidence_records_provenance_idx").on(table.provenanceEndpoint),
    sql`CHECK (pg_column_size(${table.content}) <= ${sql.raw(String(MAX_CONTENT_BYTES))})`,
  ],
);
