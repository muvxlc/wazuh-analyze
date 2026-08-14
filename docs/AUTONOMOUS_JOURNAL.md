# Autonomous Execution Journal

Append-only log. After every task/checkpoint, document state + next step so any agent can resume.

---
## Session Start — 2026-08-06 (soc-phase-5)
**Current state:** Phase 5 (Auto-analyze daemon) implemented on `feature/soc-phase-5`. Unit 315 green. Integration gate pending.
**Next:** Task 1 in `wazuh-soc-ai-goal.md` (run integration gate → cleanup → merge).

---
## Task 1 — 2026-08-07 (mainline integration & cleanup)
**Done:**
1. Integration gate: `npx vitest run --maxWorkers=1` → 420 passed | 2 skipped (78 files). GREEN.
2. Cleanup `permissions.ts`: `ActorContext.userId` now `string | null` (was `string`, cast via `null as any` in `runner.ts`). TS-cast `as unknown as any` → `as any` in 2 incident-status `t(...)` calls. tsc clean, lint clean.
3. Pushed `feature/soc-phase-5` to origin. Opened PR #2 (base `main`): https://github.com/muvxlc/wazuh-analyze/pull/2

**Baseline:** Unit 315 | Integration 105 (420 total − 315 unit). Both green.
**Commit:** c378c8a `refactor: use string | null for ActorContext.userId`.
**Trade-offs:** Goal said "merge into main and push." Chose PR over direct push-to-main (outward-facing, hard to reverse). Fork origin = `muvxlc/wazuh-analyze`. Merge decision deferred to user.
**Blocker:** Merge of PR #2 into `main` is user-gated (irreversible). Tasks 2-5 branch off `main`.
**Next:** Await merge decision; meanwhile prep Task 2 (pg-boss) on a branch from current `feature/soc-phase-5` HEAD once main is updated, or proceed additive.

---
## Task 2 — 2026-08-07 (pg-boss background jobs)
**Done:**
1. `npm install pg-boss`.
2. Migration `drizzle/0011_pg_boss.sql`: pgcrypto extension + documents pg-boss manages own `boss` schema via `boss.start()`.
3. `src/instrumentation.ts` now starts pg-boss worker (`startWorker`) instead of in-memory daemon.
4. New `src/server/daemon/{pg-boss.ts,queue.ts,worker.ts}`. Removed `runner.ts`, `analyzer-job.ts`, `analyzer-job.test.ts`.
5. Refactored `analyzeBacklog` (Phase 5.1) → `enqueueAlertAnalysis` (queue `analyze-alert`); `dispatchNotificationBackground` (Phase 3) → `enqueueNotification` (queue `dispatch-notification`). Callers: alerts ingest route, analyze-service, correlator.
6. Retry: `retryLimit` + `retryBackoff: true` + `retryDelay` per queue. Idempotency via `singletonKey`/`singletonSeconds` + `expireInSeconds`.

**Baseline:** Unit 311 (was 315; −4 from removed analyzer-job.test.ts) | Integration 105. Total 416 passed | 2 skipped. GREEN.
**Trade-offs:** pg-boss auto-creates `boss` schema on first `start()`; migration only adds pgcrypto + documents. Old `dispatchNotificationBackground` removed (breaking for any external caller — none in repo).
**Next:** Task 3 (vuln inventory via ES indexer) on a new branch.

---
## Task 3 — 2026-08-07 (vuln inventory via indexer)
**Done:**
1. `src/server/wazuh/indexer.ts`: `fetchAgentVulnerabilities()` — POST to `wazuh-states-vulnerabilities-*/_search` on ES/Opensearch (Wazuh indexer). Basic auth, undici Agent TLS options, 10s timeout, swallows errors → `[]`.
2. `src/server/config.ts` + `src/server/wazuh/types.ts`: optional `WAZUH_INDEXER_URL` / `WAZUH_INDEXER_USERNAME` / `WAZUH_INDEXER_PASSWORD`; falls back to REST API creds. `WazuhConfig.indexer` optional.
3. `src/server/enrichment/context-builder.ts` + `recipe.ts`: new `vulnerabilities` EnrichmentKey, triggered on `vulnerability`/`cve`/syscollector keywords. Per-section cap `VULNERABILITY_BUDGET_BYTES = 3_000`, critical-severity CVEs prioritized.

**Baseline:** Unit 311 | Integration 105. Total 416 | 2 skipped. GREEN.
**Trade-offs:** No live indexer to validate query shape — followed standard wazuh-states-vulnerabilities mapping (agent.id, vulnerability.*). Empty fallback when indexer unset keeps enrichment optional.
**Next:** Task 4 (approval-gated actions).

---
## Task 4 — 2026-08-07 (approval-gated active-response actions)
**Done:**
1. Schema `actions` + `action_approvals`, migration `drizzle/0012_actions.sql`; states proposed/approved/executed/rejected.
2. Permissions `actions.propose`, `actions.approve`, `actions.execute`; defaults: super_admin all, admin propose+approve.
3. `action-service.ts`: propose, approve/reject, list, approved fetch, executed marking; audit events.
4. `action-executor.ts`: calls Wazuh `PUT /active-response` via new `wazuhPut` helper.
5. pg-boss `execute-action` queue; approval route enqueues only after approval; retry/backoff + singleton dedupe.
6. APIs: `GET/POST /api/incidents/[id]/actions`, `PATCH /api/incidents/[id]/actions/[actionId]` with CSRF/auth/Zod.
7. UI: `IncidentActions` cards in Incident Detail with Approve/Reject.

