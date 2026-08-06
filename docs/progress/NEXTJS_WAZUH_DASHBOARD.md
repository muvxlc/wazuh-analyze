---
title: Next.js Wazuh Dashboard Progress
project: wazuh-alert-webhook
status: in-progress
updated: 2026-08-03
branch: feature/nextjs-wazuh-dashboard
head: 5b6338b
tags:
  - wazuh
  - nextjs
  - postgresql
  - migration
---

# Next.js Wazuh Dashboard Progress

## Resume First

- Repository: `/Users/kittisak.s/Desktop/opencode/wazuh-alert-webhook-main`
- Active worktree: `/Users/kittisak.s/Desktop/opencode/wazuh-alert-webhook-main/.worktrees/nextjs-wazuh-dashboard`
- Branch: `feature/nextjs-wazuh-dashboard`
- Current HEAD: `55408dc`.
- Remote: `origin https://github.com/muvxlc/wazuh-alert-webhook.git`
- Remote push status: not pushed
- Active task: Task 5 complete (commits 843c3b5, e9ef0a3, d83bc44, 55408dc, 5b6338b). Security APPROVED, tester PASS on fresh PostgreSQL Docker. Integration 110/110 pass, unit 58/58 pass, integration 52/52 pass, lint/typecheck/build/db check clean. Deferred minor: Permission=string divergence, no login rate limiting, no security headers, per-request DB pool, test pool max=1, no auto-migrate, npm audit pre-existing.
- Next action: Task 7 implementation dispatch (Wazuh agent adapter, snapshots, health APIs).
- Task 6 complete: commits 84ac572 and f9ee981. HMAC exact-byte verification, timestamp freshness, replay SHA-256 key, atomic replay+alert transaction, 202/401/409/413/422/500 mappings, server-only ingestion modules, fixtures and tests implemented.
- Task 6 quality gate: Security review APPROVED and re-review APPROVED, 0 Critical/Important findings. Verification PASS: integration 58/58, unit 81/81, route 11/11, lint, typecheck, build, and db:check clean. Deferred minors: dead status ternary, per-request pool, timestamp upper-bound, clock injection parity, narrow cast, pre-existing npm audit advisories.
- Obsidian sync pending: external mirror /Users/kittisak.s/Desktop/obsidian/Wazuh Alert Dashboard.md unavailable.
- Restart required: yes. OpenCode config changed; new subagent model mapping loads only after restart.
- Config verified: `/Users/kittisak.s/.config/opencode/opencode.json` maps specialist agents to `9router/agnes/agnes-2.5-flash`; agent files `researcher`, `ui-designer`, `db-architect`, `nextjs-dev`, `security`, `tester`, and `devops-docker` confirm same model; orchestrator maps `9router/max/gpt-5.6-sol`. Config changes require OpenCode restart.
- Obsidian sync pending: external mirror `/Users/kittisak.s/Desktop/obsidian/Wazuh Alert Dashboard.md` unavailable.
- Worktree repair task: `git worktree repair` from common repo succeeded; no source code or history changes performed.
- Verification 2026-08-03: active worktree path `/Volumes/data/opencode/wazuh-alert-webhook-main/wazuh-alert-webhook-main/.worktrees/nextjs-wazuh-dashboard`; `--git-dir` `/Volumes/data/opencode/wazuh-alert-webhook-main/wazuh-alert-webhook-main/.git/worktrees/nextjs-wazuh-dashboard`; `--git-common-dir` `/Volumes/data/opencode/wazuh-alert-webhook-main/wazuh-alert-webhook-main/.git`; branch `feature/nextjs-wazuh-dashboard`; HEAD `df994eb79e9ab7f668ffc883b4dd1cf6b5ddbdfc`.
- Verification summary: common repo lists target worktree correctly; active worktree status shows only uncommitted progress-doc modification `M docs/progress/NEXTJS_WAZUH_DASHBOARD.md`; common repo pre-existing status remains `M .gitignore` and `?? AGENTS.md`.
- No source changes. Uncommitted progress-doc modifications remain. Obsidian sync pending: external mirror `/Users/kittisak.s/Desktop/obsidian/Wazuh Alert Dashboard.md` unavailable.
- Worktree repair task: complete. Next action: evaluate Task 4 implementer report and review exact diff from `df994eb`.
- Session update 2026-08-03: user requested https://github.com/Joaquinvesapa/sub-agent-statusline. Global `/Users/kittisak.s/.config/opencode/tui.json` now pins `opencode-subagent-statusline@1.2.1`. Global npm package installed and verified. Project-local `.opencode/opencode.json` cleaned to schema-only after `opencode plugin list` side effect. Security re-review CLEAN. Tester PASS for JSON/package but runtime TUI requires quit/restart and live sidebar check; do not claim runtime display verified. Task 4 status unchanged — still partial uncommitted, review pending. Branch: `feature/nextjs-wazuh-dashboard`. HEAD: `df994eb79e9ab7f668ffc883b4dd1cf6b5ddbdfc`. Active task: Task 4 (partial uncommitted, security review + tester regression pending). Next command: dispatch @security review and @tester on Task 4 uncommitted auth/source changes. Unresolved risks: npm audit 5 moderate + 3 high (pre-existing deferred), Task 4 incomplete, runtime TUI not verified. Obsidian sync pending: mirror unavailable.
- Task 4 implementation checkpoint 2026-08-03: partial auth files remain uncommitted from `df994eb`; required acceptance gaps include build-clean imports/types, session and invite integration tests, auth route tests, invite POST CSRF, session rotation, and exact `AuthenticatedUser`/`Permission` contracts. Next action: fresh `@nextjs-dev` completion implementation, then independent `@security` and `@tester` review.
- Task 4 implementer returned commit `d5af404` (`feat: add invitation-based authentication`). Unit 47/47, lint, typecheck, and build pass. Integration tests skipped because PostgreSQL unavailable. Report: `.superpowers/sdd/2026-08-02-nextjs-wazuh-dashboard/task-4-report.md`. Review pending; next action independent `@security` and `@tester` review.
- Task 4 review not approved. Security findings: absolute session expiry unenforced, no login session rotation, login CSRF missing, logout `Secure` missing, and no bulk session revoke utility. Tester found invite URL token overridden by body token. Integration suites fail `ECONNREFUSED 127.0.0.1:55432` when PostgreSQL unavailable. Fix round 1 pending; next action `@nextjs-dev` blocking fixes and focused verification, then re-review.
- Task 4 fix round 1 commit `9a35c51` addresses all 6 blocking/important findings. Unit 49/49, lint, typecheck, build pass; integration skipped because PostgreSQL unavailable (`ECONNREFUSED 127.0.0.1:55432`). Report: `task-4-fix-report.md`. Implementer flagged migration `NOT NULL` backfill concern. Re-review pending.
- Task 4 re-review not approved: Critical C3 login rotation still runs revoke and create in separate transactions; Important I4 migration `0001_calm_vermin.sql` adds NOT NULL absolute expiry without existing-row backfill. Tester still passes unit 49/49, lint, typecheck, build; integration unavailable. Next action: `@nextjs-dev` atomic rotation and safe migration fix, then re-review.
- Task 4 fix round 2 commit `581bd56` adds atomic `rotateSession` and a three-step safe migration with existing-row backfill using `LEAST(expires_at, created_at + 7 days)`. Unit 49/49, lint, typecheck, build, and Drizzle check pass; integration unavailable (`ECONNREFUSED 127.0.0.1:55432`). Final security/test re-review pending.
- Task 4 final security review APPROVED (range df994eb..581bd56): all 8 prior findings addressed (C1+C2+C3 Critical, I1+I2+I3+I4+Tester Important); 0 new Critical/Important findings; unit 20/20 PASS; typecheck/lint/build/drizzle-check clean; deferred: timing side-channel M1, cache-control M2, security headers M3, session binding M4, npm audit pre-existing 5 moderate + 3 high. Report: .superpowers/sdd/2026-08-02-nextjs-wazuh-dashboard/task-4-final-review.md.
- Task 4 complete across `d5af404`, `9a35c51`, and `581bd56`; final security review Approved and tester verification passed. Integration remains unavailable (`ECONNREFUSED 127.0.0.1:55432`). Next action: Task 5 implementation dispatch.
- Task 5 implementation returned in commits `843c3b5` and `e9ef0a3`. Unit 58/58, lint, typecheck, build, and Drizzle check pass; integration unavailable (`ECONNREFUSED 127.0.0.1:55432`). QA verification complete — PASS with all design compliance confirmed. Session-cleanup inverted condition bug fixed in `e9ef0a3`. Independent `@security` and `@tester` reviews dispatched in parallel.
- Task 5 paused per user request. Tester PASS: 58/58 unit, lint, typecheck, build, Drizzle check. Security review not approved: Important concurrent transition idempotency gap in `src/server/alerts/workflow.ts` can duplicate `alert_event`; Minor M1-M4 remain. Integration unavailable (`ECONNREFUSED 127.0.0.1:55432`). Task 5 not marked complete. Resume: lock alert row before idempotency check, verify, re-review.
- Task 5 review re-dispatched 2026-08-03. Parallel @security, @tester, @devops, @researcher reviews dispatched. HEAD `e9ef0a3` (fix session-cleanup inverted `gt`→`lte`). Next action: evaluate both verdicts, resolve I1 concurrent transition idempotency gap (row lock before status check), verify, re-review.
- Task 5 review NOT APPROVED (2026-08-03 re-review). d83bc44 fixes correct: workflow FOR UPDATE row lock, Drizzle wrapped 23505 dedup (`error.cause.code`), test constraint cleanup (`audit_events` `task3_rollback_test` DROP in `reset.ts`), query unique-email fix, retention seed-data rewrite. Security re-review: fixes correct but NOT APPROVED — remaining integration failures + unreliable full-suite evidence. Tester fresh DB maxWorkers=1: 50/52 integration pass, 2 failures: (1) `session.rotateSession` regression assertion expects `transactionCalls.length === 2`, implementation correctly uses 1 atomic transaction — regression test itself is wrong; (2) invite already-used returns `invalid_invite` instead of `invite_already_used`. Retain open minor concerns: `Permission=string` contract divergence, no login rate limiting, no security headers, tmpfs/no auto-migrate, test pool max=1. Docker evidence healthy at localhost:55432; migrations manual after fresh start. Reports: `task-5-fix-report.md`, `task-5-integration-review.md`. Next action: dispatch @nextjs-dev to fix invite error semantics and correct/remove rotateSession regression test, then rerun integration deterministically and security/tester re-review.

