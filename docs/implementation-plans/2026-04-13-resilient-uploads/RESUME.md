# Phase 5 Resume — 2026-04-18

**Read this file before invoking `/ed3d-plan-and-execute:execute-implementation-plan`.**

This plan has 7 phases total. Only **Phase 5** is the target of the next execution session. All other phases are either merged (1–4) or future work (6–7). **Do not touch them.**

Phase 5 itself is partially complete. The table below is the source of truth for what's done vs outstanding. The skill's just-in-time phase reader should skip any task with a commit SHA in this table and only dispatch subagents for the tasks listed under **Remaining**.

## Completed in earlier sessions

- Phases 1, 2, 3, 4 — merged to `main` and deployed to production. Do not re-execute.
- `2026-04-16-oversize-image-compression` plan — also shipped. Not relevant here.

## Phase 5 completion status (as of commit `cb5c245`)

| Task | Subcomponent | Status | Commit |
|---|---|---|---|
| 0 | 0 (plan revisions) | ✅ Done | `48e3954` |
| 1 | A (handoff doc) | ✅ Done | `ddee2af` |
| 2 | A (decisions doc) | ✅ Done (Team ID `GP2M7H6R3U` filled, all Apple-portal prereqs complete) | `340b04b`, `096a436`, `cb5c245` |
| 3 | B (bundle builder) | ✅ Done — `npm run build:bundle` verified | `58c860c` |
| 4 | B (CORS + route) | ✅ Done — `dotnet build` clean | `0d318ae` |
| 5 | C (Capacitor scaffold) | ⬜ **Remaining** — `[WSL]` in this container |
| 6 | C (bootstrap loader) | ⬜ **Remaining** — `[WSL]` |
| 7 | C (platform adapters) | ⬜ **Remaining** — `[WSL]` |
| 8 | C (iOS CSS) | ✅ Done | `18d2502` |
| 9 | D (bootstrap tests) | ⬜ **Remaining** — `[WSL]` |
| 10 | E (TestFlight signing) | ⏸ Deferred — `[Mac — Xcode]` only. Skip in container session. |
| 11 | E (device smoke) | ⏸ Deferred — `[Mac — Xcode]` only. Skip in container session. |
| 12 | F (deployment runbook) | ⬜ **Remaining** — `[WSL]` |

## Remaining (this session's target)

Execute exactly these five tasks in order: **5 → 6 → 7 → 9 → 12**.

- Task 5 generates the `ios/App/` tree via `npx cap add ios`. Large committed surface — do it as its own commit.
- Task 6 is the meatiest: ~150 LOC `src/bootstrap/loader.js` + companion HTML. Dispatch `task-implementor-fast` with the phase file path.
- Task 7 adds platform-adapter seams (minor surgery on two existing JS files).
- Task 9 implements the 5 unit-test scenarios for Task 6's loader (AC9.1–9.5). **Depends on Task 6.**
- Task 12 appends a Phase 5 section to `deployment-runbook.md`.

After Task 12 completes, the phase is ready for Mac handoff (Tasks 10, 11). Do NOT attempt Tasks 10 or 11 in this container — they require Xcode.

## Code review scope

When the skill runs per-phase code review after Tasks 5–7, 9, 12:

- **BASE_SHA:** `cb5c245` (this file's commit ancestor — the last commit before the new session starts executing Phase 5 code tasks).
- **HEAD_SHA:** current HEAD at review time.
- **PLAN_OR_REQUIREMENTS:** only Tasks 5, 6, 7, 9, and 12 from `phase_05.md`. The reviewer should **not** re-review commits from `48e3954…18d2502` range — those were reviewed when made.

## Environment notes (re-verify if uncertain)

- Container is Linux, Ubuntu 24.04, aarch64. See memory `reference_mac_dev_topology`.
- `dotnet 8.0.420` installed in `/usr/share/dotnet` with symlink at `/usr/local/bin/dotnet` (throwaway install; vanishes on container rebuild). `dotnet build RoadTripMap.sln --configuration Release` works.
- `node -v` is 20+. `npm ci` from repo root works.
- `git push` from this container requires the credential-helper override documented in memory `reference_container_git_push.md`:
  ```
  git -c credential.helper= -c credential.helper='!gh auth git-credential' \
      -c credential.https://github.com.helper= -c credential.https://github.com.helper='!gh auth git-credential' \
      push origin develop
  ```

## Kickoff prompt (what to paste after `/clear`)

```
Read /workspaces/road-trip/docs/implementation-plans/2026-04-13-resilient-uploads/RESUME.md first — it tells you which Phase 5 tasks are already done and which remain. Then invoke /ed3d-plan-and-execute:execute-implementation-plan with plan dir /workspaces/road-trip/docs/implementation-plans/2026-04-13-resilient-uploads and working dir /workspaces/road-trip, scoped to Phase 5 only, executing only the tasks marked "Remaining" in RESUME.md (Tasks 5, 6, 7, 9, 12 — skip all others).
```
