-- T3.1: notification_channels + notification_rules + notification_deliveries
DO $$ BEGIN
  CREATE TYPE "notification_channel_type" AS ENUM('discord', 'telegram');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "notification_event_type" AS ENUM('alert.high_severity', 'incident.created', 'incident.escalated', 'verdict.confident_real');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "notification_delivery_status" AS ENUM('sent', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "type" "notification_channel_type" NOT NULL,
  "config" jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_by_user_id" uuid REFERENCES "public"."users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_type" "notification_event_type" NOT NULL,
  "severity_threshold" integer,
  "channel_id" uuid NOT NULL REFERENCES "public"."notification_channels"("id") ON DELETE cascade,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "rule_id" uuid REFERENCES "public"."notification_rules"("id") ON DELETE set null,
  "channel_id" uuid REFERENCES "public"."notification_channels"("id") ON DELETE cascade,
  "event_type" "notification_event_type" NOT NULL,
  "target_type" text,
  "target_id" text,
  "status" "notification_delivery_status" NOT NULL,
  "status_code" integer,
  "error" text,
  "attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_channels_enabled_idx" ON "notification_channels" ("enabled");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_rules_event_channel_idx" ON "notification_rules" ("event_type", "channel_id", "enabled");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_channel_attempted_idx" ON "notification_deliveries" ("channel_id", "attempted_at" DESC NULLS LAST);
