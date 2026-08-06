# Next.js Wazuh Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy Express/static Wazuh monitor with a secure bilingual Next.js full-stack dashboard backed by PostgreSQL and verified against the live Wazuh API.

**Architecture:** Build a Next.js 16 App Router modular monolith. Keep business rules in server-only domain modules, use Drizzle with one PostgreSQL instance, expose narrow route handlers, and update dashboard data through cursor polling every 3-5 seconds. Preserve legacy runtime files until signed ingestion, live Wazuh access, and end-to-end parity pass.

**Tech Stack:** Next.js 16.2.12, React 19.2.8, TypeScript 5.9.3, PostgreSQL, Drizzle ORM 0.45.2, drizzle-kit 0.31.10, next-intl 4.13.4, argon2 0.45.1, Zod 4.4.3, Vitest 4.1.10, Testing Library, Playwright 1.62.1, Python 3 standard library plus `requests` on Wazuh host.

## Global Constraints

- Follow `DESIGN.md`: white/soft-white canvas, ink `#171717`, emerald `#3ecf8e` used sparingly, near-black text on emerald, no gradients, 6px buttons, 8-12px panels.
- Use `IBM Plex Sans Thai` through `next/font/google` for English and Thai UI; use system monospace for IDs and JSON.
- English is default locale; persist authenticated locale in `users.locale` and pre-auth locale in cookie `locale`.
- Fixed roles are exactly `super_admin`, `admin`, and `user`; do not add custom roles.
- Per-user overrides support exactly `allow` and `deny`; deny wins, then allow, then role default.
- Retain alert raw payloads in PostgreSQL `JSONB` for 90 days based on `ingested_at`.
- Normal polling interval is 4,000ms, within approved 3-5 second range; exponential backoff is capped at 30,000ms.
- Wazuh credentials, session secrets, database credentials, and webhook secrets remain server-only and absent from logs.
- Production TLS verification must remain enabled; insecure Wazuh TLS is development-only behind `WAZUH_ALLOW_INSECURE_TLS=true` and must throw in production.
- Signed ingestion endpoint is `POST /api/integrations/wazuh/alerts` with exact-body HMAC-SHA256, Unix-seconds timestamp, and 300-second replay window.
- Ingestion responses are `202` new, `401` invalid/missing/stale signature, `409` replay/duplicate, `413` oversized body, `422` malformed/invalid payload, and `500` unexpected failure with request ID.
- Preserve `backend/`, `frontend/`, and legacy integration behavior until Task 12 parity gate.
- Never render Wazuh values with `innerHTML` or `dangerouslySetInnerHTML`.
- Use live Wazuh tests only when `LIVE_WAZUH_ACCEPTANCE=1`; tests must never print tokens, passwords, or signatures.
- Every mutation enforces authorization in server domain code and writes required audit data in the same database transaction.
- Use TDD: failing focused test, observed failure, minimal implementation, passing focused test, broader regression check, commit.

## Shared Contracts

Create these exact contracts in their producing tasks and import them elsewhere instead of redefining them:

```ts
export type Role = "super_admin" | "admin" | "user";
export type Locale = "en" | "th";
export type OverrideEffect = "allow" | "deny";

export type Permission =
  | "dashboard.read"
  | "alerts.read"
  | "alerts.acknowledge"
  | "alerts.resolve"
  | "agents.read"
  | "users.read"
  | "users.manage"
  | "invites.manage"
  | "roles.read"
  | "permission_overrides.manage"
  | "sessions.revoke"
  | "settings.manage"
  | "audit.read"
  | "super_admins.manage";

export interface ActorContext {
  userId: string;
  role: Role;
  permissions: ReadonlySet<Permission>;
  sessionId: string;
}

export interface RequestMetadata {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}
```

```ts
export type AlertStatus = "open" | "acknowledged" | "resolved";

export interface AlertCursor {
  ingestedAt: string;
  id: string;
}

export interface AlertListQuery {
  after?: AlertCursor;
  before?: AlertCursor;
  limit: number;
  text?: string;
  minLevel?: number;
  maxLevel?: number;
  statuses?: AlertStatus[];
  agent?: string;
  ruleId?: string;
  from?: string;
  to?: string;
}
```

```ts
export interface WazuhAgent {
  id: string;
  name: string;
  ip: string | null;
  status: "active" | "disconnected" | "pending" | "never_connected" | "unknown";
  os: string | null;
  version: string | null;
  manager: string | null;
  node: string | null;
  lastKeepAlive: string | null;
  source: Record<string, unknown>;
}

export interface AgentSnapshotResult {
  agents: WazuhAgent[];
  stale: boolean;
  lastSuccessfulSyncAt: string | null;
  upstreamErrorCode: string | null;
}
```

---

### Task 1: Next.js Foundation and Cross-Cutting Contracts

**Files:**
- Replace: `package.json`
- Create: `package-lock.json`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `playwright.config.ts`
- Create: `drizzle.config.ts`
- Create: `.env.example`
- Modify: `.gitignore`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `src/server/config.ts`
- Create: `src/server/errors.ts`
- Create: `src/server/http/error-response.ts`
- Create: `src/server/http/request-metadata.ts`
- Create: `src/server/logging/logger.ts`
- Test: `src/server/config.test.ts`
- Test: `src/server/http/error-response.test.ts`
- Test: `src/server/logging/logger.test.ts`

**Interfaces:**
- Consumes: approved spec and global constraints only.
- Produces: `AppConfig`, `loadConfig`, `AppError`, `toErrorResponse`, `getRequestMetadata`, and redacting logger used by every later task.

- [ ] **Step 1: Write failing configuration and error tests**

```ts
it("rejects insecure Wazuh TLS in production", () => {
  expect(() => loadConfig(validEnv({
    NODE_ENV: "production",
    WAZUH_ALLOW_INSECURE_TLS: "true",
  }))).toThrow("WAZUH_ALLOW_INSECURE_TLS");
});

it("maps AppError to stable JSON", async () => {
  const response = toErrorResponse(new AppError("forbidden", 403), "req-1");
  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toEqual({
    error: { code: "forbidden", requestId: "req-1" },
  });
});

it("redacts nested secrets", () => {
  expect(redact({ password: "p", nested: { authorization: "Bearer x" } }))
    .toEqual({ password: "[REDACTED]", nested: { authorization: "[REDACTED]" } });
});
```

