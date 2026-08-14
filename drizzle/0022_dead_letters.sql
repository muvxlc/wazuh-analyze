-- 0022: dead_letters — Replay/Dead-Letter queue for Phase 1.
-- Applied via docker psql (npm run db:migrate hangs; see memory drizzle-migrate-hang).
-- No journal edit — matches convention used by 0008+ migrations.
--
-- Safety invariants:
--   * raw_payload bounded to 64 KB via pg_column_size CHECK.
--   * error_reason bounded to 1024 chars; text column bounded to 200 chars.
--   * Idempotent: DO blocks wrap type/index/table creation so re-applying is safe.

DO $$ BEGIN
  CREATE TYPE "dead_letter_status" AS ENUM ('open', 'retrying', 'dead');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dead_letters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source" text NOT NULL,
  "text" text NOT NULL,
  "raw_payload" jsonb NOT NULL,
  "error_reason" text NOT NULL,
  "attempted_at" timestamp with time zone NOT NULL,
  "retried_at" timestamp with time zone,
  "last_error" text,
  "status" "dead_letter_status" DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dead_letters_raw_payload_size_check"
    CHECK (pg_column_size("dead_letters"."raw_payload") <= 65536)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dead_letters_status_idx"
  ON "dead_letters" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dead_letters_source_idx"
  ON "dead_letters" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dead_letters_created_idx"
  ON "dead_letters" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dead_letters_attempted_idx"
  ON "dead_letters" USING btree ("attempted_at" DESC NULLS LAST);
