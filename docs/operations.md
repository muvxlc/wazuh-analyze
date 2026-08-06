# Operations, Backup, & Rollback

This operational reference outlines monitoring, routine maintenance, and disaster recovery procedures.

AI chat connection setup: [`docs/ai-connections.md`](ai-connections.md).

## 0. Alert Resync

Historical alert recovery procedure: [`docs/resync-alerts.md`](resync-alerts.md). Run `resync-archive.py` on Wazuh Manager against configured archive JSONL. Confirm `sent`, `duplicate`, `invalid`, and `failed` counts before removing or rotating source archives.

## 1. Health Monitoring

The dashboard exposes automated diagnostic check endpoints:
- `GET /api/health/live` — Returns HTTP 200 indicating basic runtime accessibility.
- `GET /api/health/ready` — Validates database reachability and readiness.
- `GET /api/health/wazuh` — Performs active Wazuh API verification test.

## 2. Routine Maintenance Scheduling

Configure daily automated execution of database cleanup scripts via system cron or equivalent job scheduler:

```bash
# Daily session cleanup at 02:00 AM
0 2 * * * cd /opt/wazuh-alert-dashboard && npx tsx scripts/cleanup-sessions.ts >> /var/log/dashboard-maintenance.log 2>&1

# Daily alert database retention pruning at 02:30 AM
30 2 * * * cd /opt/wazuh-alert-dashboard && npx tsx scripts/run-retention.ts >> /var/log/dashboard-maintenance.log 2>&1
```

## 3. Credential Rotation

When rotating webhook HMAC secrets:
1. Update `WEBHOOK_HMAC_SECRET` in `/opt/wazuh-alert-dashboard/.env.production`.
2. Restart dashboard system service: `systemctl restart wazuh-alert.service`.
3. Update `WAZUH_WEBHOOK_SECRET` across Wazuh Manager integration hosts.
4. Restart Wazuh manager: `systemctl restart wazuh-manager`.

## 4. Database Backup & Restore

> WARNING: `system_settings` stores encrypted secrets (Wazuh credentials, HMAC
> keys, etc.) using AES with `SETTINGS_ENCRYPTION_KEY`. A restore is only
> usable if the **same** `SETTINGS_ENCRYPTION_KEY` (min 32 chars, see
> `src/server/config.ts`) is configured on the target environment. Back up
> that key alongside the dump but store it in a secret manager, never in the
> dump file or alongside code. Rotating the key renders existing
> `system_settings` values unrecoverable.

Application tables: `users`, `invites`, `sessions`, `permission_overrides`,
`audit_events`, `system_settings`, `webhook_replay_keys`, `alerts`,
`alert_events`, `agent_snapshots`, `agent_tags`
(see `src/test/postgres/reset.ts`).

### 4.1 Full logical backup (custom format, compressed)

```bash
# Set connection once; prefer a dedicated least-privilege backup role.
export DATABASE_URL="postgresql://user:password@localhost:5432/dashboard"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
pg_dump "$DATABASE_URL" -F c -Z 6 -v \
  -f "/backups/dashboard-${STAMP}.dump"

# Record the current encryption key fingerprint (not the key itself):
printf '%s\n' "$(sha256sum <<<"$SETTINGS_ENCRYPTION_KEY" | cut -d' ' -f1)" \
  > "/backups/dashboard-${STAMP}.key-sha256"

# Retain only the last 14 full dumps.
ls -1t /backups/dashboard-*.dump | tail -n +15 | xargs -r rm -f
```

### 4.2 Configuration-only backup (system_settings, users, invites)

Lightweight nightly snapshot for credential / user recovery:

```bash
pg_dump "$DATABASE_URL" -F c -Z 6 \
  -t system_settings -t users -t invites -t permission_overrides \
  -f "/backups/config-${STAMP}.dump"
```

### 4.3 Restore to a target environment

1. Confirm target DB is reachable and empty, or use a fresh database to avoid
   constraint clashes (oids differ between environments).
2. **Verify the encryption key first** — restoring without the matching
   `SETTINGS_ENCRYPTION_KEY` bricks all encrypted `system_settings` rows:

   ```bash
   # Must match the *.key-sha256 captured at backup time.
   sha256sum <<<"$SETTINGS_ENCRYPTION_KEY"
   ```

3. Restore data (custom format):

   ```bash
   pg_restore -d "$DATABASE_URL" -v --no-owner --no-privileges \
     /backups/dashboard-<STAMP>.dump
   ```

   For a config-only restore into an already-migrated DB, restrict to those
   tables and use `--data-only`:

   ```bash
   pg_restore -d "$DATABASE_URL" -v --data-only --no-owner \
     -t system_settings -t users -t invites -t permission_overrides \
     /backups/config-<STAMP>.dump
   ```

4. Re-run pending Drizzle migrations if schema changed:
   `npx drizzle-kit migrate`.
5. Restart services and verify:
   ```bash
   systemctl restart wazuh-alert.service
   curl -fsS https://dashboard.example.com/api/health/ready
   ```
6. Smoke-test Wazuh integration via `GET /api/health/wazuh`. A 401 / TLS error
   after a `system_settings` restore almost always means the encryption key
   differs from the source — do not attempt manual row edits; re-encrypt via
   the settings UI instead.

## 5. Rollback Procedures

If an upgrade introduces breaking issues:
1. Revert deployment binary to prior confirmed Git commit hash.
2. If database schema migrations occurred, restore DB state from backup snapshot taken immediately prior to migration execution.
3. Restart services and verify functionality against `/api/health/ready` endpoints.