- [ ] **Step 2: Run focused tests and verify expected import/module failures**

Run: `npx vitest run src/server/config.test.ts src/server/http/error-response.test.ts src/server/logging/logger.test.ts`

Expected: FAIL because foundation modules do not exist.

- [ ] **Step 3: Create exact package scripts and pinned dependencies**

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run --project unit",
    "test:integration": "vitest run --project integration",
    "test:e2e": "playwright test",
    "test:live": "vitest run tests/live",
    "db:generate": "drizzle-kit generate",
    "db:check": "drizzle-kit check",
    "db:migrate": "drizzle-kit migrate"
  }
}
```

Install exact versions named in plan header. Add `postgres`, `server-only`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `eslint`, `eslint-config-next`, and Node/React type packages compatible with pinned stack.

- [ ] **Step 4: Implement config, error, metadata, and logging contracts**

```ts
export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  appUrl: URL;
  sessionSecret: string;
  webhookHmacSecret: string;
  webhookMaxBodyBytes: number;
  webhookReplayWindowSeconds: number;
  alertRetentionDays: number;
  maintenanceBatchSize: number;
  wazuh: {
    apiUrl: URL;
    username: string;
    password: string;
    caPath: string | null;
    allowInsecureTls: boolean;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig;

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) { super(code); }
}
```

Defaults: body `1048576`, replay window `300`, retention `90`, maintenance batch `1000`. `getRequestMetadata` reads `x-request-id` or creates UUID, accepts first `x-forwarded-for` value, and copies user-agent.

- [ ] **Step 5: Build minimal branded root shell**

Use CSS custom properties matching `DESIGN.md`. Root `/` redirects to `/dashboard`; do not create feature UI yet.

- [ ] **Step 6: Run foundation verification**

Run: `npm run test && npm run lint && npm run typecheck && npm run build`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json next.config.ts tsconfig.json eslint.config.mjs vitest.config.ts vitest.setup.ts playwright.config.ts drizzle.config.ts .env.example .gitignore src
git commit -m "chore: scaffold Next.js application"
```

---

### Task 2: PostgreSQL Schema and Test Harness

**Files:**
- Create: `compose.test.yml`
- Create: `src/server/db/client.ts`
- Create: `src/server/db/schema/users.ts`
- Create: `src/server/db/schema/access.ts`
- Create: `src/server/db/schema/alerts.ts`
- Create: `src/server/db/schema/wazuh.ts`
- Create: `src/server/db/schema/audit.ts`
- Create: `src/server/db/schema/index.ts`
- Create: `src/server/db/types.ts`
- Create: `src/test/postgres/database.ts`
- Create: `src/test/postgres/reset.ts`
- Create: `drizzle/0000_initial.sql`
- Create: `drizzle/meta/_journal.json`
- Test: `src/server/db/schema.integration.test.ts`

**Interfaces:**
- Consumes: `AppConfig.databaseUrl`.
- Produces: `Database`, `DatabaseTransaction`, `createDatabase(connectionString)`, schema table exports, and isolated integration DB helpers.

- [ ] **Step 1: Write failing schema integration tests**

```ts
it("enforces normalized email uniqueness", async () => {
  await insertUser({ email: "admin@example.com", normalizedEmail: "admin@example.com" });
  await expect(insertUser({ email: "ADMIN@example.com", normalizedEmail: "admin@example.com" }))
    .rejects.toMatchObject({ code: "23505" });
});

it("enforces one alert deduplication identity", async () => {
  await insertAlert({ wazuhEventId: "evt-1", fingerprint: "fp-1" });
  await expect(insertAlert({ wazuhEventId: "evt-1", fingerprint: "fp-2" }))
    .rejects.toMatchObject({ code: "23505" });
});
```

Also assert expected indexes through `pg_indexes`.

- [ ] **Step 2: Start test PostgreSQL and verify tests fail before migration**

Run: `docker compose -f compose.test.yml up -d postgres && npm run test:integration -- src/server/db/schema.integration.test.ts`

Expected: FAIL because tables/migration do not exist.

- [ ] **Step 3: Implement schema and migration**

Tables: `users`, `sessions`, `invites`, `permission_overrides`, `alerts`, `alert_events`, `webhook_replay_keys`, `agent_snapshots`, `audit_events`, `system_settings`.

Required DB rules:

```sql
CREATE UNIQUE INDEX users_normalized_email_unique ON users (normalized_email);
CREATE UNIQUE INDEX sessions_token_hash_unique ON sessions (token_hash);
CREATE UNIQUE INDEX alerts_wazuh_event_id_unique ON alerts (wazuh_event_id) WHERE wazuh_event_id IS NOT NULL;
CREATE UNIQUE INDEX alerts_fingerprint_unique ON alerts (fingerprint);
CREATE INDEX alerts_cursor_idx ON alerts (ingested_at DESC, id DESC);
CREATE INDEX alerts_level_idx ON alerts (level);
CREATE INDEX alerts_status_idx ON alerts (status);
CREATE INDEX alerts_agent_idx ON alerts (agent_id, agent_name);
CREATE INDEX alerts_rule_idx ON alerts (rule_id);
```

Use PostgreSQL enums for role, locale, override effect, and alert status. Use UUID primary keys and timezone-aware timestamps.

- [ ] **Step 4: Implement DB and reset helpers**

```ts
export type Database = NodePgDatabase<typeof schema>;
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createDatabase(connectionString: string): {
  db: Database;
  pool: Pool;
};
```

Reset helper truncates application tables with identity restart only against a database whose URL contains `_test`.

- [ ] **Step 5: Verify migration and constraints**

Run: `npm run db:check && npm run db:migrate && npm run test:integration -- src/server/db/schema.integration.test.ts`

Expected: PASS. Run migration second time; expected no pending changes.

- [ ] **Step 6: Commit**

```bash
git add compose.test.yml src/server/db src/test/postgres drizzle
git commit -m "feat: add PostgreSQL persistence schema"
```

---

### Task 3: RBAC, User Administration Policy, and Audit Core

