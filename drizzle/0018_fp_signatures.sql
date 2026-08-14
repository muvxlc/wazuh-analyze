-- FP (false-positive) memory signatures.
-- Source of truth for prod apply via docker psql (npm run db:migrate hangs;
-- see memory drizzle-migrate-hang). Mirrors src/server/db/schema/fp-signatures.ts.
-- Safety invariants encoded here:
--   * expires_at NOT NULL — expired rows never match, no auto-renew.
--   * signature_key UNIQUE — one live row per (ruleId, agentId, level) tuple.
--   * enabled DEFAULT true — disabled rows skipped by checkFpMatch WHERE clause.
-- srcip is deliberately NOT part of the signature (privacy + noise reduction).
CREATE TABLE IF NOT EXISTS "fp_signatures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "signature_key" text NOT NULL,
  "rule_id" text,
  "agent_id" text,
  "level" integer,
  "reason" text,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "last_matched_at" timestamptz,
  "match_count" integer DEFAULT 0 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "fp_signatures_signature_key_idx" ON "fp_signatures" USING btree ("signature_key");
CREATE INDEX IF NOT EXISTS "fp_signatures_expires_at_idx" ON "fp_signatures" USING btree ("expires_at");
CREATE INDEX IF NOT EXISTS "fp_signatures_rule_agent_idx" ON "fp_signatures" USING btree ("rule_id","agent_id");
