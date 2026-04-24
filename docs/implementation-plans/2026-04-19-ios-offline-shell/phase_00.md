# iOS Offline Shell — Phase 0: Prerequisites — clean up prior WIP stash

**Goal:** Bring the working tree to a clean, committed state by reconciling `stash@{0}` from the abandoned old Phase 5 work, so subsequent phases start from a known baseline.

**Architecture:** Pure git/filesystem housekeeping — pop the stash, discard the one change that the new Phase 5 will rewrite end-to-end, add `.gitignore` entries for SPM caches, commit the rest as a single atomic commit on the `ios-offline-shell` branch.

**Tech Stack:** git, .gitignore.

**Scope:** Phase 0 of 8 (phases 0–7) from the iOS Offline Shell design.

**Codebase verified:** 2026-04-19.

---

## Acceptance Criteria Coverage

This phase implements and tests:

**None.** Phase 0 is housekeeping. Per the design plan, "ACs covered: None (housekeeping; verification is operational, not behavioral)." Verification is the design's "Done when" checklist (see Task 5).

---

## Branching note

The design says the Phase 0 commit lands on `develop`. We are working on a feature branch (`ios-offline-shell`, branched from local `develop` at `a4fa938`) per the project git-flow in `CLAUDE.md`. The Phase 0 commit therefore lands on `ios-offline-shell` and reaches `develop` via the eventual feature PR. This is a deliberate, documented divergence from the design.

---

<!-- START_TASK_1 -->
### Task 1: Preflight — confirm baseline

**Verifies:** None (infrastructure/housekeeping).

**Files:** None modified.

**Step 1: Confirm current branch and clean baseline**

Run:
```bash
git branch --show-current
# Expected: ios-offline-shell

git status -s
# Expected: only '?? ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/' (the untracked dir)

git stash list | head -3
# Expected: stash@{0} contains "WIP Phase 5 paused (deeper): signing+photo perm+SPM cache+storyboard+defer fix on bootstrap/index.html"

git log --oneline -2
# Expected tip is a4fa938 "docs(ios-offline-shell): add Phase 0 prerequisites for stash@{0} cleanup"
```

**Step 2: Stop if any check fails**

If the branch is wrong, the tree is dirty beyond the known swiftpm/ untracked, or the stash is missing or in a different position, STOP and surface the discrepancy. Do NOT proceed.

**Commit:** None (read-only verification).
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Pop the stash and discard the defer-only change

**Verifies:** None.

**Files:**
- Modified by `git stash pop`: `ios/App/App/Info.plist`, `ios/App/App.xcodeproj/project.pbxproj`, `ios/App/App/Base.lproj/Main.storyboard`, `src/bootstrap/index.html`
- Discarded: `src/bootstrap/index.html` (the new Phase 5 rewrites this file end-to-end)

**Step 1: Pop stash@{0} onto the working tree**

```bash
git stash pop stash@{0}
```

Expected: four files move to "Changes not staged for commit" (M status). No conflicts (baseline is clean aside from the known untracked swiftpm/ dir).

If pop reports a conflict, STOP and surface the error.

**Step 2: Discard the index.html defer change**

```bash
git checkout -- src/bootstrap/index.html
```

Expected: `src/bootstrap/index.html` returns to HEAD state (no `defer` attribute on the loader.js script tag).

**Step 3: Verify**

```bash
git status -s
# Expected (order may vary):
#  M ios/App/App.xcodeproj/project.pbxproj
#  M ios/App/App/Base.lproj/Main.storyboard
#  M ios/App/App/Info.plist
# ?? ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/

grep -c 'defer' src/bootstrap/index.html
# Expected: 0
```

**Commit:** None yet (Task 4 commits everything).
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Add .gitignore entries for SPM caches

**Verifies:** None.

**Files:**
- Modify: `.gitignore` (append two lines at end)

**Step 1: Append entries**

Append these two lines to the end of `/Users/patrickford/Documents/claudeProjects/road-trip/.gitignore`:

```
ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/configuration/
ios/App/App.xcodeproj/xcuserdata/
```

**Step 2: Verify**