**Files:**
- Create: `src/server/authorization/permissions.ts`
- Create: `src/server/authorization/role-defaults.ts`
- Create: `src/server/authorization/resolve.ts`
- Create: `src/server/authorization/require.ts`
- Create: `src/server/users/administration-policy.ts`
- Create: `src/server/users/user-service.ts`
- Create: `src/server/audit/types.ts`
- Create: `src/server/audit/audit-service.ts`
- Test: `src/server/authorization/resolve.test.ts`
- Test: `src/server/users/administration-policy.integration.test.ts`
- Test: `src/server/audit/audit-service.integration.test.ts`

**Interfaces:**
- Consumes: `Database`, `DatabaseTransaction`, user/access/audit tables.
- Produces: shared role/locale/permission types, `resolvePermissions`, `requirePermission`, `updateUserAccess`, and `writeAuditEvent`.

- [ ] **Step 1: Write failing permission and administration tests**

```ts
it("applies deny before allow before role defaults", () => {
  const permissions = resolvePermissions({
    role: "admin",
    overrides: [
      { permission: "users.read", effect: "deny" },
      { permission: "alerts.resolve", effect: "allow" },
    ],
  });
  expect(permissions.has("users.read")).toBe(false);
  expect(permissions.has("alerts.resolve")).toBe(true);
});

it("prevents demoting the last active super admin", async () => {
  await expect(updateUserAccess(db, actor, {
    userId: lastSuperAdminId,
    role: "admin",
  }, metadata)).rejects.toMatchObject({ code: "last_super_admin" });
});
```

- [ ] **Step 2: Run tests and observe missing contracts**

Run: `npx vitest run src/server/authorization/resolve.test.ts src/server/users/administration-policy.integration.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement exact permission catalogue and defaults**

Export `PERMISSIONS`, `ROLE_DEFAULTS`, `Role`, `Locale`, `Permission`, `OverrideEffect`, and `ActorContext`. `super_admin` receives all permissions. `admin` receives dashboard/alert/agent reads, alert workflow, user read/manage, invite management, role read, session revoke, and audit read, but not `super_admins.manage`, override management, or settings unless explicitly allowed. `user` receives dashboard/alert/agent read only.

- [ ] **Step 4: Implement transaction-safe user access changes and audit writer**

```ts
export async function updateUserAccess(
  db: Database,
  actor: ActorContext,
  input: UpdateUserAccessInput,
  metadata: RequestMetadata,
): Promise<UserSummary>;

export async function writeAuditEvent(
  tx: DatabaseTransaction,
  event: AuditEventInput,
): Promise<void>;
```

Lock target user and active `super_admin` rows before demotion/deactivation checks. Reject grants actor lacks. Commit access mutation and audit event in one transaction.

- [ ] **Step 5: Verify RBAC and audit atomicity**

Run: `npx vitest run src/server/authorization src/server/users src/server/audit`

Expected: PASS, including rollback test proving no access mutation survives failed audit insert.

- [ ] **Step 6: Commit**

```bash
git add src/server/authorization src/server/users src/server/audit
git commit -m "feat: add role and permission enforcement"
```

---

### Task 4: Password Authentication, Sessions, Invites, and CSRF

**Files:**
- Create: `src/server/auth/password.ts`
- Create: `src/server/auth/session.ts`
- Create: `src/server/auth/authenticate.ts`
- Create: `src/server/auth/cookies.ts`
- Create: `src/server/auth/csrf.ts`
- Create: `src/server/auth/current-user.ts`
- Create: `src/server/auth/schemas.ts`
- Create: `src/server/users/invite-service.ts`
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/app/api/auth/session/route.ts`
- Create: `src/app/api/invites/[token]/route.ts`
- Test: `src/server/auth/password.test.ts`
- Test: `src/server/auth/session.integration.test.ts`
- Test: `src/server/auth/csrf.test.ts`
- Test: `src/server/users/invite-service.integration.test.ts`
- Test: `src/app/api/auth/auth-routes.test.ts`

**Interfaces:**
- Consumes: RBAC resolution, users/sessions/invites/audit tables.
- Produces: `AuthenticatedUser`, `authenticateRequest`, `createSession`, `acceptInvite`, `assertCsrfSafe`, and auth routes.

- [ ] **Step 1: Write failing password/session/invite tests**

```ts
it("stores only a session token hash", async () => {
  const session = await createSession(tx, userId, now);
  const row = await readSession(session.sessionId);
  expect(row.tokenHash).not.toContain(session.token);
});

it("accepts an invite once", async () => {
  await acceptInvite(db, validInput, metadata);
  await expect(acceptInvite(db, validInput, metadata))
    .rejects.toMatchObject({ code: "invite_already_used" });
});

it("rejects a cross-origin mutation", () => {
  expect(() => assertCsrfSafe(requestWithOrigin("https://evil.test"), appUrl))
    .toThrow("csrf_origin_mismatch");
});
```

- [ ] **Step 2: Run focused tests and verify failures**

Run: `npx vitest run src/server/auth src/server/users/invite-service.integration.test.ts src/app/api/auth/auth-routes.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement password and opaque session primitives**

Use Argon2id. Password policy: 12-128 Unicode code points and versioned local denylist containing at minimum common breached passwords used by tests. Never trim or truncate before hashing.

```ts
export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  locale: Locale;
  permissions: ReadonlySet<Permission>;
}

