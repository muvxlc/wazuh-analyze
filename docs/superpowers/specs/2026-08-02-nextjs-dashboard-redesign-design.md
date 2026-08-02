# Next.js Wazuh Dashboard Redesign

**Date:** 2026-08-02
**Status:** Approved design

## Goal

Replace the current Express and static frontend application with a secure Next.js full-stack dashboard. Preserve the existing Wazuh integration workflow, use live Wazuh data where practical, and redesign the product using the visual language in `DESIGN.md`.

## Scope

The first release is an operational dashboard MVP with:

- Live Wazuh agent data.
- Secure alert ingestion from the Wazuh integration host.
- Durable alert storage with 90-day retention and raw payloads.
- Alert search, filtering, detail views, acknowledgement, and resolution.
- Multi-user email/password authentication.
- Invite-based account creation.
- Fixed `super_admin`, `admin`, and `user` roles.
- Per-user permission grants and denials.
- User, role assignment, invite, and permission-override management.
- English and Thai UI, with English as the default and locale saved per user.
- Audit logs for security-sensitive and workflow actions.

Marketing pages described in `DESIGN.md` are outside this release. Its design tokens and product-UI language apply to the dashboard.

## Architecture

Use a modular monolith built with Next.js App Router and TypeScript. UI, route handlers, authentication, authorization, ingestion, Wazuh access, and scheduled maintenance live in one deployable application, but server modules remain separated by domain.

Use one PostgreSQL instance. Poll the application API every 3-5 seconds for new alerts using a stable cursor. Do not require a persistent WebSocket process. Keep realtime interfaces isolated so polling can later be replaced with PostgreSQL notifications, Redis, or another fan-out service.

Primary routes:

- `/login`
- `/invite/[token]`
- `/dashboard`
- `/alerts`
- `/alerts/[id]`
- `/agents`
- `/users`
- `/roles`
- `/settings`

Server-only domain modules:

- Authentication and sessions.
- Authorization and permission resolution.
- Alerts and workflow transitions.
- Alert ingestion and normalization.
- Wazuh API adapter.
- Agent snapshots and health state.
- Users, invites, and role assignments.
- Audit logging.
- Retention and maintenance jobs.

React components must not call the Wazuh API or PostgreSQL directly. Wazuh credentials, webhook secrets, session secrets, and database credentials remain server-only.

## Data Model

### Users and Access

`users` stores email, display name, password hash, fixed role, locale, activation state, and timestamps. Email addresses are unique after normalization.

`sessions` stores only a cryptographic hash of each session token, user ID, expiry, last-used time, and revocation metadata.

`invites` stores email, intended role, token hash, creator, expiry, accepted time, and revocation time. Invite tokens are single-use. The admin UI generates a copyable invite URL; email delivery is outside this release.

`permission_overrides` stores explicit per-user allow or deny decisions. Overrides operate on a documented permission catalogue and take precedence over the fixed role defaults. A deny overrides an allow for the same permission.

Fixed role intent:

- `super_admin`: all permissions, including assigning `super_admin`, managing admins, changing overrides, and system settings.
- `admin`: operational management, invites, and user management within allowed boundaries; cannot grant privileges they do not possess or manage `super_admin` accounts.
- `user`: dashboard, agent, and alert access according to role defaults and explicit overrides.

The last active `super_admin` cannot be disabled, deleted, or demoted.

### Alerts

`alerts` stores:

- Internal UUID.
- Wazuh event ID when supplied.
- Deterministic fingerprint fallback for deduplication.
- Wazuh timestamp and ingestion timestamp.
- Agent ID, name, and IP where available.
- Rule ID, description, level, groups, and compliance metadata where available.
- Workflow status: `open`, `acknowledged`, or `resolved`.
- Acknowledgement and resolution actor/timestamps.
- Raw Wazuh payload as PostgreSQL `JSONB`.

Use normalized columns for filtering and ordering. Use `JSONB` for forensic detail, not primary list queries. Index timestamp, level, status, agent, rule ID, and deduplication keys. Retention removes alerts older than 90 days in bounded batches.

`alert_events` records status transitions, actor, timestamp, and structured metadata. This provides the alert workflow timeline independently from the general audit log.

### Wazuh and Agents

