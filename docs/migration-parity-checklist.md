# Migration & Parity Checklist

This checklist confirms complete feature and architectural parity before legacy runtime removal.

## Parity Verification Matrix

- [x] **Alert Ingestion:** Exact-byte HMAC signed payload verification, duplicate replay prevention, timestamp verification window.
- [x] **Authentication & Access Control:** Argon2 password hashing, secure cookie storage, CSRF mitigation, granular RBAC (super_admin, admin, user).
- [x] **Dashboard Interface:** Real-time polling alert feed, severity sorting, agent inventory management, bilingual localization (English/Thai).
- [x] **Operations & Maintenance:** Bounded batch cleanup of expired sessions and historical alert retention pruning.
- [x] **Live Integration & E2E Validation:** Playwright E2E suite covering complete workflow paths and Vitest live integration suites.

## Legacy Deprecation Gate

Legacy Node.js runtime (`backend/server.js`) and HTML frontend (`frontend/`) have been removed. Before production cutover verify:
1. All end-to-end acceptance verification suites pass (`npm run test`, `npm run test:e2e`, `npm run test:live`).
2. Production data ingestion operates stable on Next.js pipeline for minimal 72-hour operational window.
3. Complete database backups are created and confirmed verifiable via mock restore operations.