export async function createSession(
  tx: DatabaseTransaction,
  userId: string,
  now: Date,
): Promise<{ token: string; sessionId: string; expiresAt: Date }>;
```

Session token uses 32 random bytes, URL-safe base64, SHA-256 hash in DB, 12-hour idle expiry, and 7-day absolute expiry.

- [ ] **Step 4: Implement invite and route behavior**

Invite token uses 32 random bytes, hash-only storage, 72-hour expiry, and single-use transaction. Login always returns generic `invalid_credentials` for unknown email or wrong password. Rotate session after login and privilege changes.

- [ ] **Step 5: Implement cookies and CSRF checks**

Cookie name `wazuh_session`; `HttpOnly`, `SameSite=Lax`, `Path=/`; `Secure` outside development. Cookie-authenticated `POST`, `PUT`, `PATCH`, and `DELETE` require exact origin matching `APP_URL`.

- [ ] **Step 6: Verify authentication contract**

Run: `npx vitest run src/server/auth src/server/users/invite-service.integration.test.ts src/app/api/auth/auth-routes.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/auth src/server/users/invite-service.ts src/app/api/auth src/app/api/invites
git commit -m "feat: add invitation-based authentication"
```

---

### Task 5: Alert Domain, Query, Workflow, and Retention

**Files:**
- Create: `src/server/alerts/types.ts`
- Create: `src/server/alerts/schemas.ts`
- Create: `src/server/alerts/normalize.ts`
- Create: `src/server/alerts/fingerprint.ts`
- Create: `src/server/alerts/alert-repository.ts`
- Create: `src/server/alerts/alert-service.ts`
- Create: `src/server/alerts/query.ts`
- Create: `src/server/alerts/workflow.ts`
- Create: `src/server/maintenance/retention.ts`
- Create: `src/server/maintenance/session-cleanup.ts`
- Test: `src/server/alerts/normalize.test.ts`
- Test: `src/server/alerts/alert-service.integration.test.ts`
- Test: `src/server/alerts/query.integration.test.ts`
- Test: `src/server/alerts/workflow.integration.test.ts`
- Test: `src/server/maintenance/retention.integration.test.ts`

**Interfaces:**
- Consumes: alert/audit tables, permission checks, actor and metadata contracts.
- Produces: `NormalizedAlertInput`, `normalizeWazuhAlert`, `createAlertFingerprint`, `persistAlert`, `listAlerts`, `transitionAlert`, `deleteExpiredAlerts`.

- [ ] **Step 1: Write failing normalization, deduplication, cursor, and workflow tests**

```ts
it("normalizes representative Wazuh fields", () => {
  expect(normalizeWazuhAlert(fixture)).toMatchObject({
    wazuhEventId: fixture.id,
    agentId: fixture.agent.id,
    agentName: fixture.agent.name,
    ruleId: fixture.rule.id,
    level: fixture.rule.level,
    description: fixture.rule.description,
  });
});

it("does not duplicate an idempotent transition", async () => {
  await transitionAlert(db, actor, { alertId, to: "acknowledged" }, metadata);
  await transitionAlert(db, actor, { alertId, to: "acknowledged" }, metadata);
  expect(await countAlertEvents(alertId, "acknowledged")).toBe(1);
});
```

- [ ] **Step 2: Run focused tests and verify failures**

Run: `npx vitest run src/server/alerts src/server/maintenance`

Expected: FAIL.

- [ ] **Step 3: Implement normalization and deterministic fingerprinting**

```ts
export function normalizeWazuhAlert(raw: unknown): NormalizedAlertInput;
export function createAlertFingerprint(alert: NormalizedAlertInput): string;
```

Fingerprint canonical input: source timestamp, agent ID/name, rule ID, level, and source decoder/location when present, serialized in fixed key order and SHA-256 hashed. Preserve complete validated raw object.

- [ ] **Step 4: Implement persistence and tuple-cursor query**

```ts
export async function persistAlert(
  tx: DatabaseTransaction,
  input: NormalizedAlertInput,
): Promise<{ alert: AlertRecord; inserted: boolean }>;

export async function listAlerts(
  db: Database,
  actor: ActorContext,
  query: AlertListQuery,
): Promise<AlertPage>;
```

Order by `(ingested_at DESC, id DESC)`. Validate limit `1-100`. Search normalized agent/rule/description columns, not raw JSON.

- [ ] **Step 5: Implement workflow and bounded cleanup**

```ts
export async function transitionAlert(
  db: Database,
  actor: ActorContext,
  input: { alertId: string; to: "acknowledged" | "resolved" },
  metadata: RequestMetadata,
): Promise<AlertDetail>;

export async function deleteExpiredAlerts(
  db: Database,
  input: { before: Date; batchSize: number },
): Promise<number>;
```

Workflow mutation, `alert_events`, and `audit_events` use one transaction. Retention selects bounded IDs using `FOR UPDATE SKIP LOCKED`, then deletes. Session cleanup follows same bounded pattern.

- [ ] **Step 6: Verify alert domain**

Run: `npx vitest run src/server/alerts src/server/maintenance`

Expected: PASS including concurrent deduplication and retention tests.

- [ ] **Step 7: Commit**

```bash
git add src/server/alerts src/server/maintenance
git commit -m "feat: add durable alert domain"
```

---

### Task 6: HMAC-Signed Alert Ingestion

**Files:**
- Create: `src/server/ingestion/protocol.ts`
- Create: `src/server/ingestion/signature.ts`
- Create: `src/server/ingestion/replay.ts`
- Create: `src/server/ingestion/ingest.ts`
- Create: `src/app/api/integrations/wazuh/alerts/route.ts`
- Create: `tests/fixtures/webhook/signature-vectors.json`
- Test: `src/server/ingestion/signature.test.ts`
- Test: `src/server/ingestion/replay.integration.test.ts`
- Test: `src/app/api/integrations/wazuh/alerts/route.test.ts`

**Interfaces:**
- Consumes: config, errors, metadata, alert normalization/persistence, replay table.
- Produces: exact cross-language signing protocol and secured ingestion route.

- [ ] **Step 1: Create signature fixture vectors and failing tests**

```json
{
  "secret": "test-secret",
  "timestamp": "1785686400",
  "bodyUtf8": "{\"id\":\"fixture-1\",\"rule\":{\"level\":7,\"id\":\"100001\",\"description\":\"Fixture\"},\"agent\":{\"id\":\"001\",\"name\":\"agent-1\"}}"
}
```

Compute expected lowercase hex once with trusted Node crypto and store it in fixture. Tests must prove changing whitespace changes signature.

- [ ] **Step 2: Run tests and verify failures**

Run: `npx vitest run src/server/ingestion src/app/api/integrations/wazuh/alerts/route.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement exact-byte verifier**

```ts
export interface SignedWebhookRequest {
  body: Uint8Array;
  timestamp: string | null;
  signature: string | null;
}

export function verifyWebhookRequest(input: {
  request: SignedWebhookRequest;
  secret: Uint8Array;
  now: Date;
  maxAgeMs: number;
}): void;
```