## Approved Scope

Refactor legacy Express/static dashboard into Next.js full-stack modular monolith with PostgreSQL, signed Wazuh ingestion, alert workflow, multi-user auth, fixed roles plus overrides, English/Thai UI, and design language from `DESIGN.md`.

Key decisions:

- Next.js App Router + TypeScript.
- PostgreSQL single instance.
- Polling every 3-5 seconds, implementation default 4 seconds.
- Alert retention 90 days with raw PostgreSQL `JSONB` payload.
- Email/password auth and copyable invite links.
- Fixed `super_admin`, `admin`, `user` roles with per-user allow/deny overrides.
- English default, Thai optional, locale saved per user.
- `IBM Plex Sans Thai` via `next/font/google`.
- Existing Wazuh launcher/Python integration shape retained and upgraded with HMAC, timeout, retry, and external config.
- Legacy files remain until Task 12 parity gate.

## Live Wazuh Evidence

Connection test completed against configured Wazuh API before credentials were removed from source:

- Network and TLS handshake reached Wazuh API.
- Authentication returned HTTP `200`.
- `/agents` returned HTTP `200`.
- Agent count was `3` with `failed_items=0`.
- Returned fields included `id`, `name`, `status`, `ip`, `os`, `version`, `manager`, `node_name`, and `lastKeepAlive`.

