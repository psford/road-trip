# iOS Shell Polish — Human Test Plan

**Plan:** `docs/implementation-plans/2026-05-09-ios-shell-polish/`
**Branch:** `ios-shell-polish`
**Generated:** 2026-05-10
**Baseline:** 607 tests → 703 passing (+96 net new across Phases 1–5)

## Purpose

This document is the human-executable verification layer for the iOS Shell Polish branch. Automated coverage (vitest, 703 passing tests) verifies wrapper-call sites, state-machine emitters, lifecycle hooks, skeleton injection, and animation lifecycle. This plan covers the surfaces jsdom cannot reach: real iOS chrome (`backdrop-filter`, system-blue accent, native share sheet, native confirm, status-bar text-color flip, real haptic motors, real `prefers-reduced-motion`, real safe-area insets, real `prefers-color-scheme`) and end-to-end flows.

The canonical operational artifact is the existing smoke checklist:

> **`docs/implementation-plans/2026-05-09-ios-shell-polish/smoke-checklist.md`**

This document supplements the smoke checklist with end-to-end scenario walkthroughs, prerequisites, and an AC traceability matrix. Patrick should run the smoke checklist line-by-line on his iPhone after `npx cap sync ios` and use this document for the scenario-level passes.

## Prerequisites

### Environment

- Physical iPhone (iOS 18+) — `prefers-color-scheme`, `prefers-reduced-motion`, `backdrop-filter`, native share sheet, and real haptics cannot be exercised in jsdom or the iOS Simulator with fidelity.
- Patrick's iPhone is the canonical test device.
- Xcode + SPM project at `ios/App/` is the iOS build root (never CocoaPods).

### Pre-flight gates (run locally before sync)

```
npm test                          # vitest: must report 703 passing across 35 files
dotnet build RoadTripMap.sln      # must report 0 warnings / 0 errors
```

`dotnet test RoadTripMap.sln` is the AC8.2 gate in environments where Azurite/SQL fixtures are reachable. In the worktree session for this branch, `dotnet build` (0 warnings/0 errors) was the verified gate per the cross-phase env-mismatch note. Patrick should run `dotnet test` once before sync if he has not already.

### iOS sync (Patrick only — Claude must NOT run these)

```
npm run prepare:ios-shell         # only if wwwroot/js/tripStorage.js changed
npx cap sync ios                  # syncs wwwroot + src/bootstrap into the Xcode project
```

Open Xcode, build, deploy to the physical iPhone.

### Source of truth for line-by-line verification

```
docs/implementation-plans/2026-05-09-ios-shell-polish/smoke-checklist.md
```

The smoke checklist has 7 sections matching the design plan AC groups (token foundation, native plugin wiring, post.html chrome, trips.html immersive viewer, index.html / create.html, page transitions + skeletons, regression / browser cross-check). Every checkbox there must be checked in light AND dark mode, online AND airplane mode where indicated.

## End-to-End Scenarios

These scenarios span multiple phases and exercise the user journeys the unit tests can't reach end-to-end. Run them in the order listed. Each scenario validates several ACs together — see traceability matrix below.

### Scenario E1: Cold start → trip view → photo viewer (AC2.1, AC3.5, AC4.1, AC5.1, AC5.2, AC5.3, AC5.4, AC7.1, AC7.3)

