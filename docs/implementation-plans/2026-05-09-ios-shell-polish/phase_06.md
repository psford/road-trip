# iOS Shell Polish — Phase 6: On-device verification and bug fix

**Goal:** Patrick runs the app on his iPhone in light + dark mode, online + offline, both flows (post-a-photo and view-someone-else's-trip), and signs off. Any bugs surfaced get fixed in this phase. Verification log captured per the project's existing on-device-smoke conventions (see prior plans `2026-04-19-ios-offline-shell/phase_07.md` and `2026-04-21-ios-shell-hardening/smoke-checklist.md`).

**Architecture:** Operational, not architectural. No new code by default. The phase produces:
1. A `smoke-checklist.md` adjacent to this plan, listing every iOS-shell-polish AC as a checkable item.
2. A `phase-6-device-smoke.md` capture doc recording Patrick's run-through (date, device, iOS version, build number, observations, pass/fail per section, bugs filed).
3. A verification-log section appended to the design plan itself (per the design's Phase 6 spec at line 272: "append a verification log section at the bottom recording what Patrick tested and observed").
4. Bug fixes (commit-by-commit on the `ios-shell-polish` branch) for any failures surfaced during the run.

**Tech Stack:** Patrick's Mac (Xcode 26, `npx cap sync ios`, Archive + TestFlight upload OR direct device install), Patrick's iPhone, Safari Web Inspector for remote debugging.

**Scope:** Phase 6 of 6 from `docs/design-plans/2026-05-09-ios-shell-polish.md`.

**Codebase verified:** 2026-05-10. No discrepancies.

**Discrepancies from design — read carefully:**
- The design's Phase 6 component list is intentionally minimal ("No new components by default. Bug fixes land where the bugs live."). This phase materializes that into a concrete process: smoke-checklist artifact → device run → capture doc → optional bug-fix sub-tasks → verification-log append → done.
- **Patrick runs `npx cap sync ios` and Xcode build/archive — never the executor.** Per CLAUDE.md "Who can do what" table, those are Patrick-only operations. The executor's responsibility ends at producing the smoke-checklist and capturing the run; Patrick triggers the build, runs the matrix, and authors the capture doc (or dictates findings for the executor to transcribe in a follow-up commit).
- **The Phase 5 de-scope decision happens here** if any rapid-navigation issues surfaced in earlier phases that weren't fully resolved by Task 1's generation tracker. The design plan's de-scope ladder (motion + skeletons → destructive-confirm UI → entry-page nav-bar → hard floor of post.html + trips.html in light/dark with system-blue + immersive viewer + share + key haptics) is the explicit fallback. Patrick + Claude review the smoke results together and pick the cut line.
- **No Phase 6 acceptance criteria are NEW** — Phase 6 closes out AC8.* (existing functionality preserved) and AC10.* (subjective sign-off). Every other AC was implemented and tested in Phases 1–5; Phase 6 confirms they hold on a real iPhone.

**Recommended skills for executor (activate before starting):**
- `ed3d-house-style:writing-for-a-technical-audience` (smoke checklist must be unambiguous: anyone reading it can run the matrix and know what passed/failed)
- `ed3d-plan-and-execute:verification-before-completion` (Patrick + executor must NOT mark this phase complete on incomplete data; partial sign-off is an open phase)
- `ed3d-plan-and-execute:systematic-debugging` (any bug surfaced needs root-cause investigation before a fix lands)

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ios-shell-polish.AC8: Existing functionality preserved
- **ios-shell-polish.AC8.1 Success:** `npm test` (vitest, ~149 existing tests plus new ones) passes.
- **ios-shell-polish.AC8.2 Success:** `dotnet test RoadTripMap.sln` passes.
- **ios-shell-polish.AC8.3 Success:** Resilient upload flow, offline shell page-cache, asset pre-cache, MapLibre map, and trips list all behave unchanged when polish is disabled (e.g., in browser).
- **ios-shell-polish.AC8.4 Success:** `version-protocol` and `LogSanitizer` invariants are unchanged.

### ios-shell-polish.AC10: Subjective sign-off
- **ios-shell-polish.AC10.1 Success:** Patrick runs the app on his iPhone in light and dark, online and offline, both flows (post-a-photo and view-someone-else's-trip) and signs off in the verification log.
- **ios-shell-polish.AC10.2 Success:** Patrick reaches for the iOS app instead of the website on the upcoming trip.

(All other ACs — AC1–AC7, AC9 — are re-validated implicitly during the device matrix run. A failure in any of them re-opens the corresponding earlier phase.)

---

<!-- START_SUBCOMPONENT_A (tasks 1) -->
<!-- START_TASK_1 -->
### Task 1: Author the smoke checklist

**Type:** Documentation (operational artifact).

**Verifies:** None directly (substrate for AC10.1).

**Files:**
- Create: `docs/implementation-plans/2026-05-09-ios-shell-polish/smoke-checklist.md`

**Implementation:**

Author a smoke checklist following the convention from `docs/implementation-plans/2026-04-21-ios-shell-hardening/smoke-checklist.md`. Header includes signoff metadata; sections grouped by AC with checkable items.

Structure (the executor produces the actual content; this is the spec):

```markdown
# iOS Shell Polish — On-device Smoke Checklist

Run on Patrick's iPhone with iOS 18+. Run in BOTH light and dark mode (Settings → Display & Brightness → Light / Dark). Run BOTH online and in airplane mode where indicated. The branch under test is `ios-shell-polish` after Phases 1–5 have landed.

## Signoff metadata
- Device: ___________
- iOS version: ___________
- App build: ___________
- Tester: ___________
- Date: ___________
- Light/Dark mode tested: ☐ Light ☐ Dark
- Online/Offline tested: ☐ Online ☐ Airplane mode

## Section 1 — Token foundation + dark mode (AC1, AC2)
- [ ] AC1.1: Headings, body, captions across all four pages use the new type scale (look for crisp, larger headings; subhead/footnote sizing on labels).
- [ ] AC1.2: Existing UI (toasts, brand-tinted CTAs, trip-card hovers) renders unchanged from before the polish.
- [ ] AC2.1: With OS in Dark Mode, all four pages render with dark surface, white text, brand-teal CTAs unchanged.
- [ ] AC2.1: With OS in Light Mode, all four pages render with the existing light palette.
- [ ] AC2.2: Toggle OS theme while the app is open — re-render shows the new theme on the next paint without a full reload.
- [ ] AC2.3: Open the immersive photo viewer in BOTH themes — backdrop is true-black in both (does not invert in light mode).

## Section 2 — Native plugin wiring (AC3)
- [ ] AC3.1: Tap Add-Photo / Cancel / Post — feel a light haptic on each.
- [ ] AC3.1: Successfully upload a photo — feel a medium haptic on commit.
- [ ] AC3.1: Force an upload failure (turn airplane mode on mid-upload) — feel an error haptic when the failure surfaces.
- [ ] AC3.3: Tap per-photo Share on post.html or trips.html — native iOS share sheet opens with title + URL prefilled. URL begins with `https://app-roadtripmap-prod.azurewebsites.net/...`, NOT `capacitor://...`.
- [ ] AC3.4: Tap per-photo Delete on post.html — native iOS confirm dialog appears with title "Delete photo?" and destructive "Delete" button.
- [ ] AC3.4: Cancel the dialog — photo is NOT deleted (AC4.6).
- [ ] AC3.4: Confirm the dialog — photo IS deleted; success toast.
- [ ] AC3.5: Open the immersive photo viewer — status bar text becomes light (visible against the true-black backdrop).
- [ ] AC3.5: Close the viewer (close button, Escape via external keyboard if available, swipe-down) — status bar text returns to dark.
- [ ] AC3.6: Idempotency — navigate away and back to a page multiple times — haptics do not stack (one buzz per action, not N).

## Section 3 — post.html chrome (AC4)
- [ ] AC4.1: `.page-header` is translucent + sticky on scroll. Status bar area visible above; content scrolls behind. iPhone notch/Dynamic Island has clear margin.
- [ ] AC4.2: All three top buttons (Add-Photo, Cancel, Post-Photo) buzz light on tap.
- [ ] AC4.3: Successful post buzzes medium; failed post buzzes error.
- [ ] AC4.4: Per-photo share opens iOS share sheet (also covered in AC3.3).
- [ ] AC4.5 + AC4.6: Per-photo delete shows native confirm; cancel keeps photo, confirm deletes.

## Section 4 — trips.html immersive viewer (AC5)
- [ ] AC5.1: `.map-header` is translucent. Trip name is visible (large + small forms both rendered).
- [ ] AC5.2: Tap a carousel thumbnail — viewer opens with true-black backdrop, light status bar.
- [ ] AC5.2: Tap on the overlay — chrome (close button, action buttons) fades out. Tap again — fades in. The image stays visible throughout.
- [ ] AC5.3: Swipe down on the open viewer — viewer dismisses with translate+fade animation.
- [ ] AC5.4: Status bar restores to dark on every dismiss path: close button, swipe-down, Escape (external keyboard).
- [ ] AC5.5: With Web Inspector attached, edit `closeOverlay` to throw a synthetic error (or trigger a real error path) — status bar still restores to dark (try/finally guarantee).

## Section 5 — index.html and create.html (AC6)
- [ ] AC6.1: index.html hero shows the trip-map title in large-title typography. Trip cards (if you have any in localStorage) render as Photos-tile cards (rounded, subtle shadow, press-in scale).
- [ ] AC6.2: create.html nav-bar header looks the same as post.html (translucent, sticky, safe-area-aware). Form inputs have iOS frosted-fill styling with system-blue focus outline.
- [ ] AC6.3: Submit a valid trip → success haptic before navigation. Submit an empty form (validation error) → error haptic + error banner.
- [ ] AC6.4: Tap targets are reliable for `.nav a` (back link), `.my-trip-card`, `.button-hero` — no near-misses.

## Section 6 — Cross-page motion + skeletons (AC7)
- [ ] AC7.1: Cross-page navigation (e.g., tap "Create a Trip" on home, then "← Back") shows a brief fade-out / fade-in transition.
- [ ] AC7.2: Settings → Accessibility → Motion → Reduce Motion ON. Re-launch the app. Cross-page navigation is now instant (no fade). Skeletons appear without shimmer.
- [ ] AC7.3: On post.html and trips.html (cold load), photo carousel briefly shows shimmering grey placeholder tiles before real photos appear.
- [ ] AC7.4: Tap rapidly between pages (post → create → trips → post → create, each tap within ~500ms of the last). The app stays responsive; no transitions get "stuck"; nothing visually corrupted; the third-and-later visit to post.html still renders the full page (Phase 5 Task 1's generation tracker holds).

## Section 7 — Existing functionality preserved (AC8)
- [ ] AC8.3: Resilient upload (large photo over a flaky network) — upload still recovers. The Phase 2 haptics on commit-success/failure don't change the underlying state machine.
- [ ] AC8.3: Offline shell — re-launch app in airplane mode, navigate to a previously-visited trip; cached page renders. The page-transition animation runs (or doesn't, if reduced motion); cached content is fine.
- [ ] AC8.3: MapLibre map renders pins, popups, route line, POIs, park boundaries — Phase 3 polish did not regress any layer.
- [ ] AC8.3: Trips list on index.html renders all stored trips with their owner/viewer role badge.
- [ ] AC8.4: Open Web Inspector → Network. Confirm response headers `x-server-version` and `x-client-min-version` still present on every request.
- [ ] AC8.4: Trigger an upload that fails on the server — confirm the server logs (via Patrick's normal log access) do NOT contain raw secret tokens, raw GPS coordinates, or full SAS URLs (LogSanitizer invariant).

## Section 8 — Subjective acceptance (AC10)
- [ ] AC10.1: Sign off below.
- [ ] AC10.2: After this run, on the upcoming trip, Patrick reaches for the iOS app instead of the website.

---

## Sign-off

I, Patrick, ran the full matrix above on the date, device, and OS version recorded in the metadata header. The unchecked items in each section above represent failures that need fixing before this branch ships.

Signed: ______________________ Date: __________
```

**Step 1:** Write the file at the path above with the structure above. Fill in actual sections per the design's AC structure (the example above is the spec — the executor writes the real file matching the exact AC text from the design plan).

**Step 2:** Commit:

```bash
git add docs/implementation-plans/2026-05-09-ios-shell-polish/smoke-checklist.md
git commit -m "docs(phase-6): on-device smoke checklist for ios-shell-polish

Run-through matrix covering AC1-AC10. Section per AC group, checkable
items with the exact verification action. Signoff metadata + sign-off
block at the end.

Pattern matches docs/implementation-plans/2026-04-21-ios-shell-hardening/
smoke-checklist.md."
```
<!-- END_TASK_1 -->
<!-- END_SUBCOMPONENT_A -->

---

<!-- START_SUBCOMPONENT_B (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: Patrick builds, installs, runs the matrix

**Type:** Operational (Patrick's responsibility per CLAUDE.md "who can do what" table — the executor cannot run `npx cap sync ios` or Xcode).

**Verifies:** Substrate for AC10.1.

**Files:** None modified by the executor.

**Implementation steps for Patrick** (the executor outputs these as a final-instructions block):

```bash
# Patrick: from the worktree root
cd /Users/patrickford/Documents/claudeProjects/road-trip/.worktrees/ios-shell-polish

# Sync the bootstrap shell copy (in case tripStorage.js drifted, though Phase 1-5 didn't touch it)
npm run prepare:ios-shell

# Optional but recommended: rebuild legacy bundle artifacts
npm run build:bundle

# Push wwwroot + plugin packages to the iOS project
npx cap sync ios

# Open Xcode
open ios/App/App.xcodeproj
```

In Xcode:
1. Select the `App` scheme and Patrick's iPhone (or "Any iOS Device" + Archive + TestFlight).
2. Direct-install path (faster for iteration): plug iPhone in, select it as destination, hit Run. Xcode pushes a debug build directly.
3. TestFlight path: Product → Archive, then distribute via App Store Connect → TestFlight Internal.
4. With Xcode console attached (or Safari Web Inspector → "Inspect [iPhone] → Road Trip"), watch for any errors during the matrix run.

Then on the iPhone:
1. Open Road Trip.
2. Run through every section of `docs/implementation-plans/2026-05-09-ios-shell-polish/smoke-checklist.md`.
3. Check items as they pass; circle items that fail and capture the bug summary inline.
4. Run the matrix in BOTH light and dark mode (toggle Settings → Display → Theme between sections, or do two passes).
5. Test offline scenarios in airplane mode where the checklist calls for it.

**Verification:** every checkable item in the smoke checklist is checked OR captured as a bug.
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Capture run-through into `phase-6-device-smoke.md`

**Type:** Documentation.

**Verifies:** AC10.1 (subjective sign-off in writing).

**Files:**
- Create: `docs/implementation-plans/2026-05-09-ios-shell-polish/phase-6-device-smoke.md`

**Implementation:**

After Patrick completes the matrix run, the executor creates this file documenting the outcome. Pattern matches the existing `docs/implementation-plans/2026-04-19-ios-offline-shell/phase-7-device-smoke.md` (read it first for tone and structure).

Structure:

```markdown
# Phase 6 — Device Smoke Capture

## Run metadata
- Tester: Patrick
- Date: 2026-05-XX
- Device: iPhone 15 Pro (or whatever)
- iOS version: 18.X
- App build: 1.0.0 (XX)
- Branch: ios-shell-polish at commit <sha>
- Modes tested: ☑ Light ☑ Dark ☑ Online ☑ Airplane

## Results by section

### Section 1 — Token foundation + dark mode (AC1, AC2): PASS / FAIL
- [observations, e.g., "AC2.2 verified — theme toggle reflows on next paint."]

### Section 2 — Native plugin wiring (AC3): PASS / FAIL
- [observations]

[... one block per section ...]

## Bugs filed
1. [Bug 1 summary] — fixed in commit <sha> / not yet fixed (open) / wontfix because <reason>
2. [Bug 2 summary] — ...

## Phase 5 de-scope decision
- ☐ Ship Phases 1-5 as-is (transitions + skeletons + everything earlier).
- ☐ Drop Tasks 2-3 of Phase 5 (transitions); keep Task 1 (script-dedup fix) and Tasks 4-5 (skeletons). Reason: <observation>.
- ☐ Drop all of Phase 5. Reason: <observation>.
- ☐ Other: <describe>.

## Sign-off
The branch is ready to merge to develop after [bugs above are fixed / no bugs to fix / Phase 5 de-scope is applied]. Patrick signs off below.

Signed: Patrick — Date: 2026-05-XX
```

**Step 1:** Author the file using the actual smoke-checklist results. If Patrick's run is in-flight (executor doesn't have results yet), output the file with placeholders and a note: "Awaiting Patrick's run-through — fill the placeholders after the matrix completes."

**Step 2: DO NOT COMMIT YET.** The capture doc remains uncommitted (in the working tree) through Task 4's bug-fix iteration loop. Per Task 4's process, each bug-fix commit references the capture doc by filing-line and the capture doc references the fix by SHA — committing the capture doc after each bug fix would create an unnecessary chain of "update doc" commits and a SHA-chicken-and-egg problem (the capture doc can't reference a SHA that doesn't exist yet, but the fix commit can't be reviewed before the doc names it).

**Resolution:** the capture doc is a **single working-tree artifact** through Tasks 3–4. Each bug-fix in Task 4 amends the doc in-place (no commit) AND lands its own `fix:` commit. After Task 4 completes (zero open bugs, all fixes referenced by SHA in the doc), Task 5 commits the now-stable capture doc together with the design-plan verification-log append in **one** documentation commit. See Task 5 for the unified commit.
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_B -->

---

<!-- START_SUBCOMPONENT_C (tasks 4) -->
<!-- START_TASK_4 -->
### Task 4: Bug-fix iteration for any failures surfaced

**Type:** Functionality (zero or more bug-fix commits).

**Verifies:** Whatever AC the bug regressed.

**Files:** Wherever the bug lives. No predetermined paths — bugs land on whatever Phase 1–5 file owns the broken behavior.

**Implementation:**

For each bug captured in `phase-6-device-smoke.md` (which remains uncommitted in the working tree per Task 3's resolution):

1. **Root-cause it before fixing.** Use the `ed3d-plan-and-execute:systematic-debugging` skill if the cause isn't immediately obvious. Don't pattern-match a fix without understanding why.
2. **Add a regression test first** if the bug is reproducible in vitest + jsdom (most JS bugs will be). Skip if the bug only manifests on real iOS (e.g., a `backdrop-filter` rendering glitch); document why no test in the commit message.
3. **Land the fix as a normal commit on `ios-shell-polish`.** One commit per bug, **without** the capture doc in the staged files. Commit message references the smoke-checklist line item:
   ```
   fix(<area>): <one-line summary>

   Regressed: ios-shell-polish.AC<N>.<M> per phase-6-device-smoke.md
   Section <K> bullet "<bullet text>".

   Root cause: <brief>.
   Fix: <brief>.
   ```
4. **Edit `phase-6-device-smoke.md` in the working tree** (no commit) to mark the bug as fixed in the just-created commit's `<sha>`. Capture `<sha>` from `git rev-parse HEAD`.
5. **Re-run the relevant smoke-checklist section** on device. If it passes, move on to the next bug. If it doesn't, repeat from step 1 with a follow-up `fix:` commit.
6. **Re-run `npm test` and `dotnet test RoadTripMap.sln`** after every bug fix, even if the fix looked tiny — this is the AC8.1 / AC8.2 gate.

When all bugs are fixed and referenced by SHA in the capture doc, the doc is ready to commit in Task 5.

**Decision tree for un-fixable bugs:**

- If a bug is a pre-existing issue (not introduced by Phases 1–5), file it in `docs/issues/` with a follow-up date and accept it for this branch. Note in `phase-6-device-smoke.md`. Don't expand Phase 6 scope to fix it.
- If a bug is introduced by a specific Phase 1–5 task and reverting that task is cheaper than fixing, propose the de-scope to Patrick. Per the design's de-scope ladder, Phase 5 motion is the first cut; below that the cuts get progressively more painful.

**Verification:**

After all bug-fix commits, re-run the full smoke-checklist matrix. All previously-failing items pass; previously-passing items still pass.

**Commits:** Zero or more `fix:` commits. No single commit message template — match the bug.
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_C -->

---

<!-- START_SUBCOMPONENT_D (tasks 5-6) -->
<!-- START_TASK_5 -->
### Task 5: Append verification log to the design plan

**Type:** Documentation.

**Verifies:** AC10.1 (per the design's Phase 6 spec at line 272).

**Files:**
- Modify: `docs/design-plans/2026-05-09-ios-shell-polish.md` — append a new `## Verification log` section at the bottom.

**Implementation:**

Read the design plan first to confirm the file ends without a verification log section already (it does as of 2026-05-10 — the design's own description is "append a verification log section at the bottom"). Append the section after the Additional Considerations block.

Template:

```markdown
## Verification log

### 2026-05-XX — Phase 6 on-device sign-off

- **Tester:** Patrick
- **Device:** iPhone 15 Pro
- **iOS version:** 18.X
- **App build:** 1.0.0 (XX)
- **Branch:** `ios-shell-polish` at commit <sha>
- **Smoke checklist:** [docs/implementation-plans/2026-05-09-ios-shell-polish/smoke-checklist.md](../implementation-plans/2026-05-09-ios-shell-polish/smoke-checklist.md)
- **Capture doc:** [docs/implementation-plans/2026-05-09-ios-shell-polish/phase-6-device-smoke.md](../implementation-plans/2026-05-09-ios-shell-polish/phase-6-device-smoke.md)
- **Outcome:** All AC sections passed [or: passed except <X>, fixed in commit <sha>] [or: Phase 5 de-scoped per the ladder — Tasks 2-3 reverted, Tasks 1 + 4-5 retained]. Ready to merge.

### Future runs

Append a new dated subsection here for each subsequent verification run (e.g., a regression check after a follow-up branch merges). Keep the latest at the top.
```

**Commit (unified — captures both the smoke-capture doc from Task 3 and the design-plan verification-log append):**

```bash
git add docs/implementation-plans/2026-05-09-ios-shell-polish/phase-6-device-smoke.md \
        docs/design-plans/2026-05-09-ios-shell-polish.md
git commit -m "docs(phase-6): on-device smoke results + verification log

Captures Patrick's run-through of the smoke checklist (light + dark,
online + airplane, both flows). All bug fixes from Task 4 are referenced
by SHA in the capture doc. Design plan now has a verification-log section
recording the run.

[Brief one-line summary of outcome — e.g.,
'All AC sections pass; no Phase 5 de-scope; ready to merge.']"
```

The unified commit avoids the SHA-chicken-and-egg problem: bug-fix `<sha>`s referenced in the capture doc all exist (committed during Task 4); the capture doc itself + the design-plan append land together as the single "documentation of the run" commit.
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Final test gate + readiness for merge

**Type:** Infrastructure verification.

**Verifies:** ios-shell-polish.AC8.1, ios-shell-polish.AC8.2.

**Step 1:** `npm test` — all tests pass.

```
$ npm test
> road-trip@1.0.0 test
> vitest run

 Test Files  XX passed (XX)
      Tests  XXX passed (XXX)
```

**Step 2:** `dotnet test RoadTripMap.sln` — all tests pass.

**Step 3:** Confirm clean working tree (no uncommitted changes left from bug fixes):

```bash
git status
```

Expected: `nothing to commit, working tree clean` OR `nothing to commit, working tree clean` after the smoke-checklist + smoke-capture + verification-log commits land.

**Step 4:** Confirm branch is ready for PR by listing what changed since the merge-base:

```bash
git log --oneline develop..ios-shell-polish | head -50
```

Expected: a coherent series of commits, one per task, plus any bug-fix commits from Task 4. No noise commits, no half-finished work.

**Step 5:** Output to Patrick the final next-step prompt:

> "Phase 6 complete. The `ios-shell-polish` branch is verified on device, all tests pass, and the verification log is committed. Per CLAUDE.md, opening a feature-branch PR to develop and merging it is the executor's responsibility (after asking). Final checks before opening the PR:
> - `gh pr list --head ios-shell-polish` — confirm no existing open PR.
> - Patrick: confirm the branch is ready for `gh pr create --base develop --title 'iOS shell polish' --body '...'`. The PR description should link to the design plan, this implementation plan, and the smoke-capture doc.
> - After PR merges to develop (squash strategy per CLAUDE.md), the worktree at `.worktrees/ios-shell-polish` can be cleaned up via `git worktree remove`. Patrick decides whether to ship develop → main (regular merge, never squash) immediately or batch with other develop work."

No commit for Task 6 — it's a verification/readiness step.
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_D -->

---

## Phase 6 done-when checklist

- [ ] Task 1: `smoke-checklist.md` authored and committed.
- [ ] Task 2: Patrick built (`npx cap sync ios` + Xcode), installed on iPhone, ran the full matrix in light + dark, online + airplane.
- [ ] Task 3: `phase-6-device-smoke.md` captures the run with sign-off.
- [ ] Task 4: Every bug surfaced is either fixed (with regression test where possible) or accepted with a documented reason.
- [ ] Task 5: Design plan has a `## Verification log` section appended.
- [ ] Task 6: `npm test` + `dotnet test` pass; working tree clean; branch ready for PR.
- [ ] **Patrick:** decides on Phase 5 de-scope (ship as-is OR cut transitions OR cut more); approves PR opening; merges to develop via `gh pr merge --squash` after CI passes.