```bash
tail -3 .gitignore
# Expected: both entries present

git status -s
# Expected: .gitignore now appears as modified; swiftpm/configuration/ no longer shows as untracked.
# Package.resolved should still appear as untracked (we commit it explicitly in Task 4):
#  M .gitignore
#  M ios/App/App.xcodeproj/project.pbxproj
#  M ios/App/App/Base.lproj/Main.storyboard
#  M ios/App/App/Info.plist
# ?? ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
```

**Commit:** None yet (Task 4 commits everything).
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Stage specific files and commit

**Verifies:** None.

**Files staged (explicit list — do NOT use `git add -A` or `git add .`):**
- `.gitignore`
- `ios/App/App/Info.plist`
- `ios/App/App.xcodeproj/project.pbxproj`
- `ios/App/App/Base.lproj/Main.storyboard`
- `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`

**Step 1: Stage by explicit path**

```bash
git add .gitignore \
        ios/App/App/Info.plist \
        ios/App/App.xcodeproj/project.pbxproj \
        ios/App/App/Base.lproj/Main.storyboard \
        ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
```

**Step 2: Verify staged set**

```bash
git status -s
# Expected (all staged, no unstaged, no untracked):
# A  ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
# M  .gitignore
# M  ios/App/App.xcodeproj/project.pbxproj
# M  ios/App/App/Base.lproj/Main.storyboard
# M  ios/App/App/Info.plist
```

**Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(ios): apply Phase 5 Task 10 prerequisites (signing, photo perm, SPM)

Unwinds stash@{0} from the abandoned old Phase 5 work. Keeps the parts
still needed for any on-device iOS build and discards the one-off defer
fix that the new iOS Offline Shell loader (ios-offline-shell Phase 5)
will rewrite from scratch.

Included:
- Info.plist: NSPhotoLibraryUsageDescription (required by photo upload flow)
- project.pbxproj: DEVELOPMENT_TEAM=GP2M7H6R3U in Debug + Release (signing)
- Main.storyboard: Xcode 26 auto-migration (prevents re-migration on every open)
- swiftpm/Package.resolved: SPM lockfile pinning Capacitor 8.3.1
- .gitignore: skip SPM cache (configuration/) and xcuserdata

Dropped:
- src/bootstrap/index.html defer fix — superseded by the iOS Offline
  Shell loader rewrite (see docs/design-plans/2026-04-19-ios-offline-shell.md).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If a pre-commit hook fails, investigate and fix the root cause — do not pass `--no-verify`. After fixing, re-stage and commit again (do not amend; create a new commit).

**Step 4: Verify commit landed**

```bash
git log --oneline -2
# Expected: new commit is HEAD; a4fa938 "docs(ios-offline-shell): add Phase 0 prerequisites…" is its parent.
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Verify all Phase 0 done-when conditions

**Verifies:** None (verification task).

**Files:** None modified.

**Step 1: Run each design "Done when" check**

```bash
# 1. Stash is gone
git stash list | grep -c "WIP Phase 5 paused"
# Expected: 0

# 2. DEVELOPMENT_TEAM present in both configs
grep -c "DEVELOPMENT_TEAM = GP2M7H6R3U" ios/App/App.xcodeproj/project.pbxproj
# Expected: 2  (one each for Debug and Release)

# 3. Photo permission key present
grep NSPhotoLibraryUsageDescription ios/App/App/Info.plist
# Expected: a non-empty match line

# 4. index.html unchanged from develop tip prior to Phase 0 (defer discarded).
#    Compare against develop, since we branched from develop at a4fa938.
git diff develop..HEAD -- src/bootstrap/index.html
# Expected: empty (this file should not have changed since the branch point)

# 5. Clean working tree
git status -s
# Expected: empty output

# 6. Phase 0 commit landed on ios-offline-shell
git log --oneline ios-offline-shell -1
# Expected: the "chore(ios): apply Phase 5 Task 10 prerequisites…" commit
```

**Step 2: If any check fails**

Surface the discrepancy. Do not attempt to force-fix. Likely root causes: stash already popped into a different state, Xcode reopened and re-migrated storyboard, SPM cache repopulated `configuration/` after gitignore landed.

**Commit:** None.
<!-- END_TASK_5 -->
