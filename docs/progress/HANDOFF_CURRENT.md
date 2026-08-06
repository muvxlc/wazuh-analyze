---
title: Next.js Wazuh Dashboard Handoff
updated: 2026-08-06
branch: feature/nextjs-wazuh-dashboard
head: 2a249bb + uncommitted
---

# Current Handoff

## Completed this session

- **Editable role permissions feature** (uncommitted in worktree):
  - New `role_permission_overrides` table + migration `drizzle/0006_role_permission_overrides.sql`, registered in `drizzle/meta/_journal.json` (idx 6) with `0006_snapshot.json` (prevId → 0004 snapshot).
  - Schema `src/server/db/schema/access.ts` (`rolePermissionOverrides`); permission `roles.manage` added to `src/server/authorization/permissions.ts` + `role-defaults.ts` (super_admin only).
  - `resolvePermissions` (`src/server/authorization/resolve.ts`) merges role-level + user-level overrides (deny wins). `authenticateRequest` loads both.
  - Service `src/server/role-permissions/service.ts` (transactional mutate + audit, super_admin-immutable, catalogue validation). `revokeSessionsByRoleId` in `src/server/auth/session.ts`.
  - Routes: `GET/PATCH /api/roles` and `PATCH /api/roles/[role]` (CSRF, authz, session revoke by role).
  - `RoleMatrix` editable (`src/components/roles/role-matrix.tsx`); super_admin column read-only.
  - Hardened `src/app/api/users/[id]/permissions/route.ts`: body now `{overrides:[...]}`, catalogue validation, blocks non-super_admin from granting sensitive perms (super_admins.manage/overrides.manage/roles.manage/settings.manage).
  - Tests: resolve (12), roles route (8), user permissions route (10) — all pass. `tsc` + `lint` clean.
- **Migration applied to dev DB** (`wazuh_dashboard_dev` @ port 55433) via `docker exec ... psql -f drizzle/0006_role_permission_overrides.sql`. Table + indexes confirmed.
- **Docs (AI connections)** from prior session still present: `docs/ai-connections.md` + cross-links.

## Bugs fixed this session (role feature runtime)

1. `role_permission_overrides` table missing in dev DB → 500 on every auth → applied migration 0006.
2. Roles toggle HTTP 422: `role-matrix.tsx` `<option value="allowed"/"denied">` cast to effect `"allow"/"deny"` → sent `effect:"allowed"` → zod reject. Fixed select values to `"allow"/"deny"` and `currentState` consistent.
3. Roles toggle HTTP 422: route whitelists `ROLE_PERMISSION_OVERRIDES` hardcode list missing `roles.manage` → replaced with `Object.values(PERMISSIONS)` in both `/api/roles` and `/api/roles/[role]`.
4. Roles toggle HTTP 500 (real root cause): `revokeSessionsByRoleId` raw SQL `SET "sessions"."revoked_at"` — Postgres forbids qualifying SET target with relation name. Fixed to `SET revoked_at = ${now}`. (`revokeSessionsByUserId` uses query builder, unaffected.)
5. Removed temporary `console.error` debug in `[role]/route.ts`.

## Known caveats / not done

- **Wazuh shows Disconnected — credentials, not code.** `.env.local` `WAZUH_PASSWORD=replace-with-rotated-password` (placeholder) and `system_settings` table is empty (0 rows). Wazuh manager reachable on 172.16.32.5:55000 but auth returns 401. Fix: set real Wazuh credentials via the now-editable `/settings/cloud` page (or `.env.local`) + ensure `SETTINGS_ENCRYPTION_KEY` is set.
- **Settings Cloud page now editable (2026-08-06).** `/settings/cloud` rewritten to an editable form (241 lines): wazuhApiUrl, wazuhUsername, wazuhPassword (write-only), wazuhCaPath, wazuhAllowInsecureTls. Prefills URL/CA/TLS; username+password blank with set/not-set status. PATCH sends only changed fields, omits blank password. Backend PATCH already supported these fields.
- **Labels renamed (2026-08-06).** `shell.settings-cloud`/`settings.cloud` → "Wazuh setting"/"ตั้งค่า Wazuh"; `shell.settings-local`/`settings.local` → "Setting"/"ตั้งค่า" in `messages/{en,th}.json`. Keys unchanged; sidebar uses `t(item.label)`.
- Hydration mismatch warning on `<html data-__host_prefix...>` is a browser-extension artifact, not our bug.
- `npm run db:migrate` still hangs; apply SQL via `docker exec ... psql` (see memory).
- Uncommitted: ~80 modified + ~50 untracked files in worktree from prior + this session; pre-existing changes must not be reverted blindly.

