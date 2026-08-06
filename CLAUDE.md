# Project Rules

## Execution

- Default to parallelism. When work splits into independent pieces (search, exploration, unrelated edits, per-file tasks), dispatch multiple subagents in a single message so they run concurrently — up to **10 at once**.
- Only serialize when tasks genuinely conflict: same file write, shared mutable state, or a hard dependency where step B needs step A's result. If unsure, check for overlapping file paths; no overlap → parallelize.
- Keep each subagent prompt scoped and self-contained: goal, exact paths/line numbers, constraints, and the requested output shape (conclusions, diffs, commands — not file dumps). Feed them the context they need; do not assume they share this session.
- Prefer `Explore` for read-only fan-out (locate code, map a surface, answer a question), the `Plan` agent for design, and typed `general-purpose`/specialist agents for isolated edits. Verify their conclusions before building on them.
- Parallelize even within one phase: multiple `Explore` agents over different subsystems beat one agent reading everything.

## Context Discipline

- Read only files needed for current task. Start with `rg` to locate symbols, routes, and tests.
- Read relevant line ranges, not whole large files, unless file is small or full context is required.
- Do not re-read unchanged files after a successful edit or check.
- Avoid dumping full logs, full diffs, generated files, or long documentation into context. Summarize with `tail`, focused ranges, or counts.
- Do not load provider/API documentation unless task touches that provider or API.
- Keep subagent prompts scoped. Request conclusions, paths, line numbers, risks, and commands only; never request file dumps.
- Split large work into phases: explore, implement, verify. Start a fresh session when context becomes crowded.

## Implementation

- Keep changes scoped to the requested feature. Prefer existing patterns and installed dependencies.
- Use the smallest working diff. No speculative abstractions, refactors, or feature flags.
- Validate at trust boundaries: request schemas, authentication, permissions, CSRF, external API responses, and secrets.
- Never expose API keys, passwords, session secrets, or decrypted settings in responses, logs, tests, or UI.
- Store persisted provider secrets with the existing settings encryption helpers.
- Keep UI free of database access. Use server routes and services.
- Preserve legacy behavior when changing shared config; add fallback before removing old paths.

## Verification

- Run focused tests first, then full checks only at the final gate.
- Prefer concise output, for example:
  - `npx vitest run <focused-files> 2>&1 | tail -40`
  - `npx tsc --noEmit`
  - `npm run lint 2>&1 | tail -40`
- Report failed tests and skipped checks exactly. Do not claim end-to-end verification without running the app.
- For DB migrations, run `npm run db:generate`, inspect SQL, apply it to the intended database, and verify the table/indexes. `npm run db:migrate` may hang in this project; do not wait indefinitely.

## Handoff

- Keep `MEMORY.md` as an index only. Store one non-obvious fact per memory file.
- Before a context reset, write a short handoff containing current state, changed files, blockers, tests, and next command.
- Do not save facts already clear from code, git history, or `AGENTS.md`.
