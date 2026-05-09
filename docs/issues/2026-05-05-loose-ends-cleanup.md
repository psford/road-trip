# 2026-05-05 — Loose-Ends Cleanup Pass

A one-day backlog audit pass surfaced after the offline-asset-precache PR shipped (PR #69 merged 2026-05-04). Focused on hygiene, time-sensitive infra, and rotted info — not new feature work.

**Goal:** clean enough state to start the next feature without inheriting noise.

**Estimated total:** 90–120 minutes if you do everything, ~30 minutes for the quick-wins block alone.

---

## Block 1 — Quick wins (≈30 min, do first to build momentum)

These are mechanical, low-risk, and remove the most clutter. Do as a single "git/docs hygiene" sitting.

### 1.1 — Delete merged local branches
```bash
cd /Users/patrickford/Documents/claudeProjects/road-trip
git branch -d \
  chore/remove-postUI-debug-logs \
  debug/postUI-photo-flow-logs \
  docs/git-flow-claude-merges-to-develop \
  fix/create-flow-log-caught-errors \
  fix/create-trip-shell-kick-to-safari \
  fix/ios-info-plist-camera-location-keys \
  fix/static-files-revalidate \
  fix/versionProtocol-test-paths-and-roadTrip-stub \
  fix/versionProtocol-wrapFetch-idempotent \
  ios-offline-shell
```
All 10 are merged-to-main per `git branch --merged origin/main`. Safe.

### 1.2 — Delete squash-merged local branches (need `-D`, not `-d`)
```bash
git branch -D \
  docs/offline-asset-precache-research \
  docs/smoke-checklist-clarifications
```
Both squash-merged via PRs #68 / #67. Git's `-d` refuses because squash hides the merge ancestry; `-D` is correct here.

### 1.3 — Delete merged remote branches
First confirm each is squash-merged:
```bash
gh pr list --state merged --search "head:fix/ios-keyboard-resize-body OR head:docs/offline-asset-precache-research OR head:docs/smoke-checklist-clarifications" --limit 10
```
Then delete:
```bash
git push origin --delete fix/ios-keyboard-resize-body docs/offline-asset-precache-research docs/smoke-checklist-clarifications
```
Hold off on `origin/maplibre-migration`, `origin/feat/resilient-uploads`, `origin/feature/resilient-uploads`, `origin/bulk-upload`, etc. — those are older branches; do a separate audit pass before deleting (see Block 4).

### 1.4 — Drop or apply the stash
```bash
git stash show stash@{0}                 # one file: ios/App/CapApp-SPM/Package.swift
git stash show -p stash@{0}              # see the actual diff
```
If it's still relevant: `git stash pop`. Otherwise: `git stash drop stash@{0}`. The stash message says "unrelated Package.swift change parked during offline-asset-precache branching" — most likely safe to drop, but glance at the diff first.

### 1.5 — Delete the empty `oversize-compression` plan dir
```bash
ls docs/implementation-plans/2026-04-16-oversize-compression/   # confirm empty
rmdir docs/implementation-plans/2026-04-16-oversize-compression
git add -A && git commit -m "chore: drop empty oversize-compression plan dir (kept the one at oversize-image-compression)"
```

### 1.6 — Update CLAUDE.md "Phase 7 sign-off" status
The file currently says `iOS Offline Shell: ... phase 7 on-device sign-off pending`. Patrick verified on a real device 2026-05-04 (pictures post, app runs better than before). Update the relevant line in `CLAUDE.md` Tech Stack section + the Gotcha that says "Phase 7 on-device verification is NOT complete." Also bump `Last verified: 2026-04-29` → `2026-05-04`.

Commit: `docs(claude-md): mark iOS Offline Shell Phase 7 verified on-device 2026-05-04`.

### 1.7 — Drop the rotted memory file
```bash
rm /Users/patrickford/.claude/projects/-Users-patrickford-Documents-claudeProjects/memory/project_road_trip_phase5_paused.md
```
Then edit `MEMORY.md` and remove the `[Road Trip Phase 5 paused]` line. That memory describes an architectural gap that the iOS Offline Shell branch + offline asset pre-cache PR collectively resolved.

---

## Block 2 — GitHub Actions Node.js 20 upgrade (≈30 min, time-sensitive)

**Deadline:** **2026-06-02** (~4 weeks from now). After that, GitHub forces the actions to Node 24 by default; the workflow may break if the pinned versions don't support it. Already in `BACKLOG.md` under Low Priority — bump to High given the deadline.

### Affected actions (per the deploy run output 2026-05-04)
- `azure/login@v2` — used in deploy.yml + roadtrip-ci.yml
- `actions/setup-dotnet@v4` — used in roadtrip-ci.yml + deploy.yml
- (any other `@v*` actions in `.github/workflows/*.yml` should be reviewed for the same warning)

### Steps
1. Read `.github/workflows/deploy.yml` and `.github/workflows/roadtrip-ci.yml`.
2. For each affected action, check the action's repo for the latest version that supports Node 24. Common upgrades:
   - `azure/login@v2` → `azure/login@v3` (released 2025; Node 24 ready)
   - `actions/setup-dotnet@v4` → check for v5 or current with Node 24 support
3. Bump pin in both workflow files in a single commit on `develop`.
4. Push to develop directly (small fix, per CLAUDE.md "Direct on develop for: small fixes, tweaks").
5. Verify CI still passes on the next push.

**Risk:** low. Action versions are documented; downgrade is a one-line revert.

### After completing
Remove the "Node.js 20 deprecation in GitHub Actions" entry from `docs/BACKLOG.md` Low Priority. Drop `memory/project_node20_deprecation.md` if it exists.

---

## Block 3 — File the EXIF rotation tech-debt issue (≈10 min)

`ApplyExifRotation()` is a no-op stub. Photos uploaded from devices that store rotation in EXIF (most modern phones do) display in the orientation the camera saw, not the orientation the user took. CLAUDE.md flags this as a gotcha but there's no tracking issue.

### Steps
1. Add to `docs/BACKLOG.md` under **High Priority** (it's a real user-visible bug, not a polish item):
   ```
   ### EXIF rotation no-op
   `ApplyExifRotation()` in `src/RoadTripMap/Services/PhotoService.cs` is a stub — does nothing. Photos uploaded from devices that store rotation in EXIF (most phones, post-iOS 7) display rotated wrong. Needs design: SkiaSharp has rotation but EXIF parsing is via MetadataExtractor or the existing piexifjs route on the client. Coordinate with the resilient-uploads Phase 5 client-side processing (which already strips EXIF on the client tier blobs). Server-side fallback in `CommitAsync` is the natural fix point.
   ```
2. Don't fix it now — it needs a small design plan first (server vs. client, which library, perf impact on large originals, test coverage approach). Mark as "needs brainstorming session" or invoke `start-design-plan` when you're ready.

**Risk:** none — this is just tracking work.

---

## Block 4 — Old-branches audit (≈20 min, optional)

Lower urgency than the merged-branch sweep. There's a longer tail of remote branches that probably represent abandoned work or already-merged-via-different-PR work.

### Steps
1. List all remote branches with last-commit date:
   ```bash
   for b in $(git branch -r | grep -vE 'origin/(HEAD|main|develop)$'); do
     echo "$(git log -1 --format='%cs %h' $b 2>/dev/null) $b"
   done | sort -r
   ```
2. For each branch, decide: deleted-via-squash-merge (delete from origin), abandoned and superseded (delete), or "still wanted" (leave, but document why).
3. Particularly check:
   - `origin/maplibre-migration` — older, but its latest commit is "feat: add bulk photo upload with floating status bar." Suspicious — may have been mid-rename. If features landed elsewhere, delete.
   - `origin/feat/resilient-uploads` vs `origin/feature/resilient-uploads` — duplicate naming. Probably one is the original, one is renamed. Pick one to keep (or delete both if Phase 1 + Phase 5 are landed).
   - `origin/bulk-upload` — old. Check if features landed.
4. Delete the dead ones with `git push origin --delete <branch>`.

**Risk:** low if you check each branch's PR history before deleting. If unsure, skip — branches don't cost anything to leave around.

---

## Block 5 — iOS Offline Shell test plan retrofit (≈30 min, optional)

`docs/implementation-plans/2026-04-19-ios-offline-shell/` has 8 phases but no entry in `docs/test-plans/`. Predates the test-analyst skill being part of plan execution.

Two options:

### Option A: skip (recommended)
That plan's work is already verified in production via two months of daily use + today's on-device sign-off. A retrofitted test plan would be archaeology, not testing. Document this decision in a one-line note in `CLAUDE.md` or the plan dir.

### Option B: generate one retroactively
Invoke the test-analyst agent against `docs/implementation-plans/2026-04-19-ios-offline-shell/test-requirements.md` (if it exists) or against the design plan's ACs directly. Output goes to `docs/test-plans/2026-04-19-ios-offline-shell.md`.

Pick A unless you specifically want a paper trail.

---

## Skip list (explicitly NOT doing)

These items I (Claude) flagged in the audit but are below the noise threshold per the "no spiraling" principle. Don't worry about them.

- AC4.4 invariant test comment in `tests/js/assetCache.test.js:1227` says "fresh deleteDatabase loop" but the file's beforeEach doesn't delete. Cosmetic. Test is still load-bearing.
- `_extractAssetUrlsFromHtml` malformed-HTML test (`tests/js/assetCache.test.js`) asserts only `Array.isArray(urls)`, not `[]`. Loose, but the function returns `[]` in practice.

---

## Recommended order for tomorrow

1. **Block 1.1–1.3** (delete branches) — 5 min
2. **Block 1.4** (stash) — 2 min
3. **Block 1.5** (empty dir) — 2 min
4. **Block 1.6** (CLAUDE.md sign-off) — 5 min
5. **Block 1.7** (rotted memory) — 1 min
6. ☕ break, push branch-deletion + claude-md updates to `develop`
7. **Block 2** (GH Actions upgrade) — 30 min
8. **Block 3** (file EXIF issue) — 10 min
9. (Optional) **Block 4** (older branches) — 20 min
10. (Optional) **Block 5** (test plan retrofit) — 30 min, default to skip
11. New feature work starts with a clean branch state

---

## What you'll have at the end

- 10–15 fewer branches (local + remote)
- 0 stale stashes
- CLAUDE.md current as of today
- 0 rotted memory entries
- GitHub Actions on Node 24-compatible versions ahead of the forced-migration deadline
- EXIF tech debt tracked in BACKLOG.md so it's not just a Gotcha-line orphan
- A clean head to start the next feature
