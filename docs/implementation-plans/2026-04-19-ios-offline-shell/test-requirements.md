# iOS Offline Shell — Test Requirements

**Design plan:** [docs/design-plans/2026-04-19-ios-offline-shell.md](../../design-plans/2026-04-19-ios-offline-shell.md)
**Implementation plan:** [docs/implementation-plans/2026-04-19-ios-offline-shell/](.)
**Date:** 2026-04-19

This document maps each acceptance criterion from the iOS Offline Shell design to the test or verification step that proves it. The test-analyst agent uses this during execution to validate coverage; the on-device matrix in Phase 7 references it for sign-off.

---

## Coverage matrix

| AC | Type | Test file / verification step | Notes |
|---|---|---|---|
| ios-offline-shell.AC1.1 | automated + human | `tests/js/fetchAndSwap.test.js` + `tests/js/bootstrap-loader.test.js` + Phase 7 AC1.1 | 3s budget only verifiable on real WKWebView |
| ios-offline-shell.AC1.2 | automated + human | `tests/js/intercept.test.js` + Phase 7 AC1.2 | jsdom covers handler; device confirms no WebView reload |
| ios-offline-shell.AC1.3 | automated + human | `tests/js/fetchAndSwap.test.js` + Phase 3 Task 1 spike + Phase 7 AC1.3 | jsdom covers *creation*; real execution needs WKWebView |
| ios-offline-shell.AC1.4 | automated + human | `tests/js/fetchAndSwap.test.js` + Phase 7 AC1.4 | base href injection is jsdom-testable |
| ios-offline-shell.AC1.5 | automated + human | `tests/js/intercept.test.js` + Phase 7 AC1.5 | Classifier + native tap-through |
| ios-offline-shell.AC1.6 | automated | `tests/js/intercept.test.js` | Matrix notes "covered by automated tests" — modifier keys not on touch |
| ios-offline-shell.AC2.1 | automated + human | `tests/js/bootstrap-loader.test.js` + Phase 7 AC2.1 | |
| ios-offline-shell.AC2.2 | automated + human | `tests/js/bootstrap-loader.test.js` + Phase 7 AC2.2 | |
| ios-offline-shell.AC2.3 | automated | `tests/js/fetchAndSwap.test.js` + `tests/js/tripStorage.test.js` | Pure JS — fully covered |
| ios-offline-shell.AC2.4 | automated + human | `tests/js/tripStorage.test.js` (role derivation) + Phase 7 AC2.4 | Visual glasses indicator needs device |
| ios-offline-shell.AC2.5 | automated | `tests/js/tripStorage.test.js` | Pure JS — fully covered |
| ios-offline-shell.AC2.6 | automated | `tests/js/tripStorage.test.js` | Pure JS — fully covered |
| ios-offline-shell.AC3.1 | automated + human | `tests/js/cachedFetch.test.js` + Phase 7 AC3.1 | |
| ios-offline-shell.AC3.2 | automated + human | `tests/js/cachedFetch.test.js` + Phase 7 AC3.2 | |
| ios-offline-shell.AC3.3 | automated + human | `tests/js/cachedFetch.test.js` + Phase 7 AC3.3 | |
| ios-offline-shell.AC3.4 | automated | `tests/js/cachedFetch.test.js` (AC3.4 isolation test, Phase 3 Task 5) | Cross-module invariant, jsdom-testable |
| ios-offline-shell.AC3.5 | automated + human | `tests/js/cachedFetch.test.js` + Phase 7 AC3.5 | |
| ios-offline-shell.AC3.6 | automated + human | `tests/js/bootstrap-loader.test.js` + Phase 7 AC3.6 | |
| ios-offline-shell.AC3.7 | automated | `tests/js/cachedFetch.test.js` (bypass) + CI `git diff` on `mapCache.js` | Bypass classifier + mechanical diff |
| ios-offline-shell.AC4.1 | human | Phase 5 Task 6 local smoke + Phase 7 AC4.1 | Upload lifecycle can't be unit-tested through the shell |
| ios-offline-shell.AC4.2 | human | Phase 5 Task 6 local smoke + Phase 7 AC4.2 | Requires real map + optimisticPins integration |
| ios-offline-shell.AC4.3 | human | Phase 5 Task 6 local smoke + Phase 7 AC4.3 | Requires real network transitions |
| ios-offline-shell.AC4.4 | automated (mechanical) | `git diff develop -- src/RoadTripMap/wwwroot/js/uploadTransport.js` empty | Shell-command verification, not unit test |
| ios-offline-shell.AC4.5 | automated (mechanical) | `git diff develop -- src/RoadTripMap/wwwroot/js/mapCache.js` empty | Shell-command verification, not unit test |
| ios-offline-shell.AC5.1 | human | Review of rewritten `docs/test-plans/2026-04-13-resilient-uploads.md` | Doc quality, not automated |
| ios-offline-shell.AC5.2 | automated (mechanical) | `grep -q SUPERSEDED docs/implementation-plans/2026-04-13-resilient-uploads/phase_05.md` | Header-note presence check |
| ios-offline-shell.AC5.3 | human | Phase 7 on-device matrix sign-off | Only satisfiable by real device |