## Completed 2026-08-06

### Made Cloud/Wazuh settings editable + renamed labels

Implemented + verified. Backend PATCH already supported these fields. Automated gate: `tsc --noEmit` clean, `npm run lint` clean, `local/page.test.tsx` 4/4 pass, security audit all 7 points PASS (no vulns). Not yet committed.

**Changes:**

1. `src/app/(dashboard)/settings/cloud/page.tsx` — rewrite read-only display → editable form mirroring `local/page.tsx` (state + handleSubmit PATCH) and `ai/page.tsx` (write-only password):
   - Fields: wazuhApiUrl (text), wazuhUsername (text), wazuhPassword (`type=password`, autoComplete off, write-only — send only when non-blank), wazuhCaPath (text), wazuhAllowInsecureTls (checkbox).
   - GET `/api/settings` returns `wazuhApiUrl`, `wazuhCaPath`, `wazuhAllowInsecureTls`, `wazuhPasswordSet`, `wazuhUsernameSet` (not the secret values). Prefill URL/CA/TLS; leave username/password blank with set/not-set status.
   - PATCH `/api/settings` with `Content-Type: application/json` (browser auto-sends Origin for same-origin → satisfies `assertCsrfSafe`). Send only changed fields; omit password when blank (schema `.min(1)`, service treats "" as clear).
   - saving/saved/error state; remove the "cannot be edited here" line. File < 300 lines.
2. `messages/en.json` + `messages/th.json` (keep parity):
   - Rename: `shell.settings-cloud` Cloud → "Wazuh setting"/"ตั้งค่า Wazuh"; `shell.settings-local` Local → "Setting"/"ตั้งค่า"; `settings.cloud` page title → "Wazuh setting"; `settings.local` → "Setting".
   - Add: `settings.cloud-save`, `cloud-saving`, `cloud-save-success`, `cloud-wazuh-password`, `cloud-wazuh-password-placeholder`, `cloud-wazuh-username-placeholder`, `cloud-wazuh-url-placeholder`, `cloud-wazuh-ca-path-placeholder`.
3. `sidebar.tsx`: no code change needed — render already uses `t(item.label)`, keys/hrefs unchanged.

**Verification (done):**
- `npx tsc --noEmit` clean, `npm run lint` clean, `src/app/(dashboard)/settings/local/page.test.tsx` 4/4 pass.
- Security audit PASS (secret exposure, write-only password, CSRF, zod validation, settings.manage authz, no DB in UI, no hardcoded secrets).

**Still pending (manual / needs real creds):**
- Manual (dev @55433): super_admin → `/settings/cloud` → real Wazuh URL/username/password → Save → `system_settings` row appears; dashboard Wazuh → Connected; reopen shows URL/CA/TLS, password blank + "set". Requires `SETTINGS_ENCRYPTION_KEY` set + real Wazuh credentials (`.env.local` password is still placeholder).
- Sidebar titles check: "Wazuh setting", "Setting".
- Commit (logical group); no push unless requested.

### Runtime fixes 2026-08-06 (infra + bug)

