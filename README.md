# Wazuh Alert Dashboard

Next.js operational dashboard for Wazuh monitoring, featuring real-time signed webhook ingestion, robust access controls, bilingual support (EN/TH), and operational management tools.

## Architecture & Features

- **Runtime:** Next.js (Node.js/React 19)
- **Database:** PostgreSQL via Drizzle ORM
- **Security:** HMAC-SHA256 signature verification, role-based administration policy (RBAC), and session expiration controls.
- **Wazuh Integration:** Exact-byte signed payload transport via Python 3 custom webhook client on Wazuh server.
- **Operations:** Maintenance scripts for bounded session cleanup and database retention, production-ready systemd configuration.

## Quick Start

### Requirements
- Node.js 22+
- PostgreSQL 16+
- Python 3 on Wazuh Manager node

### Setup

```bash
cp .env.example .env.local
npm install
npm run db:migrate
npx tsx scripts/seed-admin.ts admin@yourdomain.com your-secure-password
```

Populate all required values in `.env.local`. Never commit `.env.local` or real credentials.

### Run Locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## Documentation

- [Deployment and Hosting](docs/deployment.md)
- [Wazuh Integration](docs/wazuh-integration.md)
- [Operations, Backup, and Rollback](docs/operations.md)
- [Migration and Parity Checklist](docs/migration-parity-checklist.md)
