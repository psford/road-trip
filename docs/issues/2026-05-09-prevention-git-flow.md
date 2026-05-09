# Prevention Plan: develop → main git-flow

**Date:** 2026-05-09
**Author:** Claude (assistant)
**Status:** Proposed — pending review and ratification by Patrick
**Companion:** `docs/issues/2026-05-09-rca-git-flow-catastrophe.md`

## Goal

Make a recurrence of the develop → main drift catastrophe **structurally impossible**, not merely "unlikely if Claude is careful." This means changes that hold even when the assistant makes a mistake, by:

1. **Authoritative rules in CLAUDE.md** that remove ambiguity about the merge strategy
2. **Pre-flight checks** Claude must run before opening any develop → main PR
3. **Verification** that the rules and checks actually prevent the failure (red-team style — try to break them)
4. **Detection** so that drift, if it ever does occur, surfaces immediately

## The single most important rule

**develop → main always uses "Create a merge commit" (regular merge), never "Squash and merge" or "Rebase and merge".**

That's it. That one rule, if followed, eliminates the failure mode entirely. Everything else in this document is reinforcement to make sure that rule gets followed.

Why regular merge for develop → main:
- develop and main stay structurally in sync (main's tip → develop's tip via the merge commit)
- The merge base for the next develop → main PR is develop's previous tip, not some ancient commit
- No phantom commits, no force-pushes, no rebase needed
- main's history is more verbose, but that's the trade-off the project chose for 60+ PRs and it worked

Why feature → develop is **still squash** (unchanged):
- Feature branches are short-lived and have intermediate commits we don't want in the long-term history
- The squash sits on develop, gets carried into main as part of develop's tip — no drift

## Mitigations

### M-1: CLAUDE.md explicit rule (mandatory, ratifies the strategy)

Replace the current ambiguous paragraph with an authoritative table. Proposed text:

```markdown
### Merge strategies

| Source → target | Strategy | Why |
|-----------------|----------|-----|
| feature branch → develop | **Squash and merge** | Feature branches have intermediate commits we don't want in long-term history |
| develop → main | **Create a merge commit** (regular merge) | Keeps develop and main structurally in sync — squash-merge here causes phantom-commit drift on the next develop → main PR. See `docs/issues/2026-05-09-rca-git-flow-catastrophe.md`. |

**Rebase-and-merge is not used.** It creates the same phantom-commit drift as squash but without the tidy-commit benefit.

These are not preferences — they are the strategy. If you find yourself wanting
to deviate, stop and read the RCA document linked above first. Specifically: do
not squash-merge develop → main even if it looks tidier.
```

Also: drop the existing "git rebase main" forbidden-operation row (no longer needed because rebase is no longer needed).

### M-2: Mandatory pre-flight before any develop → main PR (Claude behavior)

Before opening any develop → main PR, Claude must run and surface the output of:

```bash
git log --merges --oneline origin/main | head -10
git rev-list --left-right --count origin/main...origin/develop
```

…and verify:

1. The last 10 develop → main merges in `--merges` are "Merge pull request" style. If they're not, **stop** and re-read the RCA before recommending a strategy.
2. develop is strictly ahead of main (main side of `--left-right` is 0). If main is ahead of develop, **stop** — something is wrong.

This is a behavior rule (no automation enforces it). It's defended by M-3 below.

### M-3: A test that proves the strategy is being followed

Add a small JS test (or shell script run in CI) that asserts:

> "The most recent develop → main merge into `origin/main` is a regular merge commit (has 2+ parents), not a squash (1 parent)."

Pseudo-implementation:

```bash
# .github/workflows/roadtrip-ci.yml additional step (or stand-alone script)
- name: Assert develop → main merge strategy
  run: |
    LATEST_MERGE=$(git log --first-parent origin/main \
      --grep='Merge pull request.*from psford/develop' -1 --format='%H')
    [ -n "$LATEST_MERGE" ] || { echo "::error::No 'Merge pull request from develop' commit found in main's first-parent log"; exit 1; }
    PARENTS=$(git log -1 --format='%P' "$LATEST_MERGE" | wc -w)
    [ "$PARENTS" -ge 2 ] || { echo "::error::Most recent develop → main merge ($LATEST_MERGE) has $PARENTS parent(s), expected 2+"; exit 1; }
    echo "✓ Most recent develop → main merge is a regular merge commit"
```

If anyone (Claude or Patrick) accidentally squash-merges a develop → main PR, **the next CI run on develop fails** with a clear error pointing at the offending commit. Detection time: minutes, not days.

This is the most important mitigation in this plan. **Without it, M-1 and M-2 are aspirations.**

### M-4: Drift detector (post-hoc, second line of defense)

A second CI check that asserts:

> "develop is a strict ancestor of main (or equal to main + commits not yet merged)."

```bash
- name: Assert develop is strict ancestor of main
  run: |
    git fetch origin main develop
    if ! git merge-base --is-ancestor origin/develop origin/main && \
       ! git merge-base --is-ancestor origin/main origin/develop; then
      echo "::error::develop and main have diverged — phantom-commit drift detected. See docs/issues/2026-05-09-rca-git-flow-catastrophe.md"
      exit 1
    fi
```

