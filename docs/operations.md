# Operations, Backup, & Rollback

This operational reference outlines monitoring, routine maintenance, and disaster recovery procedures.

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

### Backup
Create logical schema and data dumps using Postgres standard tools:
```bash
pg_dump postgresql://user:password@localhost:5432/dashboard -F c -b -v -f /backups/dashboard-backup.dump
```

### Restore
```bash
pg_restore -d postgresql://user:password@localhost:5432/dashboard -c /backups/dashboard-backup.dump
```

## 5. Rollback Procedures

If an upgrade introduces breaking issues:
1. Revert deployment binary to prior confirmed Git commit hash.
2. If database schema migrations occurred, restore DB state from backup snapshot taken immediately prior to migration execution.
3. Restart services and verify functionality against `/api/health/ready` endpoints.