Header names: `x-wazuh-timestamp`, `x-wazuh-signature`. Signature format: `sha256=<64 lowercase hex>`. Signature input is body bytes only; timestamp freshness is validated separately. Compare fixed-length buffers with `timingSafeEqual`.

- [ ] **Step 4: Implement replay and route transaction**

Replay key is SHA-256 of `<timestamp>\n<signature>`. Insert replay row and alert in one transaction. Duplicate replay key or alert dedup key maps to `409`.

Read `request.arrayBuffer()` only after checking `Content-Length` when present, then enforce actual byte length before JSON parse.

- [ ] **Step 5: Verify all response mappings**

Run: `npx vitest run src/server/ingestion src/app/api/integrations/wazuh/alerts/route.test.ts`

Expected: tests assert `202`, `401`, `409`, `413`, `422`, and redacted `500` response.

- [ ] **Step 6: Commit**

```bash
git add src/server/ingestion src/app/api/integrations tests/fixtures/webhook
git commit -m "feat: secure Wazuh alert ingestion"
```

---

### Task 7: Wazuh Agent Adapter, Snapshot, and Health

**Files:**
- Create: `src/server/wazuh/types.ts`
- Create: `src/server/wazuh/errors.ts`
- Create: `src/server/wazuh/http-client.ts`
- Create: `src/server/wazuh/adapter.ts`
- Create: `src/server/wazuh/agent-cache.ts`
- Create: `src/server/wazuh/agent-service.ts`
- Create: `src/server/health/health-service.ts`
- Create: `src/app/api/agents/route.ts`
- Create: `src/app/api/health/live/route.ts`
- Create: `src/app/api/health/ready/route.ts`
- Create: `src/app/api/health/wazuh/route.ts`
- Test: `src/server/wazuh/adapter.test.ts`
- Test: `src/server/wazuh/agent-service.integration.test.ts`
- Test: `src/app/api/health/health-routes.test.ts`
- Live Test: `tests/live/wazuh-agents.live.test.ts`

**Interfaces:**
- Consumes: Wazuh config, DB snapshot table, auth/RBAC.
- Produces: `WazuhClient`, `createWazuhClient`, `getAgentSnapshot`, `getSystemHealth`, and agent/health routes.

- [ ] **Step 1: Write failing mocked adapter and stale-cache tests**

```ts
it("maps Wazuh affected_items", async () => {
  expect(await client.listAgents()).toEqual([
    expect.objectContaining({ id: "001", name: "agent-1", status: "active" }),
  ]);
});

it("returns stale snapshot when refresh fails", async () => {
  expect(await getAgentSnapshot(db, failingClient, now)).toMatchObject({
    stale: true,
    upstreamErrorCode: "wazuh_unavailable",
  });
});
```

- [ ] **Step 2: Run tests and verify failures**

Run: `npx vitest run src/server/wazuh src/app/api/health/health-routes.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement TLS-safe Wazuh client**

```ts
export interface WazuhClient {
  listAgents(): Promise<WazuhAgent[]>;
}

export function createWazuhClient(config: WazuhConfig): WazuhClient;
```

Authenticate at `/security/user/authenticate?raw=true`, cache token until 60 seconds before JWT expiry when parseable, then call `/agents`. Use 5-second connect and 10-second response timeout. Optional CA file must be loaded server-side. Never log response authorization headers or token body.

- [ ] **Step 4: Implement bounded snapshot and independent health states**

Store one current JSON snapshot plus successful sync timestamp. Successful empty list replaces snapshot and is not an error. Failed refresh returns previous snapshot with `stale=true`. Liveness checks process only; readiness checks DB; Wazuh health is separate.

- [ ] **Step 5: Add opt-in live agent test**

```ts
const live = process.env.LIVE_WAZUH_ACCEPTANCE === "1" ? it : it.skip;

live("authenticates and fetches real Wazuh agents", async () => {
  const agents = await createWazuhClient(loadConfig(process.env).wazuh).listAgents();
  expect(agents.length).toBeGreaterThan(0);
});
```

- [ ] **Step 6: Verify mocked tests and live test when configured**

Run: `npx vitest run src/server/wazuh src/app/api/health/health-routes.test.ts`

Then, with secrets supplied only through environment: `LIVE_WAZUH_ACCEPTANCE=1 npx vitest run tests/live/wazuh-agents.live.test.ts`

Expected: mocked suite passes; live suite finds current Wazuh agents without printing credentials.

- [ ] **Step 7: Commit**

```bash
git add src/server/wazuh src/server/health src/app/api/agents src/app/api/health tests/live/wazuh-agents.live.test.ts
git commit -m "feat: integrate Wazuh agent health"
```

---

### Task 8: Bilingual Auth UI and Accessible Application Shell

**Files:**
- Modify: `next.config.ts`
- Create: `src/i18n/request.ts`
- Create: `messages/en.json`
- Create: `messages/th.json`
- Create: `src/app/(auth)/layout.tsx`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/invite/[token]/page.tsx`
- Create: `src/app/(dashboard)/layout.tsx`
- Create: `src/components/shell/app-shell.tsx`
- Create: `src/components/shell/sidebar.tsx`
- Create: `src/components/shell/mobile-drawer.tsx`
- Create: `src/components/shell/top-bar.tsx`
- Create: `src/components/locale-switcher.tsx`
- Create: `src/app/api/preferences/locale/route.ts`
- Create: `proxy.ts`
- Copy: `frontend/favicon.ico` to `src/app/favicon.ico`
- Test: `src/i18n/messages.test.ts`
- Test: `src/components/shell/mobile-drawer.test.tsx`
- Test: `src/app/api/preferences/locale/route.test.ts`
- E2E: `tests/e2e/auth.spec.ts`
- E2E: `tests/e2e/navigation.spec.ts`

**Interfaces:**
- Consumes: auth routes, `authenticateRequest`, `AuthenticatedUser`.
- Produces: app shell, login/invite flows, locale persistence, and route protection.

- [ ] **Step 1: Write failing locale parity and drawer accessibility tests**

```ts
it("keeps English and Thai message keys identical", () => {
  expect(flattenKeys(th)).toEqual(flattenKeys(en));
});

it("closes drawer on Escape and restores focus", async () => {
  await user.click(screen.getByRole("button", { name: /menu/i }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /menu/i })).toHaveFocus();
});
```

