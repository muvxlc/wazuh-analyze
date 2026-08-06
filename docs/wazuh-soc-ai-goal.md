# Goal: Wazuh SOC AI Completion & Refinement

Use this document via `/goal` to drive autonomous, sequential execution of the remaining SOC features. 

**CRITICAL DISCIPLINE (Autonomous Process Logging):**
You must write your progress, context, and a small handoff into `docs/AUTONOMOUS_JOURNAL.md` after EVERY single task or checkpoint completion. Before you exit or shift to a new task, document:
1. What was just done (commit hash).
2. The current baseline test count (Unit + Integration).
3. Any blocked items or trade-offs made (`ponytail:` notes).
4. The exact NEXT task to execute.
If you crash or hit a context limit, the next agent must be able to read `docs/AUTONOMOUS_JOURNAL.md` and resume seamlessly without asking the user.

**PARALLELISM RULE (Subagent Fan-out):**
You may dispatch work to **up to 10 subagents at once** (`Agent` tool, batch in a single message). If the planned tasks/files do NOT overlap (no shared file writes, no shared mutable state, no hard dependency where step B needs step A's result), **run them concurrently** — do not serialize independent work. Overlap check: scan the file paths each subagent will touch; no intersection → parallelize. Serialize ONLY when tasks conflict on the same file or have a true data dependency. Prefer `Explore` for read-only fan-out and typed `general-purpose` agents for isolated edits.

---

## Task 1: Mainline Integration & Cleanup
**Branch:** `feature/soc-phase-5` (current)
1. Run final integration gate: `npx vitest run --maxWorkers=1`.
2. Clean up `runner.ts`: Change `ActorContext.userId` in `src/server/authorization/permissions.ts` to `string | null` instead of type casting `null as any`. Fix TS errors globally (e.g. `audit-service`).
3. Merge `feature/soc-phase-5` into `main` and push.

## Task 2: Reliable Background Jobs (pg-boss)
**Branch:** `main` → new branch `feature/pg-boss`
Replace the in-memory daemon (`runner.ts`) and fire-and-forget background blocks with `pg-boss`.
1. `npm install pg-boss`.
2. Add migration for pg-boss schema.
3. Replace Next.js instrumentation daemon with a proper pg-boss worker init.
4. Refactor `analyzeBacklog` (Phase 5.1) and `dispatchNotificationBackground` (Phase 3) into idempotent pg-boss jobs.
5. Add retry policies (e.g. exponential backoff for AI connection failures).
6. Commit & run baseline tests. Write to Journal.

## Task 3: Vulnerability Detection Inventory (Indexer)
**Branch:** `main` → new branch `feature/vuln-inventory`
Wazuh 4.14.7 REST API lacks `/vulnerability` endpoints. Build an Elasticsearch/Opensearch client to query the `wazuh-states-vulnerabilities-*` index.
1. Add generic ES client wrapper in `src/server/wazuh/indexer.ts` (using wazuh api credentials).
2. Build fetcher for vulnerabilities by Agent ID.
3. Integrate into `src/server/enrichment/context-builder.ts` (budget ~3KB for critical CVEs).
4. Commit & run baseline tests. Write to Journal.

## Task 4: Approval-Gated Actions
**Branch:** `main` → new branch `feature/approval-actions`
Move from "recommend-only" AI verdicts to executable Wazuh active-responses.
1. Schema: `actions` (proposed, approved, executed, rejected) + `action_approvals`.
2. Permissions: `actions.propose`, `actions.approve`, `actions.execute`.
3. Worker (pg-boss): Job to call Wazuh `PUT /active-response`.
4. UI: Action proposal cards in Incident Detail view with Approve/Reject buttons.
5. Commit & run baseline tests. Write to Journal.

## Task 5: Scheduled Reports & Case Management
**Branch:** `main` → new branch `feature/soc-reports`
1. Schema: `case_notes` (thread on incidents) and `reports` (scheduled jobs).
2. UI: Incident thread for Analyst notes.
3. Job: pg-boss cron job to aggregate weekly metrics (from Phase 4) and dispatch via Notification channels.
4. Commit & run baseline tests. Write to Journal.

---

**Checkpoint criteria for EVERY task:**
- `npx tsc --noEmit`
- `npm run lint`
- `npx vitest run --project unit` (must be ≥315 passing)
- Document state in `docs/AUTONOMOUS_JOURNAL.md`.
