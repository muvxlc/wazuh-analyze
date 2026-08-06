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

## Subagent Model

OpenCode global config maps all available subagents to `9router/agnes/agnes-2.5-flash`. Config changes require quitting and restarting OpenCode before dispatching more subagents.