---

## Per-AC details

### ios-offline-shell.AC1.1: First page loads within 3s of launch when cached

- **Automated coverage:** `tests/js/fetchAndSwap.test.js` verifies the engine resolves the cache-first path without awaiting network; `tests/js/bootstrap-loader.test.js` verifies the loader reaches `FetchAndSwap.fetchAndSwap` without a network round-trip when cache is warm.
- **Human verification:** Phase 7 AC1.1 — stopwatch / screen-record frame analysis on Patrick's iPhone after cold-launch.
- **Justification for human verification:** The 3-second budget cannot be measured deterministically in jsdom; it depends on real WKWebView render time, boot paint timing, and IDB I/O on device flash. Automation covers the "no unnecessary awaits" invariant that makes the budget achievable.

### ios-offline-shell.AC1.2: Clicking an internal `<a href>` triggers fetch+swap; new page renders without full WebView reload

- **Automated coverage:** `tests/js/intercept.test.js` — click-handler tests assert `event.preventDefault()` fires, `history.pushState` is called with the resolved URL, and `FetchAndSwap.fetchAndSwap` is invoked with the same URL.
- **Human verification:** Phase 7 AC1.2 — visual confirmation in Web Inspector that the WebView URL bar does NOT change and no top-level navigation entry is emitted.
- **Justification for human verification:** jsdom has no WebView URL bar; "no full reload" can only be observed in a real WKWebView.

### ios-offline-shell.AC1.3: Scripts in the fetched page execute (e.g., `addPhotoButton`, `MapUI.init`)

- **Automated coverage:** `tests/js/fetchAndSwap.test.js` script-recreation tests verify every `<script>` in the fetched HTML is re-created via `document.createElement('script')` with attributes copied and inserted in source order. Also asserts external scripts are awaited via `onload`/`onerror`.
- **Human verification:** Phase 3 Task 1 on-device spike (`docs/implementation-plans/2026-04-19-ios-offline-shell/phase-3-spike-result.md`) + Phase 7 AC1.3 — Web Inspector confirms `MapUI.init` ran (map renders), photo picker opens on `+` tap.
- **Justification for human verification:** Automation covers *creation* mechanics; it cannot cover *execution* because jsdom neither fetches remote `<script src="https://...">` bodies nor reliably executes inline scripts inserted via `appendChild`. WKWebView also enforces CSP on dynamically-inserted external scripts more strictly than desktop browsers — the spike + device matrix are the load-bearing verification.

### ios-offline-shell.AC1.4: Relative URLs in fetched HTML resolve to App Service origin via injected `<base href>`

- **Automated coverage:** `tests/js/fetchAndSwap.test.js` asserts `document.head.querySelector('base[href]').getAttribute('href')` equals `https://app-roadtripmap-prod.azurewebsites.net/` after swap, and that `document.body.querySelector('a').href` resolves to a fully-qualified App Service URL (jsdom honors `<base href>` on anchor `.href`).
- **Human verification:** Phase 7 AC1.4 — Web Inspector console confirms the same invariants on real WebKit.

