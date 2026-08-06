# Task 5 Integration Fix Report

**Date**: 2026-08-03
**Base**: e9ef0a3
**HEAD**: d83bc44
**Status**: DONE — fixes committed

## Changes Made

### 1. Alert Dedup Fix (alert-repository.ts)
- **Root cause**: Drizzle ORM wraps pg errors — `error.code` is `undefined` on the wrapper; the code lives on `error.cause.code`
- **Fix**: Check `error.cause?.code` for `23505` before falling back to dedup lookup by fingerprint
- **Files**: `src/server/alerts/alert-repository.ts`

### 2. Workflow Row Lock (workflow.ts)
- **Root cause**: C1 Critical — concurrent transitions could race on status check without row lock
- **Fix**: Added `.for("update").execute()` to the SELECT that fetches the alert for transition
- **Files**: `src/server/alerts/workflow.ts`

### 3. Test Cleanup — Constraint Leak (reset.ts)
- **Root cause**: `task3_rollback_test` CHECK constraint from Task 3's `administration-policy.integration.test.ts` persisted across test files because `TRUNCATE` does not drop constraints
- **Fix**: Added `ALTER TABLE "audit_events" DROP CONSTRAINT IF EXISTS "task3_rollback_test"` after TRUNCATE in `resetTestDatabase`
- **Files**: `src/test/postgres/reset.ts`

### 4. Query Test — Unique Email (query.integration.test.ts)
- **Root cause**: `beforeAll` and `beforeEach` both inserted users with the same `normalizedEmail`, causing unique constraint violations
- **Fix**: Added `Date.now()` suffix to email to ensure uniqueness per run
- **Files**: `src/server/alerts/query.integration.test.ts`

### 5. Retention Test — Seed Data (retention.integration.test.ts)
- **Root cause**: `seedOldAlerts` reused the same `evt-retention-${i}` IDs across calls, causing dedup collisions; "preserves newer" and "is safe" tests used `wazuhTimestamp`-based days but `ingestedAt` was always `NOW()`, so all alerts were expired
- **Fix**: Added unique prefix parameter to `seedOldAlerts`; rewrote "preserves newer" to insert fresh alerts directly with future `ingestedAt`; rewrote "is safe" to use a past cutoff date; imported `createAlertFingerprint` for direct inserts
- **Files**: `src/server/maintenance/retention.integration.test.ts`

## Test Results

| Suite | Before | After |
|-------|--------|-------|
| alert-service.integration | 1/3 pass | 3/3 pass |
| query.integration | 2/8 pass | 8/8 pass |
| workflow.integration | 1/6 pass | 6/6 pass |
| audit-service.integration | 0/3 pass | 3/3 pass |
| retention.integration | 1/4 pass | 4/4 pass |
| administration-policy.integration | 5/8 pass | 8/8 pass |
| invite-service.integration | 4/5 pass | 4/5 pass (1 pre-existing) |
| session.integration | 8/9 pass | 8/9 pass (1 pre-existing) |
| **Total** | 75/110 pass | 108/110 pass |

## Pre-existing Failures (Not Fixed — Were Failing Before e9ef0a3)

1. **`session.integration > rotateSession receives same tx — regression test`**: Test expects `transactionCalls.length === 2` but gets 1. This was failing at baseline (e9ef0a3).

2. **`invite-service.integration > rejects a already-used invite`**: Returns `invalid_invite` instead of `invite_already_used`. Was failing at baseline.

## Verification

- Unit tests: 58/58 PASS
- Lint: clean
- Typecheck: clean
- Build: clean
- Drizzle check/generate: clean
- Integration: 108/110 pass (2 pre-existing failures)
- Docker: `docker compose -f compose.test.yml up -d postgres` → healthy at localhost:55432
- Note: tmpfs means DB is empty after every fresh Docker start; migrations must run after each start

## Commit

- `d83bc44 fix: resolve Task 5 integration failures — dedup, query, workflow lock, retention seed, constraint leak`
