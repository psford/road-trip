# iOS Offline Shell — Phase 7: On-device verification

**Goal:** Execute the rewritten device-smoke matrix on Patrick's iPhone; sign off all reframed ACs. Operational phase — no code changes, no test changes.

**Architecture:** Build a TestFlight build from the iOS Offline Shell branch (`ios-offline-shell`), install via TestFlight, run the matrix from [docs/test-plans/2026-04-13-resilient-uploads.md](../../test-plans/2026-04-13-resilient-uploads.md) (rewritten in Phase 6) on Patrick's iPhone, capture evidence into `docs/implementation-plans/2026-04-19-ios-offline-shell/phase-7-device-smoke.md`, and sign off both documents.

**Tech Stack:** Xcode 26, iOS Simulator, Patrick's iPhone, TestFlight, Safari Web Inspector.

**Scope:** Phase 7 of 8.

**Codebase verified:** 2026-04-19.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ios-offline-shell.AC5: AC9/AC10 reframed; phase_05 superseded
- **ios-offline-shell.AC5.3 Success:** All AC1.*–AC4.* PASS in on-device matrix execution on Patrick's iPhone.

(Implicitly re-validates AC1.*, AC2.*, AC3.*, AC4.* end-to-end on real WebKit.)

---

## Codebase findings

- ✓ TestFlight signing prerequisites (`DEVELOPMENT_TEAM = GP2M7H6R3U`, `NSPhotoLibraryUsageDescription`) committed by Phase 0.
- ✓ Build workflow: `npm run prepare:ios-shell` → `npx cap sync ios` → open `ios/App/App.xcodeproj` in Xcode (Mac) → Archive → upload to App Store Connect → distribute to TestFlight internal testers.
- ✓ Test plan to execute: [docs/test-plans/2026-04-13-resilient-uploads.md](../../test-plans/2026-04-13-resilient-uploads.md).
- ✓ Recording location: `docs/implementation-plans/2026-04-19-ios-offline-shell/phase-7-device-smoke.md`.

**External dependency findings:** N/A.

**Skills to activate at execution:** `ed3d-house-style:writing-for-a-technical-audience`, `ed3d-plan-and-execute:verification-before-completion`.

---

<!-- START_TASK_1 -->
### Task 1: Build + upload TestFlight build

**Verifies:** None directly (build infrastructure for the matrix run).

**Files:**
- No version-controlled changes. Generates an Xcode archive + App Store Connect build.

**Implementation:**

This task runs on Patrick's Mac. From the project root:

```bash
# 1. Sync the bootstrap shell copy (in case tripStorage.js drifted since last build)
npm run prepare:ios-shell

# 2. Optional: rebuild the legacy /bundle/* assets (the new shell doesn't use them, but the route is still live)
npm run build:bundle

# 3. Push everything to the iOS project
npx cap sync ios

# 4. Open Xcode
open ios/App/App.xcodeproj
```

In Xcode:
1. Select the `App` scheme and "Any iOS Device (arm64)" as the destination.
2. Product → Archive.
3. After archiving completes (Organizer opens), Distribute App → App Store Connect → Upload → Next → confirm signing → Upload.
4. Wait for processing (2–10 min). Watch App Store Connect → TestFlight for build status.
5. Once processed, the build appears under TestFlight → iOS → Builds. Add it to an Internal Testing group (Patrick is already in it).

**Verification:**
- Build appears in TestFlight Internal group, ready to install.
- Note the build number (e.g., `1.0.0 (42)`) for the sign-off doc.

**Commit:** None (operational; no version-controlled artifacts produced).
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Install on Patrick's iPhone

**Verifies:** None directly.

**Files:** None.

**Implementation:**

1. On Patrick's iPhone, open the TestFlight app.
2. Find "Road Trip" → tap Install (or Update).
3. Wait for download.
4. Confirm the build version on the iPhone's TestFlight build details matches the one uploaded in Task 1.

**Verification:** Road Trip app installed at the new build version; tappable from the home screen.

**Commit:** None.
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Execute the matrix from the rewritten test plan

**Verifies:** `ios-offline-shell.AC5.3` (and end-to-end revalidation of AC1.*–AC4.*).

**Files:**
- Create: `docs/implementation-plans/2026-04-19-ios-offline-shell/phase-7-device-smoke.md`

**Implementation:**

Open the rewritten test plan: [docs/test-plans/2026-04-13-resilient-uploads.md](../../test-plans/2026-04-13-resilient-uploads.md).

Run every section in order:

1. **Pre-flight (0.1–0.8)** — Mac terminal. All must PASS.
2. **AC1.1–AC1.6** matrix on D1 (Patrick's iPhone).
3. **AC2.1, AC2.2, AC2.4** matrix on D1.
4. **AC3.1–AC3.7** matrix on D1.
5. **AC4.1–AC4.5** matrix on D1 (4.4/4.5 already verified in pre-flight).
6. **End-to-end realistic scenario** on D1.

For each matrix entry, record results in `phase-7-device-smoke.md` using this template:

```markdown
# Phase 7 — On-device smoke (iOS Offline Shell)

**TestFlight build:** `1.0.0 (XX)` (replace XX with actual)
**Device:** Patrick's iPhone (model + iOS version)
**Date:** YYYY-MM-DD

---

## Pre-flight

| # | Check | Result | Evidence |
|---|---|---|---|
| 0.1 | curl `/` 200 HTML | PASS / FAIL | (curl output snippet) |
| 0.2 | curl `/post/{token}` 200 HTML | PASS / FAIL | |
| 0.3 | CORS header on `/` | PASS / FAIL | |
| 0.4 | CORS header on `/api/trips/view/...` | PASS / FAIL | |
| 0.5 | Bootstrap files in build resources | PASS / FAIL | (Xcode screenshot) |
| 0.6 | `npm test` green | PASS / FAIL | |
| 0.7 | `git diff` empty for uploadTransport.js + mapCache.js | PASS / FAIL | |
| 0.8 | `diff` empty for tripStorage.js shell copy | PASS / FAIL | |

## AC1: Server pages render and behave inside the iOS shell

| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC1.1 | PASS / FAIL | (screenshot of stopwatch + first-frame screen) | Time recorded: X.X s |
| AC1.2 | PASS / FAIL | (screencast of click → swap, no reload) | |
| AC1.3 | PASS / FAIL | (screenshot of map + photo picker open) | |
| AC1.4 | PASS / FAIL | (Web Inspector console output) | |
| AC1.5 | PASS / FAIL | (screencast of GitHub link tap → Safari) | |
| AC1.6 | PASS (by automated tests) | (note: not testable on touch device; covered by tests/js/intercept.test.js) | |

## AC2: Saved-trips routing and home screen

| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC2.1 | PASS / FAIL | (screenshot of empty hero state) | |
| AC2.2 | PASS / FAIL | (screencast of cold-launch jumping to trip B) | |
| AC2.4 | PASS / FAIL | (screenshot showing 👓 prefix on view-only card) | |

## AC3: Aggressive offline-first cache

| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC3.1 | PASS / FAIL | (Web Inspector Storage screenshot showing record) | |
| AC3.2 | PASS / FAIL | (Network tab screenshot showing no page fetch) | |
| AC3.3 | PASS / FAIL | (Network tab showing If-None-Match → 200/304 update) | |
| AC3.4 | PASS / FAIL | (screencast: revalidate fires, live page unchanged) | |
| AC3.5 | PASS / FAIL | (airplane-mode launch screencast) | |
| AC3.6 | PASS / FAIL | (screenshot of fallback.html with retry/back buttons) | |
| AC3.7 | PASS / FAIL | (Storage screenshot: no /api/poi entries in RoadTripPageCache) | |

## AC4: Existing offline upload behavior preserved

| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC4.1 | PASS / FAIL | (screencast of resume after re-launch) | |
| AC4.2 | PASS / FAIL | (screenshot of optimistic pin while offline) | |
| AC4.3 | PASS / FAIL | (screencast of pin promotion after re-enable) | |
| AC4.4 | PASS (pre-flight) | git diff empty | |
| AC4.5 | PASS (pre-flight) | git diff empty | |

## End-to-end realistic scenario

(Step-by-step PASS log + final state screenshot.)

---

## Anomalies / observations

(Anything unexpected: console errors, slow renders, visual glitches, edge cases. Even if all ACs PASS, log surprises here for the next branch.)
```

If ANY AC fails:
- Record the failure in the matrix row with full evidence.
- Capture a screen recording + Web Inspector logs.
- STOP and surface to Patrick. Do not sign off until all PASS or explicit known-issue waivers documented.

**Verification:** Every matrix row in `phase-7-device-smoke.md` has a result (PASS or FAIL with evidence). No empty cells.

**Commit:** `docs(ios-offline-shell): record Phase 7 on-device smoke results`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Sign-off

**Verifies:** `ios-offline-shell.AC5.3` (formal closure).

**Files:**
- Modify: `docs/implementation-plans/2026-04-19-ios-offline-shell/phase-7-device-smoke.md` — add the sign-off line at the bottom.
- Modify: `docs/test-plans/2026-04-13-resilient-uploads.md` — fill in the sign-off table at the end.

**Implementation:**

Append to `phase-7-device-smoke.md`:

```markdown
---

## Sign-off

All matrix entries PASS on Patrick's iPhone (TestFlight build `1.0.0 (XX)`, iOS [version], [date]).

The iOS Offline Shell ships. AC1.* through AC4.* are verified end-to-end on real WebKit. AC5.3 satisfied.

Signed: Patrick `<date>`.
```

In `docs/test-plans/2026-04-13-resilient-uploads.md`, mark the sign-off table at the bottom:

```markdown
| Item | Status | Notes |
|---|---|---|
| Pre-flight 0.1–0.8 PASS | ☑ | |
| AC1.1–AC1.6 matrix PASS on D1 | ☑ | |
| AC2.1, AC2.2, AC2.4 PASS on D1 | ☑ | |
| AC3.1–AC3.7 PASS on D1 | ☑ | |
| AC4.1–AC4.5 PASS on D1 | ☑ | |
| End-to-end realistic scenario PASS | ☑ | |
| Screenshots/video captured | ☑ | docs/implementation-plans/2026-04-19-ios-offline-shell/phase-7-device-smoke.md |

Signed off: Patrick `<date>`. All matrix entries PASS.
```

**Verification:**
- Both files have a sign-off line with date and PASS status.
- All ACs have a green checkmark (or explicit waiver) in both docs.

**Commit:** `docs(ios-offline-shell): sign off Phase 7 — iOS Offline Shell verified on-device`

After this commit lands: the iOS Offline Shell implementation is **complete**. Branch `ios-offline-shell` is ready to merge into `develop` per the project git-flow (PR via GitHub UI; Patrick merges).
<!-- END_TASK_4 -->