- [ ] **Step 2: Run tests and verify failures**

Run: `npx vitest run src/i18n src/components/shell src/app/api/preferences/locale/route.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement next-intl and IBM Plex Sans Thai**

Use `IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "500"] })`. URL paths remain unprefixed. Locale resolution order: authenticated user, `locale` cookie, then `en`.

- [ ] **Step 4: Implement auth pages and protected shell**

Sidebar links: Dashboard, Alerts, Agents, Users, Roles, Settings. Hide links without read permission, but keep route/domain authorization authoritative. Mobile drawer uses dialog semantics, focus containment, Escape close, and focus restoration.

- [ ] **Step 5: Implement locale mutation**

Authenticated change updates `users.locale` and cookie in one request; pre-auth change updates cookie only. Validate exactly `en` or `th`.

- [ ] **Step 6: Add Playwright auth/navigation flows**

Tests cover invite acceptance, login, logout, unauthorized redirect, desktop sidebar, mobile drawer, and persisted locale after new session.

- [ ] **Step 7: Verify UI shell**

Run: `npm run test -- src/i18n src/components/shell src/app/api/preferences/locale/route.test.ts && npx playwright test tests/e2e/auth.spec.ts tests/e2e/navigation.spec.ts`

Expected: PASS desktop and mobile projects.

- [ ] **Step 8: Commit**

```bash
git add next.config.ts proxy.ts src/i18n messages src/app src/components/shell src/components/locale-switcher.tsx tests/e2e src/app/favicon.ico
git commit -m "feat: add bilingual authenticated shell"
```

---

### Task 9: Dashboard, Alerts, Agents, and Polling Queue

**Files:**
- Create: `src/server/dashboard/dashboard-service.ts`
- Create: `src/app/api/dashboard/summary/route.ts`
- Create: `src/app/api/alerts/route.ts`
- Create: `src/app/api/alerts/[id]/route.ts`
- Create: `src/app/api/alerts/[id]/status/route.ts`
- Create: `src/app/(dashboard)/dashboard/page.tsx`
- Create: `src/app/(dashboard)/alerts/page.tsx`
- Create: `src/app/(dashboard)/alerts/[id]/page.tsx`
- Create: `src/app/(dashboard)/agents/page.tsx`
- Create: `src/components/alerts/alert-table.tsx`
- Create: `src/components/alerts/alert-filters.tsx`
- Create: `src/components/alerts/alert-detail.tsx`
- Create: `src/components/alerts/raw-json.tsx`
- Create: `src/components/alerts/alert-poller.ts`
- Create: `src/components/agents/agent-table.tsx`
- Test: `src/server/dashboard/dashboard-service.integration.test.ts`
- Test: `src/components/alerts/alert-poller.test.ts`
- Test: `src/components/alerts/alert-table.test.tsx`
- Test: `src/app/api/alerts/alert-routes.test.ts`
- E2E: `tests/e2e/dashboard.spec.ts`
- E2E: `tests/e2e/alerts.spec.ts`
- E2E: `tests/e2e/agents.spec.ts`

**Interfaces:**
- Consumes: alert query/workflow, Wazuh snapshot, auth/RBAC, app shell.
- Produces: operational dashboard and polling state machine.

- [ ] **Step 1: Write failing polling and API tests**

```ts
it("queues incoming alerts without changing visible rows", () => {
  const next = queuePolledAlerts(initialState, [newAlert]);
  expect(next.queued).toEqual([newAlert]);
  expect(next.visible).toEqual(initialState.visible);
});

it.each([
  [0, 4000], [1, 8000], [2, 16000], [3, 30000], [10, 30000],
])("backs off %i failures to %ims", (failures, expected) => {
  expect(nextPollingDelay(failures, { normalMs: 4000, maxMs: 30000 })).toBe(expected);
});
```

- [ ] **Step 2: Run focused tests and verify failures**

Run: `npx vitest run src/server/dashboard src/components/alerts src/app/api/alerts/alert-routes.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement dashboard and alert APIs**

Summary contains Wazuh health, agent status counts, alert severity counts, and workflow counts. Alert list supports approved filters and tuple cursor. Detail includes timeline and raw JSON. Status route calls `transitionAlert`; route never writes tables directly.

- [ ] **Step 4: Implement polling state machine**

```ts
export interface AlertPollingState {
  cursor: AlertCursor | null;
  visible: readonly AlertListItem[];
  queued: readonly AlertListItem[];
  connection: "idle" | "connected" | "backing_off";
  consecutiveFailures: number;
}

export function nextPollingDelay(
  failures: number,
  options: { normalMs: number; maxMs: number },
): number;

export function queuePolledAlerts(
  state: AlertPollingState,
  incoming: readonly AlertListItem[],
): AlertPollingState;
```

Cap queue at 500. When exceeded, set `requiresRefresh=true` and retain count instead of storing unlimited rows. Success resets failures; reveal merges unique rows by ID.

- [ ] **Step 5: Implement responsive operational UI**

Dashboard panels fail independently. Tables have loading, empty, unavailable, stale, and permission-denied states. Raw JSON uses `<pre>{JSON.stringify(raw, null, 2)}</pre>` only. Severity may use domain colors inside status indicators while emerald remains primary action color.

- [ ] **Step 6: Add Playwright operational flows**

Cover dashboard summary, filters, cursor pagination, queued alert reveal, acknowledge/resolve permissions, raw payload escaping, stale agents, mobile tables, and no scroll jump.

- [ ] **Step 7: Verify operational UI**

Run: `npx vitest run src/server/dashboard src/components/alerts src/app/api/alerts/alert-routes.test.ts && npx playwright test tests/e2e/dashboard.spec.ts tests/e2e/alerts.spec.ts tests/e2e/agents.spec.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/dashboard src/app/api/dashboard src/app/api/alerts src/app/\(dashboard\)/dashboard src/app/\(dashboard\)/alerts src/app/\(dashboard\)/agents src/components/alerts src/components/agents tests/e2e
git commit -m "feat: build Wazuh operations dashboard"
```

---

### Task 10: User, Role, Invite, Override, Session, and Settings Management