Purpose: validate the bootstrap chain (cold-start status-bar dark, asset pre-cache, ios.css injection) and the immersive viewer end-to-end.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Force-quit the app (swipe up, swipe Road Trip card away). | App is fully terminated. |
| 2 | Tap the Road Trip app icon. | Bootstrap progress flashes briefly; status-bar text is DARK (matches default light app theme). |
| 3 | App lands on default trip (`/trips/{viewToken}`) or `/` if no saved trip. | `.platform-ios` class is on `<body>`; translucent `.map-header` visible at top; large trip-name title rendered. |
| 4 | Scroll the trips page. | Header stays sticky and translucent (`backdrop-filter` blur visible behind status-bar area). Content scrolls beneath. Notch / Dynamic Island has clear margin (safe-area-inset-top respected). |
| 5 | While the photo list loads (online, slow network), observe the carousel area. | Skeleton placeholders (shimmering grey tiles) flash briefly before real photos appear. |
| 6 | Tap a photo thumbnail in the carousel. | Immersive viewer opens. Backdrop is TRUE-BLACK (`#000000`, not the universal `rgba(0,0,0,0.9)`). Status bar text flips to LIGHT (visible against black). Chrome (close button + action buttons) is visible. |
| 7 | Tap the photo area (not chrome). | Chrome fades out (`.chrome-hidden`). Image remains visible. |
| 8 | Tap again. | Chrome fades back in. |
| 9 | Swipe DOWN on the viewer with > 100px translation. | Viewer dismisses with translate+fade animation. Status bar text returns to DARK. |
| 10 | Open the viewer again, then tap the close (X) button. | Viewer closes. Status bar text returns to DARK. |
| 11 | Open the viewer again, then press Escape on an external keyboard if available. | Viewer closes. Status bar text returns to DARK. |
| 12 | Navigate to another page (tap the Map button or any nav link). | Page transition: visible fade-out, content swap, fade-in. New page's chrome is correct. |

### Scenario E2: Upload a photo end-to-end (AC3.1, AC4.2, AC4.3)

Purpose: validate haptic feedback across the upload state machine, end-to-end.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Navigate to `/post/{secretToken}` (post page). | Page loads with sticky translucent header. Add-Photo button visible. |
| 2 | Tap Add-Photo. | Feel a LIGHT haptic. File picker opens. |
| 3 | Pick a photo with GPS EXIF. | Picker closes; preview pin renders on map. |
| 4 | Tap Post-Photo. | Feel a LIGHT haptic. Upload begins. Progress visible. |
| 5 | Wait for upload to commit. | Feel a MEDIUM haptic when the upload commits successfully. Photo appears in the carousel. |
| 6 | Tap Add-Photo, pick a second photo, tap Cancel before posting. | Cancel button feels a LIGHT haptic. Preview pin clears. |
| 7 | Now turn on airplane mode. Tap Add-Photo, pick a photo, tap Post-Photo. | Upload starts, then fails. Feel an ERROR haptic when the failure surfaces. Toast / inline error shows the friendly offline copy. |
| 8 | Turn airplane mode OFF. Tap retry (if surfaced) or re-upload. | Photo commits successfully. MEDIUM haptic confirms. |
| 9 | Navigate away from /post and back several times. | Haptics do NOT stack (each button press fires ONE buzz, not N). |

### Scenario E3: Photo deletion with native confirm (AC3.4, AC4.5, AC4.6)

Purpose: validate the native iOS confirm dialog and the cancel-keeps-photo invariant.

| Step | Action | Expected |
|------|--------|----------|
| 1 | On `/post/{secretToken}` with at least one photo in the carousel, open the immersive viewer for that photo. | Viewer opens with light status bar. |
| 2 | Tap the Delete (trash icon) action button. | Status bar restores to DARK as viewer closes (try/finally). Native iOS confirm dialog appears with title "Delete photo?" and a destructive (red) "Delete" button + Cancel. |
| 3 | Tap Cancel. | Dialog dismisses. Photo IS NOT deleted (still in carousel). No error toast. |
| 4 | Re-open the viewer for the same photo. Tap Delete again. | Same dialog appears. |
| 5 | Tap Delete (destructive). | Photo IS deleted. Success toast appears. Carousel re-renders without it. |

### Scenario E4: Native share sheet (AC3.3, AC4.4)

Purpose: validate that the native iOS share sheet opens with the production HTTPS URL, not `capacitor://`.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open the immersive viewer for any photo (post.html OR trips.html). | Viewer opens. |
| 2 | Tap the Share action button. | Native iOS UIActivityViewController opens with the photo's title and a URL. |
| 3 | Inspect the URL in the share sheet preview. | URL begins with `https://app-roadtripmap-prod.azurewebsites.net/...`. It does NOT begin with `capacitor://localhost`. |
| 4 | Tap Cancel on the share sheet. | Share sheet dismisses. Viewer is still open. No error. |
| 5 | Re-open share, pick "Copy" (or AirDrop / Messages). | Action completes normally. |

