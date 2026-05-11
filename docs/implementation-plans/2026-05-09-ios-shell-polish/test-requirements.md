# iOS Shell Polish — Test Requirements

**Plan:** docs/implementation-plans/2026-05-09-ios-shell-polish/
**Generated:** 2026-05-10
**Purpose:** Map every acceptance criterion from the design (`docs/design-plans/2026-05-09-ios-shell-polish.md`) to a concrete test artifact (automated or human), so the code-reviewer and test-analyst subagents can validate coverage at execution time.

## Overview

The iOS Shell Polish design has 33 acceptance criteria across 10 groups (AC1–AC10). The testing strategy splits along three lines:

1. **Automated unit tests (vitest + jsdom + fake-indexeddb).** Every `Native.*` wrapper method, every page-module call site that invokes the wrapper, every state-machine emitter, every fetch-and-swap lifecycle hook, every skeleton injection point. These are the high-value regression-catchers — they run on `npm test` locally before each push (CI does not yet run vitest, see CLAUDE.md gotcha).
2. **.NET integration tests (`dotnet test RoadTripMap.sln`).** Phase 1–6 makes no .NET changes, so the .NET suite is the AC8.2 invariant gate — it must continue to pass with no regressions.
3. **Human verification on a physical iPhone (Phase 6 smoke checklist).** Anything that requires real iOS chrome (translucent `backdrop-filter` rendering, system-blue accent against the iOS render pipeline, native iOS share sheet, native iOS confirm alert, status-bar text-color flip, real haptic motors, real `prefers-reduced-motion` accessibility setting, real safe-area insets, real `prefers-color-scheme` OS toggle) must be exercised on Patrick's iPhone after `npx cap sync ios`. The Phase 6 smoke checklist is the operational artifact.

