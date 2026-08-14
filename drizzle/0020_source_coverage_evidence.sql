-- Source coverage: tracks per-source (rule/mitre/indicator) analysis outcomes.
-- Mirrors src/server/db/schema/source-coverage.ts.
-- Safety invariants:
--   * status enum (pending/analyzed/ignored) — append-only semantics via service.
--   * bounded JSONB — record_snapshot + verdict capped at 64KB via CHECK.
--   * FK set null — deleting alert/incident/AI connection never drops coverage history.
-- Applied via docker psql (npm run db:migrate hangs; see memory drizzle-migrate-hang).
CREATE TYPE "source_coverage_type" AS ENUM ('rule', 'mitre', 'indicator');--> statement-breakpoint
CREATE TYPE "source_coverage_status" AS ENUM ('pending', 'analyzed', 'ignored');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_coverage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_id" text NOT NULL,
  "source_type" "source_coverage_type" NOT NULL,
  "alert_id" uuid,
  "incident_id" uuid,
  "ai_connection_id" uuid,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "status" "source_coverage_status" DEFAULT 'pending' NOT NULL,
  "record_snapshot" jsonb NOT NULL,
  "snapshot_hash" text NOT NULL,
  "verdict" jsonb NOT NULL,
  "latency_ms" integer,
  "created_by_user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "source_coverage_record_snapshot_size_check"
    CHECK (pg_column_size("source_coverage"."record_snapshot") <= 65536),
  CONSTRAINT "source_coverage_verdict_size_check"
    CHECK (pg_column_size("source_coverage"."verdict") <= 65536)
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "source_coverage"
    ADD CONSTRAINT "source_coverage_alert_id_alerts_id_fk"
    FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "source_coverage"
    ADD CONSTRAINT "source_coverage_incident_id_incidents_id_fk"
    FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "source_coverage"
    ADD CONSTRAINT "source_coverage_ai_connection_id_ai_connections_id_fk"
    FOREIGN KEY ("ai_connection_id") REFERENCES "public"."ai_connections"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "source_coverage"
    ADD CONSTRAINT "source_coverage_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "source_coverage_source_type_source_id_unique"
  ON "source_coverage" USING btree ("source_type", "source_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_coverage_incident_idx"
  ON "source_coverage" USING btree ("incident_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_coverage_alert_idx"
  ON "source_coverage" USING btree ("alert_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_coverage_created_idx"
  ON "source_coverage" USING btree ("created_at" DESC);
--> statement-breakpoint
-- Evidence records: collected proof items tied to alerts or incidents.
-- Mirrors src/server/db/schema/evidence-records.ts.
CREATE TYPE "evidence_type" AS ENUM ('ioc', 'log', 'note', 'network', 'threat_intel');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidence_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "alert_id" uuid,
  "incident_id" uuid,
  "evidence_type" "evidence_type" NOT NULL,
  "title" text NOT NULL,
  "content" jsonb NOT NULL,
  "collected_from" text,
  "validated" boolean DEFAULT false NOT NULL,
  "validated_by_user_id" uuid,
  "validated_at" timestamptz,
  "created_by_user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "evidence_records"
    ADD CONSTRAINT "evidence_records_alert_id_alerts_id_fk"
    FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "evidence_records"
    ADD CONSTRAINT "evidence_records_incident_id_incidents_id_fk"
    FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "evidence_records"
    ADD CONSTRAINT "evidence_records_validated_by_user_id_users_id_fk"
    FOREIGN KEY ("validated_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "evidence_records"
    ADD CONSTRAINT "evidence_records_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidence_records_alert_idx"
  ON "evidence_records" USING btree ("alert_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidence_records_incident_idx"
  ON "evidence_records" USING btree ("incident_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidence_records_type_idx"
  ON "evidence_records" USING btree ("evidence_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidence_records_created_idx"
  ON "evidence_records" USING btree ("created_at" DESC);
