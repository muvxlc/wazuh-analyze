# Task 5 Integration Review Report

**Date**: 2026-08-03
**Range**: 843c3b5..e9ef0a3
**HEAD**: e9ef0a3
**Verdict**: NOT APPROVED

## Summary

Integration suite run after Docker PostgreSQL startup. PostgreSQL healthy at localhost:55432, tmpfs means DB is empty after every fresh start — migrations must run after each `docker compose up`. No auto-start/migrate script exists.

Integration results: **39 failed / 13 passed** (52 total)

## Integration Failures

### 1. Alert Dedup (alert-service.integration.test.ts)
- `persistAlert` returns `inserted=true` for duplicate wazuh event id (expected `false`)
- `persistAlert` returns `inserted=true` for duplicate fingerprint (expected `false`)
- **Root cause**: dedup logic not enforced in repository layer

### 2. Query Contract Deviations (query.integration.test.ts)
- `listAlerts` returns 2 alerts instead of 5, unsorted
- `limit` validation returns 0 results (expected 1)
- `search` by normalized description returns 0 (expected >0)
- `search` by agent fields returns 0 (expected >0)
- `cursor` pagination returns 0 (expected 2)
- `status` filter hits deadlock on `resetTestDatabase`
- **Root cause**: plan contract deviations — AlertListQuery sorting/ordering not enforced

### 3. Workflow FK Violations (workflow.integration.test.ts)
- All transition tests fail with "alert not found"
- SQL: `update "alerts" set "status" = $1, "acknowledged_at" = $2, "acknowledged_by_user_id" = $3`
- **Root cause**: transition uses random `user_id` that does not exist in test DB; `acknowledged_by_user_id` must reference seeded user

### 4. Audit FK Violations (audit-service.integration.test.ts)
- `writeAuditEvent` fails with FK violation on `actor_user_id`
- Params show empty `actor_user_id`
- **Root cause**: same — empty/non-existent user_id in test setup

### 5. Invite FK Violations (invite-service.integration.test.ts)
- `createInvite` fails with FK violation on `created_by_user_id`
- **Root cause**: same — referenced user not seeded in test DB

### 6. Retention Failures (retention.integration.test.ts)
- `deletes alerts older than cutoff` fails: expected result >0, got 0
- `preserves alerts newer than cutoff` fails: expected 3, got 0
- `respects batchSize limit` fails: expected 7 remaining, got 6
- **Root cause**: seed data not persisted to DB (0 alerts in DB when retention runs)

## Security Findings

### C1 Critical — Concurrent Transition Idempotency Gap
- **File**: `src/server/alerts/workflow.ts`
- **Issue**: Missing row lock before status check — concurrent transitions can race and create duplicate `alert_event` rows
- **Fix**: Add `FOR UPDATE` lock on alert row before checking status for idempotency

## Researcher Findings

### Plan Contract Deviations
1. **AlertListQuery**: sorting and ordering not enforced per plan spec
2. **Permission**: override contract deviation from plan
3. **Missing test**: session-cleanup integration test not present

## Environment Notes

- Docker PostgreSQL: `docker compose -f compose.test.yml up -d postgres` → healthy at localhost:55432
- tmpfs volume means DB is empty after every fresh container start
- Migrations must run manually after each start: `DATABASE_URL=postgresql://postgres:postgres@localhost:55432/wazuh_dashboard_test npm run db:migrate`
- No auto-start/migrate script exists
- Unit tests: 58/58 PASS
- Lint/typecheck/build/Drizzle check: all clean

## Next Action

Dispatch @nextjs-dev to fix:
1. Alert dedup logic in repository layer
2. Query contract enforcement (sorting, ordering, search, limit, cursor)
3. Test DB seeding for workflow/audit/invite FK violations (ensure users exist before alerts)
4. Retention seed data persistence
5. Row lock in workflow.ts for C1 Critical
6. Add session-cleanup integration test
