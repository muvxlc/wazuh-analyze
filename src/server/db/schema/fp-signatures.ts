import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { users } from "./users";

// FP (false-positive) memory: analyst-created signature rows that, when matched
// against an incoming alert, soft-suppress downstream IR/notify (never hide the
// alert). Signature key = (ruleId, agentId, level) — NEVER includes srcip
// (privacy + noise: srcip fractures signatures). Severity floor + expiry are
// enforced structurally; see src/server/fp/check.ts.
export const fpSignatures = pgTable(
  "fp_signatures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    signatureKey: text("signature_key").notNull(),
    // Stored for display/filter; the authoritative match key is signatureKey.
    ruleId: text("rule_id"),
    agentId: text("agent_id"),
    level: integer("level"),
    reason: text("reason"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Hard expiry — NOT NULL by design. Expired rows never match even if the
    // signature key matches. No auto-renew on match.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastMatchedAt: timestamp("last_matched_at", { withTimezone: true }),
    matchCount: integer("match_count").default(0).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
  },
  (table) => [
    uniqueIndex("fp_signatures_signature_key_idx").on(table.signatureKey),
    index("fp_signatures_expires_at_idx").on(table.expiresAt),
    index("fp_signatures_rule_agent_idx").on(table.ruleId, table.agentId),
  ],
);