Most ACs split: a unit test proves the *call site* invokes the wrapper with the right arguments (jsdom can do that), and a smoke-checklist line proves the *plugin actually fires* on a real device (jsdom can't). The matrix at the end of this document lists both.

A small group of ACs are **visual-only with no automatable surface**: AC1.1 (type-scale tokens render correctly), AC1.2 (legacy tokens unchanged — verified by no-regression on the existing 607-test suite), AC2.1 (dark-mode color tokens render), AC2.2 (theme switches on next paint), AC2.3 (immersive viewer is dark in both themes), AC4.1 (translucent sticky nav bar visual), AC5.1 (translucent map header + large title visual), AC6.1 (hero typography + Photos-tile feel visual), AC6.2 (frosted-fill form input visual), AC6.4 (44×44 tap-target tactile), AC7.1 (page transitions visual), AC7.2 (reduced-motion bypass — partially source-checkable), AC7.3 (skeleton shimmer visual), AC8.3 (existing-functionality regression visual + on-device), AC9.3 (browser sees no `.platform-ios` chrome bleed). For each, a Phase 6 smoke-checklist line carries the verification.

## Automated Coverage

Grouped by AC. For each AC the implementation plan produces an automated test, the section lists the test type, the expected test file path (per the phase plan's task descriptions), and the specific test-case names the executor is expected to write.

### ios-shell-polish.AC1.1 — Type-scale tokens render
- **Type:** Visual-only; no dedicated automated test.
- **Verification:** Phase 6 smoke checklist Section 1 (token foundation). Implicitly relies on Phase 1 Task 2's "no regression" gate (existing 607-test baseline still passes after the `:root` extension, proving no rename/removal).
- **Notes:** Phase 1 Task 2 does not introduce a vitest test; the universal token names are pure CSS additions with no testable JS surface.

### ios-shell-polish.AC1.2 — Existing legacy tokens unchanged
- **Type:** Regression-only (no dedicated test); covered by AC8.1 baseline-preservation.
- **Verification:** Phase 6 smoke checklist Section 1 (existing UI renders unchanged).
- **Notes:** The contract here is "do not rename or remove existing tokens"; the `npm test` baseline of 607 tests serves as the regression net because every legacy-token consumer continues to render in unit-test fixtures.

### ios-shell-polish.AC1.3 — No iOS-only token outside `.platform-ios`
- **Type:** Static source-check (manual grep in Phase 1 Task 4 verification step).
- **Test file:** None automated as a vitest case in the current plan — **flagged as a gap**. The verification step in Phase 1 Task 4 runs an ad-hoc grep but is not codified as a regression test.
- **Recommended automated test (gap-filler):** add `tests/js/ios-css-scoping.test.js` with a case "no rule outside `.platform-ios` references `--color-accent` (other than the alias declaration in `:root`)". The pattern matches `tests/js/ios-safe-area.test.js` (Phase 6 of the prior `ios-shell-hardening` plan) which already does source-check assertions on `ios.css`.
- **Verification:** Phase 6 smoke checklist Section 1 (browser sees only universal upgrades).

### ios-shell-polish.AC2.1 — Dark-mode color tokens render in both runtimes
- **Type:** Visual-only; no dedicated automated test.
- **Verification:** Phase 6 smoke checklist Section 1 (dark-mode line items).
- **Notes:** `prefers-color-scheme` is a CSS media query; jsdom does not evaluate it. The CSS rule-presence is implicit in the file diff but not asserted.

### ios-shell-polish.AC2.2 — Theme switch reflows on next paint
- **Type:** Visual-only; no automated test.
- **Verification:** Phase 6 smoke checklist Section 1 (toggle OS theme while app is open).
- **Notes:** Browser-native repaint behavior; nothing to assert.

### ios-shell-polish.AC2.3 — Immersive photo viewer is dark regardless of theme
- **Type:** Visual-only; no automated test in the current plan.
- **Verification:** Phase 6 smoke checklist Section 1 (open viewer in both themes).
- **Notes:** Could be source-checked (`grep -n "fullscreen-overlay" src/RoadTripMap/wwwroot/css/styles.css` returns the hardcoded `rgba(0,0,0,0.9)` rule, and the iOS-only `.platform-ios .fullscreen-overlay` rule is `#000000`). Not asserted automatically — minor gap, acceptable.

### ios-shell-polish.AC3.1 — `Native.haptic` dispatches to plugin on iOS
- **Type:** Unit (vitest + jsdom + dynamic-import stub).
- **Test file:** `tests/js/nativeBridge.test.js` (Phase 1 Task 5 + Task 6).
- **Test cases (in `describe('Native bridge — iOS path')`):**
  - "Native.haptic('light') calls Haptics.impact with ImpactStyle.Light"
  - "Native.haptic('medium') calls Haptics.impact with ImpactStyle.Medium"
  - "Native.haptic('heavy') calls Haptics.impact with ImpactStyle.Heavy"
  - "Native.haptic('success') calls Haptics.notification with NotificationType.Success"
  - "Native.haptic('warning') calls Haptics.notification with NotificationType.Warning"
  - "Native.haptic('error') calls Haptics.notification with NotificationType.Error"

### ios-shell-polish.AC3.2 — Web fallbacks for every `Native.*` method
- **Type:** Unit (vitest + jsdom).
- **Test file:** `tests/js/nativeBridge.test.js` (Phase 1 Task 5 + Task 6).
- **Test cases (in `describe('Web fallbacks (RoadTrip.isNativePlatform === false)')`):**
  - "Native module exports the documented surface (haptic, share, dialogConfirm, dialogAlert, statusBar, install)"
  - "Native.haptic is a no-op and resolves for every label"
  - "Native.haptic with unknown label resolves silently"
  - "Native.share with navigator.share available calls navigator.share"
  - "Native.share without navigator.share falls through to clipboard"
  - "Native.share when navigator.share rejects with AbortError resolves silently"
  - "Native.dialogConfirm falls through to window.confirm and returns { value: boolean }"
  - "Native.dialogAlert falls through to window.alert and resolves void"
  - "Native.statusBar is a no-op on web"
- **Plus (in `describe('Plugin import failure resilience')`):**
  - "Native.haptic resolves silently if dynamic import rejects"
  - "Native.share falls back to web path if dynamic import rejects"

### ios-shell-polish.AC3.3 — `Native.share` opens native iOS share sheet
- **Type:** Mixed — automated call-site coverage + human on-device.
- **Test files:**
  - Web fallback unit test in `tests/js/nativeBridge.test.js` (AC3.2 above proves the wrapper itself works).
  - Call-site coverage: `tests/js/photoCarousel.test.js` (Phase 2 Task 5) and `tests/js/mapUI.test.js` (Phase 3 Task 3).
- **Test cases:**
  - photoCarousel: "handleSave delegates to Native.share with title and url" / "handleSave with photo lacking placeName uses 'Photo' as title" / "handleSave falls back to download when Native is unavailable" / "handleSave does not throw if Native.share rejects"
  - mapUI: "sharePhoto delegates to Native.share when available" / "sharePhoto falls back to navigator.share when Native is unavailable" / "sharePhoto uses RoadTrip.appOrigin() to build the shareable URL"
- **Human verification:** Phase 6 smoke checklist Section 2 (AC3.3 line — native share sheet opens with `https://...` URL, NOT `capacitor://...`).

### ios-shell-polish.AC3.4 — `Native.dialogConfirm` shows native iOS alert
- **Type:** Mixed — automated call-site coverage + human on-device.
- **Test files:**
  - Web fallback unit test in `tests/js/nativeBridge.test.js` (AC3.2 above).
  - Call-site coverage: `tests/js/postUI-upload.test.js` (Phase 2 Task 6) — see also AC4.5/AC4.6.
- **Test cases:**
  - "onDeleteFromCarousel calls Native.dialogConfirm and deletes on confirm"
  - "onDeleteFromCarousel does not delete when user cancels"
  - "onDeleteFromCarousel does not delete when dialog returns null/undefined"
  - "onDeleteFromCarousel falls back to window.confirm when Native is unavailable"
  - "onDeleteFromCarousel shows error toast when delete API fails"
- **Human verification:** Phase 6 smoke checklist Section 2 (AC3.4 line — native confirm appears with destructive "Delete" button).

### ios-shell-polish.AC3.5 — `Native.statusBar` switches text color and restores on close
- **Type:** Mixed — automated lifecycle coverage + human on-device.
- **Test files:**
  - Web fallback unit test in `tests/js/nativeBridge.test.js` (AC3.2 above).
  - Cold-start gating: `tests/js/bootstrap-loader.test.js` (Phase 1 Task 8).
  - Viewer lifecycle (the load-bearing one): `tests/js/photoCarousel.test.js` (Phase 3 Task 7).
- **Test cases:**
  - bootstrap-loader: "calls Native.statusBar('dark') on cold start when Native is available" / "does not throw on cold start when Native is undefined" / "swallows errors from Native.statusBar to avoid breaking bootstrap"
  - photoCarousel: "Native.statusBar('light') fires on viewer open" / "Native.statusBar('dark') fires on close-button dismiss" / "Native.statusBar('dark') fires on Escape-key dismiss" / "Native.statusBar('dark') fires on edit-location button dismiss" / "Native.statusBar('dark') fires on delete-button dismiss" / "Native.statusBar('dark') fires even if removeChild throws" / "multiple closeOverlay() calls do not crash"
- **Human verification:** Phase 6 smoke checklist Section 2 + Section 4 (status-bar text flips light on viewer open, restores dark on every close path).

### ios-shell-polish.AC3.6 — `Native.install()` is idempotent
- **Type:** Unit (vitest re-eval pattern, mirrors `roadTrip.test.js:186-215`).
- **Test file:** `tests/js/nativeBridge.test.js` (Phase 1 Task 5).
- **Test case (in `describe('Native.install idempotency')`):**
  - "re-evaluating the module does not re-run install side effects"

### ios-shell-polish.AC4.1 — Translucent sticky nav bar with safe-area
- **Type:** Visual-only; no dedicated automated test.
- **Verification:** Phase 6 smoke checklist Section 3 (sticky translucent header + clear notch margin).
- **Notes:** `backdrop-filter`, `position: sticky`, and `env(safe-area-inset-top)` cannot be evaluated meaningfully in jsdom. CSS rule-presence could be source-checked but is currently not codified as a vitest case.

### ios-shell-polish.AC4.2 — Add-Photo, Cancel, Post-Photo fire `Native.haptic('light')` on tap
- **Type:** Unit (vitest + jsdom).
- **Test file:** `tests/js/postUI-upload.test.js` (Phase 2 Task 3) — investigator may rename to `tests/js/postUI.test.js` if the upload-flavored file doesn't fit.
- **Test cases:**
  - "Add-Photo button click fires Native.haptic('light')"
  - "Cancel button click fires Native.haptic('light')"
  - "Post-Photo button click fires Native.haptic('light')"
  - "Native.haptic absence does not break button handlers"

### ios-shell-polish.AC4.3 — Upload commit success/failure fires haptic
- **Type:** Unit (vitest + jsdom).
- **Test file:** `tests/js/uploadQueue.test.js` (Phase 2 Task 4).
- **Test cases:**
  - "emits Native.haptic('medium') when an upload commits successfully"
  - "emits Native.haptic('error') when an upload fails permanently"
  - "Native.haptic absence does not interfere with the state machine"

### ios-shell-polish.AC4.4 — Per-photo share uses `Native.share()`
- **Type:** Unit (vitest + jsdom). Same test file/cases as AC3.3 (call-site coverage in `photoCarousel.test.js`). The two ACs share the call-site assertions.
- **Test file:** `tests/js/photoCarousel.test.js` (Phase 2 Task 5).

### ios-shell-polish.AC4.5 — Per-photo delete shows `Native.dialogConfirm()` and only deletes on confirm
- **Type:** Unit (vitest + jsdom). Shares the test file/cases with AC3.4 (`tests/js/postUI-upload.test.js` Phase 2 Task 6).

### ios-shell-polish.AC4.6 — Cancelling delete confirm leaves photo intact
- **Type:** Unit (vitest + jsdom). Specifically the case "onDeleteFromCarousel does not delete when user cancels" (and the "...returns null/undefined" sibling) in `tests/js/postUI-upload.test.js`. Phase 2 Task 6.

### ios-shell-polish.AC5.1 — Translucent `.map-header` with large title
- **Type:** Visual-only; no dedicated automated test.
- **Verification:** Phase 6 smoke checklist Section 4 (translucent header, large title visible).
- **Notes:** Per Phase 3 Task 2 discrepancy note, the "collapses to nav-title size on scroll" clause is satisfied by the dormant `.map-header.is-collapsed` foundation; trips.html has no scroll trigger today, so the collapse never fires. A future trigger would be a Phase 6 Task 4 follow-up bug.

### ios-shell-polish.AC5.2 — Tap thumbnail opens viewer with true-black backdrop, light status bar, auto-hiding chrome
- **Type:** Mixed — chrome-toggle is unit-tested; status-bar flip is unit-tested (AC3.5 / AC5.4); true-black backdrop is visual-only.
- **Test file (chrome toggle):** `tests/js/photoCarousel.test.js` (Phase 3 Task 7).
- **Test cases (in `describe('Immersive viewer — chrome auto-hide on tap')`):**
  - "clicking the overlay backdrop toggles .chrome-hidden"
  - "clicking on the close button does NOT toggle chrome-hidden"
  - "clicking on action buttons (save/delete/edit) does NOT toggle chrome-hidden"
- **Human verification:** Phase 6 smoke checklist Section 4 (true-black backdrop + light status bar + chrome auto-hide on tap).

### ios-shell-polish.AC5.3 — Swipe-down dismisses with translate+fade
- **Type:** Mixed — Pointer-Event lifecycle unit-tested; visual translate+fade is on-device only.
- **Test file:** `tests/js/photoCarousel.test.js` (Phase 3 Task 7).
- **Test cases (in `describe('Immersive viewer — swipe-to-dismiss')`):**
  - "pointerdown + pointermove + pointerup with dy > 100 dismisses"
  - "pointerup with dy < 100 snaps back (no dismiss)"
  - "pointerdown on a chrome button does not start a drag"
  - "does not attach pointer listeners when not on iOS"
- **Human verification:** Phase 6 smoke checklist Section 4 (swipe-down translate+fade visible).

### ios-shell-polish.AC5.4 — Status bar restores to dark on every viewer-close path
- **Type:** Unit (vitest + jsdom). Same test file/cases as AC3.5 viewer lifecycle in `tests/js/photoCarousel.test.js` (Phase 3 Task 7) — five close-path cases ("close-button dismiss", "Escape-key dismiss", "edit-location button dismiss", "delete-button dismiss", "Native.statusBar('dark') fires even if removeChild throws").

### ios-shell-polish.AC5.5 — Thrown error inside viewer does not leave status bar inverted
- **Type:** Unit (vitest + jsdom). Specifically the case "Native.statusBar('dark') fires even if removeChild throws" in `tests/js/photoCarousel.test.js` (Phase 3 Task 7). The try/finally guarantee.

### ios-shell-polish.AC6.1 — index.html hero with large-title typography + Photos-tile cards
- **Type:** Visual-only; no dedicated automated test.
- **Verification:** Phase 6 smoke checklist Section 5 (hero looks dominant; trip cards lift on press).

### ios-shell-polish.AC6.2 — create.html nav-bar header + iOS-styled form inputs
- **Type:** Visual-only; no dedicated automated test.
- **Verification:** Phase 6 smoke checklist Section 5 (nav-bar matches post.html; frosted-fill inputs with system-blue focus).

### ios-shell-polish.AC6.3 — Trip-create success/failure fires haptic
- **Type:** Unit (vitest + jsdom).
- **Test file:** `tests/js/create-flow.test.js` (Phase 4 Tasks 2 + 3, extending the existing 422-line suite).
- **Test cases:**
  - "fires Native.haptic('success') after API.createTrip resolves"
  - "does not throw when Native is undefined on success"
  - "fires Native.haptic('error') when API.createTrip rejects"
  - "fires Native.haptic('error') when API.createTrip rejects with offline error"
  - "fires Native.haptic('error') when name is missing (validation error)"
  - "does not throw when Native is undefined on failure"
- **Plus (Phase 4 Task 1, idempotency precondition for the haptics meaning what they say):**
  - "re-evaluating the inline script does not double-attach the submit listener"

### ios-shell-polish.AC6.4 — `.nav a`, `.my-trip-card` meet 44×44 minimum on iOS
- **Type:** Visual / tactile only; no dedicated automated test in the current plan.
- **Verification:** Phase 6 smoke checklist Section 5 (no near-miss tap targets).
- **Notes:** Could be source-checked with a vitest case asserting the consolidated `min-height: 44px; min-width: 44px;` rule lists `.platform-ios .nav a`, `.platform-ios .my-trip-card`, `.platform-ios .button-hero` (Phase 4 Task 6). This pattern matches `tests/js/ios-hig.test.js` from the prior `ios-shell-hardening` plan — **flagged as a small gap; consider adding for parity**.

### ios-shell-polish.AC7.1 — Cross-page navigation shows animate-out, swap, animate-in
- **Type:** Mixed — animation lifecycle unit-tested; visual fade is on-device only.
- **Test file:** `tests/js/fetchAndSwap.test.js` (Phase 5 Task 6, extending the existing 1021-line suite).
- **Test cases (in `describe('Phase 5: page transitions')` and `describe('iOS-shell-only animation gating')` / `describe('Animation lifecycle')`):**
  - "adds .page-out class to body before swap when .platform-ios is present"
  - "does not add animation classes when .platform-ios is absent (browser)"
  - "removes .page-out after animationend fires"
  - "removes .page-out via safety timeout if animationend never fires"
  - "adds .page-in after the swap completes"
  - "app:page-load fires AFTER scripts execute and BEFORE page-in animation"
- **Human verification:** Phase 6 smoke checklist Section 6 (visible fade-out / fade-in transition between pages).

### ios-shell-polish.AC7.2 — `prefers-reduced-motion: reduce` bypasses transitions
- **Type:** Mixed — source-level check (no JS-side `matchMedia` gate); visual confirmation is on-device.
- **Test file:** `tests/js/fetchAndSwap.test.js` (Phase 5 Task 6).
- **Test case (in `describe('Reduced-motion handling — CSS-only, smoke-tested')`):**
  - "source contains no matchMedia(prefers-reduced-motion) calls — handled in CSS only"
- **Human verification:** Phase 6 smoke checklist Section 6 (with iOS Reduce Motion ON, navigation is instant; skeletons are static).
- **Notes:** jsdom does not honor `prefers-reduced-motion` natively; CSS-side bypass is verified visually only.

### ios-shell-polish.AC7.3 — Skeleton placeholders during initial fetch
- **Type:** Unit (vitest + jsdom).
- **Test files:**
  - `tests/js/postUI-upload.test.js` or sibling (Phase 5 Task 4) — extends Phase 2's postUI tests with skeleton coverage.
  - `tests/js/mapUI.test.js` (Phase 5 Task 5) — extends Phase 3's mapUI tests.
- **Test cases (postUI side):**
  - "injects skeleton placeholders before listPhotos resolves"
  - "removes skeletons after listPhotos resolves with content"
  - "removes skeletons after listPhotos rejects"
- **Test cases (mapUI side):**
  - "mapUI.init injects skeletons in #viewCarousel before fetch resolves"
  - "mapUI.init removes skeletons after fetch resolves"
  - "mapUI.init removes skeletons after fetch rejects"
- **Human verification:** Phase 6 smoke checklist Section 6 (shimmering grey tiles flash before real photos appear).

### ios-shell-polish.AC7.4 — Rapid back-to-back navigations don't stack or visually corrupt
- **Type:** Unit (vitest + jsdom). The substrate fix (Phase 5 Task 1's swap-generation tracker) has dedicated tests; the animation-lifecycle layer has rapid-nav tests too.
- **Test file:** `tests/js/fetchAndSwap.test.js` (Phase 5 Tasks 1 + 6).
- **Test cases (in `describe('Rapid-navigation race conditions')` from Task 1):**
  - "a stale-swap script onload does not pollute _executedScriptSrcs"
  - "current-generation onload still adds to _executedScriptSrcs (dedup still works)"
  - "three rapid swaps complete without crashing"
- **Test cases (in `describe('Rapid back-to-back navigations')` from Task 6):**
  - "three rapid swaps do not leave .page-out / .page-in stuck on body"
  - "rapid swap during animate-out does not crash"
- **Human verification:** Phase 6 smoke checklist Section 6 (rapid-tap between five pages stays responsive, nothing sticky).

### ios-shell-polish.AC8.1 — `npm test` passes
- **Type:** Test-suite gate (every phase's final task).
- **Verification:** Every phase's final verification task runs `npm test` and confirms zero failures. Baseline ~607 tests; after Phases 1–5 add coverage, ~640+ tests.
- **Notes:** CI does NOT run vitest — Patrick or the executor runs locally before pushing.

### ios-shell-polish.AC8.2 — `dotnet test RoadTripMap.sln` passes
- **Type:** Test-suite gate.
- **Verification:** Every phase's final verification task runs `dotnet test RoadTripMap.sln`. Phases 1–6 make no .NET changes, so this is a pure invariant check.

### ios-shell-polish.AC8.3 — Existing functionality preserved
- **Type:** Mixed — automated regression net (the 607-test baseline + new ~30 tests must all pass) + Phase 6 on-device confirmation.
- **Verification:** Phase 6 smoke checklist Section 7 (resilient upload recovers, offline shell works, MapLibre renders, trips list renders).

### ios-shell-polish.AC8.4 — `version-protocol` and `LogSanitizer` invariants unchanged
- **Type:** Regression-only via existing .NET test suite (the dotnet test gate).
- **Verification:** Phase 6 smoke checklist Section 7 (version headers present; sanitized logs).
- **Notes:** Phases 1–6 don't touch the version-header middleware, `ServerVersion.cs`, `LogSanitizer.cs`, or any captured-log assertion fixture. The existing `UploadEndpointHttpTests` captured-log assertions remain the regression net.

### ios-shell-polish.AC9.1 — No new HTML files in `wwwroot/`; no `ios/` template tree
- **Type:** Static source-check (manual; Phase 1 Task 7 commit only modifies the four existing pages).
- **Test file:** None automated — **flagged as a possible gap**. Could be a source-check test asserting `wwwroot/*.html` count is exactly 4 + the existing maintenance pages.
- **Verification:** Code review on the Phase 1 PR; Phase 6 smoke checklist (implicit — every page Patrick exercises is one of the four).

### ios-shell-polish.AC9.2 — No `@capacitor/*` import in web bundle
- **Type:** Static source-check (Phase 1 Task 9 verification step).
- **Test file:** None automated as a vitest case — **flagged as a gap**. The verification step in Phase 1 Task 9 runs `grep -c "globalThis.Native" src/RoadTripMap/wwwroot/bundle/app.js` (positive check) but does NOT explicitly run a negative check for `@capacitor/` strings in the bundle.
- **Recommended automated test (gap-filler):** add a vitest case "wwwroot/bundle/app.js contains no @capacitor/* import" — the dynamic-import-only contract is the single most important architectural invariant for AC9 and should be regression-protected.
- **Verification:** Phase 1 Task 9 build-bundle verification step + Phase 6 smoke checklist Section 7 (no plugin errors in Xcode console).

### ios-shell-polish.AC9.3 — Browser sees universal upgrades only; no `.platform-ios` chrome bleed
- **Type:** Static source-check (every iOS-only rule scoped under `.platform-ios`); plus on-device cross-check.
- **Test file:** None automated as a dedicated vitest case — **flagged as a gap**. The pattern from `tests/js/ios-hig.test.js` (Phase 7 of the prior `ios-shell-hardening` plan) which scans `ios.css` for unscoped selectors would extend cleanly to cover the new Phase 1–5 chrome rules.
- **Verification:** Phase 6 smoke checklist Section 7 (browser smoke — universal-only upgrades).

### ios-shell-polish.AC10.1 — Patrick on-device sign-off
- **Type:** Human verification (the entire Phase 6 smoke checklist).
- **Verification:** `docs/implementation-plans/2026-05-09-ios-shell-polish/smoke-checklist.md` (Phase 6 Task 1) + `phase-6-device-smoke.md` capture (Phase 6 Task 3) + verification-log append to the design plan (Phase 6 Task 5).

### ios-shell-polish.AC10.2 — Patrick reaches for iOS app on the upcoming trip
- **Type:** Human verification (post-deployment subjective).
- **Verification:** Captured in the design-plan `## Verification log` section after the upcoming trip; not part of the immediate Phase 6 sign-off but the ultimate definition of done.

## Human Verification

The following ACs cannot be fully automated and rely on Phase 6 smoke-checklist sign-off on Patrick's iPhone. Each lists why automation isn't sufficient, the smoke-checklist section, and the required environment.

| AC | Why it can't be fully automated | Smoke section | Environment |
|---|---|---|---|
| AC1.1 type-scale tokens render | jsdom doesn't render CSS visually; type-scale legibility is a visual judgement | Section 1 | Real iPhone (light + dark) |
| AC1.2 legacy tokens unchanged | Visual regression check; backed by AC8.1 baseline | Section 1 | Real iPhone |
| AC2.1 dark-mode color tokens render | jsdom doesn't honor `prefers-color-scheme` | Section 1 | Real iPhone (OS in dark mode) |
| AC2.2 theme switches on next paint | Browser-native repaint; nothing to assert in jsdom | Section 1 | Real iPhone |
| AC2.3 immersive viewer dark in both themes | Visual (could be source-checked but isn't) | Section 1 | Real iPhone (toggle theme with viewer open) |
| AC3.3 native iOS share sheet opens | jsdom can't surface UIActivityViewController | Section 2 | Real iPhone |
| AC3.4 native iOS confirm alert appears | jsdom can't surface UIAlertController | Section 2 | Real iPhone |
| AC3.5 status-bar text-color flips | iOS status bar is a real OS chrome surface | Section 2 + 4 | Real iPhone |
| AC4.1 translucent sticky nav bar | `backdrop-filter` + `position: sticky` not evaluated by jsdom | Section 3 | Real iPhone |
| AC5.1 translucent map header + large title | Visual + `backdrop-filter` | Section 4 | Real iPhone |
| AC5.2 true-black backdrop + auto-hiding chrome (visual) | True-black is visual; chrome toggle is unit-tested | Section 4 | Real iPhone |
| AC5.3 swipe-down translate+fade visible | Animation visible only on-device; Pointer Events unit-tested | Section 4 | Real iPhone |
| AC6.1 hero typography + Photos-tile feel | Visual judgement | Section 5 | Real iPhone |
| AC6.2 frosted-fill form inputs + system-blue focus | Visual + `backdrop-filter` | Section 5 | Real iPhone |
| AC6.4 44×44 tap-target tactile | Tactile "no near-misses" judgement | Section 5 | Real iPhone (human finger) |
| AC7.1 page-transition fade visible | jsdom doesn't run CSS animations | Section 6 | Real iPhone |
| AC7.2 reduced-motion bypass behavior | jsdom doesn't honor `prefers-reduced-motion`; source-check is partial | Section 6 | Real iPhone (Reduce Motion ON in Settings) |
| AC7.3 skeleton shimmer visual | jsdom doesn't render shimmer; injection unit-tested | Section 6 | Real iPhone |
| AC7.4 rapid-nav doesn't visually corrupt | jsdom unit-tests the substrate; visual sticky-state is on-device | Section 6 | Real iPhone (rapid-tap stress) |
| AC8.3 existing functionality on real device | Resilient upload, MapLibre, offline shell behave on iOS | Section 7 | Real iPhone (online + airplane) |
| AC8.4 LogSanitizer invariant | Captured-log assertions are .NET-side; on-device confirms operationally | Section 7 | Real iPhone + server log access |
| AC9.1 no new HTML files | Code-review check; trivially observable | Implicit (Section 7) | Code review |
| AC9.2 no @capacitor in web bundle | Phase 1 Task 9 grep; could be automated (gap) | Section 7 | Build-bundle verification + on-device |
| AC9.3 no .platform-ios bleed in browser | Phase 6 cross-checks browser; could be automated (gap) | Section 7 | Real browser + iPhone |
| AC10.1 Patrick on-device sign-off | The whole point | Sign-off block | Real iPhone |
| AC10.2 Patrick reaches for app on trip | Post-deployment subjective | Verification log | Real iPhone, real trip |

## AC → Test Coverage Matrix

| AC | Automated test | Human verification | Phase implementing |
|---|---|---|---|
| ios-shell-polish.AC1.1 | (none — visual; baseline-preservation gate via AC8.1) | Phase 6 smoke Section 1 | Phase 1 (Task 2) |
| ios-shell-polish.AC1.2 | (none — regression-only via 607-test baseline) | Phase 6 smoke Section 1 | Phase 1 (Task 2) |
| ios-shell-polish.AC1.3 | (gap — manual grep in Phase 1 Task 4; recommend `tests/js/ios-css-scoping.test.js`) | Phase 6 smoke Section 1 | Phase 1 (Task 4) |
| ios-shell-polish.AC2.1 | (none — `prefers-color-scheme` not evaluated by jsdom) | Phase 6 smoke Section 1 | Phase 1 (Task 3) |
| ios-shell-polish.AC2.2 | (none — browser-native repaint) | Phase 6 smoke Section 1 | Phase 1 (Task 3) |
| ios-shell-polish.AC2.3 | (none — could be source-checked; minor gap) | Phase 6 smoke Section 1 | Phase 1 (Task 3) + Phase 3 (Task 2) |
| ios-shell-polish.AC3.1 | `tests/js/nativeBridge.test.js` (6 cases — light/medium/heavy + success/warning/error) | Phase 6 smoke Section 2 | Phase 1 (Tasks 5+6) |
| ios-shell-polish.AC3.2 | `tests/js/nativeBridge.test.js` (~9 web-fallback cases + 2 import-failure cases) | Phase 6 smoke Section 2 | Phase 1 (Tasks 5+6) |
| ios-shell-polish.AC3.3 | `tests/js/photoCarousel.test.js` + `tests/js/mapUI.test.js` (call-site coverage) | Phase 6 smoke Section 2 | Phase 2 (Task 5) + Phase 3 (Task 3) |
| ios-shell-polish.AC3.4 | `tests/js/postUI-upload.test.js` (delete-flow coverage) | Phase 6 smoke Section 2 | Phase 2 (Task 6) |
| ios-shell-polish.AC3.5 | `tests/js/bootstrap-loader.test.js` (cold-start) + `tests/js/photoCarousel.test.js` (viewer lifecycle) | Phase 6 smoke Section 2 + Section 4 | Phase 1 (Task 8) + Phase 3 (Task 7) |
| ios-shell-polish.AC3.6 | `tests/js/nativeBridge.test.js` (re-eval idempotency case) | Phase 6 smoke Section 2 | Phase 1 (Task 5) |
| ios-shell-polish.AC4.1 | (none — visual `backdrop-filter` + `position: sticky` + safe-area) | Phase 6 smoke Section 3 | Phase 2 (Task 2) |
| ios-shell-polish.AC4.2 | `tests/js/postUI-upload.test.js` (3 buttons + Native-absent guard) | Phase 6 smoke Section 3 | Phase 2 (Task 3) |
| ios-shell-polish.AC4.3 | `tests/js/uploadQueue.test.js` (commit success + permanent failure + Native-absent) | Phase 6 smoke Section 3 | Phase 2 (Task 4) |
| ios-shell-polish.AC4.4 | `tests/js/photoCarousel.test.js` (handleSave delegation) | Phase 6 smoke Section 3 | Phase 2 (Task 5) |
| ios-shell-polish.AC4.5 | `tests/js/postUI-upload.test.js` (dialogConfirm + delete on confirm) | Phase 6 smoke Section 3 | Phase 2 (Task 6) |
| ios-shell-polish.AC4.6 | `tests/js/postUI-upload.test.js` (cancel keeps photo intact, null/undefined) | Phase 6 smoke Section 3 | Phase 2 (Task 6) |
| ios-shell-polish.AC5.1 | (none — visual + dormant-collapse foundation, see Phase 3 discrepancy) | Phase 6 smoke Section 4 | Phase 3 (Tasks 1+2) |
| ios-shell-polish.AC5.2 | `tests/js/photoCarousel.test.js` (chrome-toggle 3 cases) | Phase 6 smoke Section 4 | Phase 3 (Tasks 4+7) |
| ios-shell-polish.AC5.3 | `tests/js/photoCarousel.test.js` (swipe-dismiss 4 cases) | Phase 6 smoke Section 4 | Phase 3 (Tasks 5+7) |
| ios-shell-polish.AC5.4 | `tests/js/photoCarousel.test.js` (5 close-path status-bar cases) | Phase 6 smoke Section 4 | Phase 3 (Tasks 4+7) |
| ios-shell-polish.AC5.5 | `tests/js/photoCarousel.test.js` ("statusBar('dark') fires even if removeChild throws") | Phase 6 smoke Section 4 | Phase 3 (Tasks 4+7) |
| ios-shell-polish.AC6.1 | (none — visual hero typography + Photos-tile feel) | Phase 6 smoke Section 5 | Phase 4 (Tasks 4+5) |
| ios-shell-polish.AC6.2 | (none — visual frosted-fill + system-blue focus) | Phase 6 smoke Section 5 | Phase 4 (Tasks 4+5) |
| ios-shell-polish.AC6.3 | `tests/js/create-flow.test.js` (success + 3 failure-shape + Native-absent + IIFE-guard idempotency) | Phase 6 smoke Section 5 | Phase 4 (Tasks 1+2+3) |
| ios-shell-polish.AC6.4 | (gap — could source-check the consolidated 44×44 selector list per `ios-hig.test.js` precedent) | Phase 6 smoke Section 5 | Phase 4 (Task 6) |
| ios-shell-polish.AC7.1 | `tests/js/fetchAndSwap.test.js` (animation-lifecycle + iOS-only gating cases) | Phase 6 smoke Section 6 | Phase 5 (Tasks 2+3+6) |
| ios-shell-polish.AC7.2 | `tests/js/fetchAndSwap.test.js` (source-level "no JS-side matchMedia" check) | Phase 6 smoke Section 6 | Phase 5 (Tasks 2+6) |
| ios-shell-polish.AC7.3 | `tests/js/postUI-upload.test.js` + `tests/js/mapUI.test.js` (skeleton inject/remove on resolve/reject) | Phase 6 smoke Section 6 | Phase 5 (Tasks 4+5) |
| ios-shell-polish.AC7.4 | `tests/js/fetchAndSwap.test.js` (race-condition + rapid-nav, 5 cases across Tasks 1+6) | Phase 6 smoke Section 6 | Phase 5 (Tasks 1+6) |
| ios-shell-polish.AC8.1 | Every phase's final task runs `npm test` (~640+ tests after Phases 1–5) | Phase 6 smoke Section 7 + Phase 6 Task 6 | All phases |
| ios-shell-polish.AC8.2 | Every phase's final task runs `dotnet test RoadTripMap.sln` | Phase 6 smoke Section 7 + Phase 6 Task 6 | All phases |
| ios-shell-polish.AC8.3 | (existing test baseline + on-device check) | Phase 6 smoke Section 7 | Phase 6 |
| ios-shell-polish.AC8.4 | (existing `UploadEndpointHttpTests` captured-log assertions; no new tests required) | Phase 6 smoke Section 7 | Phase 6 |
| ios-shell-polish.AC9.1 | (gap — could assert wwwroot/*.html count; trivial code-review otherwise) | Implicit (Section 7) | Phase 1 (Task 7) |
| ios-shell-polish.AC9.2 | (gap — Phase 1 Task 9 grep; recommend explicit "no @capacitor in bundle" vitest case) | Phase 6 smoke Section 7 + Phase 1 Task 9 | Phase 1 (Tasks 6+9) |
| ios-shell-polish.AC9.3 | (gap — could source-check `ios.css` per `ios-hig.test.js` precedent) | Phase 6 smoke Section 7 | All phases |
| ios-shell-polish.AC10.1 | (none — human sign-off) | Phase 6 smoke + capture doc + verification log | Phase 6 |
| ios-shell-polish.AC10.2 | (none — post-trip subjective) | Verification log future entry | Phase 6 (post-trip) |

## Identified gaps in the test plan

The following ACs *could* be automated but the implementation plan does not currently include a vitest case. None are blockers; all should be considered for inclusion in a follow-up "test hardening" pass:

1. **AC1.3** — no source-check vitest case asserts that `--color-accent` (or other iOS-only tokens) only appears outside `.platform-ios` as the alias declaration in `:root`. Recommend `tests/js/ios-css-scoping.test.js`.
2. **AC2.3** — no source-check that `.platform-ios .fullscreen-overlay { background: #000000 }` exists (and that the universal `.fullscreen-overlay` keeps its rgba dark backdrop).
3. **AC6.4** — no source-check that `.platform-ios .nav a`, `.platform-ios .my-trip-card`, `.platform-ios .button-hero` are present in the consolidated 44×44 rule list. Pattern matches `tests/js/ios-hig.test.js` from the prior `ios-shell-hardening` plan.
4. **AC9.1** — no source-check that the `wwwroot/*.html` file set is unchanged (modulo the existing 4 pages + maintenance pages). Trivially code-reviewable but easy to automate.
5. **AC9.2** — Phase 1 Task 9 runs a *positive* grep (`grep -c "globalThis.Native"` on the bundle); the *negative* grep (`grep -c "@capacitor/" src/RoadTripMap/wwwroot/bundle/app.js` should be 0) is implied by the dynamic-import architecture but not explicitly asserted. **This is the highest-value gap to fill** — AC9.2 is the architectural invariant of the entire native-plugin design.
6. **AC9.3** — no source-check that every iOS-only rule in `ios.css` is `.platform-ios`-scoped. Pattern matches `tests/js/ios-hig.test.js` test 5 / `tests/js/ios-safe-area.test.js` test 5 from the prior plan.

All six gaps share the same shape: a small static source-check vitest file that reads the relevant CSS / JS / HTML file as text and asserts a regex invariant. Each is a 5-to-15-line addition. Filing them as Phase 6 Task 4 follow-ups is acceptable; treating them as test-debt and addressing in a sibling "test-hardening" branch after this branch ships is also acceptable.

## Cross-cutting Automation Commands

Full suite gate (required before any Phase 1–5 task's done-checklist):

```
npm test
dotnet test RoadTripMap.sln
```

Per-phase vitest spot-runs (each phase's final verification task):

- Phase 1: `npx vitest run tests/js/nativeBridge.test.js`; `npx vitest run tests/js/bootstrap-loader.test.js`
- Phase 2: `npx vitest run tests/js/postUI-upload.test.js`; `npx vitest run tests/js/uploadQueue.test.js`; `npx vitest run tests/js/photoCarousel.test.js`
- Phase 3: `npx vitest run tests/js/photoCarousel.test.js`; `npx vitest run tests/js/mapUI.test.js`
- Phase 4: `npx vitest run tests/js/create-flow.test.js`
- Phase 5: `npx vitest run tests/js/fetchAndSwap.test.js`; `npx vitest run tests/js/postUI-upload.test.js`; `npx vitest run tests/js/mapUI.test.js`
- Phase 6: `npm test` (sanity gate before merge) + `dotnet test RoadTripMap.sln`

Build-bundle verification (Phases 1, 2, 3, 4, 5):

- `npm run build:bundle` — `node --check` must pass; `asset-manifest.json` regenerates with `nativeBridge.js` (Phase 1) and any subsequent JS edits.
- Phase 1 Task 9 grep: `grep -c "globalThis.Native" src/RoadTripMap/wwwroot/bundle/app.js` ≥ 1.

On-device gate (Phase 6, manual):

- `docs/implementation-plans/2026-05-09-ios-shell-polish/smoke-checklist.md` every checkbox checked + sign-off block completed; all checks run on Patrick's iPhone in light + dark, online + airplane, both flows (post-a-photo + view-someone-else's-trip).
