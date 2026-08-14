import type { Pool } from "pg";

export const applicationTables = [
  "alert_events",
  "permission_overrides",
  "role_permission_overrides",
  "sessions",
  "invites",
  "audit_events",
  "alerts",
  "vulnerability_analyses",
  "ioc_cache",
  "fp_signatures",
  "queue_progress",
  "source_coverage",
  "evidence_records",
  "agent_snapshots",
  "agent_tags",
  "system_settings",
  "webhook_replay_keys",
  "users",
  "dead_letters",
] as const;

export async function resetTestDatabase(
  pool: Pool,
): Promise<void> {
  const connectionString = pool.options.connectionString;

  if (!connectionString) {
    throw new Error("Refusing to reset a database without an explicit URL");
  }

  const databaseName = new URL(connectionString).pathname.slice(1);

  if (!databaseName.includes("_test")) {
    throw new Error("Refusing to reset a database without _test in its name");
  }

  await pool.query(
    `TRUNCATE TABLE ${applicationTables.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );

  // Drop any test-only constraints left by prior tests (e.g. task3_rollback_test)
  await pool.query(
    `ALTER TABLE "audit_events" DROP CONSTRAINT IF EXISTS "task3_rollback_test"`,
  );

  // Ensure Phase 1 dead_letters table exists for tests (migration 0022 may not
  // yet be applied to the test DB; uses DO block for idempotent create).
  // No DROP TYPE CASCADE — it would drop dependent objects. CREATE TYPE only
  // if the enum does not exist yet.
  await pool.query(`
    DO $$ BEGIN
      CREATE TYPE "dead_letter_status" AS ENUM ('open', 'retrying', 'dead');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await pool.query(`
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
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "dead_letters_status_idx"
      ON "dead_letters" USING btree ("status");
    CREATE INDEX IF NOT EXISTS "dead_letters_source_idx"
      ON "dead_letters" USING btree ("source");
    CREATE INDEX IF NOT EXISTS "dead_letters_created_idx"
      ON "dead_letters" USING btree ("created_at" DESC NULLS LAST);
    CREATE INDEX IF NOT EXISTS "dead_letters_attempted_idx"
      ON "dead_letters" USING btree ("attempted_at" DESC NULLS LAST);
  `);
}