The Wazuh adapter authenticates against the configured Wazuh API and fetches `/agents`. It maps API responses into stable application types while retaining enough source metadata for troubleshooting.

Store a bounded agent snapshot or cache record with the last successful sync time. When Wazuh is unavailable, return stale data with an explicit stale flag instead of failing the whole dashboard.

### Audit

Audit events include login success/failure, logout, invite creation/revocation/acceptance, user activation changes, role changes, permission override changes, alert workflow changes, and settings changes. Entries include actor, target, action, timestamp, request metadata, and structured detail without secrets.

## Authentication and Security

Hash passwords with Argon2id using production-safe parameters. Apply password length and compromised/common-password protections without silently truncating input.

Use opaque database-backed sessions. Send session tokens only in `HttpOnly`, `Secure` production cookies with `SameSite=Lax`. Rotate sessions after login and privilege changes. Enforce expiry and revocation server-side.

All mutations require authorization checks in server domain functions, not only hidden UI controls. Validate request bodies and query parameters with schemas. Apply CSRF protection appropriate to cookie-authenticated mutations and check request origin.

The existing plaintext Wazuh API credential in `backend/server.js` must move to environment configuration and be rotated. Production Wazuh TLS must use a trusted system certificate or configured CA certificate. `rejectUnauthorized: false` is allowed only behind an explicit development-only setting.

## Wazuh Alert Integration

Preserve the existing Wazuh integration shape:

1. Wazuh invokes `on-wazuh-server/custom-webhook`.
2. The launcher invokes `custom-webhook.py` with the alert file path.
3. Python reads and parses the Wazuh alert.
4. Python sends the complete payload to the Next.js ingestion endpoint.

Upgrade `custom-webhook.py` to read endpoint URL and shared secret from protected configuration, set a request timestamp, hash the exact request bytes, and send an HMAC-SHA256 signature. The server verifies timestamp freshness, signature equality using constant-time comparison, payload size, schema, and deduplication key before storage.

Use a bounded replay window. Store or derive a replay key from timestamp, signature, and event identity. Return:

- `202 Accepted` when a new alert is persisted.
- `401 Unauthorized` when authentication or signature validation fails.
- `409 Conflict` for duplicate or replayed events.
- `422 Unprocessable Entity` for invalid alert payloads.

The Python client uses explicit connect/read timeouts and bounded exponential backoff. Retry connection failures, timeouts, rate limits with retry guidance, and `5xx` responses. Do not retry other `4xx` responses. Logs must not include secrets, authorization material, or full sensitive responses.

## Alert Query and Polling

Initial alert pages use cursor pagination with deterministic ordering by ingestion timestamp and internal ID. Filters support text search, severity range, workflow status, agent, rule, and date range.

Dashboard polling requests only alerts newer than the last cursor every 3-5 seconds. New rows update counts and a pending-new-alert indicator without moving the user's scroll position or replacing an active table selection. The user can reveal queued rows explicitly.

On transient polling failure, retain current data, show connection state, and use exponential backoff with an upper bound. Restore the normal interval after a successful request.

## User Experience

Apply `DESIGN.md` as the design source:

- White and soft-white canvas.
- Near-black text.
- Emerald `#3ecf8e` used sparingly for primary actions and selected status accents.
- Near-black text on emerald buttons.
- Thin grey hairline borders.
- 6px button radius and 8-12px panel radius.
- No atmospheric gradients.
- Dense technical product UI instead of decorative illustration.

Use `IBM Plex Sans Thai` through `next/font/google` for Thai and English UI. Use system monospace for event IDs, structured data, code, and raw JSON.

Desktop uses a compact sidebar and top bar. Mobile uses a drawer with keyboard and focus management. All controls meet accessible touch-target and contrast requirements.

### Dashboard

Show:

- Wazuh API health and last successful sync.
- Connected, disconnected, pending, and never-connected agent counts.
- Alert totals and severity distribution for useful recent windows.
- Open, acknowledged, and resolved counts.
- Latest alerts table with polling state and queued-new-alert behavior.

### Alerts

Provide filterable, paginated list and detail views. Alert detail includes normalized summary, status controls permitted by RBAC, workflow timeline, and formatted raw JSON. Raw payload rendering must escape content and never use unsafe HTML insertion.

