# Bug tracking

Bugs are tracked as markdown files in this directory. No external tracker — portable across any VCS (git, jj, Azure DevOps Repos, etc.), no API dependency, no auth, no rate limits. Versioned with the code, auditable through commit history, survives any migration.

## File layout

```
bugs/
├── README.md            ← workflow (this file)
├── _template.md         ← copy to start a new bug
├── assets/              ← screenshots, videos, repros (committed)
├── 001-short-slug.md    ← one file per bug, 3-digit zero-padded id
├── 002-short-slug.md
└── ...
```

State lives in frontmatter. No `open/` vs `closed/` directories — moving files between dirs creates merge friction and obscures rename history. `grep -l "status: open" bugs/*.md` is the canonical "list open bugs."

## Filing a new bug

1. Copy `_template.md` to `bugs/NNN-short-slug.md`. NNN is the next free 3-digit id (ls the directory, take max + 1).
2. Fill in the frontmatter and body. **Steps to reproduce are the single most important field — see the next section.**
3. Drop screenshots / videos under `bugs/assets/` and reference them by relative path.
4. Commit on develop (or a branch + PR per the gitflow rules in CLAUDE.md). One bug = one file = one commit is the easiest unit.

### Steps to reproduce: the most important field

Steps to reproduce are the heart of a bug report. Without precise repro steps, the bug is effectively unfixable from any context other than the original session that filed it. **Assume the reader is a future agent (or a future you) opening this file on a different computer, after a session-clear, or weeks later with no memory of the original report.** They need to follow the steps verbatim and trigger the bug — no extra knowledge, no guesswork, no "you know what I mean."

A bug with strong repro is debuggable across context boundaries and across people. A bug with weak repro dies with the session that filed it.

**Good repro steps:**

- **Numbered**, in execution order. Not bullet points, not prose.
- **URLs / tokens are explicit** — paste the actual `/post/<token>` URL you used, or say "use any trip with at least N photos" when the token doesn't matter. Don't write "the test trip."
- **Trigger gestures are precise** — "scroll down 200 px," "tap Add Photo, pick the first photo in the picker, hit OK." Not "scroll a bit." Not "do the thing."
- **State is established up front** — "Open the app from a cold launch" vs. "Already navigated to /trips/X." Different starting states often produce different bugs.
- **Device / build / browser are recorded** in the Environment section so the reader knows what to match (iPhone 16 Pro vs. Simulator vs. desktop Safari is not the same surface).
- **The final step produces a single, observable outcome** that matches what "Actual results" describes. If the final step has multiple possible outcomes, split it into more steps.

If the repro requires test data, fixtures, or a particular trip state, drop the fixture into `bugs/assets/<id>-*.json` (or a curl command to re-create it) so the reader doesn't have to guess.

If you can't reliably reproduce the bug yet, file it with `status: needs-clarification` and write what you tried. Don't make up steps that look plausible — those are worse than no steps, because they send the reader down a confidently wrong path.

### Use the traditional bug-report headings

Bodies use the canonical QA / QE bug-report shape: **Bug**, **Steps to reproduce**, **Expected results**, **Actual results**, **Environment**, **Screenshots / video**, **Notes for Claude**. The template has them in that order. Use those headings when they apply — they're standard for a reason and they make bugs trivially scannable by anyone (human or agent) who's read a bug report before. The "Notes for Claude" trailing section is the only deviation; it's where fix-surface pointers, related code links, and design-question flags live.

## Bug lifecycle

| State           | Frontmatter `status` | Meaning                                                                |
| --------------- | -------------------- | ---------------------------------------------------------------------- |
| Open            | `open`               | Filed, not yet being worked on                                          |
| In progress     | `in-progress`        | Claude (or an agent) has started a fix                                  |
| Closed (fixed)  | `closed`             | Fixed and shipped. `fixed-by` field links the PR / commit               |
| Closed (won't fix) | `wontfix`         | Acknowledged, not going to be fixed (with reason in the body)           |
| Needs design    | `needs-design`       | Real bug but the resolution requires a design decision before code      |
| Needs clarification | `needs-clarification` | Cannot reproduce or important detail missing                       |

State transitions are just edits to the frontmatter. Don't rename or move files between dirs.

## Linking bugs to PRs

- PR body should reference the bug: `Fixes bug 003` or `Addresses bugs 001, 002`.
- After merge: update the bug file's frontmatter to `status: closed` and set `fixed-by: PR #N` (or commit SHA).
- The PR that fixes the bug should include the frontmatter status update — same commit as the code fix.

## Severity

| Severity      | Meaning                                                            |
| ------------- | ------------------------------------------------------------------ |
| `blocker`     | Feature unusable; ships before polish work                          |
| `important`   | Feature usable but visibly / functionally broken                    |
| `polish`      | Minor visual or UX issue; can sit behind more urgent work           |

## Surface taxonomy

Use the most specific that fits:

- `ios-app/<page>` — iOS shell, named page (`ios-app/post-page`, `ios-app/trips-page`, etc.)
- `web/<browser>` — non-shell browser (`web/ios-safari`, `web/mobile-other`, `web/desktop`)
- `api` — backend endpoints
- `infra` — Azure / CI / build / deploy
- `tests` — test infra itself broken
- `tooling` — local dev scripts, hooks, etc.

## Repros that become tests

When fixing a bug whose repro is automatable, write the repro as a Playwright test in `tests/playwright-layout/*.spec.js` (or wherever fits) **before** writing the fix. The test should fail on current `develop` and pass after the fix. That converts the bug into a permanent regression guard — same philosophy as the Layer 1 layout suite. Reference the test file from the bug's `regression-test` frontmatter field.

## What this is NOT

- A roadmap or feature tracker. Feature work belongs in design docs / implementation plans (`docs/implementation-plans/`).
- A discussion board. Design questions about a fix live in the bug body under "Notes" or in the PR.
- A status report. Anyone wanting "what's the bug count" runs `grep -c '^status: open$' bugs/*.md`.
