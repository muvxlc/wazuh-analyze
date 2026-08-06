CREATE TYPE "public"."ai_connection_provider" AS ENUM('lm_studio', 'openai_compatible');--> statement-breakpoint
CREATE TABLE "ai_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" "ai_connection_provider" NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"api_key" jsonb,
	"timeout_ms" integer DEFAULT 30000 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_connections" ADD CONSTRAINT "ai_connections_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_connections" ADD CONSTRAINT "ai_connections_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_connections_is_default_idx" ON "ai_connections" USING btree ("is_default");--> statement-breakpoint
CREATE INDEX "ai_connections_updated_at_idx" ON "ai_connections" USING btree ("updated_at");
