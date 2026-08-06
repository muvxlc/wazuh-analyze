# Project Continuity Rules

## Source of Truth

- Approved design: `docs/superpowers/specs/2026-08-02-nextjs-dashboard-redesign-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-02-nextjs-wazuh-dashboard.md`
- Human-readable handoff: `docs/progress/NEXTJS_WAZUH_DASHBOARD.md`
- SDD ledger: `.superpowers/sdd/2026-08-02-nextjs-wazuh-dashboard/progress.md`
- Obsidian mirror: `/Users/kittisak.s/Desktop/obsidian/Wazuh Alert Dashboard.md`

## Mandatory Progress Updates

Update progress records whenever any of these events occurs:

1. Before dispatching a task, record task number, status, base commit, and next action.
2. After an implementer returns, record result, commit, tests, concerns, and whether review is pending.
3. After every review or re-review, record verdict and every open, fixed, deferred, or parked finding.
4. On any blocker or user decision, record exact blocker evidence and ruling.
5. Before ending or restarting a session, refresh current branch, HEAD, worktree status, active task, next command, and unresolved risks.

Always update both:

- `.superpowers/sdd/2026-08-02-nextjs-wazuh-dashboard/progress.md` for machine/task recovery.
- `docs/progress/NEXTJS_WAZUH_DASHBOARD.md` for human recovery.

Also update `/Users/kittisak.s/Desktop/obsidian/Wazuh Alert Dashboard.md` when external-directory access is available. If unavailable, record `Obsidian sync pending` in the repository handoff instead of skipping silently.

Never mark a task complete before implementation verification and required review are clean. Never infer completion from an implementer report alone.

## Resume Procedure

1. Read this file.
2. Read `docs/progress/NEXTJS_WAZUH_DASHBOARD.md`.
3. Read SDD ledger.
4. Run `git status --short --branch` and `git log --oneline -10` in active worktree.
5. Resume first task not marked complete in ledger.
6. Keep legacy removal Task 12 blocked until parity evidence and explicit user approval.

## Wazuh Resync Rules

- Production live trigger remains `custom-analyze` -> `custom-analyze.py` -> `POST /api/integrations/wazuh/alerts`.
- Historical recovery uses `on-wazuh-server/resync-archive.py` on Wazuh Manager, reading configured JSONL archive files (`/var/ossec/logs/archives/` or `/var/ossec/archives/`). Do not add dashboard startup resync or direct DB writes.
- Run with Wazuh bundled Python and variables from protected `custom-analyze.env`:
  `sudo -u wazuh env $(sudo cat /var/ossec/integrations/custom-analyze.env | grep -v '^#' | xargs) /var/ossec/framework/python/bin/python3 /var/ossec/integrations/resync-archive.py --dry-run /path/to/alerts.json`
- Resync must sign each request with fresh current timestamp/HMAC. `200`/`202` means sent; `409` means duplicate and successful completion. Retry network, timeout, `429`, and `5xx`; preserve source archive on all failures.
- `--from-line N` resumes a known JSONL interruption. `--dry-run` validates/counts without sending. Reruns must be safe through server unique deduplication.
- Replaying an alert already `resolved` must never reopen, overwrite workflow fields, or add a human status transition. New Wazuh event IDs/timestamps create new alert rows; occurrence grouping requires a separate model.
- Never point tests at dev/production DB. `compose.test.yml` is disposable; persistent local development uses `compose.dev.yml` and `wazuh_dashboard_dev`.

## Subagent Model

OpenCode global config maps all available subagents to `9router/agnes/agnes-2.5-flash`. Config changes require quitting and restarting OpenCode before dispatching more subagents.