### ios-offline-shell.AC1.5: Click on external-origin link is NOT intercepted

- **Automated coverage:** `tests/js/intercept.test.js` — classifier tests cover `https://github.com/psford`, `mailto:`, `tel:`, `target="_blank"`, and `data-no-shell="true"`. End-to-end tests assert `FetchAndSwap.fetchAndSwap` is NOT called and `evt.defaultPrevented === false` for external anchors.
- **Human verification:** Phase 7 AC1.5 — tap GitHub footer link on iPhone, confirm iOS opens Safari (or prompts).
- **Justification for human verification:** "Native iOS link handling triggered" only observable on device.

### ios-offline-shell.AC1.6: Click with modifier keys held, or middle-click, is NOT intercepted

- **Automated coverage:** `tests/js/intercept.test.js` — asserts `metaKey`, `ctrlKey`, `shiftKey`, `altKey` each short-circuit the intercept, and `button !== 0` (middle-click) does the same.
- **Human verification:** None required on touch-only iPhones (iOS doesn't expose modifier keys or middle-click through touch).
- **Justification:** This AC is jsdom-testable (synthetic `MouseEvent` with modifier flags) but NOT testable on touch iPhones. The Phase 6 rewritten test plan marks this matrix row as "covered by automated tests in `tests/js/intercept.test.js`" — no device step required.

### ios-offline-shell.AC2.1: First launch with 0 saved trips → bootstrap fetches `/`

- **Automated coverage:** `tests/js/bootstrap-loader.test.js` — with `TripStorage.getTrips()` returning `[]`, asserts `globalThis.fetch` was called with `/` after `runLoader`.
- **Human verification:** Phase 7 AC2.1 — delete app, reinstall from TestFlight, cold-launch, confirm home page empty hero state renders.

### ios-offline-shell.AC2.2: Launches with 1+ saved trips → bootstrap fetches most-recently-opened directly

- **Automated coverage:** `tests/js/bootstrap-loader.test.js` — saves trips A and B, marks B opened last, asserts `fetch` was called with B's `postUrl`. Additional variant covers three trips with ordering changes.
- **Human verification:** Phase 7 AC2.2 — cold-launch on device after opening trip B last, confirm B loads directly (not home).

### ios-offline-shell.AC2.3: `fetchAndSwap` of saved trip URL calls `TripStorage.markOpened(url)`

- **Automated coverage:** `tests/js/fetchAndSwap.test.js` — after `FetchAndSwap.fetchAndSwap('/post/abc')`, asserts `TripStorage.getTrips()[0].lastOpenedAt` is a number. `tests/js/tripStorage.test.js` covers the `markOpened(url)` method in isolation (match-by-postUrl, match-by-viewUrl, no-match, preserves existing fields).
- **Human verification:** None needed — pure JS, fully covered.

### ios-offline-shell.AC2.4: Home page "My Trips" shows view-only trips with glasses indicator

- **Automated coverage:** `tests/js/tripStorage.test.js` — `getRoleForUrl` classifies `/trips/xyz` as `viewer`, `/post/abc` as `owner`; `getDefaultTrip()` enriches result with derived `role`.
- **Human verification:** Phase 7 AC2.4 — hand-craft a view-only entry via Web Inspector, navigate to home page, confirm 👓 prefix.
- **Justification for human verification:** The glasses indicator is a CSS rule in `ios.css` scoped to `.platform-ios .my-trip-card[data-role="viewer"]::before`. Automation covers `data-role` attribute assignment; visual rendering of the emoji prefix requires device review.

### ios-offline-shell.AC2.5: Legacy entries without `lastOpenedAt` use `savedAt` as fallback

- **Automated coverage:** `tests/js/tripStorage.test.js` — `getDefaultTrip` fallback test seeds records without `lastOpenedAt`, asserts the one with greatest `savedAt` wins. Mixed test verifies `lastOpenedAt` beats `savedAt` fallback. Unparseable `savedAt` treated as 0.
- **Human verification:** None needed — pure JS, fully covered.

### ios-offline-shell.AC2.6: Existing `getTrips()` / rendering does not break

- **Automated coverage:** `tests/js/tripStorage.test.js` — baseline tests lock the existing shape (`{name, postUrl, viewUrl, savedAt}`), and each new method's tests re-assert the pre-existing fields survive the additive writes.
- **Human verification:** None needed.

### ios-offline-shell.AC3.1: First online visit caches page with cachedAt, etag, lastModified

- **Automated coverage:** `tests/js/cachedFetch.test.js` — write-through test with ETag + Last-Modified headers asserts all three fields landed; a second test verifies headers-absent path yields `etag: null, lastModified: null, cachedAt: <number>`.
- **Human verification:** Phase 7 AC3.1 — Web Inspector → Storage → `RoadTripPageCache.pages` confirms record shape on real WebKit.

### ios-offline-shell.AC3.2: Subsequent visit renders from cache immediately

- **Automated coverage:** `tests/js/cachedFetch.test.js` — pre-seeds IDB, asserts `result.source === 'cache'` and the response body matches the cached HTML, without requiring any fetch to have resolved.
- **Human verification:** Phase 7 AC3.2 — Network tab shows no page fetch on cached-launch.

### ios-offline-shell.AC3.3: Online cache hit fires conditional revalidate; updates IDB on 200, no-op on 304

- **Automated coverage:** `tests/js/cachedFetch.test.js` — 200 updates IDB and sends `If-None-Match`; 304 leaves IDB unchanged; 5xx leaves IDB unchanged; no conditional headers when cached has none; `asJson` path updates `api` store only.
- **Human verification:** Phase 7 AC3.3 — live test against modified server content confirms the round-trip on device.

### ios-offline-shell.AC3.4: Background revalidate does NOT swap live DOM

- **Automated coverage:** `tests/js/cachedFetch.test.js` (Phase 3 Task 5 isolation test) — pre-seeds cache with old HTML, mocks network to return new HTML, triggers `cachedFetch`, flushes microtasks, asserts IDB record updates BUT `document.head.innerHTML` and `document.body.innerHTML` are byte-identical to before.
- **Human verification:** Optionally re-checked in Phase 7 AC3.4, but the invariant is structural (cachedFetch never reaches into the live document) and unit-testable end-to-end.

### ios-offline-shell.AC3.5: Offline launch with cached default trip → renders from cache; revalidate fails silently

- **Automated coverage:** `tests/js/cachedFetch.test.js` — network-error-swallowed test: pre-seed cache, mock `fetch` to reject, spy on `console.error`; cachedFetch resolves with cache source, IDB unchanged, `console.error` never called.
- **Human verification:** Phase 7 AC3.5 — airplane-mode cold-launch on device.

### ios-offline-shell.AC3.6: Offline + cache miss → fallback.html with retry/back

- **Automated coverage:** `tests/js/bootstrap-loader.test.js` — first fetch (boot) rejects; second fetch (`fetch('fallback.html')`) resolves with fallback HTML; asserts `#bootstrap-retry` present in DOM and clicking it calls stubbed `location.reload`. Double-failure path asserts the inline "Unable to load" fallback.
- **Human verification:** Phase 7 AC3.6 — on-device airplane-mode navigation to uncached page confirms visual fallback rendering.

### ios-offline-shell.AC3.7: `^/api/(poi|park-boundaries)` NOT touched by `cachedFetch`; mapCache handles them

- **Automated coverage:** `tests/js/cachedFetch.test.js` — `isBypassed` classifier cases, plus end-to-end bypass-passthrough tests asserting `/api/poi*` and `/api/park-boundaries*` never write to either IDB store. Mechanical verification: Phase 5 Task 6 Step 1 runs `git diff develop -- src/RoadTripMap/wwwroot/js/mapCache.js` which must be empty.
- **Human verification:** Phase 7 AC3.7 — Web Inspector confirms bypass URLs absent from `RoadTripPageCache.api` on device, and still present in `mapCache`-owned IDB.

### ios-offline-shell.AC4.1: After fetch+swap, uploadQueue re-init resumes pending uploads

- **Automated coverage:** None through the new shell. The upload flow is tested in its own existing suites (`uploadQueue.test.js` etc.), which are not modified by this plan.
- **Human verification:** Phase 5 Task 6 local smoke on iOS Simulator + Phase 7 AC4.1 on iPhone.
- **Justification for human verification:** The upload-resume lifecycle threads through `uploadQueue.js`, IDB, real network transitions, and trip-page UI wiring that is re-constructed on every document-swap. These interactions cannot be meaningfully unit-tested through the new shell; only a full-stack run on Simulator or device exercises them.

### ios-offline-shell.AC4.2: Posting offline shows optimistic pin on map immediately

- **Automated coverage:** None through the new shell.
- **Human verification:** Phase 5 Task 6 local smoke + Phase 7 AC4.2.
- **Justification for human verification:** Requires real MapLibre map, `optimisticPins.js` integration, and map render cycle — all absent from jsdom.

### ios-offline-shell.AC4.3: Queued upload completes when connectivity returns; pin promotes

- **Automated coverage:** None through the new shell.
- **Human verification:** Phase 5 Task 6 local smoke + Phase 7 AC4.3.
- **Justification for human verification:** Requires real connectivity transitions and visible pin style change on map.

### ios-offline-shell.AC4.4: `uploadTransport.js` unchanged

- **Automated coverage:** `git diff develop -- src/RoadTripMap/wwwroot/js/uploadTransport.js` must return empty. Runs in Phase 5 Task 6 (Step 1) and again as pre-flight 0.7 in the Phase 6 test plan.
- **Human verification:** None needed.
- **Justification:** This is a mechanical CI-able shell command, not a unit test. Classified as automated because it's a deterministic, scriptable check — not because it runs in vitest.

### ios-offline-shell.AC4.5: `mapCache.js` unchanged

- **Automated coverage:** `git diff develop -- src/RoadTripMap/wwwroot/js/mapCache.js` must return empty. Same verification path as AC4.4.
- **Human verification:** None needed.

### ios-offline-shell.AC5.1: Test plan rewritten to reframe AC9/AC10 under new architecture

- **Automated coverage:** None (pure doc change).
- **Human verification:** Review of `docs/test-plans/2026-04-13-resilient-uploads.md` — Patrick reviews Phase 6 Task 2 output; the mapping table at the top is the heart of AC5.1.
- **Justification for human verification:** Document quality and completeness is a subjective review; automation can't judge whether the rewrite accurately reframes every old AC under the new architecture.

### ios-offline-shell.AC5.2: Old phase_05.md has supersede header note

- **Automated coverage:** `grep -q "SUPERSEDED" docs/implementation-plans/2026-04-13-resilient-uploads/phase_05.md` — mechanical presence check, plus `git diff` confirms only top-of-file additions (no body edits).
- **Human verification:** Optional review of note content for clarity.
- **Justification:** Classified as automated (mechanical) because the note's presence and scope are deterministically checkable. Content quality is a light human pass in Phase 6 Task 1 verification.

### ios-offline-shell.AC5.3: All AC1.*–AC4.* PASS in on-device matrix on Patrick's iPhone

- **Automated coverage:** None — this AC explicitly delegates to the device matrix.
- **Human verification:** Phase 7 on-device smoke (`phase-7-device-smoke.md`) + sign-off in both that file and `docs/test-plans/2026-04-13-resilient-uploads.md`.
- **Justification for human verification:** The AC's text mandates on-device execution on Patrick's iPhone; this is the load-bearing end-to-end verification for the entire design (jsdom cannot validate real WebKit behavior, and the Simulator is not Patrick's iPhone). Sign-off here is the gate for merging the feature branch to `develop`.