**Files:**
- Create: `src/app/api/users/route.ts`
- Create: `src/app/api/users/[id]/route.ts`
- Create: `src/app/api/users/[id]/role/route.ts`
- Create: `src/app/api/users/[id]/activation/route.ts`
- Create: `src/app/api/users/[id]/permissions/route.ts`
- Create: `src/app/api/users/[id]/sessions/revoke/route.ts`
- Create: `src/app/api/invites/route.ts`
- Create: `src/app/api/invites/[id]/revoke/route.ts`
- Create: `src/app/api/roles/route.ts`
- Create: `src/app/api/settings/route.ts`
- Create: `src/app/(dashboard)/users/page.tsx`
- Create: `src/app/(dashboard)/roles/page.tsx`
- Create: `src/app/(dashboard)/settings/page.tsx`
- Create: `src/components/users/user-table.tsx`
- Create: `src/components/users/invite-dialog.tsx`
- Create: `src/components/users/permission-editor.tsx`
- Create: `src/components/roles/role-matrix.tsx`
- Test: `src/app/api/users/user-routes.test.ts`
- Test: `src/app/api/invites/invite-routes.test.ts`
- Test: `src/components/users/permission-editor.test.tsx`
- E2E: `tests/e2e/user-management.spec.ts`
- E2E: `tests/e2e/roles.spec.ts`
- E2E: `tests/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: user/RBAC/audit services, invite/session services, shell/i18n.
- Produces: complete admin surface without custom-role creation.

- [ ] **Step 1: Write failing direct-API authorization and permission editor tests**

```ts
it("renders inherited, allowed, and denied states", () => {
  render(<PermissionEditor defaults={["alerts.read"]} overrides={[
    { permission: "alerts.resolve", effect: "allow" },
    { permission: "agents.read", effect: "deny" },
  ]} />);
  expect(screen.getByText("Inherited")).toBeInTheDocument();
  expect(screen.getByText("Allowed")).toBeInTheDocument();
  expect(screen.getByText("Denied")).toBeInTheDocument();
});
```

Route tests must send forbidden direct requests, not only inspect hidden controls.

- [ ] **Step 2: Run tests and verify failures**

Run: `npx vitest run src/app/api/users src/app/api/invites src/components/users`

Expected: FAIL.

- [ ] **Step 3: Implement routes as thin domain adapters**

Every mutation calls `authenticateRequest`, `assertCsrfSafe`, and domain user/invite service. Role API is read-only. Invite creation returns copyable `${APP_URL}/invite/<token>` once; DB stores hash only.

- [ ] **Step 4: Implement user and role UI**

User page supports invite generation, activation, fixed-role assignment, permission overrides, and session revocation. Role page shows fixed defaults and effective preview only. Settings page exposes safe runtime settings and retention display; secrets are never returned.

- [ ] **Step 5: Add security-sensitive session behavior**

Role, activation, or permission change revokes all target sessions. Self-change that remains authorized creates a replacement session only when required; demotion logs current actor out after successful response. Last-super-admin errors use stable localized messages.

- [ ] **Step 6: Add Playwright role matrix**

Test `super_admin`, `admin`, and `user` through UI and direct API. Prove admin cannot manage `super_admin`, grant missing permission, or edit settings without override.

- [ ] **Step 7: Verify admin surfaces**

Run: `npx vitest run src/app/api/users src/app/api/invites src/components/users && npx playwright test tests/e2e/user-management.spec.ts tests/e2e/roles.spec.ts tests/e2e/settings.spec.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/users src/app/api/invites src/app/api/roles src/app/api/settings src/app/\(dashboard\)/users src/app/\(dashboard\)/roles src/app/\(dashboard\)/settings src/components/users src/components/roles tests/e2e
git commit -m "feat: add user and role management"
```

---

### Task 11: Python Integration, Operations, and Live Acceptance

**Files:**
- Modify: `on-wazuh-server/custom-webhook.py`
- Preserve: `on-wazuh-server/custom-webhook`
- Create: `on-wazuh-server/tests/test_custom_webhook.py`
- Create: `on-wazuh-server/custom-webhook.env.example`
- Create: `tests/live/wazuh-ingestion.live.test.ts`
- Create: `tests/e2e/full-workflow.spec.ts`
- Create: `scripts/run-retention.ts`
- Create: `scripts/cleanup-sessions.ts`
- Create: `scripts/seed-admin.ts`
- Create: `scripts/reset-test-db.ts`
- Modify: `wazuh-alert.service`
- Replace: `README.md`
- Create: `docs/deployment.md`
- Create: `docs/wazuh-integration.md`
- Create: `docs/operations.md`
- Create: `docs/migration-parity-checklist.md`

**Interfaces:**
- Consumes: signed ingestion protocol, auth/UI, maintenance services, live Wazuh adapter.
- Produces: deployable integration client, operational scripts/docs, and parity evidence.

- [ ] **Step 1: Write failing Python protocol and retry tests**

```py
def test_signature_matches_shared_vector(self):
    body = serialize_alert(self.fixture)
    self.assertEqual(create_signature(b"test-secret", body), self.expected_signature)

def test_does_not_retry_422(self):
    response = self.send_with_statuses([422, 202])
    self.assertEqual(response, 422)
    self.assertEqual(self.request_count, 1)
