CREATE TABLE "agent_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"tag" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tags_agent_tag_unique" ON "agent_tags" USING btree ("agent_id","tag");--> statement-breakpoint
CREATE INDEX "agent_tags_agent_id_idx" ON "agent_tags" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_tags_tag_idx" ON "agent_tags" USING btree ("tag");--> statement-breakpoint
ALTER TABLE "agent_tags" ADD CONSTRAINT "agent_tags_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
