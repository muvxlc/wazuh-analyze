-- Step 1: add column nullable — safe for existing databases with rows
ALTER TABLE "sessions" ADD COLUMN "absolute_expires_at" timestamp with time zone;

-- Step 2: backfill existing sessions with a defensible absolute expiry.
-- Use LEAST(expires_at, created_at + INTERVAL '7 days') so:
--   - sessions already near idle expiry get absolute bound at their idle expiry
--   - fresh sessions get a full 7-day absolute cap from creation
-- This preserves current session semantics without silently extending or truncating.
UPDATE "sessions"
SET "absolute_expires_at" = LEAST("expires_at", "created_at" + INTERVAL '7 days')
WHERE "absolute_expires_at" IS NULL;

-- Step 3: enforce NOT NULL after backfill is complete
ALTER TABLE "sessions" ALTER COLUMN "absolute_expires_at" SET NOT NULL;

CREATE INDEX "sessions_absolute_expires_at_idx" ON "sessions" USING btree ("absolute_expires_at");