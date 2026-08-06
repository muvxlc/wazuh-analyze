# Wazuh Alert Resync Guide

Use `resync-archive.py` to replay historical Wazuh alerts into dashboard after dashboard downtime, database recovery, or webhook delivery failure.

Resync runs on Wazuh Manager. It reads an archive file and sends each alert through the existing signed endpoint:

```text
Wazuh archive JSONL -> resync-archive.py -> POST /api/integrations/wazuh/alerts -> PostgreSQL
```

## Before Start

1. Confirm dashboard is running and reachable from Wazuh Manager.
2. Confirm `WAZUH_WEBHOOK_URL` points to dashboard, not `localhost` on Wazuh Manager.
3. Confirm `WAZUH_WEBHOOK_SECRET` matches dashboard `WEBHOOK_HMAC_SECRET`.
4. Confirm archive logging is enabled on Wazuh.
5. Use the Wazuh alert JSON source. On this deployment the correct source is:

```text
/var/ossec/logs/alerts/alerts.json
```

Other files have different meanings:

```text
/var/ossec/logs/alerts/2026/Aug/ossec-alerts-04.json  # rotated alert JSON
/var/ossec/logs/archives/archives.json                 # all events, including records without rule fields
*.sum                                                   # checksum files, never resync
*.log                                                   # plain text, not accepted by this script
```

Archive paths differ by Wazuh version/configuration. Do not guess. Verify the file contains one JSON object per line and alert records include `rule.id`, `rule.level`, and `rule.description`. The current script targets alert JSON, not generic event archives.

## Install

Copy the script to Wazuh Manager:

```bash
sudo cp on-wazuh-server/resync-archive.py /var/ossec/integrations/resync-archive.py
sudo chown root:wazuh /var/ossec/integrations/resync-archive.py
sudo chmod 750 /var/ossec/integrations/resync-archive.py
```

Use the same protected environment file as `custom-analyze`:

```text
/var/ossec/integrations/custom-analyze.env
```

Required variables:

```env
WAZUH_WEBHOOK_URL=http://<dashboard-host>:3456/api/integrations/wazuh/alerts
WAZUH_WEBHOOK_SECRET=<same-secret-as-dashboard>
```

Optional retry variables are also supported:

```env
WAZUH_WEBHOOK_CONNECT_TIMEOUT=3
WAZUH_WEBHOOK_READ_TIMEOUT=10
WAZUH_WEBHOOK_MAX_ATTEMPTS=4
WAZUH_WEBHOOK_MAX_BACKOFF=60
```

## Safe Environment Loading

Do not put the secret directly in the command line. Load the protected environment file in a root-owned shell, then run as `wazuh`:

```bash
sudo sh -c '
  set -a
  . /var/ossec/integrations/custom-analyze.env
  set +a
  exec su -s /bin/sh wazuh -c "/var/ossec/framework/python/bin/python3 /var/ossec/integrations/resync-archive.py \"$1\" --dry-run"
' -- /var/ossec/logs/alerts/alerts.json
```

For simpler manual use, the repository also documents an `env $(cat ... | xargs)` form. Use the protected-shell form in production because command arguments can be visible to other users.

## Dry Run

Dry-run validates JSON records and counts alerts without sending them:

```bash
sudo sh -c '
  set -a
  . /var/ossec/integrations/custom-analyze.env
  set +a
  exec su -s /bin/sh wazuh -c "/var/ossec/framework/python/bin/python3 /var/ossec/integrations/resync-archive.py --dry-run \"$1\""
' -- /var/ossec/logs/alerts/alerts.json
```

Expected output:

```text
resync: sent=120, duplicate=0, invalid=2, failed=0
```

`sent` means valid records in dry-run. No HTTP request is made.

## Resync

Run the same command without `--dry-run`:

```bash
sudo sh -c '
  set -a
  . /var/ossec/integrations/custom-analyze.env
  set +a
  exec su -s /bin/sh wazuh -c "/var/ossec/framework/python/bin/python3 /var/ossec/integrations/resync-archive.py \"$1\""
' -- /var/ossec/logs/alerts/alerts.json
```

Result example:

```text
resync: sent=120, duplicate=85, invalid=2, failed=0
```

Meaning:

- `sent`: dashboard accepted a new alert (`200` or `202`)
- `duplicate`: dashboard returned `409`; alert already exists and is safe to skip
- `invalid`: malformed/non-object archive record skipped
- `failed`: delivery failed or dashboard returned another terminal status

Exit code is `0` when there are no invalid or failed records. Exit code is `1` when invalid or failed records exist.

## Resume After Interruption

The script processes records serially. If a run stops after line 50,000, resume from the next known line:

```bash
... resync-archive.py --from-line 50001 /var/ossec/logs/alerts/alerts.json
```

`--from-line` is a manual resume aid, not a database checkpoint. If the exact stop position is unknown, rerun the full file. Server-side unique constraints make reruns safe.

Compressed archives are supported:

```bash
... resync-archive.py /var/ossec/logs/alerts/alerts.json.gz
```

## Rerun and Resolved Alerts

Rerun is safe. Dashboard deduplication uses `wazuhEventId` and fingerprint constraints.

If an alert was already resolved before resync:

```text
HTTP 409 duplicate
status remains resolved
resolved_at remains unchanged
resolved_by_user_id remains unchanged
no human workflow event is created
```

Resync never reopens or overwrites analyst decisions. A genuinely new Wazuh event with a new identity is stored as a new open alert.

## Failure Handling

The script retries:

- connection errors
- request timeouts
- HTTP `429`
- HTTP `5xx`

It creates a fresh webhook timestamp and HMAC for every request. This is required because dashboard webhook timestamps have a limited replay window.

It does not retry permanent `4xx` responses such as `401` or `422`. Check:

```bash
# Dashboard logs
journalctl -u wazuh-alert.service -n 100 --no-pager

# Wazuh integration logs
sudo tail -n 100 /var/ossec/logs/integrations.log
```

Common causes:

- `401`: secret mismatch, expired clock, invalid signature
- `422`: archive record does not match Wazuh alert schema
- `413`: payload exceeds dashboard body limit
- network failure: dashboard host/port/firewall unavailable

Do not delete archive files until resync output has been checked and failures are resolved.

## Production Rules

- Run one resync worker at a time for a given archive.
- Keep archive files read-only during recovery.
- Do not point resync at a test dashboard or test database accidentally.
- Do not run `npm test` or test database reset commands against production.
- Keep `custom-analyze.env` owner-readable and never commit it.
- Back up dashboard PostgreSQL before destructive maintenance.
- Resync is recovery tooling, not a replacement for durable live webhook delivery or database backups.
