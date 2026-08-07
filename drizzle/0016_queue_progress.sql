CREATE TABLE IF NOT EXISTS "queue_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue_name" text NOT NULL,
	"entity_id" text NOT NULL,
	"job_id" text,
	"phase" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"detail" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "queue_progress_entity_idx" ON "queue_progress" USING btree ("queue_name","entity_id");
