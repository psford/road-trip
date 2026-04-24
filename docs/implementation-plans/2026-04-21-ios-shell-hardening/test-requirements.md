# iOS Shell Hardening — Test Requirements

**Plan:** docs/implementation-plans/2026-04-21-ios-shell-hardening/
**Generated:** 2026-04-22
**Purpose:** Map every acceptance criterion from the design to a concrete test artifact (automated or human), so the code-reviewer and test-analyst subagents can validate coverage at execution time.

## Summary

- Total ACs: 33
- Automated: 24
- Human verification: 5
- Mixed (partial automated + human sign-off): 3
- Documented failure-mode branch (not a test): 1 (`ios-shell-hardening.AC7.2`)

Counts by AC group:

| Group | ACs | Automated | Human-only | Mixed | Failure branch |
|---|---|---|---|---|---|
| AC1 (duplicate-const) | 4 | 4 | 0 | 0 | 0 |
| AC2 (listener cascade) | 9 | 9 | 0 | 0 | 0 |
| AC3 (shareable URLs) | 5 | 4 | 1 | 0 | 0 |
| AC4 (offline create) | 4 | 4 | 0 | 0 | 0 |
| AC5 (offline photos) | 4 | 4 | 0 | 0 | 0 |
| AC6.safeArea | 4 | 1 (AC6.safeArea.1 fully automated) + 3 rule-presence halves | 0 | 3 (AC6.safeArea.2, .3, .4) | 0 |
| AC6.hig | 5 | 4 (AC6.hig.2, .3, .4, .5) + 1 rule-presence half | 0 | 1 (AC6.hig.1) | 0 |
| AC7 (issue #7) | 2 | 0 | 1 (AC7.1) | 0 | 1 (AC7.2) |

## AC -> Test Mapping

### AC1: No duplicate-`const` cascade (Phase 3)

| AC | Text | Type | Test File / Checklist Location | Notes |
|---|---|---|---|---|
| `ios-shell-hardening.AC1.1` | After `post → create → post` navigation, `FetchAndSwap._executedScriptSrcs` contains each shared script's absolutized `src` exactly once; no `SyntaxError: Can't create duplicate variable` in console. | Automated — unit | `tests/js/fetchAndSwap.test.js` `describe('script-src deduplication', ...)` test 1 | Phase 3 Task 2 test 1. Also covered on-device by smoke-checklist.md Section 1. |
| `ios-shell-hardening.AC1.2` | Inline scripts re-execute on every swap (not tracked by the `src` Set). | Automated — unit | `tests/js/fetchAndSwap.test.js` `describe('script-src deduplication', ...)` test 2 | Phase 3 Task 2 test 2. |
| `ios-shell-hardening.AC1.3` | Script `src` URLs with different query-strings (`?v=1` vs `?v=2`) are treated as distinct — allows cache-bust to force re-run. | Automated — unit | `tests/js/fetchAndSwap.test.js` `describe('script-src deduplication', ...)` test 3 | Phase 3 Task 2 test 3. |
| `ios-shell-hardening.AC1.4` | If the same `<script src>` appears twice within one page, the second instance is skipped after the first executes (idempotent per page). | Automated — unit | `tests/js/fetchAndSwap.test.js` `describe('script-src deduplication', ...)` test 4 | Phase 3 Task 2 test 4. |

### AC2: No stale-handler listener cascade (Phases 1 + 2)

| AC | Text | Type | Test File / Checklist Location | Notes |
|---|---|---|---|---|
| `ios-shell-hardening.AC2.shim.1` | `ListenerShim.install()` wraps `document.addEventListener` / `removeEventListener`; tracks `DOMContentLoaded` and `load` only. | Automated — unit | `tests/js/listenerShim.test.js` test 1 | Phase 1 Task 2 test 1. |
| `ios-shell-hardening.AC2.shim.2` | `ListenerShim.clearPageLifecycleListeners()` removes every tracked handler via the real `removeEventListener` and clears the internal tracking map. | Automated — unit | `tests/js/listenerShim.test.js` test 2 | Phase 1 Task 2 test 2. |
| `ios-shell-hardening.AC2.shim.3` | Non-lifecycle events (`click`, `submit`, `change`, etc.) pass through untracked and are never cleared by the shim. | Automated — unit | `tests/js/listenerShim.test.js` test 3 | Phase 1 Task 2 test 3. |
| `ios-shell-hardening.AC2.shim.4` | Listeners added to targets other than `document` (e.g. `window.addEventListener`) are not tracked. | Automated — unit | `tests/js/listenerShim.test.js` test 4 | Phase 1 Task 2 test 4. |
| `ios-shell-hardening.AC2.event.1` | `fetchAndSwap` dispatches `app:page-load` (not synthetic `DOMContentLoaded`) after every swap, after the shim clear. | Automated — unit | `tests/js/fetchAndSwap.test.js` rewritten `describe('lifecycle events')` block — positive dispatch test, negative (no DOMContentLoaded/window.load), ordering test, ListenerShim-absent fallback | Phase 1 Task 5 tests 1–4. |
| `ios-shell-hardening.AC2.scope.1` | `RoadTrip.onPageLoad('post', fn)` runs `fn` on `app:page-load` iff `document.body.dataset.page === 'post'`. | Automated — unit | `tests/js/roadTrip.test.js` test 1 | Phase 2 Task 2 test 1. |
| `ios-shell-hardening.AC2.scope.2` | `RoadTrip.onPageLoad('*', fn)` runs on every `app:page-load` regardless of `data-page` (cross-cutting concerns). | Automated — unit | `tests/js/roadTrip.test.js` test 2 | Phase 2 Task 2 test 2. |
| `ios-shell-hardening.AC2.scope.3` | In a regular browser, `RoadTrip.onPageLoad('home', fn)` fires on initial load via a synthesized `app:page-load` dispatched from `DOMContentLoaded`. | Automated — unit | `tests/js/roadTrip.test.js` test 3 (+ supporting test 7 late-registration catch-up) | Phase 2 Task 2 tests 3 and 7. |
| `ios-shell-hardening.AC2.scope.4` | `postUI.js`'s migrated handler does NOT fire on the `/create` page (`data-page="create" !== "post"`). | Automated — unit | `tests/js/roadTrip.test.js` test 4 | Phase 2 Task 2 test 4. |

### AC3: Shareable URLs are valid `https://…` (Phase 2)

| AC | Text | Type | Test File / Checklist Location | Notes |
|---|---|---|---|---|
| `ios-shell-hardening.AC3.1` | In iOS shell (`Capacitor.isNativePlatform() === true`), `RoadTrip.appOrigin()` returns `"https://app-roadtripmap-prod.azurewebsites.net"`. | Automated — unit | `tests/js/roadTrip.test.js` test 5 | Phase 2 Task 2 test 5. |
| `ios-shell-hardening.AC3.2` | In a regular browser (`window.Capacitor` undefined), `RoadTrip.appOrigin()` returns `window.location.origin`. | Automated — unit | `tests/js/roadTrip.test.js` test 6 | Phase 2 Task 2 test 6. |
| `ios-shell-hardening.AC3.3` | On iPhone, the "Share This Trip" view link reads `https://…/trips/{guid}` — never `capacitor://localhost/…`. | Human verification | `smoke-checklist.md` Section 2 — Share-trip link (AC3.3) | WKWebView-only behavior + native clipboard paste into a second device's Safari. Phase 2 Task 8 wires the helper through `postUI.js:232`; unit tests for AC3.1/AC3.2 prove the helper returns the right origin, but the end-to-end "copy on iPhone, paste in Safari on another device, trip loads" flow requires on-device verification per Phase 8 smoke checklist. |
| `ios-shell-hardening.AC3.4` | `mapUI.js`'s assembled URL uses the same helper. | Automated — unit (static) | Phase 2 Task 9 verification grep: `grep -n "RoadTrip.appOrigin" src/RoadTripMap/wwwroot/js/mapUI.js` -> 1 result, `grep -n "window.location.origin" src/RoadTripMap/wwwroot/js/mapUI.js` -> 0 results. | Verified by Phase 2 Task 9's explicit grep checks. No dedicated test added because `mapUI.sharePhoto` goes through the native share sheet — the assertion is that the call site uses `RoadTrip.appOrigin()`. |
| `ios-shell-hardening.AC3.5` | Audit pass finds no other `window.location.origin` use for shareable-URL assembly in `wwwroot/js/`. | Automated — unit (static) | Phase 2 Task 10 verification: `grep -rn 'window.location.origin' src/RoadTripMap/wwwroot/js/` returns only Class B (non-user-facing) hits or zero. | Audit task (no commit unless a new Class A site is found). |

### AC4: Friendly offline message on create (Phases 2 + 4)

| AC | Text | Type | Test File / Checklist Location | Notes |
|---|---|---|---|---|
| `ios-shell-hardening.AC4.1` | `OfflineError.isOfflineError(err)` returns true for `err instanceof TypeError`. | Automated — unit | `tests/js/offlineError.test.js` test 1 | Phase 2 Task 5 test 1. |
| `ios-shell-hardening.AC4.2` | `OfflineError.isOfflineError(err)` returns true when `navigator.onLine === false` regardless of `err` shape. | Automated — unit | `tests/js/offlineError.test.js` test 2 | Phase 2 Task 5 test 2. |
| `ios-shell-hardening.AC4.3` | Offline submit on `/create` shows `"Can't create a trip while offline. Try again when you're back online."` (final copy TBD in implementation). | Automated — integration | `tests/js/create-flow.test.js` new `describe('offline submit', ...)` block — tests 1 (TypeError path) and 2 (navigator.onLine=false path) | Phase 4 Task 3 tests 1 and 2. Also validated on-device in smoke-checklist.md Section 3. |
| `ios-shell-hardening.AC4.4` | Non-offline errors (e.g. 400 validation) do NOT classify as offline; they show their normal message. | Automated — unit (+ integration regression) | `tests/js/offlineError.test.js` test 3 (+ `tests/js/create-flow.test.js` offline-submit test 3 as integration regression) | Phase 2 Task 5 test 3 and Phase 4 Task 3 test 3. |

### AC5: Offline trip-page photos (Phase 5)

| AC | Text | Type | Test File / Checklist Location | Notes |
|---|---|---|---|---|
| `ios-shell-hardening.AC5.1` | `API.getTripPhotos(token)` is served through `CachedFetch.cachedFetch(url, { asJson: true })`. | Automated — unit | `tests/js/trip-photos-offline.test.js` test 1 | Phase 5 Task 2 test 1. |
| `ios-shell-hardening.AC5.2` | Second visit to a previously-online trip page while offline renders the cached JSON photo list (no "Failed to load photos" banner). | Automated — integration | `tests/js/trip-photos-offline.test.js` test 2 (+ postUI `describe('postUI photo-fetch catch copy', ...)` tests in the same file) | Phase 5 Task 2 test 2 + Phase 5 Task 5. Also validated on-device in smoke-checklist.md Section 4. |
| `ios-shell-hardening.AC5.3` | First visit to a trip page while offline (cache miss) shows `"Photos unavailable offline. Reconnect to see the latest."`. | Automated — integration | `tests/js/trip-photos-offline.test.js` test 3 (cache-miss rejects with TypeError) + `tests/js/trip-photos-offline.test.js` `describe('postUI photo-fetch catch copy', ...)` tests 1 and 2 (toast copy) | Phase 5 Task 2 test 3 and Phase 5 Task 5 tests 1–2. |
| `ios-shell-hardening.AC5.4` | Online visit after offline cache-hit triggers background revalidate; `RoadTripPageCache.api` updates to the latest server response (existing `CachedFetch` contract). | Automated — integration | `tests/js/trip-photos-offline.test.js` test 4 | Phase 5 Task 2 test 4. |

### AC6.safeArea: iOS safe-areas (Phase 6 + Phase 8)

| AC | Text | Type | Test File / Checklist Location | Notes |
|---|---|---|---|---|
| `ios-shell-hardening.AC6.safeArea.1` | Every `wwwroot/*.html` viewport meta contains `viewport-fit=cover`. | Automated — unit (static) | `tests/js/ios-safe-area.test.js` test 1 | Phase 6 Task 3 test 1. Purely file-content; fully automated. |
| `ios-shell-hardening.AC6.safeArea.2` | On a notched iPhone, `.map-header`, `.page-header`, `.hero`, `.resume-banner` all clear the status bar visually. | Mixed — automated rule-presence + human visual | Rule-presence: `tests/js/ios-safe-area.test.js` test 2 (Phase 6 Task 3). Visual: `smoke-checklist.md` Section 5 (bullets for `.map-header`, `.page-header`, `.hero`, `.resume-banner`). | `env(safe-area-inset-*)` evaluates to 0 in jsdom; real visual clearance only verifiable on a notched iPhone. |
| `ios-shell-hardening.AC6.safeArea.3` | On iPhone with home indicator, `.toast-container`, `.view-carousel-container`, `.map-control` all clear the home indicator. | Mixed — automated rule-presence + human visual | Rule-presence: `tests/js/ios-safe-area.test.js` test 3 (Phase 6 Task 3). Visual: `smoke-checklist.md` Section 5 (bullets for `.toast-container`, `.view-carousel-container`, `.map-control`). | Home-indicator clearance only observable on-device with a home indicator. |
| `ios-shell-hardening.AC6.safeArea.4` | `.homescreen-modal-overlay` padding accounts for both top and bottom safe-areas. | Mixed — automated rule-presence + human visual | Rule-presence: `tests/js/ios-safe-area.test.js` test 4 (Phase 6 Task 3). Visual: `smoke-checklist.md` Section 5 (bullet for `.homescreen-modal-overlay`). | Both top and bottom insets verified in one rule block automated, visual clearance on-device only. |

### AC6.hig: iOS HIG compliance (Phase 7 + Phase 8)

| AC | Text | Type | Test File / Checklist Location | Notes |
|---|---|---|---|---|
| `ios-shell-hardening.AC6.hig.1` | `.copy-button`, `.carousel-action-btn`, `.photo-popup-delete`, `.upload-panel__toggle`, `.upload-panel__retry` / `pin-drop` / `discard`, `.map-back`, `.poi-action-btn` all have computed tap-target ≥44×44pt on iPhone. | Mixed — automated rule-presence + human tactile | Rule-presence: `tests/js/ios-hig.test.js` test 1 (Phase 7 Task 4). Tactile: `smoke-checklist.md` Section 6 (bullets for every listed selector). | Computed tap-target size only measurable on a real device with a human finger — "no near-misses" is a tactile judgement. Automated layer asserts the CSS rule lists every required selector and applies `min-height: 44px; min-width: 44px;` plus a padding-widening rule for the three upload-panel buttons. |
| `ios-shell-hardening.AC6.hig.2` | `.upload-panel__body` has `-webkit-overflow-scrolling: touch`. | Automated — unit (static) + human feel | Static: `tests/js/ios-hig.test.js` test 2 (Phase 7 Task 4). Feel: `smoke-checklist.md` Section 6 (bullet for `.upload-panel__body` momentum). | Static assertion sufficient for correctness; smoke checklist captures the "feels native" check as extra assurance but the rule itself is fully automatable. |
| `ios-shell-hardening.AC6.hig.3` | `#captionInput` has `autocorrect="on" autocapitalize="sentences"`. | Automated — unit (static) | `tests/js/ios-hig.test.js` test 3 | Phase 7 Task 4 test 3. Also verified on-device in smoke-checklist.md Section 7 bullet 1. |
| `ios-shell-hardening.AC6.hig.4` | Trip-name input has `autocapitalize="words"`; description textarea has `autocapitalize="sentences"`. | Automated — unit (static) | `tests/js/ios-hig.test.js` test 4 | Phase 7 Task 4 test 4. Also verified on-device in smoke-checklist.md Section 7 bullets 2–3. |
| `ios-shell-hardening.AC6.hig.5` | Regular-browser users on non-iOS devices see no visible change — all rules scoped under `.platform-ios`. | Automated — unit (static) + human regression | Static: `tests/js/ios-hig.test.js` test 5 (every new selector is `.platform-ios`-scoped) + `tests/js/ios-safe-area.test.js` test 5 (same invariant for Phase 6 rules). Human regression: `smoke-checklist.md` Section 8 bullet 1. | Automated regex scan guarantees no unscoped selector leaked into the new rule blocks; the smoke-checklist regression step is belt-and-suspenders on a non-notched iPad/desktop. |

### AC7: Issue #7 verification (Phase 3 + Phase 8)

| AC | Text | Type | Test File / Checklist Location | Notes |
|---|---|---|---|---|
| `ios-shell-hardening.AC7.1` | After Phase 3 lands, on-device repro of "fetchAndSwap fails offline on an uncached URL" produces a clean console (no cascade). | Human verification | `smoke-checklist.md` Section 1 last bullet ("(AC7.1) With device in airplane mode, try to navigate to a trip URL that has NEVER been visited before. `fetchAndSwap` fails cleanly — console shows the failure but NO cascade of follow-up errors.") | Operationally on-device-only. The mechanism (script-src dedup) is unit-tested via AC1.1–AC1.4, but the specific post-failure cascade seen in issue #7 only reproduces under a real iOS WKWebView + real offline network stack + real cached-page state. |
| `ios-shell-hardening.AC7.2` | If AC7.1 fails on-device, a follow-up investigation issue is opened (instrumentation + trace); plan completion is not blocked. | Not a test — failure-mode branch | `smoke-checklist.md` "Follow-up (if any AC failed)" section — opens a GitHub issue titled `iOS shell: post-failure cascade persists after script-src dedup (AC7.2)`. | Documented for completeness. AC7.2 describes what to do if AC7.1 regresses; it is not itself a testable behavior. |

## Human-only Verification Items

The following ACs have at least one component that can only be verified on a physical iPhone. Cross-reference each to `smoke-checklist.md` when executing Phase 8.

- `ios-shell-hardening.AC3.3` -- smoke-checklist.md Section 2 (share-trip link pastes as `https://…` in Safari on a second device).
- `ios-shell-hardening.AC6.safeArea.2` -- smoke-checklist.md Section 5 (visual: `.map-header`, `.page-header`, `.hero`, `.resume-banner` all clear notch).
- `ios-shell-hardening.AC6.safeArea.3` -- smoke-checklist.md Section 5 (visual: `.toast-container`, `.view-carousel-container`, `.map-control` all clear home indicator).
- `ios-shell-hardening.AC6.safeArea.4` -- smoke-checklist.md Section 5 (visual: `.homescreen-modal-overlay` clears both).
- `ios-shell-hardening.AC6.hig.1` -- smoke-checklist.md Section 6 (tactile: every listed button feels at-least-44×44pt).
- `ios-shell-hardening.AC7.1` -- smoke-checklist.md Section 1 last bullet (offline uncached-URL fetchAndSwap produces clean console).

Additionally, these fully-automated ACs have an on-device belt-and-suspenders check in the smoke checklist but do NOT require the manual step to pass: AC1.1 (Section 1), AC4.3 (Section 3), AC5.2 and AC5.3 (Section 4), AC6.hig.2 / .3 / .4 (Sections 6 and 7), AC6.hig.5 (Section 8).

## Cross-cutting Automation Commands

Full suite gate (required before any Phase 1–7 task's done-checklist):

```
npm test
```

Per-phase vitest spot-runs (every phase specifies these):

- Phase 1: `npx vitest run tests/js/listenerShim.test.js`; `npx vitest run tests/js/fetchAndSwap.test.js`
- Phase 2: `npx vitest run tests/js/roadTrip.test.js`; `npx vitest run tests/js/offlineError.test.js`
- Phase 3: `npx vitest run tests/js/fetchAndSwap.test.js`
- Phase 4: `npx vitest run tests/js/create-flow.test.js`
- Phase 5: `npx vitest run tests/js/trip-photos-offline.test.js`
- Phase 6: `npx vitest run tests/js/ios-safe-area.test.js`
- Phase 7: `npx vitest run tests/js/ios-hig.test.js`
- Phase 8: `npm test` (documentation-only phase; sanity gate)

Static-verification greps (Phases 2, 3, 6, 7 — each phase's task `Verification` block specifies the exact greps, reproduced here as an aggregate pre-merge checklist):

- `grep -rn 'DOMContentLoaded' src/RoadTripMap/wwwroot/js/` -> 0 matches (Phase 2 done-checklist)
- `grep -rn 'window.location.origin' src/RoadTripMap/wwwroot/js/` -> 0 matches or Class B only (Phase 2 Task 10 + done-checklist)
- `grep -l 'viewport-fit=cover' src/RoadTripMap/wwwroot/*.html` -> 4 matches (Phase 6 Task 1)
- `grep -n 'offlineError.js' src/RoadTripMap/wwwroot/create.html` -> 1 match (Phase 4 Task 1)
- `grep -n 'offlineError.js' src/RoadTripMap/wwwroot/post.html` -> 1 match (Phase 5 Task 3)
- `grep -n 'autocorrect="on"' src/RoadTripMap/wwwroot/post.html` -> 1 match; `grep -n 'autocapitalize="sentences"' src/RoadTripMap/wwwroot/post.html` -> 1 match (Phase 7 Task 3)
- `grep -n 'autocapitalize="words"' src/RoadTripMap/wwwroot/create.html` -> 1 match; `grep -n 'autocapitalize="sentences"' src/RoadTripMap/wwwroot/create.html` -> 1 match (Phase 7 Task 3)
- `grep -n '-webkit-overflow-scrolling' src/RoadTripMap/wwwroot/ios.css` -> 1 match (Phase 7 Task 3)
- `node --check` on every modified `src/bootstrap/*.js` and `src/RoadTripMap/wwwroot/js/*.js` (per-task `Verification` sections)

On-device gate (Phase 8, manual):

- `smoke-checklist.md` every checkbox checked + Section 8 signoff completed; all checks run on a notched iPhone with a home indicator.