### Scenario E5: Trip creation success + failure haptics (AC6.3)

Purpose: validate the create-flow haptic round-trip.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Navigate to `/create`. | Form renders with iOS nav-bar header + frosted-fill input + system-blue focus ring on tap. |
| 2 | Tap the Name input. Type a trip name. | Input focuses with system-blue accent ring; characters appear. |
| 3 | Tap Create. | Feel a SUCCESS haptic (notification-style) when the API resolves and the page navigates to `/post/{secretToken}`. |
| 4 | Navigate back to `/create`. Leave Name empty. Tap Create. | Feel an ERROR haptic. Inline validation message appears. |
| 5 | Type a name. Turn on airplane mode. Tap Create. | Feel an ERROR haptic. Friendly offline-error copy appears (not the raw `TypeError: Failed to fetch`). |
| 6 | Turn airplane mode OFF. Tap Create again. | Trip is created. SUCCESS haptic. Navigates to `/post/{secretToken}`. |

### Scenario E6: Page-transition + skeleton + rapid-nav stress (AC7.1, AC7.3, AC7.4)

Purpose: validate the animation lifecycle holds up under rapid back-to-back navigations and that skeletons render in the expected slot.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Starting on `/`, tap into a trip card. | Fade-out, swap, fade-in transition is visible. Skeleton placeholders flash briefly during the photo-list fetch. |
| 2 | Tap back to home, then into a different trip card, then back, then a third trip card — five rapid taps within 2 seconds. | Each navigation completes. NO `.page-out` or `.page-in` class is left stuck on `<body>` (content is fully visible at rest after rapid sequence). No console errors in Xcode log. |
| 3 | After the rapid sequence settles, scroll the final page. | Page is responsive, content interacts normally. |
| 4 | Go to iOS Settings → Accessibility → Motion → Reduce Motion: ON. Return to the app. | Cross-page navigation is now near-instant (CSS `prefers-reduced-motion` shortens animation duration to 0.001ms). Skeleton placeholders are STATIC (no shimmer). |
| 5 | Turn Reduce Motion OFF. Return to the app. | Animations and shimmer return. |

### Scenario E7: Dark mode round-trip (AC2.1, AC2.2, AC2.3)

Purpose: validate the dark-mode token override and the immersive viewer's true-black invariant.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Settings → Display & Brightness → Light. Open the app. | All four pages render in light palette (existing brand-teal CTAs unchanged). |
| 2 | Without closing the app, swipe up to Control Center and toggle Dark mode (or Settings → Dark). Return to app. | App re-renders in dark mode on the next paint without a full reload. Surfaces are dark, text is white, brand-teal CTAs unchanged. |
| 3 | Open the immersive photo viewer. | Backdrop is TRUE-BLACK (not the inverted-light variant). Status bar text is LIGHT. |
| 4 | Toggle back to Light mode WITH the viewer still open. | Viewer remains TRUE-BLACK (does not invert). |
| 5 | Close the viewer. | App renders in light mode again. |

### Scenario E8: Offline-first regression sanity (AC8.3)

Purpose: validate that prior shipped behavior (resilient upload, offline shell, MapLibre rendering) is preserved.

| Step | Action | Expected |
|------|--------|----------|
| 1 | While online, open a trip you've visited before. | Trip loads quickly (page-cache hit). |
| 2 | Force-quit the app. Turn on airplane mode. Open the app. | App opens. The saved-trip page renders from `RoadTripPageCache`. Skeletons appear in the carousel briefly. Cached photo list renders; image thumbnails may show as broken (accepted scope boundary — list visibility > image visibility offline). |
| 3 | Turn airplane mode OFF. Pull-to-refresh or navigate away and back. | Real photo thumbnails appear. |
| 4 | Open the MapLibre map view. | Map renders. POIs / park boundaries load. No console errors. |
| 5 | Navigate to `/post/{token}`, pick a photo, tap Post. With airplane mode flipped OFF mid-upload (start online, kill the network briefly), then back ON. | Upload survives the network churn and eventually commits. MEDIUM haptic fires when it does. |

