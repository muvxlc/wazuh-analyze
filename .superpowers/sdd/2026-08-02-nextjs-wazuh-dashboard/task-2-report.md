# Task 2 Report

Status: `COMPLETE`

## Summary

Implemented PostgreSQL persistence foundation for Task 3+ with Drizzle schema exports, generated initial migration, node-postgres database contracts, Docker Compose test PostgreSQL, guarded reset helpers, and focused integration coverage.

Legacy paths remain unchanged. Task 1 contracts remain unchanged.

## Implemented Artifacts

- PostgreSQL 17 test service in `compose.test.yml` using dedicated `wazuh_dashboard_test` database and tmpfs storage.
- `Database`, `DatabaseTransaction`, and `createDatabase(connectionString)` using Drizzle `NodePgDatabase` and `pg.Pool`.
- PostgreSQL enums: `role`, `locale`, `override_effect`, and `alert_status`.
- Tables: `users`, `sessions`, `invites`, `permission_overrides`, `alerts`, `alert_events`, `webhook_replay_keys`, `agent_snapshots`, `audit_events`, and `system_settings`.
- UUID primary keys, timezone-aware timestamps, foreign keys, unique constraints, operational indexes, JSONB forensic/detail fields, and alert array metadata.
- Required named indexes, including partial Wazuh event identity uniqueness and stable descending alert cursor ordering.
- Isolated integration pool and guarded reset helper. Reset reads the pool's actual connection URL and refuses any database name without `_test`.
- Drizzle migration `drizzle/0000_initial.sql`, snapshot, and journal metadata.

## TDD Evidence

Initial focused test run before migration:

```text
npm run test:integration -- src/server/db/schema.integration.test.ts
Test Files  1 failed (1)
Tests       5 failed | 1 passed (6)
error: relation "alert_events" does not exist
```

This established the required RED state against a running, empty PostgreSQL database. The reset safety test passed independently.

After schema and migration implementation:

```text
Test Files  1 passed (1)
Tests       6 passed (6)
```

Coverage proves table and enum presence, normalized email uniqueness, both alert deduplication identities, required indexes through `pg_indexes`, timezone-aware timestamp columns, and destructive reset refusal for non-test database names.

## Migration Safety

A fresh database was created by removing and recreating the tmpfs PostgreSQL container. `db:check` and first migration passed. The focused integration suite passed. A second migration also passed, and `drizzle.__drizzle_migrations` remained exactly one row, proving migration journal idempotency.

## Verification Evidence

| Command | Result |
| --- | --- |
| `docker compose -f compose.test.yml down && docker compose -f compose.test.yml up -d postgres` | PASS, fresh healthy PostgreSQL 17 container |
| `DATABASE_URL=postgresql://postgres:postgres@localhost:55432/wazuh_dashboard_test npm run db:check` | PASS |
| First `npm run db:migrate` | PASS |
| `npm run test:integration -- src/server/db/schema.integration.test.ts` | PASS, 1 file / 6 tests |
| Second `npm run db:migrate` | PASS, migration journal remained 1 row |
| `npm test` | PASS, 4 files / 26 tests |
| `npm run lint` | PASS, no findings |
| `npm run typecheck` | PASS |
| `npm run build` | PASS, Next.js 16.2.12 production build |
| `npm ls --depth=0` | PASS, no dependency-tree errors |
| `git diff --check` | PASS |

## Concerns

- Task 2 brief requires `NodePgDatabase` and `Pool`, but Task 1 dependencies included only the `postgres` driver. Added exact `pg@8.16.3` and `@types/pg@8.15.5`; no Task 1 interface changed.
- Existing `npm audit` state remains 8 transitive findings: 5 moderate and 3 high. No automatic audit fix applied because it would alter pinned foundation dependencies.
