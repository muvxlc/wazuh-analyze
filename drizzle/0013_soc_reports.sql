DO $$ BEGIN
  CREATE TYPE "report_status" AS ENUM('scheduled', 'running', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "incident_id" uuid NOT NULL REFERENCES "public"."incidents"("id") ON DELETE cascade,
  "author_user_id" uuid REFERENCES "public"."users"("id") ON DELETE set null,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "schedule" text NOT NULL,
  "channel" text,
  "last_run_at" timestamp with time zone,
  "next_run_at" timestamp with time zone,
  "status" "report_status" DEFAULT 'scheduled' NOT NULL,
  "created_by_user_id" uuid REFERENCES "public"."users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_notes_incident_idx" ON "case_notes" ("incident_id", "created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_status_idx" ON "reports" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_next_run_idx" ON "reports" ("next_run_at");
