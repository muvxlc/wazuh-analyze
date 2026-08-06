CREATE TABLE "alert_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"ai_connection_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"verdict" jsonb NOT NULL,
	"tokens_used" integer,
	"latency_ms" integer,
	"enrichments_used" text[] DEFAULT '{}' NOT NULL,
	"ioc_lookups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_analyses" ADD CONSTRAINT "alert_analyses_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_analyses" ADD CONSTRAINT "alert_analyses_ai_connection_id_ai_connections_id_fk" FOREIGN KEY ("ai_connection_id") REFERENCES "public"."ai_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_analyses" ADD CONSTRAINT "alert_analyses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_analyses_alert_created_idx" ON "alert_analyses" USING btree ("alert_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "alert_analyses_created_idx" ON "alert_analyses" USING btree ("created_at" DESC NULLS LAST);