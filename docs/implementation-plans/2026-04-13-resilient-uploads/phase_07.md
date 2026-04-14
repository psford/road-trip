# Resilient Photo Uploads — Phase 7: iOS Stabilization and TestFlight Rollout

**Goal:** Polish iOS build, capture tester feedback on the real active trip, confirm no regressions in the web path, close out the implementation.

**Architecture:** No new runtime modules. Polish items, deep-link support, tester TestFlight session, regression smoke.

**Cross-machine sequencing:** Tasks 1, 2, 6, 7, 8, 9 on WSL. Tasks 3, 4, 5 on Mac.

**Scope:** Phase 7 of 7.

**Codebase verified:** 2026-04-13.

---

## Acceptance Criteria Coverage

Validation phase. No new AC implementations. Verifies:
- Aggregate of AC11.1–AC11.4 on the tester's real device with real conditions.
- AC12.1–AC12.4 on the tester's real photos.
- ACX.2 (no silent failures) in tester session.
- ACX.3 (no regressions in web path).

---

## Notes for Implementers

- **No new features.** Polish only. Feature ideas surfaced during the tester session go to `backlog-ios.md` (a companion project memory file — see feedback_per_project_backlogs memory).
- **Tester session is the hard gate.** Task 5 cannot be self-signed-off.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
## Subcomponent A: Polish backlog + JS polish (WSL)

<!-- START_TASK_1 -->
### Task 1: Aggregate polish backlog

**Shell:** `[WSL]`

**Files:** `docs/implementation-plans/2026-04-13-resilient-uploads/phase-7-polish-backlog.md`

**Implementation:** Walk every open issue from `phase-5-device-smoke.md` and `phase-6-device-matrix.md`; compile into categorized list (loading, transitions, empty states, error copy, icon, splash, permissions, deep links). Review with Patrick; mark each as `[P0 must-fix | P1 should-fix | P2 defer]`. Commit.

**Verification:** Doc reviewed and approved by Patrick.

**Commit:** `docs(ios): Phase 7 polish backlog`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: JS/CSS polish

**Shell:** `[WSL]`

**Files:** Various in `src/RoadTripMap/wwwroot/`.

**Implementation:** Implement all `[P0]` + `[P1]` JS/CSS items from Task 1 backlog. Examples: loading spinner during `request-upload`, empty-state text on a brand-new trip, improved error copy (specific and action-oriented). Each fix includes a test where practical. Re-run `npm run build:bundle` after changes.

**Verification:**

Run: `npm test && npm run test:e2e`
Expected: Green.

**Commit:** `feat(web): Phase 7 UI polish — loading/empty/error states`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->
## Subcomponent B: Mac polish + deep links + tester session

<!-- START_TASK_3 -->
### Task 3: iOS launch screen, icon, permissions copy

**Shell:** `[Mac — Xcode]`

**Prerequisite:** Tasks 1–2 committed + pushed.

**Files:**
- Modify: `ios/App/App/Assets.xcassets/AppIcon.appiconset/` (all sizes)
- Modify: `ios/App/App/Base.lproj/LaunchScreen.storyboard`
- Modify: `ios/App/App/Info.plist` (permissions copy polish)

**Implementation:**

Icon: use `capacitor-assets` if installed (`npx @capacitor/assets generate`) feeding from a single 1024×1024 source placed at `resources/icon.png`. If not installed, manually drop sized PNGs into the asset catalog.

Launch screen: simple branded screen with app name + tagline; matches Phase 3 mockup style.

Permissions copy: finalize `NSPhotoLibraryUsageDescription`, `NSCameraUsageDescription` wording with Patrick's voice.

**Verification:**

Xcode simulator → app icon + launch screen visible.

**Commit:** `chore(ios): app icon, launch screen, permissions copy`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Deep-link support

**Shell:** `[Mac — Xcode]`

**Verifies:** Returning to active trip from a shared link.