1. **`readSession` "Failed query" / 500 on every auth — Docker daemon was stopped.** Dev Postgres container was down (no docker socket) → app on `localhost:55433` couldn't connect → drizzle's session SELECT threw. NOT a code/schema bug. Fix: `open -a Docker`, then `docker compose -f compose.dev.yml up -d postgres` (reuses volume `wazuh_dashboard_dev_data` — sessions/settings/migration 0006 preserved). Then **restart `next dev`** — Turbopack caches `DATABASE_URL` at module load and won't reconnect on its own. Verified: `sessions` 24 rows (1 active), `absolute_expires_at` column present, `system_settings` 0 rows.
2. **Cloud settings save HTTP 422.** `cloud/page.tsx` PATCH body sent `wazuhCaPath: state.data.wazuhCaPath` which is `string | null`; GET returns `null` when unset. Route zod `wazuhCaPath: z.string().max(1000).optional()` rejects `null` (null ≠ undefined) → 422. Fix: `wazuhCaPath: state.data.wazuhCaPath ?? ""`. tsc + lint clean. (No cloud page test exists yet.)

### Sidebar regroup + i18n fixes 2026-08-06

- **Sidebar regrouped** (`src/components/shell/sidebar.tsx`, 117 lines): split flat `navItems` into `workspaceItems` (dashboard, alerts, agents, chat) under "Workspace" and `adminItems` (users, roles) under "Admin"; settings triad (local/cloud/ai) stays under Admin. Admin section gated on `usersRead || rolesRead || settingsManage`; per-item permission filters kept; settings triad still `settingsManage`-gated. Icons/keys/hrefs/active-state unchanged. Mobile drawer imports `Sidebar` (no dup); topbar unrelated.
- **en.json label fix:** `shell.settings-local` was still `"Local"` (cloud rename had landed, local missed) → `"Setting"`. th.json already `"ตั้งค่า"`.
- **th.json parity fix:** `src/i18n/messages.test.ts` (en/th key parity) was failing. Root cause was NOT missing keys — an earlier python-json rewrite had appended a **duplicate trailing block** of the 12 cloud-* settings keys, breaking `toEqual` (order-sensitive). Rebuilt `settings` key order to match en.json exactly, dropped the duplicate block. Parity test now passes.
- **Gate:** `npx tsc --noEmit` clean; `npm run lint` clean; `npm run test:unit` = **233 passed, 11 skipped, 0 assertion failures**. The 1 "failed" file (`integrations/wazuh/alerts/route.test.ts`) is environmental — disposable test DB (port 55432) has no schema (`relation "alert_events" does not exist`); needs a migrated test DB. Confirmed not a code regression.

## Resume

1. `git -C .worktrees/nextjs-wazuh-dashboard status --short --branch`.
2. Read `AGENTS.md`, this handoff, and only the docs/files relevant to the current task. Use `rg` first; read targeted line ranges; avoid repeating unchanged reads.
3. Work only in that worktree. Keep pre-existing uncommitted changes; do not revert blindly.
4. Keep deployment names aligned: `custom-analyze`, `custom-analyze.py`, `custom-analyze.env`, and `<name>custom-analyze</name>` in `ossec.conf`.
5. For database changes: generate SQL, inspect it, apply against the intended DB via `docker exec ... psql` if `npm run db:migrate` hangs, then verify tables/indexes.
6. For Wazuh credential fix once UI editable: set real password via `/settings/cloud` (writes encrypted to `system_settings`, DB-over-env) or `.env.local`.
7. `SETTINGS_ENCRYPTION_KEY` (min 32 chars) must be in env for saving encrypted secrets.
8. Run focused tests first; final gate is `npx tsc --noEmit`, `npm run lint`, and focused/full tests as risk requires. Keep command output concise.
9. Before production: use HTTPS, valid Wazuh CA, rotated credentials, and firewall allowlist from Wazuh Manager to dashboard webhook.
10. Commit logical groups only; leave unrelated pre-existing worktree changes unstaged. No push unless explicitly requested.
