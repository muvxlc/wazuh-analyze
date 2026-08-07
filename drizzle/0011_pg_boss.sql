-- pg-boss schema is created and managed by pg-boss itself (boss.start()).
-- This migration only documents it and ensures pgcrypto extension exists,
-- which pg-boss requires for gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS pgcrypto;
