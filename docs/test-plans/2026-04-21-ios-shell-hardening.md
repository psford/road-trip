# iOS Shell Hardening — Human Test Plan

**Source plan:** `docs/implementation-plans/2026-04-21-ios-shell-hardening/`
**Scope:** Phases 1–8 (40 commits on branch `ios-offline-shell`)
**Companion artifact:** `docs/implementation-plans/2026-04-21-ios-shell-hardening/smoke-checklist.md` — the same on-device steps in checkbox form for Phase 8 Task 3 signoff.

Automated coverage for every acceptance criterion is PASS per the test analyst. This document enumerates the manual steps Patrick must run on a physical iPhone to close out the deferred on-device ACs (AC3.3, AC6.safeArea.2–4, AC6.hig.1–5, AC7.1).

---

## Prerequisites

- Physical iPhone 12 or newer (notch + home indicator)
- iOS 17+ recommended
- App built from `ios-offline-shell` branch at HEAD `3469730` (or later) and installed via Xcode
- Xcode device console attached (Window → Devices and Simulators → select device → Open Console) to observe runtime JS console output
- A second device (another iPhone or desktop) with Safari for share-link verification
- At least one pre-existing trip the iPhone is the owner of (post token accessible) with photos uploaded
- A share-view link from another trip so an uncached offline-navigate case can be exercised
- `npm test` green locally on the same HEAD (modulo the 8 pre-existing `tests/js/versionProtocol.test.js` failures — hardcoded `/workspaces/road-trip/` paths, out-of-scope baseline)

---

## Phase 1: Cascade-free navigation (AC1, AC2.event, AC2.scope, AC7.1)

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Launch app cold with Xcode console attached. | Console is clean. Home page (`/`) renders with saved trips (if any). No `SyntaxError` or listener-duplicate warnings. |
| 1.2 | Tap a saved post link to navigate home → post. | Post page renders. Console shows no cascade errors. `PostUI.init` equivalents run (upload form visible in initial state). |
| 1.3 | Tap the "Create new trip" link to navigate post → create. | Create page renders. No duplicate-const SyntaxError. Form inputs present. |
| 1.4 | Submit a dummy trip (fill name + description). | Navigates to post page for new trip. Console remains clean. |
| 1.5 | Navigate create → post → home → post (repeat at least 5 navigations total). | Every swap succeeds without `SyntaxError: Can't create duplicate variable`. `PostUI.init`-style handlers fire exactly once per visit (upload form returns to initial state on each arrival, not duplicated). |
| 1.6 | (AC7.1) Enable airplane mode. In app, attempt to navigate to a trip URL that has NEVER been visited/cached before (use a new share-view link someone else sent). | `fetchAndSwap` fails cleanly. Console shows the single failure reason but NO cascade of follow-up errors. Fallback page renders with Retry / Back buttons. |
| 1.7 | Still offline, tap Back. | Previous cached page returns. No additional error cascade. |
| 1.8 | Disable airplane mode. | Subsequent navigations resume normally. |

## Phase 2: Share-trip link (AC3.3)

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Navigate to a post page (trip you own). | Post page renders with share-view block visible. |
| 2.2 | Tap the "Copy" button on the share-view link. | Confirmation (toast / button flash) indicates copy. |
| 2.3 | Open Messages (or Notes / any text app on same device). Paste. | Pasted text reads `https://app-roadtripmap-prod.azurewebsites.net/trips/{viewGuid}`. MUST NOT start with `capacitor://`. |
| 2.4 | Send the link to yourself or copy to the second device's Safari. | URL opens in Safari → trip view-only page renders without auth prompt. Photos load. |
| 2.5 | Back in the app, open the post page carousel, tap a single photo's native share action. | iOS share sheet opens. The URL presented in the share sheet is of the same `https://app-roadtripmap-prod.azurewebsites.net/...` form. Never `capacitor://`. |