Credential was previously plaintext in `backend/server.js`. Source now reads environment variables. Credential must be rotated before production cutover.

## Git and GitHub

- Existing GitHub repository connected: `https://github.com/muvxlc/wazuh-alert-webhook.git`.
- Remote default branch: `main`.
- Local sanitized baseline commits:
  - `0f842a1 docs: define Next.js dashboard migration`
  - `e653600 chore: ignore local worktrees`
- Feature worktree created at `.worktrees/nextjs-wazuh-dashboard`.
- Feature branch has not been pushed. Do not push without explicit user request.

## Completed Work

### Design and Planning

- Approved design spec: `docs/superpowers/specs/2026-08-02-nextjs-dashboard-redesign-design.md`.
- Approved implementation plan: `docs/superpowers/plans/2026-08-02-nextjs-wazuh-dashboard.md`.
- Plan contains 12 SDD tasks and final verification.
- TypeScript changed from `7.0.2` to `5.9.3` after verified incompatibility with `typescript-eslint@8.65.0`.

### Task 1: Next.js Foundation

Status: complete, review clean.

Commits:

- `47e79be chore: scaffold Next.js application`
- `911e1d0 fix: harden foundation security contracts`

Implemented:

- Next.js 16.2.12, React 19.2.8, TypeScript 5.9.3 foundation.
- Vitest, ESLint, Playwright, Drizzle configs.
- Branded root layout and `/` redirect to `/dashboard`.
- `AppConfig`, stable `AppError` response mapping, request metadata, structured redacting logger.
- Production Wazuh URL requires HTTPS.
- Logger redacts database URLs, API/private/access keys, credentials, tokens, passwords, cookies, signatures, and circular values.

