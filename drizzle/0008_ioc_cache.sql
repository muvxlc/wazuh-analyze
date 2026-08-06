CREATE TABLE IF NOT EXISTS "ioc_cache" (
  "indicator" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "abuse_score" double precision,
  "abuse_category" text,
  "pulse_count" integer,
  "sources" text[] DEFAULT '{}'::text[] NOT NULL,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ttl_days" integer DEFAULT 30 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ioc_cache_indicator_type_idx" ON "ioc_cache" USING btree ("indicator", "type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ioc_cache_fetched_idx" ON "ioc_cache" USING btree ("fetched_at");