## Phase 3: Offline create (AC4.3)

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | With the app online, navigate to `/create`. | Form loads normally. |
| 3.2 | Enable airplane mode. | No network. |
| 3.3 | Type "Test Offline Trip" in name. Type "Testing offline." in description. Tap Submit. | Error area shows exact copy: `Can't create a trip while offline. Try again when you're back online.` |
| 3.4 | Verify submit button state. | Button is re-enabled (not stuck on "Creating..."). Button text reverted to "Create Trip". |
| 3.5 | Verify no internal error leaked. | No raw text like `"Load failed"`, `"TypeError"`, `"NetworkError"`, or stack trace visible in UI. |
| 3.6 | Disable airplane mode. Tap Submit again. | Creation succeeds; navigates to post page for new trip. |

## Phase 4: Offline trip-page photos (AC5.2, AC5.3)

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | While online, visit a trip view link (`/trips/{viewGuid}`) that has at least 2 photos. | Photos load and thumbnails render. |
| 4.2 | Fully background or kill the app. Enable airplane mode. Relaunch. Re-visit the SAME trip view link. | Photo list renders (cached JSON). Thumbs may show broken-image placeholders — this is the documented Azure-blob limitation and is expected. |
| 4.3 | Still offline, navigate to a NEW trip view link that has never been cached. | Offline-friendly message shown instead of blank screen. No cascade errors in console. |
| 4.4 | Still offline, open an owner post page for a trip whose photos are NOT cached. | Toast shows exact copy: `Photos unavailable offline. Reconnect to see the latest.` |
| 4.5 | Disable airplane mode. Pull to refresh / re-open the trip page. | Fresh photo list loads. Thumbnails render correctly. |

## Phase 5: Safe-areas visual check (AC6.safeArea.2, .3, .4)

Visually inspect on a notched iPhone. No element should be clipped by the notch or the home indicator.

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | Open `/` (home / index). | `.hero` does not overlap notch. Readable gap above. |
| 5.2 | Open `/create`. | `.page-header` sits cleanly beneath the notch. |
| 5.3 | Open a post page `/post/{token}`. | `.page-header` clears the notch. `.toast-container` (trigger a toast by, e.g., invalid input) floats above the home indicator. |
| 5.4 | With a paused upload present (start an upload then immediately background the app for >1s, return), reopen post page. | `.resume-banner` visible and clears the notch. |
| 5.5 | Open a trip view link `/trips/{viewToken}`. | `.map-header` beneath notch with full visibility. `.map-control` buttons float above home indicator. |
| 5.6 | On trip view, tap a photo to open the carousel. | `.view-carousel-container` floats above home indicator (not obscured). |
| 5.7 | On a post page, trigger the homescreen/install modal (if applicable) or any `.homescreen-modal-overlay`. | Visible margin above notch AND above home indicator (both padded). |

## Phase 6: HIG tap-targets + momentum scroll (AC6.hig.1, AC6.hig.2)

| Step | Action | Expected |
|------|--------|----------|
| 6.1 | On post page (owner), tap `.copy-button` near share link (the "Copy" button). | Registers on first tap, no near-miss. Feels finger-sized (≥44×44pt). |
| 6.2 | Open carousel; tap each `.carousel-action-btn`. | Full-sized tap targets; no missed taps. |
| 6.3 | Tap `.photo-popup-delete` in a photo popup. | Full-sized; confirmation dialog appears reliably. |
| 6.4 | Tap the upload panel toggle (`.upload-panel__toggle`) to open/close. | Full-sized. |
| 6.5 | With an in-flight or failed upload: tap `.upload-panel__retry`, `.upload-panel__pin-drop`, `.upload-panel__discard` each. | All three feel full-sized (padding ≥12px per axis, confirmed in static test). |
| 6.6 | On trip view page, tap `.map-back` button. | Full-sized. |
| 6.7 | Tap any `.poi-action-btn` pin. | Full-sized. |
| 6.8 | On post page with multiple in-flight uploads visible in `.upload-panel__body`, flick-scroll the list. | List scrolls with iOS native momentum/inertia. Does not feel sticky or stuck. |