Verification:

- 20 tests passed.
- Lint passed.
- Typecheck passed.
- Next.js production build passed.
- Task reviewer approved after fix round 1; 3 findings addressed, 0 open.

Deferred risk:

- `npm audit` reports 5 moderate and 3 high transitive findings from pinned stack. Triage before production release.

### Task 2: PostgreSQL Schema

Status: complete, review clean.

Commit:

- `ebf3a3c feat: add PostgreSQL persistence schema`
- `3f711a2 docs: add persistent project handoff`
- `0839482 docs: record restart checkpoint`

Implemented:

- PostgreSQL 17 test service in `compose.test.yml`.
- Drizzle database client and transaction types.
- Tables: users, sessions, invites, permission overrides, alerts, alert events, webhook replay keys, agent snapshots, audit events, system settings.
- Role, locale, override-effect, and alert-status enums.
- Alert deduplication and query indexes.
- Initial migration and Drizzle metadata.
- Test database reset guard requiring `_test` database name.

Agent-reported verification:

- Schema integration tests: 6 passed.
- Full tests: 26 passed.
- `db:check`, migrations, migration idempotency, lint, typecheck, and build passed.
- Controller has not yet independently re-run verification or dispatched reviewer. Task 2 is not complete.

## Remaining Work

- [x] Task 2: PostgreSQL schema, verification, and clean review.
- [x] Task 3: RBAC, administration policy, audit core; fix round 1 re-review complete, Approved.
- [x] Task 4: password auth, sessions, invites, CSRF — final security APPROVED, tester PASS; deferred minor: timing side-channel, cache-control, security headers, session binding, npm audit pre-existing.
- [x] Task 5: alert domain, query, workflow, retention — APPROVED; security APPROVED with deferred minor items; tester PASS on fresh PostgreSQL Docker; full 110/110, unit 58/58, integration 52/52; lint/typecheck/build/db check clean; minor deferred: Permission=string divergence, no login rate limiting, no security headers, tmpfs/no auto-migrate, test pool max=1.
- [x] Task 6: HMAC-signed ingestion route and replay protection.
- [ ] Task 7: Wazuh adapter, stale agent snapshot, health APIs, live agent test.
- [ ] Task 8: bilingual auth UI and accessible app shell.
- [ ] Task 9: dashboard, alerts, agents, polling queue.
- [ ] Task 10: user/role/invite/override/session/settings management.
- [ ] Task 11: Python integration, operations docs, full E2E, live signed-ingestion acceptance.
- [ ] Task 12: legacy removal only after parity evidence and explicit user approval.
- [ ] Final whole-branch review and verification.
- [ ] Decide whether to push feature branch or open PR.

