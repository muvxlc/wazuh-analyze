# Deployment Guide

This document defines standard deployment procedures for the Next.js Wazuh Dashboard.

## 1. Environment Configuration

Copy `.env.example` to `.env.production` and configure all required variables:

```bash
NODE_ENV=production
DATABASE_URL=postgresql://user:password@localhost:5432/dashboard
APP_URL=https://dashboard.example.com
SESSION_SECRET=replace-with-secure-32-character-random-string
WEBHOOK_HMAC_SECRET=replace-with-secure-32-character-random-string
WEBHOOK_MAX_BODY_BYTES=1048576
WEBHOOK_REPLAY_WINDOW_SECONDS=300
ALERT_RETENTION_DAYS=90
MAINTENANCE_BATCH_SIZE=1000
WAZUH_API_URL=https://wazuh.example.com:55000
WAZUH_USERNAME=wazuh-api-user
WAZUH_PASSWORD=wazuh-api-password
WAZUH_CA_PATH=/etc/ssl/certs/wazuh-ca.pem
WAZUH_ALLOW_INSECURE_TLS=false
```

## 2. Database setup and migration

Apply Drizzle migrations to setup initial database schema:
```bash
npm run db:migrate
```

Seed initial super_admin account:
```bash
npx tsx scripts/seed-admin.ts superadmin@example.com your-secure-initial-password
```

## 3. Node.js self-hosted systemd configuration

Place `wazuh-alert.service` into `/etc/systemd/system/wazuh-alert.service`. Modify paths and user credentials as appropriate.

```bash
systemctl daemon-reload
systemctl enable wazuh-alert.service
systemctl start wazuh-alert.service
```

## 4. Reverse Proxy & TLS Configuration

Expose the Next.js server through Nginx with HTTPS enabled.

```nginx
server {
    listen 443 ssl http2;
    server_name dashboard.example.com;

    ssl_certificate /etc/letsencrypt/live/dashboard.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dashboard.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3456;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 5. Wazuh Custom Webhook integration deployment

Deploy `on-wazuh-server/custom-webhook` and `on-wazuh-server/custom-webhook.py` to `/var/ossec/integrations/` on your Wazuh Manager node as `custom-analyze` and `custom-analyze.py`.
Set appropriate filesystem execution permissions and populate `/var/ossec/integrations/custom-analyze.env` according to `on-wazuh-server/custom-webhook.env.example`.