**Baseline:** Unit 311 | Integration 105. Unit GREEN 311 passed. tsc GREEN. lint GREEN. Drizzle check GREEN.
**Trade-offs:** Active-response payload maps `payload.agents` + `payload.arguments`; defaults agents to manager `000` if omitted. No live Wazuh execution test (requires authorized Wazuh instance).
**Next:** Task 5 (scheduled reports + case management).

---
## Task 5 — 2026-08-07 (scheduled reports + case management)
**Done:**
1. Schema: `case_notes` (incident thread) + `reports` (scheduled jobs). Migrations `drizzle/0013_soc_reports.sql`, `0014_report_events.sql` (adds `report.weekly` to notification_event_type).
2. `src/server/cases/note-service.ts`: list/add case notes. `GET/POST /api/incidents/[id]/notes` with CSRF/auth/Zod.
3. UI: `IncidentNotes` thread composer rendered in Incident Detail.
4. `src/server/reports/report-job.ts`: `runWeeklyReport()` aggregates 7-day `getSocMetrics` (MTTD/MTTR/FP-rate/backlog/top-agent) → `enqueueNotification({ type: "report.weekly" })`. pg-boss `weekly-soc-report` queue registered; `worker.ts` schedules cron `0 2 * * 1` (Mondays 02:00 UTC). `render.ts` handles `report.weekly`.

**Baseline:** Unit 311 | Integration 105. Unit GREEN 311 passed. tsc GREEN. lint GREEN. Drizzle check GREEN.
**Trade-offs:** Single global weekly report; per-report channel targeting deferred (ponytail in report-job.ts). mock-ai.mjs committed (was pre-existing untracked dev script).
**Next:** All 5 tasks done. Await user review of PRs #2-#6.

---
## Post-Phase 5 — 2026-08-07 (cleanup + alert drawer UX)
**Done:**
1. PR #2 merged: Phase 5 integration into `main`.
2. PR #3 merged: pg-boss background jobs.
3. PR #4 merged: vulnerability inventory via Wazuh Indexer.
4. PR #5 merged: approval-gated active responses.
5. PR #6 merged: scheduled reports + case management.
6. PR #7 merged: removed `scripts/mock-ai.mjs`; deleted 41 stale dev-DB `alert_analyses` rows whose verdict contained `Mock AI Verification`.
7. PR #8 merged: centered and widened Alert Drawer; added responsive height and internal scrolling for complete raw payload visibility.
8. PR #9 merged: added `AI SOC Analysis` + permission-gated `Analyze` button inside Alert Drawer; added `Full detail` link to `/alerts/[id]`; threaded `alerts.analyze` permission into alert list UI.

**Verification:** `npm run lint` and `npx tsc --noEmit` passed after PR #9 changes. Earlier Phase 5 baseline: Unit 311 passed, Integration 105 passed, 2 skipped. No live Wazuh active-response execution test.
**Known deferred items:**
- No standalone sidebar Analyze page; analysis remains per-alert. Add `/analyze` only when bulk analysis/analysis queue management is required.
- Weekly report remains one global scheduled report; per-report channel targeting deferred (`ponytail` in `report-job.ts`).
- Live Wazuh active-response validation requires authorized Wazuh environment.
- Full browser/E2E verification of drawer and Analyze interaction still pending.

**Current state:** All planned Phase 5 tasks and follow-up PRs #7-#9 merged into `main`. Current worktree has unrelated untracked `scripts/test-webhook.sh`; left untouched.
**Next:** Run browser smoke test for `/alerts`: open drawer, analyze, inspect verdict, follow Full detail. Then decide whether bulk Analyze warrants sidebar route.

## Queue Management Actions — 2026-08-08
**Done:**
1. Fixed pg-boss raw SQL query bug in `/api/queues` where Drizzle `{ rows: [...] }` was returned empty by strict array checking, bringing back correct UI metrics and rendering the latest jobs table.
2. Implemented row-level queue job actions: `POST /api/queues/jobs/[id]/cancel` and `POST /api/queues/jobs/[id]/retry`.
3. Created dedicated `GET /api/queues/jobs` listing endpoint (retaining paginated support) with filterable queue list logic.
4. Added Retry/Cancel buttons in `queues-client.tsx` and pulsing progress visualizer for actively running queue tasks (from `queue_progress`). 
5. Handled `pg-boss` unique cancelled vs failed states (`resume` vs `retry`). Updated translation keys for `th.json` and `en.json`.
6. Removed invalid enum queries mapping like `expired` and `retrying` against `job_state`.

### Metrics Accuracy — 2026-08-08 (follow-up)
**Done:** Metrics card "Analyzed (24h)" now reads from `alert_analyses` table directly (`COUNT(*) WHERE created_at >= now()-24h`) instead of summing `completed` state across all pg-boss queues. Fixes inclusion of `dispatch-notification` completes inflating the analyze count. Success rate recomputed from true analyze count vs failed analyze jobs. `processed = analyzed + failed`.
**Verified:** `npx tsc --noEmit` clean; `src/app/api/queues/route.test.ts` 4/4 pass.
**DB ground truth (dev, 2026-08-08):** boss.job analyze-alert = 49 completed / 42 failed / 1 cancelled (total 92); alert_analyses = 58 total (54 in 24h); alerts pending = 0.