### Agents

Show live or stale Wazuh agent data with status, ID, name, IP, OS, version, manager, node, and last keepalive where available. Clearly distinguish source-unavailable state from an empty agent list.

### Users and Roles

Users UI supports invite generation, activation/deactivation, fixed-role assignment, locale visibility, session revocation where permitted, and permission overrides.

Roles UI documents fixed role defaults and exposes effective permission previews. It does not create custom roles. Permission overrides are edited per user with clear inherited, allowed, and denied states.

### Localization

English is the default locale. Users can switch between English and Thai. Store the selected locale in the user record and apply it on later sessions. Authentication and invite pages use a cookie preference before a user record is available.

## Error Handling

Wazuh API failures return typed application errors and stale cache metadata. Dashboard panels fail independently where possible. Error messages distinguish permission denial, invalid input, unavailable upstream service, and internal failure without exposing stack traces or secrets.

Database constraints provide final protection for unique emails, invite usage, session tokens, and alert deduplication. Route handlers map known domain errors to stable HTTP statuses. Unexpected errors receive request IDs and structured server logs.

## Testing

Use test-driven development for domain behavior and route contracts.

Automated coverage includes:

- Alert normalization and fingerprint generation.
- Alert deduplication and workflow transitions.
- Retention batching.
- Fixed role defaults and permission override precedence.
- Last-`super_admin` protections.
- Password, session, invite, and CSRF behavior.
- HMAC signature, timestamp, replay, and payload-size validation.
- Wazuh adapter success, authentication failure, TLS/configuration failure, malformed response, and stale-cache behavior.
- Route handler status and error mapping.
- Polling queue behavior and backoff.
- English and Thai message coverage for key flows.
- Accessible login, dashboard, alert, invite, user management, and responsive navigation flows.

Playwright covers critical end-to-end flows against a test PostgreSQL database. Standard CI uses fixtures and mocked Wazuh HTTP responses.

Maintain a separate opt-in live acceptance suite. It authenticates to the configured real Wazuh API, checks the agents response, and can submit a marked sample alert through the secured ingestion route. The suite must not print tokens or passwords and must not run without explicit environment flags.

## Operations and Configuration

Required configuration includes PostgreSQL URL, application URL, session secret material, webhook HMAC secret, Wazuh API URL, Wazuh username/password, optional Wazuh CA path, and retention settings.

Provide health checks that distinguish application/database health from Wazuh upstream health. Use structured logs with secret redaction. Scheduled retention and stale-session cleanup must be safe to run repeatedly and concurrently, even though the initial deployment uses one application instance.

Deployment remains undecided. The application should run as a standard self-hosted Node process or in Docker without changing domain code. PostgreSQL is external to the application process in both cases.

## Migration

Replace the invalid root package metadata and create the Next.js application at the repository root. Preserve legacy files until feature parity and live acceptance checks pass. Move reusable sound and favicon assets into the Next.js public directory where still required.

Do not reuse the legacy browser `innerHTML` rendering, in-memory alert archive, open webhook endpoint, hardcoded Wazuh credentials, disabled TLS verification, or persistent WebSocket client array.

After the new app passes verification, update the Wazuh integration scripts and deployment documentation. Legacy Express and static frontend files can then be removed in a separately reviewable task.

## Success Criteria

- A user can accept an invite, set a password, log in, and use English or Thai UI.
- Authorization matches fixed roles plus per-user overrides on both UI and server actions.
- Real Wazuh agents appear through the server-side adapter, with graceful stale-data behavior.
- Signed Wazuh alerts are validated, deduplicated, persisted, searchable, and visible within 3-5 seconds.
- Users with permission can acknowledge and resolve alerts with a complete timeline and audit trail.
- Alerts older than 90 days are removed by a bounded retention job.
- Secrets are absent from source code and logs, TLS verification is enabled in production, and the exposed legacy credential is rotated.
- Responsive dashboard, alert, agent, and user-management views follow `DESIGN.md` and use `IBM Plex Sans Thai`.
- Unit, integration, route, UI, Playwright, build, lint, typecheck, and opt-in live Wazuh verification paths are documented and pass in their intended environments.
