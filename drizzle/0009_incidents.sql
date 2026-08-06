-- T2.1: incidents + incident_alerts + incident_events
-- Applied via psql (npm run db:migrate hangs; journal stays at 0007 — ioc_cache 0008 same pattern).
DO $$ BEGIN
  CREATE TYPE "incident_status" AS ENUM('open', 'investigating', 'mitigated', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "status" "incident_status" DEFAULT 'open' NOT NULL,
  "severity" text DEFAULT 'medium' NOT NULL,
  "agent_id" text,
  "rule_id" text,
  "assignee_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "closed_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_alerts" (
  "incident_id" uuid NOT NULL,
  "alert_id" uuid NOT NULL,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "incident_id" uuid NOT NULL,
  "from_status" "incident_status",
  "to_status" "incident_status" NOT NULL,
  "actor_user_id" uuid,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "incidents" ADD CONSTRAINT "incidents_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "incident_alerts" ADD CONSTRAINT "incident_alerts_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "incident_alerts" ADD CONSTRAINT "incident_alerts_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "incident_alerts_unique_idx" ON "incident_alerts" USING btree ("incident_id","alert_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_alerts_incident_idx" ON "incident_alerts" USING btree ("incident_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_alerts_alert_idx" ON "incident_alerts" USING btree ("alert_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_events_incident_occurred_idx" ON "incident_events" USING btree ("incident_id","occurred_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_status_idx" ON "incidents" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_agent_idx" ON "incidents" USING btree ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_rule_idx" ON "incidents" USING btree ("rule_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_created_idx" ON "incidents" USING btree ("created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_correlator_idx" ON "incidents" USING btree ("agent_id","rule_id","status","created_at" DESC NULLS LAST);