## Phase 7: Keyboard attributes (AC6.hig.3, AC6.hig.4)

| Step | Action | Expected |
|------|--------|----------|
| 7.1 | On post page, tap the `#captionInput` field. | iOS keyboard opens. Begin typing "hello world this is a test." — the `h`, and the next sentence start auto-capitalize (sentences mode). Misspelling a word ("teh") offers autocorrect suggestions. |
| 7.2 | On create, tap `#tripName` field. Type "pacific coast highway". | Each word's first letter auto-capitalizes → "Pacific Coast Highway" (words mode). |
| 7.3 | On create, tap `#tripDescription` textarea. Type "driving south. weather nice." | Each sentence's first letter auto-capitalizes (sentences mode). |

## Phase 8: Regression and sign-off (AC6.hig.5)

| Step | Action | Expected |
|------|--------|----------|
| 8.1 | On a non-iOS device (desktop Chrome or non-notched iPad Safari), open `https://app-roadtripmap-prod.azurewebsites.net/`. | No `.platform-ios` styles leak: no extra padding above headers, no 44×44 min constraints affecting button layout, no visible difference from pre-hardening. |
| 8.2 | Navigate home → post → create → trips view in the non-iOS browser. | Every page renders normally. No console errors. No CSS anomalies. |
| 8.3 | Back on the iPhone: after all previous steps, check console one more time. | No outstanding error toasts or warnings on any page. |
| 8.4 | Patrick's signoff on smoke-checklist.md Section 8. | Tester, device, iOS version, build, date filled in. |

---

## End-to-End Scenarios

### E2E-1: Owner creates, shares, and views offline

**Purpose:** validates the full resilient-upload + share + offline-read path end-to-end across the hardened shell.

1. (Online) Launch the app cold. Navigate to `/create`. Create a new trip "E2E Smoke Trip".
2. On the resulting post page, upload 2 photos (wait for both to complete).
3. Tap Copy on the share-view link. Verify exact `https://...` form in pasted clipboard (Phase 2).
4. On a second device, open the copied link in Safari. Verify both photos load.
5. Back in the iPhone app, fully kill the app. Enable airplane mode. Relaunch.
6. From home, tap the saved trip. Navigate through post → home → trips → post repeatedly.
7. Verify console is cascade-free (Phase 1.5), photo list renders from cache (Phase 4.2), share link still reads `https://...` (Phase 2.3), and no safe-area overlaps anywhere (Phase 5).
8. Disable airplane mode. Verify fresh sync updates the cached photo list (AC5.4 background revalidate).

### E2E-2: Offline-first cold start with uncached target

**Purpose:** validates AC7.1 cascade-prevention in the harshest path (zero cache + cold start + unseen URL).

1. Uninstall and reinstall the app (clears all IDB + localStorage).
2. Before first launch, enable airplane mode.
3. Launch the app. Expected: fallback page renders cleanly (no cascade). Console shows the single cache-miss-while-offline failure.
4. Tap Retry — fallback re-renders (still offline). No cascade.
5. Disable airplane mode. Tap Retry. Home page loads normally.

---

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC3.3 | Requires real WKWebView + clipboard + second-device Safari paste | Phase 2 |
| AC6.safeArea.2 | `env(safe-area-inset-*)` = 0 in jsdom; only observable on notched device | Phase 5.1–5.5 |
| AC6.safeArea.3 | Home-indicator clearance only observable with a home indicator | Phase 5.3, 5.5, 5.6 |
| AC6.safeArea.4 | Both-inset clearance only visible on device | Phase 5.7 |
| AC6.hig.1 | Tap-target "feel" is a tactile judgement | Phase 6.1–6.7 |
| AC7.1 | Post-failure cascade only reproduces under real WKWebView offline stack | Phase 1.6, E2E-2 |