```

Also test retry for timeout, connection error, `429` with bounded `Retry-After`, and `5xx`.

- [ ] **Step 2: Run Python tests and verify failures**

Run: `python3 -m unittest discover -s on-wazuh-server/tests -p "test_*.py"`

Expected: FAIL.

- [ ] **Step 3: Implement exact-byte Python client**

```py
def serialize_alert(alert: dict) -> bytes:
    return json.dumps(alert, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

def create_signature(secret: bytes, body: bytes) -> str:
    return "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()

def send_alert(endpoint: str, secret: bytes, body: bytes) -> int:
    timestamp = str(int(time.time()))
    headers = {
        "content-type": "application/json",
        "x-wazuh-timestamp": timestamp,
        "x-wazuh-signature": create_signature(secret, body),
    }
    for attempt in range(MAX_ATTEMPTS):
        try:
            response = requests.post(
                endpoint,
                data=body,
                headers=headers,
                timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
            )
        except (requests.ConnectionError, requests.Timeout):
            if attempt + 1 == MAX_ATTEMPTS:
                raise
            time.sleep(min(2 ** attempt, MAX_BACKOFF_SECONDS))
            continue

        if response.status_code == 429 or response.status_code >= 500:
            if attempt + 1 < MAX_ATTEMPTS:
                delay = retry_delay(response, attempt)
                time.sleep(delay)
                continue
        return response.status_code

    raise RuntimeError("unreachable retry state")
```

Read `WAZUH_WEBHOOK_URL`, `WAZUH_WEBHOOK_SECRET`, connect timeout default `3`, read timeout default `10`, attempts default `4`. Send Unix timestamp and signature headers. Return non-zero process exit on terminal failure. Remove raw-alert debug logging.

- [ ] **Step 4: Add maintenance scripts and service configuration**

Scripts load normal app config and call bounded domain cleanup. `wazuh-alert.service` must use a real `ExecStart`, environment file, correct working directory, restart policy, and Node process; no browser sound target.

- [ ] **Step 5: Add full E2E and live signed-ingestion tests**

Live ingestion test:

```ts
const live = process.env.LIVE_WAZUH_ACCEPTANCE === "1" ? it : it.skip;

live("stores a marked signed alert within five seconds", async () => {
  const marker = `acceptance-${crypto.randomUUID()}`;
  const response = await sendSignedFixture({ marker });
  expect(response.status).toBe(202);
  await expect.poll(() => findAlert(marker), { timeout: 5000 }).toBeTruthy();
  expect((await sendSignedFixture({ marker })).status).toBe(409);
});
```

Cleanup only marked fixtures when `LIVE_WAZUH_CLEANUP=1`.

- [ ] **Step 6: Write complete deployment and migration docs**

Document environment variables, PostgreSQL migration, first `super_admin` seed, Node self-hosting, Docker-compatible setup, reverse proxy/TLS, Wazuh CA, integration file placement/permissions, HMAC secret installation, credential rotation, health endpoints, retention scheduling, backup/restore, and rollback before legacy deletion.

- [ ] **Step 7: Run full verification**

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
python3 -m unittest discover -s on-wazuh-server/tests -p "test_*.py"
python3 -m py_compile on-wazuh-server/custom-webhook.py
LIVE_WAZUH_ACCEPTANCE=1 npm run test:live
```

Expected: all configured suites pass; live output contains no secret material.

- [ ] **Step 8: Commit**

```bash
git add on-wazuh-server tests/live tests/e2e/full-workflow.spec.ts scripts wazuh-alert.service README.md docs
git commit -m "feat: complete secure Wazuh migration"
```

---

### Task 12: Remove Legacy Runtime After Parity Gate

**Files:**
- Delete: `backend/server.js`
- Delete: `backend/package.json`
- Delete: `backend/package-lock.json`
- Delete: `frontend/index.html`
- Delete: `frontend/app.js`
- Delete: `frontend/style.css`
- Delete: `frontend/favicon.ico`
- Move or delete after parity decision: `frontend/sounds/alarm.wav`
- Delete: `init-project.sh`
- Delete if unused: `image.png`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `docs/migration-parity-checklist.md`

**Interfaces:**
- Consumes: signed live ingestion, live Wazuh agents, production build, parity checklist.
- Produces: Next.js-only runtime with Wazuh launcher retained.

- [ ] **Step 1: Verify irreversible deletion preconditions**

All conditions must be true:

```text
[ ] lint, typecheck, unit, integration, route, UI, E2E, and build pass
[ ] live Wazuh agent authentication passes
[ ] live signed ingestion appears in UI within 5 seconds
[ ] duplicate signed event returns 409
[ ] legacy Wazuh credential has been rotated
[ ] deployment/service configuration points to Next.js
[ ] PostgreSQL backup and rollback procedure has been tested
[ ] alarm sound is migrated or explicitly waived
```

If any condition is false, stop Task 12 without deleting files.

- [ ] **Step 2: Record baseline and remove legacy runtime files**

Delete only listed legacy files. Keep `on-wazuh-server/custom-webhook` and upgraded Python script.

- [ ] **Step 3: Search for forbidden runtime references**

Run:

```bash
rg -n "express|new WebSocket|innerHTML|latestAlerts|WAZUH_PASSWORD\s*=|rejectUnauthorized:\s*false" .
rg -n "backend/|frontend/" package.json README.md docs wazuh-alert.service
```

Expected: no legacy runtime references. Development-only insecure TLS branch may remain only with production guard and tests.

- [ ] **Step 4: Run final clean verification**

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
python3 -m unittest discover -s on-wazuh-server/tests -p "test_*.py"
```

Expected: all pass without `backend/` or `frontend/`.

- [ ] **Step 5: Commit**

```bash
git add -A backend frontend init-project.sh image.png .gitignore README.md docs
git commit -m "refactor: remove legacy dashboard runtime"
```

## Final Verification

Run after all approved tasks:

```bash
npm ci
docker compose -f compose.test.yml up -d postgres
npm run db:migrate
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
python3 -m unittest discover -s on-wazuh-server/tests -p "test_*.py"
python3 -m py_compile on-wazuh-server/custom-webhook.py
LIVE_WAZUH_ACCEPTANCE=1 npm run test:live
npx @google/design.md lint DESIGN.md
```

Expected live evidence:

- Real Wazuh authentication returns success.
- Real `/agents` response maps at least the currently available agents.
- Marked signed alert persists once, duplicate returns `409`, and dashboard sees it within five seconds.
- No command output contains Wazuh password, API token, session token, webhook secret, or HMAC signature.

## Execution Notes

- Workspace currently has no `.git` metadata. Subagent-Driven Development requires a Git repository for isolated worktrees, task commits, review packages, and recovery ledger. Initialize or restore Git before Task 1 execution.
- Treat credential currently embedded in legacy `backend/server.js` as compromised. Rotate it before production cutover; never copy it into `.env.example`, plan, tests, or commits.
- Tasks 3 and 7 are logically independent after Task 2, as are Tasks 9 and 10 after their prerequisites. Subagent-Driven Development still dispatches implementation agents sequentially to avoid worktree conflicts.
- Task 12 is intentionally gated and destructive. Do not execute it from plan momentum; require parity evidence and explicit user approval at that point.