If develop diverges from main (the failure mode of this incident), CI flags it on the next push. This catches the case where M-3 is somehow defeated.

### M-5: Update the RCA into project context (CLAUDE.md gotcha)

Add to CLAUDE.md's Gotchas:

```markdown
- **develop → main merge strategy is "Create a merge commit", never squash.**
  Squash-merging develop → main creates phantom-commit drift that breaks the
  next develop → main PR with conflicts. See `docs/issues/2026-05-09-rca-git-flow-catastrophe.md`
  for the full incident report. The CI step "Assert develop → main merge
  strategy" in `.github/workflows/roadtrip-ci.yml` enforces this; it will
  fail loudly if anyone accidentally squashes.
```

A future Claude session reading CLAUDE.md will encounter this and know not to recommend squash for develop → main.

## Test plan (proves the prevention works)

The mitigations above must themselves be verified — otherwise this is just paperwork. Concretely:

### Test T-1: Rule clarity (manual review)
- Read M-1's proposed CLAUDE.md text. Ask "could a future Claude session interpret this as 'sometimes squash for develop → main is OK'?" If yes, sharpen the language until no.
- Acceptance: Patrick reviews the text and confirms it's unambiguous.

### Test T-2: CI assertion fires on a squash-merge (red-team)
- Create a sandbox branch.
- On a throwaway clone, simulate a squash-merge of develop → main (`git merge --squash` then commit).
- Push to a temporary branch on origin and run the CI workflow against it.
- **Expected:** CI fails with the specific error message from M-3.
- Acceptance: failure surfaces and points at the right commit.

### Test T-3: CI assertion passes on a regular merge (positive case)
- Create a regular merge of develop → main on a sandbox branch.
- Run CI.
- **Expected:** the assertion passes.
- Acceptance: green CI.

### Test T-4: Drift detector fires on actual divergence (red-team)
- Create a fake squash-then-no-resync scenario (squash develop into main on a sandbox, then add a commit to develop, then push both).
- Run CI on develop.
- **Expected:** M-4's drift detector fails.
- Acceptance: error message identifies divergence.

### Test T-5: Pre-flight check actually runs (Claude behavior)
- In a future session, before opening a develop → main PR, Claude must produce the output of M-2's commands in the conversation. If Claude opens a develop → main PR without that pre-flight, that's a regression of this fix.
- Acceptance: pattern-match Claude's response in the next develop → main PR session.

## Order of execution

1. **Close PR #72** (its premise was wrong)
2. **Reset develop to match main** (delete the bad CLAUDE.md commit). Force-push (Patrick runs).
3. **On a fresh feature branch off develop**, write the M-1 CLAUDE.md update (correct rule), the M-3 + M-4 CI step, and the M-5 Gotcha entry. PR feature → develop, **squash-merge** (correct for feature → develop).
4. **PR develop → main, "Create a merge commit"**. This is the first PR under the new regime.
5. Run **T-2 through T-5** on a sandbox before considering this resolved. Document the test results in this file.
6. **Trigger deploy** as needed (no functional code changed; deploy is optional).

## What I'm explicitly NOT doing in the prevention plan

- **Not adding a "Claude must always do X" rule without backing it with CI.** Behavior rules without enforcement are aspirations. Every behavior rule in this plan (M-2) is paired with a structural enforcer (M-3, M-4).
- **Not banning squash entirely.** Squash for feature → develop remains correct.
- **Not relying on memory or future judgment.** The CLAUDE.md change + CI checks make the rule mechanical.

## Acceptance criteria

This prevention plan is "done" when:

- [ ] `docs/issues/2026-05-09-rca-git-flow-catastrophe.md` is committed
- [ ] `docs/issues/2026-05-09-prevention-git-flow.md` is committed (this file)
- [ ] CLAUDE.md updated per M-1 and M-5
- [ ] CI workflow updated per M-3 and M-4
- [ ] T-2, T-3, T-4 sandbox tests run successfully and results recorded in this doc
- [ ] First develop → main PR under the new regime merges as a regular-merge with no conflict

## What changed in develop's git state during the incident (cleanup needed)

Current state of develop (origin/develop):

```
e7e5c21 docs(claude-md): permit post-squash-merge rebase + force-push on develop  [WRONG — to be removed]
b98b670 (origin/main) Cleanup: GH Actions Node 24, CLAUDE.md sign-off, plan/backlog hygiene (#71)
```

The `e7e5c21` commit is the wrong fix and lives behind PR #72 right now. Cleanup steps:

1. Close PR #72 with a link to this RCA.
2. Reset develop to origin/main: `git checkout develop && git fetch origin && git reset --hard origin/main && git push --force-with-lease origin develop` (Patrick runs the force-push due to harness hook).
3. Apply the prevention work (M-1 through M-5) on a properly-named feature branch off develop, PR feature → develop (squash), then PR develop → main (regular merge).

After step 2, develop and main are equal. After step 3, develop and main are equal + the prevention commits, then equal again after the develop → main merge.

## Summary

The fix is a one-line strategy choice ("regular merge for develop → main") plus a CI check that fails loudly if anyone violates it. Everything else in this plan is supporting structure to make sure the strategy is followed, the rule survives future Claude sessions, and any deviation is detected within minutes.
