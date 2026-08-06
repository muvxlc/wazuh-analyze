DO $$ BEGIN
  CREATE TYPE "action_status" AS ENUM('proposed', 'approved', 'executed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "action_approval_decision" AS ENUM('approve', 'reject');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "incident_id" uuid NOT NULL REFERENCES "public"."incidents"("id") ON DELETE cascade,
  "status" "action_status" DEFAULT 'proposed' NOT NULL,
  "command" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "reason" text NOT NULL,
  "proposed_by_user_id" uuid REFERENCES "public"."users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "action_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action_id" uuid NOT NULL REFERENCES "public"."actions"("id") ON DELETE cascade,
  "approver_user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE restrict,
  "decision" "action_approval_decision" NOT NULL,
  "note" text,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "actions_incident_idx" ON "actions" ("incident_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "actions_status_idx" ON "actions" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_approvals_action_idx" ON "action_approvals" ("action_id");