### Scenario E9: 44×44 tap-target audit (AC6.4)

Purpose: tactile "no near-misses" check. Use a normal-sized fingertip — no precision tapping.

| Step | Action | Expected |
|------|--------|----------|
| 1 | On `/` (index.html), tap each `.my-trip-card` once. | Each tap registers; no need to aim precisely at the card center. Card lifts on press (Photos-tile feel). |
| 2 | On any page, tap each `.nav a` link in the bottom/top nav. | Each tap registers without misfires. |
| 3 | On `/`, tap the hero CTA (`.button-hero`). | Tap registers. |
| 4 | Across all four pages (`index.html`, `create.html`, `post.html`, `trips.html`), tap every visible button / link. | No tap target feels smaller than your fingertip. No near-misses. |

### Scenario E10: Browser cross-check (AC9.3)

Purpose: validate that browsers see only universal upgrades — no `.platform-ios` chrome bleed.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `https://app-roadtripmap-prod.azurewebsites.net/` in mobile Safari (NOT the installed app). | Site renders with the new universal design tokens (type scale, semantic colors, motion). No translucent headers (browser does not get `.platform-ios` scoping). No immersive viewer status-bar flip (browser has no status bar). No iOS-shell page-transition animations. |
| 2 | Open the same URL in desktop Chrome. | Same expectation. Look reasonable; no broken layout. |
| 3 | Open DevTools → Console. | No errors related to `@capacitor/*` imports (those should only resolve on the native shell via dynamic import). |
| 4 | Navigate to `/create`, then `/`, then `/trips/{viewToken}`. | All four page surfaces render correctly. Existing functionality (form submit, trip-card click, MapLibre) all behave. |

## Human Verification Required (per `test-requirements.md`)

The following ACs cannot be automated and must be exercised on Patrick's iPhone. Each is mapped into the scenarios above and into the smoke-checklist sections.

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC1.1 type-scale tokens render | jsdom cannot evaluate visual type | Smoke Section 1 + Scenario E1 step 3 (large title visible) |
| AC1.2 legacy tokens unchanged | Visual regression, backed by AC8.1 (703 tests pass) | Smoke Section 1 (existing UI unchanged) |
| AC2.1 dark-mode tokens render | `prefers-color-scheme` not evaluated by jsdom | Scenario E7 + Smoke Section 1 |
| AC2.2 theme switch on next paint | Browser-native repaint | Scenario E7 step 2 |
| AC2.3 immersive viewer dark in both themes | Visual | Scenario E7 step 4 |
| AC3.3 native iOS share sheet | jsdom can't surface UIActivityViewController | Scenario E4 + Smoke Section 2 |
| AC3.4 native iOS confirm | jsdom can't surface UIAlertController | Scenario E3 + Smoke Section 2 |
| AC3.5 status-bar text-color flip | iOS chrome surface | Scenarios E1 + E3 + Smoke Sections 2 + 4 |
| AC4.1 translucent sticky nav bar | `backdrop-filter` + `position: sticky` + safe-area | Scenario E1 steps 3+4 + Smoke Section 3 |
| AC5.1 translucent map-header + large title | Visual + `backdrop-filter` | Scenario E1 steps 3+4 + Smoke Section 4 |
| AC5.2 true-black backdrop + auto-hiding chrome (visual) | Visual; chrome toggle is unit-tested | Scenario E1 steps 6–8 + Smoke Section 4 |
| AC5.3 swipe-down translate+fade (visual) | Animation visible only on-device | Scenario E1 step 9 + Smoke Section 4 |
| AC6.1 hero typography + Photos-tile feel | Visual | Scenario E9 step 1 + Smoke Section 5 |
| AC6.2 frosted-fill form input + system-blue focus | Visual + `backdrop-filter` | Scenario E5 step 2 + Smoke Section 5 |
| AC6.4 44×44 tap targets | Tactile judgement | Scenario E9 + Smoke Section 5 |
| AC7.1 page-transition fade (visual) | jsdom doesn't run CSS animations | Scenario E6 step 1 + Smoke Section 6 |
| AC7.2 reduced-motion bypass | jsdom doesn't honor `prefers-reduced-motion` | Scenario E6 step 4 + Smoke Section 6 |
| AC7.3 skeleton shimmer (visual) | jsdom doesn't render shimmer | Scenarios E1 + E6 + E8 + Smoke Section 6 |
| AC7.4 rapid-nav doesn't visually corrupt | Visual sticky-state on-device | Scenario E6 step 2 + Smoke Section 6 |
| AC8.3 existing functionality on real device | Resilient upload, MapLibre, offline shell | Scenario E8 + Smoke Section 7 |
| AC8.4 LogSanitizer invariant | Operational confirmation | Smoke Section 7 (no token / SAS / GPS strings in Xcode console) |
| AC9.1 no new HTML files | Code-review check; trivially observable | Implicit — every page Patrick exercises is one of the four (`index`, `create`, `post`, `trips`) |
| AC9.2 no `@capacitor/*` in web bundle | Build-bundle verification + browser cross-check | Scenario E10 step 3 + Phase 1 Task 9 grep on `wwwroot/bundle/app.js` |
| AC9.3 no `.platform-ios` chrome bleed | Browser cross-check | Scenario E10 + Smoke Section 7 |
| AC10.1 Patrick on-device sign-off | The whole point | Entire smoke checklist + scenarios E1–E10 |
| AC10.2 Patrick reaches for app on the upcoming trip | Post-deployment subjective | Captured in design-plan `## Verification log` after the upcoming trip |