---

## Traceability Matrix

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | fetchAndSwap.test.js `script-src deduplication` t1 | Phase 1.5 (belt-and-suspenders) |
| AC1.2 | fetchAndSwap.test.js `script-src deduplication` t2 | — |
| AC1.3 | fetchAndSwap.test.js `script-src deduplication` t3 | — |
| AC1.4 | fetchAndSwap.test.js `script-src deduplication` t4 | — |
| AC2.shim.1 | listenerShim.test.js AC2.shim.1 block | — |
| AC2.shim.2 | listenerShim.test.js AC2.shim.2 block | — |
| AC2.shim.3 | listenerShim.test.js AC2.shim.3 block | — |
| AC2.shim.4 | listenerShim.test.js AC2.shim.4 block | — |
| AC2.event.1 | fetchAndSwap.test.js `lifecycle events` (4 tests) | — |
| AC2.scope.1 | roadTrip.test.js AC2.scope.1 block | — |
| AC2.scope.2 | roadTrip.test.js AC2.scope.2 block | — |
| AC2.scope.3 | roadTrip.test.js AC2.scope.3 + late-registration catch-up | — |
| AC2.scope.4 | roadTrip.test.js AC2.scope.4 block | — |
| AC3.1 | roadTrip.test.js AC3.1 block | — |
| AC3.2 | roadTrip.test.js AC3.2 block | — |
| AC3.3 | AC3.1/AC3.2 unit tests cover helper | Phase 2 (all steps) |
| AC3.4 | Static grep (mapUI.js:190 uses helper; 0 `window.location.origin`) | — |
| AC3.5 | Static grep (only Class B hit is roadTrip.js's own helper) | — |
| AC4.1 | offlineError.test.js AC4.1 block | — |
| AC4.2 | offlineError.test.js AC4.2 block | — |
| AC4.3 | create-flow.test.js `offline submit` tests 1+2 | Phase 3 |
| AC4.4 | offlineError.test.js AC4.4 block + create-flow regression | — |
| AC5.1 | trip-photos-offline.test.js AC5.1 | — |
| AC5.2 | trip-photos-offline.test.js AC5.2 | Phase 4.2 |
| AC5.3 | trip-photos-offline.test.js AC5.3 + postUI catch-copy tests | Phase 4.3, 4.4 |
| AC5.4 | trip-photos-offline.test.js AC5.4 | Phase 4.5 (observable as fresh data after reconnect) |
| AC6.safeArea.1 | ios-safe-area.test.js AC6.safeArea.1 (4 files × 2 tests) | — |
| AC6.safeArea.2 | ios-safe-area.test.js AC6.safeArea.2 (rule-presence) | Phase 5.1–5.5 |
| AC6.safeArea.3 | ios-safe-area.test.js AC6.safeArea.3 (rule-presence) | Phase 5.3, 5.5, 5.6 |
| AC6.safeArea.4 | ios-safe-area.test.js AC6.safeArea.4 (rule-presence) | Phase 5.7 |
| AC6.hig.1 | ios-hig.test.js AC6.hig.1 (9 selectors + 44×44 + padding) | Phase 6.1–6.7 |
| AC6.hig.2 | ios-hig.test.js AC6.hig.2 | Phase 6.8 (feel check) |
| AC6.hig.3 | ios-hig.test.js AC6.hig.3 | Phase 7.1 |
| AC6.hig.4 | ios-hig.test.js AC6.hig.4 | Phase 7.2, 7.3 |
| AC6.hig.5 | ios-hig.test.js + ios-safe-area.test.js regression blocks | Phase 8.1, 8.2 |
| AC7.1 | Mechanism via AC1.1–1.4 | Phase 1.6, E2E-2 |
| AC7.2 | Documented failure-mode branch (not a test) | smoke-checklist.md "Follow-up" section |