## Task 1-5 Quality Gate

Date: 2026-08-03
HEAD: 5b6338b
Verdict: PASS

Security: APPROVED with deferred minor items.
Tester: PASS on fresh PostgreSQL Docker.

Evidence:
- PostgreSQL: `docker compose -f compose.test.yml up -d --force-recreate` healthy at localhost:55432.
- compose uses tmpfs — no auto-start/migrate; fresh start requires manual `npm run db:migrate` before tests.
- Full suite: `npx vitest run --maxWorkers=1` 110/110 pass.
- Unit: 58/58 pass.
- Integration: 52/52 pass.
- Lint, typecheck, build, Drizzle check: all clean.

Deferred minor items (security APPROVED, retained):
1. Permission=string contract divergence.
2. No login rate limiting.
3. No security headers.
4. Per-request DB pool.
5. Test pool maxWorkers=1.
6. No auto-migrate (tmpfs).
7. npm audit pre-existing 5 moderate + 3 high.

Worktree status: M package-lock.json, ?? .opencode/ — outside reviewed source changes unless already user changes.
Task 12 remains blocked by parity evidence and explicit approval.
Obsidian sync pending: external mirror unavailable.

Next: Task 6 implementation dispatch.

Run from active worktree:

```bash
git status --short --branch
git log --oneline -10
docker compose -f compose.test.yml up -d postgres
# Note: tmpfs means DB is empty after every fresh start; run migrations each time:
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/wazuh_dashboard_test npm run db:migrate
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/wazuh_dashboard_test npm run test:integration
npm test
npm run lint
npm run typecheck
npm run build
```

Then create Task 2 review package:

```bash
"/Users/kittisak.s/.cache/opencode/packages/superpowers@git+https:/github.com/obra/superpowers.git/node_modules/superpowers/skills/subagent-driven-development/scripts/review-package" \
  "docs/superpowers/plans/2026-08-02-nextjs-wazuh-dashboard.md" \
  911e1d0 ebf3a3c
```

Review range intentionally ends at `ebf3a3c`; commit `3f711a2` contains continuity documentation only and is outside Task 2 implementation scope.

## Important Files

- `AGENTS.md`
- `DESIGN.md`
- `docs/superpowers/specs/2026-08-02-nextjs-dashboard-redesign-design.md`
- `docs/superpowers/plans/2026-08-02-nextjs-wazuh-dashboard.md`
- `.superpowers/sdd/2026-08-02-nextjs-wazuh-dashboard/progress.md`
- `.superpowers/sdd/2026-08-02-nextjs-wazuh-dashboard/task-1-report.md`
- `.superpowers/sdd/2026-08-02-nextjs-wazuh-dashboard/task-1-review.md`
- `.superpowers/sdd/2026-08-02-nextjs-wazuh-dashboard/task-1-rereview-1.md`
- `.superpowers/sdd/2026-08-02-nextjs-wazuh-dashboard/task-2-report.md`

## Continuity Rule

After every implementer, reviewer, re-reviewer, blocker, user decision, commit, or session stop:

1. Update SDD ledger.
2. Update this file.
3. Update Obsidian note `/Users/kittisak.s/Desktop/obsidian/Wazuh Alert Dashboard.md`.
4. Record exact branch, HEAD, verification evidence, current task, and next action.

No task is complete from agent report alone. Controller verification and required review must finish first.
