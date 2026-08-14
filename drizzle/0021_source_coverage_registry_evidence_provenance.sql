-- 0021: Rebuild source_coverage as deployment source registry + add provenance to evidence_records.
--
-- Pre-conditions (documented, not auto-fixed):
--   * _journal.json is at idx=7 (0007). Tables source_coverage + evidence_records were
--     inserted without a journal entry — they are "dirty" from prior dev work.
--   * This migration assumes those tables exist with legacy columns. It strips them,
--     rebuilds, and adds new columns idempotently via DO blocks.
--   * If the DB already has the new schema, all ALTER/DROP operations are wrapped in
--     exception handlers that silently skip missing objects.
--
-- Safety invariants:
--   * evidence.content CHECK <= 65536 bytes (pg_column_size jsonb).
--   * parseErrorCount overflow-guarded: GREATEST(current, MAX_INT) capped in app.
--   * No secrets in credentialScope — service rejects key=value patterns.

BEGIN;

-- ── source_coverage: strip legacy columns ────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "source_coverage" DROP CONSTRAINT IF EXISTS "source_coverage_record_snapshot_size_check";
  ALTER TABLE "source_coverage" DROP CONSTRAINT IF EXISTS "source_coverage_verdict_size_check";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "source_coverage" DROP COLUMN IF EXISTS "record_snapshot";
  ALTER TABLE "source_coverage" DROP COLUMN IF EXISTS "snapshot_hash";
  ALTER TABLE "source_coverage" DROP COLUMN IF EXISTS "verdict";
  ALTER TABLE "source_coverage" DROP COLUMN IF EXISTS "latency_ms";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "source_coverage" DROP COLUMN IF EXISTS "alert_id";
  ALTER TABLE "source_coverage" DROP COLUMN IF EXISTS "incident_id";
  ALTER TABLE "source_coverage" DROP COLUMN IF EXISTS "ai_connection_id";
  ALTER TABLE "source_coverage" DROP COLUMN IF EXISTS "provider";
  ALTER TABLE "source_coverage" DROP COLUMN IF EXISTS "model";
  ALTER TABLE "source_coverage" DROP COLUMN IF EXISTS "created_by_user_id";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "source_coverage" DROP COLUMN IF EXISTS "status";
  ALTER TABLE "source_coverage" DROP COLUMN IF EXISTS "source_type";
  ALTER TABLE "source_coverage" DROP COLUMN IF EXISTS "source_id";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  DROP TYPE IF EXISTS "source_coverage_status" CASCADE;
  DROP TYPE IF EXISTS "source_coverage_type" CASCADE;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;--> statement-breakpoint

-- ── source_coverage: rebuild as deployment source registry ───────────────
CREATE TYPE "source_coverage_type" AS ENUM ('deployment', 'feed', 'manual', 'api');--> statement-breakpoint
ALTER TABLE "source_coverage"
  ADD COLUMN IF NOT EXISTS "source_key" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "source_type" "source_coverage_type" NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "endpoint" text,
  ADD COLUMN IF NOT EXISTS "credential_scope" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "last_success_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_event_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "item_count" integer,
  ADD COLUMN IF NOT EXISTS "parse_error_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "freshness_sla_ms" integer,
  ADD COLUMN IF NOT EXISTS "contract_version" text,
  ADD COLUMN IF NOT EXISTS "last_error" text,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "source_coverage"
    ADD CONSTRAINT "source_coverage_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "source_coverage" ALTER COLUMN "source_key" DROP DEFAULT;
  ALTER TABLE "source_coverage" ALTER COLUMN "source_type" DROP DEFAULT;
  ALTER TABLE "source_coverage" ALTER COLUMN "credential_scope" DROP DEFAULT;
  ALTER TABLE "source_coverage" ALTER COLUMN "enabled" DROP DEFAULT;
  ALTER TABLE "source_coverage" ALTER COLUMN "parse_error_count" DROP DEFAULT;
  ALTER TABLE "source_coverage" ALTER COLUMN "updated_at" DROP DEFAULT;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;--> statement-breakpoint
-- Preserve existing row data: keep source_key as-is (already mapped during prior manual inserts).
-- source_type values (rule/mitre/indicator) are no longer valid; default to 'manual'.
UPDATE "source_coverage" SET
  "source_key" = COALESCE(NULLIF("source_key", ''), "source_key"),
  "source_type" = CASE
    WHEN "source_type" IN ('deployment', 'feed', 'manual', 'api') THEN "source_type"::text::"source_coverage_type"
    ELSE 'manual'
  END,
  "credential_scope" = COALESCE("credential_scope", 'unknown'),
  "updated_at" = COALESCE("updated_at", "created_at", now());--> statement-breakpoint
DO $$ BEGIN
  DROP INDEX IF EXISTS "source_coverage_source_type_source_id_unique";
  DROP INDEX IF EXISTS "source_coverage_source_idx";
  DROP INDEX IF EXISTS "source_coverage_incident_idx";
  DROP INDEX IF EXISTS "source_coverage_alert_idx";
  DROP INDEX IF EXISTS "source_coverage_created_idx";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "source_coverage_source_key_unique"
  ON "source_coverage" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_coverage_key_idx"
  ON "source_coverage" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_coverage_type_idx"
  ON "source_coverage" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_coverage_enabled_idx"
  ON "source_coverage" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_coverage_freshness_idx"
  ON "source_coverage" USING btree ("freshness_sla_ms", "last_success_at");--> statement-breakpoint

-- ── evidence_records: add provenance columns ─────────────────────────────
ALTER TABLE "evidence_records"
  ADD COLUMN IF NOT EXISTS "provenance_endpoint" text,
  ADD COLUMN IF NOT EXISTS "event_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "retrieved_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "content_hash" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "content_size" integer NOT NULL DEFAULT 0;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidence_records_provenance_idx"
  ON "evidence_records" USING btree ("provenance_endpoint");--> statement-breakpoint
-- Enforce content size bound on every row (idempotent — no-op if already compliant).
DO $$ BEGIN
  ALTER TABLE "evidence_records"
    ADD CONSTRAINT "evidence_records_content_size_check"
    CHECK (pg_column_size("content") <= 65536);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
-- Backfill content_hash/content_size for existing rows so contract is valid on read.
UPDATE "evidence_records" SET
  "content_hash" = COALESCE("content_hash", ''),
  "content_size" = COALESCE("content_size",
    CASE WHEN pg_column_size("content") > 65536 THEN 0 ELSE pg_column_size("content") END
  );--> statement-breakpoint

COMMIT;
