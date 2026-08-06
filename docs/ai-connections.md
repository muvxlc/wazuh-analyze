# AI Connections

Configure chat providers for the in-dashboard assistant (`/chat`) and the
saved-connection Test button. Connections are stored encrypted in the
`ai_connections` table and managed at **`/settings/ai`** (label: *AI Setting*).
Management requires the `settings.manage` permission; using chat requires
`chat.use`. Both are granted to `super_admin` and `admin` by default
(see `src/server/authorization/role-defaults.ts`).

## 1. Required environment

`SETTINGS_ENCRYPTION_KEY` (min 32 chars) must be present in the environment
before any API key is saved. API keys are AES-256-GCM encrypted through the
helpers in `src/server/settings/encryption.ts`. Without this key the dashboard
will refuse to boot (see `src/server/config.ts`). Back it up alongside database
dumps but never inside the dump or in Git — see
[`docs/operations.md`](operations.md) §4.

## 2. Add a connection (UI)

1. Sign in as `super_admin` or `admin`.
2. Open `/settings/ai`.
3. Click **Agnes** to load the default preset:

   | Field      | Value                              |
   | ---------- | ---------------------------------- |
   | Name       | Agnes 2.5 Flash                    |
   | Provider   | OpenAI-compatible                  |
   | Base URL   | `https://apihub.agnes-ai.com/v1`   |
   | Model      | `agnes-2.5-flash`                  |
   | Timeout    | 30000 ms                           |

   Source: `AGNES_PRESET` in `src/app/(dashboard)/settings/ai/page.tsx`.
4. Paste your Agnes API key into the API key field.
5. Tick **default** if this connection should be selected automatically in
   `/chat`, then **Save**.
6. Use **Test** to send a probe through `/api/v1/chat`. Expected reply starts
   with `OK · `.

The form sends `apiKey: null` when the field is left blank, so editing other
fields never overwrites an existing key.

### API-key field is write-only

The API key is never read back to the UI:

- `GET /api/ai/connections` returns only `apiKeySet: boolean`
  (see `src/server/ai/connections.ts`).
- The settings form shows `API key set` / `No API key` instead of the value.
- On edit, leave the password field blank to keep the stored key. To rotate,
  type a new value and save. To remove the key, an explicit clear path must be
  added (currently none exists; deleting the connection is the way to drop it).

LM Studio uses no API key and calls `<base url>/api/v1/chat`
(`http://localhost:1234` by default). OpenAI-compatible calls
`<base url>/chat/completions` with `Authorization: Bearer <key>`.

## 3. Fresh database behavior

Migration `0004` creates the `ai_connections` table but seeds nothing. On a
fresh DB, before any connection is added:

- `GET /api/v1/chat` returns `{ "data": [] }`.
- `POST /api/v1/chat` returns `422 ai_connection_missing`
  (`src/server/ai/connections.ts`).

Add at least one connection at `/settings/ai` (step 2) before using `/chat`.

## 4. Permissions

| Permission       | Grants                          | Source                          |
| ---------------- | ------------------------------- | ------------------------------- |
| `settings.manage`| Add / edit / delete connections | `/api/ai/connections/*` routes  |
| `chat.use`       | `GET`/`POST /api/v1/chat`, `/chat` page | `role-defaults.ts`      |

`Roles UI` is currently read-only (see `docs/progress/HANDOFF_CURRENT.md`);
per-role toggling of `chat.use` is a pending follow-up.

## 5. Security notes

- Never paste real API keys into issues, logs, or chat.
- Treat `SETTINGS_ENCRYPTION_KEY` as a production secret. Rotating it renders
  all stored `ai_connections.api_key` values unrecoverable; re-enter keys via
  `/settings/ai` after a deliberate rotation.
- Verify the Agnes base URL over HTTPS before production use.

## See also

- [Operations, Backup, and Rollback](operations.md) — `SETTINGS_ENCRYPTION_KEY`
  backup/restore contract.
- [Wazuh Integration](wazuh-integration.md) — alert ingestion pipeline.