**Files:**
- Modify: `ios/App/App/Info.plist` (URL scheme `roadtripmap` registered; optional Associated Domains for Universal Links)
- Modify: `ios/App/App/AppDelegate.swift` (or rely on Capacitor's built-in `appUrlOpen` event)
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js` (listener for `App.addListener('appUrlOpen', ...)` that routes to `/trip/<token>`)

**Implementation:**

Custom URL scheme is simpler than Universal Links for v1. Register `roadtripmap://` in `CFBundleURLTypes`. Parse `roadtripmap://trip/<token>` in JS listener and `window.location.assign` or Capacitor router to the correct page.

**Verification:**

`[Mac — Terminal]` `xcrun simctl openurl booted 'roadtripmap://trip/abcd1234'` → app opens on that trip.

Real device: send the URL via Messages to yourself, tap it — app launches on trip.

**Commit:** `feat(ios): roadtripmap:// custom URL scheme deep-link`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Tester TestFlight session

**Shell:** `[Mac — Xcode]` for build + upload; tester activity on their device; `[WSL]` for log review follow-up.

**Verifies:** AC11.*, AC12.* on real conditions; ACX.2.

**Files:**
- Create: `docs/implementation-plans/2026-04-13-resilient-uploads/phase-7-tester-feedback.md`

**Implementation:**

1. Mac: Archive polished build (v1.3.0 or whatever tag is current), upload to App Store Connect, assign to internal tester.
2. Tester installs from TestFlight.
3. Tester uploads photos from their active trip under real conditions (their actual cellular environment on an actual road trip). Instructed to: upload at least 15 photos, intentionally background the app mid-batch at least once, intentionally force-quit once.
4. Tester reports: which scenarios worked, anything that looked wrong, crash reports.
5. WSL: Patrick (or Claude on Patrick's behalf) pulls structured telemetry for tester's trip token, computes completion rate, retry counts, background-completion rate. Appends to `phase-7-tester-feedback.md`.
6. Triage: any `[P0]` issues cycle back to Task 2 or Task 3; any `[P1]/[P2]` go to `backlog-ios.md` for future work.

**Verification:**

`phase-7-tester-feedback.md` contains tester's report + telemetry review + triage decisions + Patrick sign-off.

**Commit:** `docs(ios): Phase 7 tester feedback + telemetry review`
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-9) -->
## Subcomponent C: Regression, documentation, close-out (WSL)

<!-- START_TASK_6 -->
### Task 6: Telemetry deep dive

**Shell:** `[WSL]`

**Files:**
- Append to: `docs/implementation-plans/2026-04-13-resilient-uploads/phase-7-tester-feedback.md`

**Implementation:**

Query App Service / App Insights for the tester's trip token:
- Total upload attempts.
- Successful commits.
- Block retries (mean, p95).
- Background completions (count of `upload.committed` events fired while App Service received block PUTs but no foreground API interaction).
- Failure reasons distribution.

Success thresholds (agreed with Patrick):
- ≥95 % commit rate.
- ≥50 % of background-started uploads complete while app backgrounded.
- Zero unexplained failures (all `failed` rows have a `reason` field).

**Verification:** Thresholds met or exceptions documented with action items.

**Commit:** `docs(ios): telemetry review from tester session`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Web path regression smoke

**Shell:** `[WSL]` + Patrick manual on desktop browser.

**Verifies:** ACX.3.

**Files:**
- Create: `docs/implementation-plans/2026-04-13-resilient-uploads/phase-7-web-smoke.md`

**Implementation:**

1. Run full Vitest + Playwright suites against develop.
2. Patrick opens the production web UI on desktop, uploads 5 photos, verifies pin placement, verifies gallery.
3. Run the legacy-trip audit script from Phase 4 Task 6 one final time — zero orphans expected.

Record results with timestamps in `phase-7-web-smoke.md`.

**Verification:**

All tests green; Patrick confirms no visible regression in web path; audit script shows zero orphans.

**Commit:** `docs(ios): Phase 7 web regression smoke — green`
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Deployment runbook — Phase 7 section

**Shell:** `[WSL]`

**Files:**
- Modify: `docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md`

**Implementation:**

Append `## Phase 7 — iOS rollout`:

1. **Pre-flight** — Phase 6 runbook signed; polish tasks done.
2. **Mac build** — per `ios-mac-handoff.md`.
3. **TestFlight internal**
   - Internal testers group includes tester.
   - Build uploaded; processing notification received.
4. **Tester session**
   - Invite via TestFlight.
   - Feedback window: 72 hours.
   - Success criteria: Task 6 thresholds.
5. **Graduation (optional, deferred)**
   - If Patrick wants to broaden, promote from "Internal" to "External Testers" group on App Store Connect (requires Beta App Review — typically 1-2 day turnaround).
   - Not required for success; TestFlight-only per design "Deliberately out of scope: App Store public release."
6. **Rollback**
   - Mark current build inactive on App Store Connect; tester reinstalls previous build.
   - Server-side: Phase 4 runbook rollback still applies if needed independently.
7. **Sign-off.**

**Verification:** Runbook reviewed; signed post-tester-session.

**Commit:** `docs(uploads): deployment runbook — Phase 7 iOS rollout`
<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: Project close-out

**Shell:** `[WSL]`

**Files:**
- Modify: `CLAUDE.md` (road-trip repo)
- Create: `docs/implementation-plans/2026-04-13-resilient-uploads/COMPLETED-YYYY-MM-DD.md` (marker)
- Modify: `backlog.md` or equivalent (road-trip project backlog — create if missing) with deferred iOS items (Android, PWA, etc.)

**Implementation:**

Update `CLAUDE.md`:
- New section "Resilient Uploads Architecture" summarizing: per-trip containers, direct-to-blob SAS, state machine, iOS Capacitor hybrid bootstrap with Swift plugins.
- Update tech-stack list with Capacitor, @capacitor-community/sqlite, @capacitor/camera.
- Note: iOS native work happens on a Mac (refer to `ios-mac-handoff.md`).

Create `COMPLETED-YYYY-MM-DD.md` marker with:
- Summary of what shipped.
- Links to design plan + all phase files.
- Links to deployment runbook, acceptance documents.
- Known deferred items.

Append to project backlog:
- Android native (requires device + tester).
- External TestFlight (if Patrick wants broader testers).
- Migration of existing `road-trip-photos` blobs off dual-read (dual-read is sufficient indefinitely; this is purely cleanup).
- PWA install prompt (if a non-iOS mobile client is ever wanted).

**Verification:** CLAUDE.md reads accurately; marker committed; backlog updated.

**Commit:** `docs(road-trip): close out resilient-uploads implementation`
<!-- END_TASK_9 -->
<!-- END_SUBCOMPONENT_C -->

---

## Phase 7 Done When

- 9 tasks complete.
- Tester installs TestFlight build and successfully uploads photos from their current trip with ≥1 background and ≥1 force-quit scenario verified.
- Telemetry thresholds met (Task 6).
- Web regression smoke green.
- CLAUDE.md updated; marker committed.
- Deployment runbook fully signed off.
- Implementation plan directory can be archived (not required — marker suffices).