## Traceability Matrix

| AC | Automated test (vitest) | Human step (this plan + smoke checklist) |
|----|-------------------------|------------------------------------------|
| AC1.1 | (none — visual; AC8.1 baseline preservation gates regression) | Smoke Section 1 / Scenario E1 step 3 |
| AC1.2 | (none — 703-test baseline regression) | Smoke Section 1 |
| AC1.3 | (gap — accepted, code-review-time) | Smoke Section 1 |
| AC2.1 | (none — `prefers-color-scheme` not evaluable in jsdom) | Scenario E7 + Smoke Section 1 |
| AC2.2 | (none — browser-native repaint) | Scenario E7 step 2 + Smoke Section 1 |
| AC2.3 | (none — could be source-checked, accepted gap) | Scenario E7 step 4 + Smoke Section 1 |
| AC3.1 | `tests/js/nativeBridge.test.js` (6 cases) | Scenario E2 + Smoke Section 2 |
| AC3.2 | `tests/js/nativeBridge.test.js` (web-fallback + import-failure, ~11 cases) | Scenario E10 (browser fallback works) |
| AC3.3 | `tests/js/photoCarousel.test.js` + `tests/js/mapUI.test.js` (call-site) | Scenario E4 + Smoke Section 2 |
| AC3.4 | `tests/js/postUI-upload.test.js` (delete-flow, 5 cases) | Scenario E3 + Smoke Section 2 |
| AC3.5 | `tests/js/bootstrap-loader.test.js` (cold-start) + `tests/js/photoCarousel.test.js` (viewer lifecycle) | Scenarios E1 + E3 + Smoke Sections 2 + 4 |
| AC3.6 | `tests/js/nativeBridge.test.js` (re-eval idempotency) | Scenario E2 step 9 (haptics don't stack) |
| AC4.1 | (none — visual) | Scenario E1 step 4 + Smoke Section 3 |
| AC4.2 | `tests/js/postUI-upload.test.js` (3 buttons + Native-absent) | Scenario E2 + Smoke Section 3 |
| AC4.3 | `tests/js/uploadQueue.test.js` (medium / error / Native-absent / user-abort regression) | Scenario E2 + Smoke Section 3 |
| AC4.4 | `tests/js/photoCarousel.test.js` (handleSave) | Scenario E4 + Smoke Section 3 |
| AC4.5 | `tests/js/postUI-upload.test.js` (dialogConfirm + delete) | Scenario E3 + Smoke Section 3 |
| AC4.6 | `tests/js/postUI-upload.test.js` (cancel keeps photo) | Scenario E3 step 3 + Smoke Section 3 |
| AC5.1 | (none — visual) | Scenario E1 step 3 + Smoke Section 4 |
| AC5.2 | `tests/js/photoCarousel.test.js` (chrome-toggle, 3 cases) | Scenario E1 steps 6–8 + Smoke Section 4 |
| AC5.3 | `tests/js/photoCarousel.test.js` (swipe-dismiss, 4 cases) | Scenario E1 step 9 + Smoke Section 4 |
| AC5.4 | `tests/js/photoCarousel.test.js` (close-button + Escape + try/finally substrate covers all paths through `closeOverlay`) | Scenario E1 steps 9–11 + Smoke Section 4 |
| AC5.5 | `tests/js/photoCarousel.test.js` ("removeChild throws" still restores) | (no human surface — try/finally is invisible if working; covered transitively by E1 step 10/11) |
| AC6.1 | (none — visual) | Scenario E9 step 1 + Smoke Section 5 |
| AC6.2 | (none — visual + `backdrop-filter`) | Scenario E5 step 2 + Smoke Section 5 |
| AC6.3 | `tests/js/create-flow.test.js` (success + 3 failure shapes + Native-absent + IIFE-guard) | Scenario E5 + Smoke Section 5 |
| AC6.4 | (gap — accepted, code-review-time) | Scenario E9 + Smoke Section 5 |
| AC7.1 | `tests/js/fetchAndSwap.test.js` (Phase 5 animation lifecycle, 7+ cases) | Scenario E6 step 1 + Smoke Section 6 |
| AC7.2 | `tests/js/fetchAndSwap.test.js` (source-level "no JS matchMedia") | Scenario E6 step 4 + Smoke Section 6 |
| AC7.3 | `tests/js/postUI-upload.test.js` + `tests/js/mapUI.test.js` (skeleton inject/remove) | Scenarios E1 step 5 + E6 + E8 + Smoke Section 6 |
| AC7.4 | `tests/js/fetchAndSwap.test.js` (race-condition + rapid-nav, 5 cases) | Scenario E6 step 2 + Smoke Section 6 |
| AC8.1 | `npm test` — 703 passing across 35 files | Smoke Section 7 (sanity gate) |
| AC8.2 | `dotnet build RoadTripMap.sln` — 0 warnings / 0 errors (env-mismatch note: `dotnet test` verified across phases) | Smoke Section 7 (Patrick runs `dotnet test` locally before sync) |
| AC8.3 | (existing 607 baseline + 96 new tests = 703 total) | Scenario E8 + Smoke Section 7 |
| AC8.4 | (existing `UploadEndpointHttpTests` captured-log assertions — Phases 1–6 don't touch the .NET side) | Smoke Section 7 (no raw secrets in Xcode console) |
| AC9.1 | (accepted gap — code-review-time) | Implicit — only 4 wwwroot HTML pages exist |
| AC9.2 | (accepted gap — Phase 1 Task 9 grep on `wwwroot/bundle/app.js`) | Scenario E10 step 3 |
| AC9.3 | (accepted gap — code-review-time) | Scenario E10 + Smoke Section 7 |
| AC10.1 | (none — human sign-off) | Entire smoke checklist + all scenarios |
| AC10.2 | (none — post-trip subjective) | Captured in design-plan verification log after the upcoming trip |

## Sign-off

Patrick completes the smoke checklist sign-off block at `docs/implementation-plans/2026-05-09-ios-shell-polish/smoke-checklist.md`. The Phase 6 capture document (`docs/implementation-plans/2026-05-09-ios-shell-polish/phase-6-device-smoke.md`, if created) records observed deltas. The design plan's `## Verification log` section captures the final post-sync-and-trip subjective sign-off (AC10.1 + AC10.2).
