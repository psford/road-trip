# iOS Shell Hardening Design

## Summary

This plan addresses seven correctness and usability bugs discovered during integration testing of the iOS Offline Shell — a Capacitor-based shell that fetches live HTML from App Service, caches it in IndexedDB, and swaps documents in-place rather than shipping a bundled app. The bugs fall into two categories: shell-level lifecycle problems (scripts re-executing on navigation causing `const` redeclaration crashes; stale event handlers accumulating across page swaps; a `capacitor://localhost` origin leaking into URLs meant to be shared externally) and user-facing offline gaps (raw error strings surfacing instead of friendly messages; cached photo lists not being served when offline; iOS safe-area and tap-target violations).

The approach is architectural rather than symptomatic. Rather than patching individual call sites, the plan introduces two small shell-side primitives — a tracked-listener shim and a deduplicated script-injection registry — and one page-side namespace (`RoadTrip`) that unifies the lifecycle event, the origin helper, and page-scoped handler registration behind a single, shell-aware API. Page scripts are migrated off `DOMContentLoaded` onto a custom `app:page-load` event (modeled after Turbo Drive's `turbo:load`) that fires correctly in both the iOS shell and regular browsers. These changes are delivered in eight sequential phases on the existing `ios-offline-shell` branch, each independently testable, with the single-source invariant — one `wwwroot/` codebase serving both platforms unchanged — preserved throughout.

## Definition of Done

Architectural and user-visible fixes to the iOS Offline Shell (branch `ios-offline-shell`) so the shell is sound before any more real-world testing. Single-source architecture is preserved: one `wwwroot/*` serves the regular-browser site and the iOS shell unchanged. Philosophy is aggressive — fix the class of problem, not the symptom.

**Deliverables** (all via code + tests):

1. **No duplicate-`const` cascade** on cross-page navigation in the iOS shell. Shell tracks executed script sources and skips re-injection of already-executed scripts. (#1; expected to also resolve #7.)
2. **No stale-handler listener cascade** after navigation. Page scripts migrated off raw `DOMContentLoaded` onto a shell-aware lifecycle event that still fires naturally in regular browsers. (#2)
3. **Share-trip "view" link is a valid `https://…` URL** on the iOS shell (usable by recipients without Capacitor), not `capacitor://localhost`. (#3)
4. **Offline create-trip shows a friendly offline message** — not raw `"Load failed"`. (#4)
5. **Offline trip page shows cached photos** (or an explicit "Photos unavailable offline" banner) rather than `"Failed to load photos"`. (#5)
6. **iOS safe-areas respected.** Header pins to safe-area top with content scrolling underneath; other visible iOS-specific CSS issues addressed across the app. Scheduled as the last phase(s) of the plan. (#6)
7. **Issue #7** (post-failure const cascade when `_swapFromHtml` never ran) confirmed resolved by the #1 fix, or cleanly split into its own follow-up if not.

**Verification:**
- `npm test` passes (existing suite + new tests for each issue).
- Patrick's on-device smoke on iPhone: console clean through 5+ cross-page navigations; offline create + offline trip-page flows show friendly messages; safe-areas visually correct; share-link pastes into Safari on another device and opens the trip.
- `CLAUDE.md` invariants updated: the custom lifecycle event replaces `DOMContentLoaded` for wwwroot page scripts; the shell tracks executed script sources; the app-origin helper is the only way to assemble shareable URLs.

**Out of scope (explicitly deferred):**
- Formal Phase 7 device-smoke matrix capture to `phase-7-device-smoke.md`.
- Real-world cellular-dropout / Wi-Fi-switch / long-session walk-around testing.
- New features beyond fixing the listed issues.
- Merge to `develop` (gated on this plan shipping + the deferred items above).

## Acceptance Criteria

### `ios-shell-hardening.AC1`: No duplicate-`const` cascade
- **ios-shell-hardening.AC1.1 Success:** After `post → create → post` navigation, `FetchAndSwap._executedScriptSrcs` contains each shared script's absolutized `src` exactly once; no `SyntaxError: Can't create duplicate variable` in console.
- **ios-shell-hardening.AC1.2 Success:** Inline scripts re-execute on every swap (not tracked by the `src` Set).
- **ios-shell-hardening.AC1.3 Edge:** Script `src` URLs with different query-strings (`?v=1` vs `?v=2`) are treated as distinct — allows cache-bust to force re-run.
- **ios-shell-hardening.AC1.4 Success:** If the same `<script src>` appears twice within one page, the second instance is skipped after the first executes (idempotent per page).

### `ios-shell-hardening.AC2`: No stale-handler listener cascade
- **ios-shell-hardening.AC2.shim.1 Success:** `ListenerShim.install()` wraps `document.addEventListener` / `removeEventListener`; tracks `DOMContentLoaded` and `load` only.
- **ios-shell-hardening.AC2.shim.2 Success:** `ListenerShim.clearPageLifecycleListeners()` removes every tracked handler via the real `removeEventListener` and clears the internal tracking map.
- **ios-shell-hardening.AC2.shim.3 Failure:** Non-lifecycle events (`click`, `submit`, `change`, etc.) pass through untracked and are never cleared by the shim.
- **ios-shell-hardening.AC2.shim.4 Edge:** Listeners added to targets other than `document` (e.g. `window.addEventListener`) are not tracked.
- **ios-shell-hardening.AC2.event.1 Success:** `fetchAndSwap` dispatches `app:page-load` (not synthetic `DOMContentLoaded`) after every swap, after the shim clear.
- **ios-shell-hardening.AC2.scope.1 Success:** `RoadTrip.onPageLoad('post', fn)` runs `fn` on `app:page-load` iff `document.body.dataset.page === 'post'`.
- **ios-shell-hardening.AC2.scope.2 Success:** `RoadTrip.onPageLoad('*', fn)` runs on every `app:page-load` regardless of `data-page` (cross-cutting concerns).
- **ios-shell-hardening.AC2.scope.3 Success:** In a regular browser, `RoadTrip.onPageLoad('home', fn)` fires on initial load via a synthesized `app:page-load` dispatched from `DOMContentLoaded`.
- **ios-shell-hardening.AC2.scope.4 Failure:** `postUI.js`'s migrated handler does NOT fire on the `/create` page (`data-page="create" !== "post"`).

### `ios-shell-hardening.AC3`: Shareable URLs are valid `https://…`
- **ios-shell-hardening.AC3.1 Success:** In iOS shell (`Capacitor.isNativePlatform() === true`), `RoadTrip.appOrigin()` returns `"https://app-roadtripmap-prod.azurewebsites.net"`.
- **ios-shell-hardening.AC3.2 Success:** In a regular browser (`window.Capacitor` undefined), `RoadTrip.appOrigin()` returns `window.location.origin`.
- **ios-shell-hardening.AC3.3 Success:** On iPhone, the "Share This Trip" view link reads `https://…/trips/{guid}` — never `capacitor://localhost/…`.
- **ios-shell-hardening.AC3.4 Success:** `mapUI.js`'s assembled URL uses the same helper.
- **ios-shell-hardening.AC3.5 Edge:** Audit pass finds no other `window.location.origin` use for shareable-URL assembly in `wwwroot/js/`.

### `ios-shell-hardening.AC4`: Friendly offline message on create
- **ios-shell-hardening.AC4.1 Success:** `OfflineError.isOfflineError(err)` returns true for `err instanceof TypeError`.
- **ios-shell-hardening.AC4.2 Success:** `OfflineError.isOfflineError(err)` returns true when `navigator.onLine === false` regardless of `err` shape.
- **ios-shell-hardening.AC4.3 Success:** Offline submit on `/create` shows `"Can't create a trip while offline. Try again when you're back online."` (final copy TBD in implementation).
- **ios-shell-hardening.AC4.4 Failure:** Non-offline errors (e.g. 400 validation) do NOT classify as offline; they show their normal message.

### `ios-shell-hardening.AC5`: Offline trip-page photos
- **ios-shell-hardening.AC5.1 Success:** `API.getTripPhotos(token)` is served through `CachedFetch.cachedFetch(url, { asJson: true })`.
- **ios-shell-hardening.AC5.2 Success:** Second visit to a previously-online trip page while offline renders the cached JSON photo list (no "Failed to load photos" banner).
- **ios-shell-hardening.AC5.3 Success:** First visit to a trip page while offline (cache miss) shows `"Photos unavailable offline. Reconnect to see the latest."`.
- **ios-shell-hardening.AC5.4 Edge:** Online visit after offline cache-hit triggers background revalidate; `RoadTripPageCache.api` updates to the latest server response (existing `CachedFetch` contract).

### `ios-shell-hardening.AC6`: iOS safe-areas + HIG compliance
- **ios-shell-hardening.AC6.safeArea.1 Success:** Every `wwwroot/*.html` viewport meta contains `viewport-fit=cover`.
- **ios-shell-hardening.AC6.safeArea.2 Success:** On a notched iPhone, `.map-header`, `.page-header`, `.hero`, `.resume-banner` all clear the status bar visually.
- **ios-shell-hardening.AC6.safeArea.3 Success:** On iPhone with home indicator, `.toast-container`, `.view-carousel-container`, `.map-control` all clear the home indicator.
- **ios-shell-hardening.AC6.safeArea.4 Success:** `.homescreen-modal-overlay` padding accounts for both top and bottom safe-areas.
- **ios-shell-hardening.AC6.hig.1 Success:** `.copy-button`, `.carousel-action-btn`, `.photo-popup-delete`, `.upload-panel__toggle`, `.upload-panel__retry` / `pin-drop` / `discard`, `.map-back`, `.poi-action-btn` all have computed tap-target ≥44×44pt on iPhone.
- **ios-shell-hardening.AC6.hig.2 Success:** `.upload-panel__body` has `-webkit-overflow-scrolling: touch`.
- **ios-shell-hardening.AC6.hig.3 Success:** `#captionInput` has `autocorrect="on" autocapitalize="sentences"`.
- **ios-shell-hardening.AC6.hig.4 Success:** Trip-name input has `autocapitalize="words"`; description textarea has `autocapitalize="sentences"`.
- **ios-shell-hardening.AC6.hig.5 Edge:** Regular-browser users on non-iOS devices see no visible change — all rules scoped under `.platform-ios`.

### `ios-shell-hardening.AC7`: Issue #7 verification
- **ios-shell-hardening.AC7.1 Success:** After Phase 3 lands, on-device repro of "fetchAndSwap fails offline on an uncached URL" produces a clean console (no cascade).
- **ios-shell-hardening.AC7.2 Failure-fallback:** If AC7.1 fails on-device, a follow-up investigation issue is opened (instrumentation + trace); plan completion is not blocked.

## Glossary

- **iOS Offline Shell**: The Capacitor-based iOS wrapper for this app. Rather than bundling JavaScript, it fetches live HTML pages from the App Service origin, caches them in IndexedDB, and swaps the page document in-place. Lives in `src/bootstrap/`.
- **document-swap shell**: The architecture the iOS Offline Shell uses: parse fetched HTML with `DOMParser`, swap `<head>` and `<body>` innerHTML, then recreate `<script>` elements so they execute — as opposed to loading a pre-built JS bundle.
- **Capacitor**: A cross-platform runtime (by Ionic) that wraps a web app in a native iOS/Android shell, providing a `WKWebView` and a JavaScript bridge to native APIs. The app uses Capacitor 8 with Swift Package Manager.
- **`capacitor://localhost`**: The origin Capacitor's WebView reports for local resources on iOS. Not a valid URL to share with recipients who do not have the app installed.
- **`app:page-load`**: The custom DOM event introduced by this plan to replace synthetic `DOMContentLoaded` dispatches after a document swap. Analogous to Hotwire Turbo Drive's `turbo:load`.
- **`DOMContentLoaded`**: A native browser event that fires when the initial HTML document has been parsed. In the shell, it was being synthesized after every swap — a misrepresentation that caused handlers registered on previous pages to accumulate and fire again.
- **`_swapFromHtml`**: The internal function in `fetchAndSwap.js` that performs the actual document swap: strip scripts, replace `head`/`body` innerHTML, recreate script elements, dispatch lifecycle events.
- **`_recreateScripts`**: The inner step of `_swapFromHtml` that re-creates `<script>` elements via `createElement` so they execute in the new document context. This plan adds src-URL deduplication to prevent re-running already-executed external scripts.
- **`_executedScriptSrcs`**: The module-scoped `Set<string>` added to `fetchAndSwap.js` to track which external script `src` URLs have already been injected in the current JavaScript realm.
- **duplicate-`const` cascade**: The crash pattern where a `const` declaration in a shared external script throws `SyntaxError: Can't create duplicate variable` on the second navigation, because the script re-executes in the same realm where it already ran.
- **listener cascade / stale-handler listener cascade**: The accumulation of `DOMContentLoaded` handlers across navigations: each swap adds new listeners but the old ones are never removed, so after N navigations the handler fires N times.
- **`ListenerShim`**: The new `src/bootstrap/listenerShim.js` module that wraps `document.addEventListener` and `removeEventListener` to track `DOMContentLoaded` and `load` handlers, enabling bulk removal before each swap.
- **`RoadTrip` namespace**: The new `wwwroot/js/roadTrip.js` window-level object exposing `appOrigin()`, `onPageLoad()`, and `isNativePlatform()` — the unified page-side API for shell-aware lifecycle and URL assembly.
- **`RoadTrip.appOrigin()`**: Helper that returns the correct HTTPS origin for assembling shareable URLs: the baked-in App Service hostname when running in the iOS shell, `window.location.origin` in a regular browser.
- **`RoadTrip.onPageLoad(pageName, fn)`**: Registers a callback to run on `app:page-load`, scoped to pages whose `<body data-page>` attribute matches `pageName`. Accepts `'*'` as a wildcard for cross-cutting concerns.
- **`data-page` attribute**: A `<body data-page="...">` attribute added to every `wwwroot/*.html` page (values: `home`, `create`, `post`, `view`, `map`) so `RoadTrip.onPageLoad` can scope handler dispatch without pathname-sniffing.
- **`OfflineError`**: The new `wwwroot/js/offlineError.js` module providing `isOfflineError(err)` and `friendlyMessage(err, context)` to classify network failures and produce human-readable copy for the `create` and `photos` contexts.
- **`CachedFetch` / `cachedFetch`**: The shell's cache-first fetch wrapper (`src/bootstrap/cachedFetch.js`). Returns a cached IndexedDB hit immediately and fires a background revalidate (using `If-None-Match`/`If-Modified-Since`). This plan routes `API.getTripPhotos` through it to enable offline photo-list serving.
- **`RoadTripPageCache`**: The IndexedDB database used by the shell. Has two object stores: `pages` (cached HTML documents) and `api` (cached JSON payloads, opt-in via `{ asJson: true }`).
- **background revalidate**: The pattern where a cache hit is returned immediately while a network fetch runs in the background; if the server responds with new data (HTTP 200), the cache is updated (write-through); a 304 Not Modified leaves the cache unchanged.
- **`FetchAndSwap` / `fetchAndSwap`**: The public shell API (`globalThis.FetchAndSwap`) for navigating to a URL: runs `cachedFetch`, then `_swapFromHtml`, then updates browser history.
- **`Intercept`**: The shell module (`src/bootstrap/intercept.js`) that intercepts `click`, `submit`, and `popstate` events to route navigations through `fetchAndSwap` instead of triggering native browser navigation.
- **`viewport-fit=cover`**: A viewport meta value that allows web content to extend into the iPhone notch and home indicator regions, which is required before CSS safe-area insets take effect.
- **safe-area insets**: CSS environment variables (`env(safe-area-inset-top)`, etc.) that provide the pixel distances needed to keep content clear of the iPhone notch, status bar, and home indicator.
- **HIG (Human Interface Guidelines)**: Apple's design specification for iOS apps, referenced here for minimum tap-target size (44×44pt), momentum scrolling behavior, and input keyboard attributes.
- **44pt tap target**: Apple's HIG minimum interactive hit area. Points (pt) are logical units independent of pixel density — 44pt is approximately 6mm, Apple's recommended minimum for reliable touch input.
- **`-webkit-overflow-scrolling: touch`**: A CSS property that enables momentum (inertial) scrolling on scrollable containers in iOS WebViews, making scroll feel native rather than sticky.
- **`.platform-ios`**: A CSS class set on `<body>` by `loader.js` before first paint when running in the iOS shell. All iOS-specific CSS rules are scoped under this class so they are invisible to regular-browser users.
- **`window.Capacitor` / `Capacitor.isNativePlatform()`**: The JavaScript bridge object auto-injected by the Capacitor runtime into the WebView. Its presence and `isNativePlatform()` return value are the runtime signal that code is running inside the iOS shell.
- **vitest + jsdom**: The JS test harness used by this project. Vitest is the test runner; jsdom is a browser-environment emulator for Node, used to run browser-targeting code in the test suite without a real browser.
- **single-source invariant**: The project constraint that one copy of `wwwroot/` serves both the regular-browser site and the iOS shell, without platform forks. Shell-specific behavior is isolated to `src/bootstrap/` and CSS scoped to `.platform-ios`.

## Architecture

The design introduces two small, symmetric pieces and leans on `window.Capacitor`, which the Capacitor iOS runtime auto-injects into every WebView page. The single-source invariant is preserved throughout: shell primitives live in `src/bootstrap/`; page-level helpers live in `src/RoadTripMap/wwwroot/`; one codebase serves the browser and the iOS shell unchanged.

**Shell side — `src/bootstrap/`:**

- **Script-src deduplication** in `_recreateScripts`. A module-scoped `Set<string>` records absolutized `src` URLs that have executed in the current realm. Already-executed external scripts are skipped on re-inject. Inline scripts always execute (they're rare and page-local). Kills the duplicate-`const` cascade.
- **Tracked-listener shim** in a new `src/bootstrap/listenerShim.js`, loaded before all other shell modules. Wraps `document.addEventListener` / `removeEventListener` to track `DOMContentLoaded` and `load` handlers only. Other events pass through unchanged. Exposes `ListenerShim.clearPageLifecycleListeners()`; called by `_swapFromHtml` before the synthetic dispatch. Safety net beneath the Phase-2 migration.
- **Event rename:** `fetchAndSwap` dispatches `app:page-load` after every swap. Synthetic `DOMContentLoaded` and `window.load` dispatches removed.

**Page side — `src/RoadTripMap/wwwroot/js/`:**

- **`roadTrip.js`** (new). Single `RoadTrip` namespace. Contract:
  ```
  RoadTrip.appOrigin(): string                            // https://…prod.azurewebsites.net in shell, window.location.origin in browser
  RoadTrip.onPageLoad(pageName: string, fn: () => void)   // unified lifecycle; '*' sentinel for cross-cutting
  RoadTrip.isNativePlatform(): boolean                    // sugar over Capacitor.isNativePlatform()
  ```
  In browsers, `onPageLoad` listens for `DOMContentLoaded` once and synthesizes an `app:page-load` dispatch, so the single code path fires in both runtimes. Handler runs only when `document.body.dataset.page === pageName` (or `pageName === '*'`).
- **`offlineError.js`** (new). `isOfflineError(err)` + `friendlyMessage(err, context)` with per-context copy for `'create'`, `'photos'`, `'generic'`.

**Page tagging:** every `wwwroot/*.html` page receives `<body data-page="...">`. Values: `home`, `create`, `post`, `view`, `map`.

**Data flow across a swap:**

```
user tap
 → Intercept delegated handler
 → FetchAndSwap.fetchAndSwap(url)
 → CachedFetch.cachedFetch(url)          (cache-first, bg revalidate)
 → _swapFromHtml(html, url)
     → DOMParser
     → strip scripts
     → document.head/body innerHTML swap
     → _recreateScripts  ← skips src already in _executedScriptSrcs
     → ListenerShim.clearPageLifecycleListeners()
     → dispatch 'app:page-load'
     → RoadTrip.onPageLoad handlers fire (scoped by data-page)
     → TripStorage.markOpened(url)
```

**Photo list caching (#5):** `API.getTripPhotos(token)` routes through `CachedFetch.cachedFetch(url, { asJson: true })`. Cache-hit returns the last-known JSON photo list; background revalidate writes newer responses through to `RoadTripPageCache.api`. Individual photo image URLs (Azure Blob) remain uncached — acknowledged as a documented limitation.

**Safe-area + HIG:** every `wwwroot/*.html` adds `viewport-fit=cover` to its viewport meta. `ios.css` extends its existing `.platform-ios` safe-area handling to every fixed/sticky/floating element identified in the HIG audit. Tap-target minimums (44pt) extended to each sub-44pt element. Input attributes added for iOS keyboard behavior. No Capacitor plugin dependency (pure CSS + HTML).

## Existing Patterns

Investigation confirmed this design builds directly on the 2026-04-19 iOS Offline Shell plan. Patterns followed:

- **Document-swap shell architecture** from `src/bootstrap/fetchAndSwap.js` — `_swapFromHtml` mechanics, script recreation order, `<base href>` injection into parsed docs. Preserved; extended (script-src tracking, listener shim call).
- **`CachedFetch.cachedFetch` cache-first + background-revalidate** (contract in [CLAUDE.md](../../CLAUDE.md)). Reused for photo-list caching in Phase 5; no new caching pattern introduced.
- **`platform-ios` body class scoping** on all iOS-specific CSS. Already installed by `src/bootstrap/loader.js` before first paint. All new `ios.css` rules scope under `.platform-ios`.
- **`ios.css` re-injection on every swap** via the loader's wrapper on `FetchAndSwap.fetchAndSwap`. Preserved; new CSS rules rely on it.
- **Swap seams** in `storageAdapter.js` / `uploadTransport.js` (noted in [CLAUDE.md](../../CLAUDE.md) Gotchas). Untouched — this plan does not introduce platform-specific wwwroot/js files.
- **Test style:** vitest + jsdom + fake-indexeddb (existing `tests/js/*.test.js`). All new tests follow the same harness.
- **`LogSanitizer`** for any log call touching tokens/paths/SAS/coords — unchanged, no new secret-touching log sites introduced.

New patterns introduced (justified):

- **`RoadTrip` window-level namespace.** Alternative (per-module globals like `FeatureFlags`, `ExifUtil` etc.) was rejected: it would multiply duplicate-`const` risk and fragment the API surface. One idempotent `RoadTrip ??= {}` install is cleaner.
- **Custom `app:page-load` event** replacing synthetic `DOMContentLoaded`. Precedent: Hotwire Turbo Drive's `turbo:load`. Synthetic `DOMContentLoaded` misrepresented the event's contract (the DOM didn't just *load* — it was swapped); a distinct event is clearer.
- **`data-page` body attribute** for page-scoped init. Alternative (pathname-sniffing) rejected as brittle under route changes, auth redirects, and unknown paths.

## Implementation Phases

8 phases. All commit onto the existing `ios-offline-shell` branch (no new branch).

<!-- START_PHASE_1 -->
### Phase 1: Listener shim + event rename
**Goal:** Shell-side lifecycle primitives in place. Synthetic `DOMContentLoaded` replaced with `app:page-load`. Tracked-listener shim installed.

**Components:**
- `src/bootstrap/listenerShim.js` (new) — `ListenerShim.install()`, `ListenerShim.clearPageLifecycleListeners()`, `ListenerShim._internals`. Wraps `document.addEventListener` / `removeEventListener`; tracks only `DOMContentLoaded` and `load`; other events pass through.
- `src/bootstrap/index.html` — load order updated: `listenerShim.js` first (before `cachedFetch.js`).
- `src/bootstrap/fetchAndSwap.js` — call `ListenerShim.clearPageLifecycleListeners()` before synthetic dispatch; dispatch `app:page-load`; remove `window.dispatchEvent(new Event('load'))`.
- `tests/js/listenerShim.test.js` (new).
- `tests/js/fetchAndSwap.test.js` (update).

**Dependencies:** None.

**ACs covered:** `ios-shell-hardening.AC2.shim.*`, `ios-shell-hardening.AC2.event.*`.

**Done when:** All listed tests pass; branch builds; `npm test` green.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: wwwroot helpers + listener / origin migration
**Goal:** Introduce `RoadTrip` and `OfflineError` helpers; migrate existing `DOMContentLoaded` listeners to `RoadTrip.onPageLoad`; migrate origin-leak sites to `RoadTrip.appOrigin`; tag every page with `data-page`.

**Components:**
- `src/RoadTripMap/wwwroot/js/roadTrip.js` (new).
- `src/RoadTripMap/wwwroot/js/offlineError.js` (new).
- `src/RoadTripMap/wwwroot/*.html` — add `<script src="/js/roadTrip.js">` first in `<head>` of every page; add `data-page="..."` to `<body>`.
- `src/RoadTripMap/wwwroot/js/postUI.js` — line 1272 `DOMContentLoaded` → `RoadTrip.onPageLoad('post', ...)`; line 232 `window.location.origin` → `RoadTrip.appOrigin()`.
- `src/RoadTripMap/wwwroot/js/versionProtocol.js` — line 125 `DOMContentLoaded` → `RoadTrip.onPageLoad('*', ...)`.
- `src/RoadTripMap/wwwroot/js/mapUI.js` — line 190 `window.location.origin` → `RoadTrip.appOrigin()`.
- Audit pass: grep `wwwroot/js/*.js` for any other shareable-URL assembly using `window.location.origin` or `window.location.href`; migrate any found.
- `tests/js/roadTrip.test.js` (new). `tests/js/offlineError.test.js` (new).

**Dependencies:** Phase 1.

**ACs covered:** `ios-shell-hardening.AC2.scope.*`, `ios-shell-hardening.AC3.*`.

**Done when:** All tests pass. No raw `DOMContentLoaded` listener remains in `wwwroot/js/`. No `window.location.origin` used for shareable-URL assembly anywhere in wwwroot. Share-trip view link visibly starts with `https://` on iPhone.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Script-src tracking (#1, verifies #7)
**Goal:** Eliminate duplicate-`const` cascade on cross-page navigation. Verify the post-failure cascade (#7) resolves as a side-effect.

**Components:**
- `src/bootstrap/fetchAndSwap.js` — add module-scoped `const _executedScriptSrcs = new Set()`. In `_recreateScripts`, before injecting external scripts, check `_executedScriptSrcs.has(absolutized(src))`; skip if yes; add to set after successful inject. Inline scripts unchanged. Expose `_executedScriptSrcs` on `globalThis.FetchAndSwap` for test inspection.
- `tests/js/fetchAndSwap.test.js` (update).
- On-device verification: navigate `post → create → post → home → post`; console is clean, no `SyntaxError: Can't create duplicate variable`.

**Dependencies:** Phase 1, Phase 2.

**ACs covered:** `ios-shell-hardening.AC1.*`, `ios-shell-hardening.AC7`.

**Done when:** Unit tests pass. On-device navigation produces no cascade. If #7 cascade persists after the fix, a follow-up investigation issue is opened (not blocking).
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Offline create copy (#4)
**Goal:** Friendly offline message on the create form.

**Components:**
- `src/RoadTripMap/wwwroot/create.html` — catch block uses `OfflineError.friendlyMessage(err, 'create')`; `offlineError.js` loaded on the page.
- `tests/js/create-flow.test.js` (update) — failed-submit-offline path shows friendly copy.

**Dependencies:** Phase 2.

**ACs covered:** `ios-shell-hardening.AC4.*`.

**Done when:** Tests pass. Airplane-mode submit on iPhone shows friendly copy, not raw `"Load failed"`.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Offline trip-page photos (#5)
**Goal:** Cached photo list + friendly fallback banner on cache miss.

**Components:**
- `src/RoadTripMap/wwwroot/js/api.js` — `getTripPhotos(token)` uses `CachedFetch.cachedFetch(url, { asJson: true })` instead of raw `fetch`.
- `src/RoadTripMap/wwwroot/js/postUI.js` — on fetch rejection, render `OfflineError.friendlyMessage(err, 'photos')` in the existing banner slot.
- `tests/js/trip-photos-offline.test.js` (new) or update existing `postUI.test.js` — cache-first hit renders cached list; cache-miss renders friendly banner; write-through on fresh online fetch.

**Dependencies:** Phase 2.

**ACs covered:** `ios-shell-hardening.AC5.*`.

**Done when:** Tests pass. Airplane-mode reload of a previously-visited trip page shows the cached photo list (image thumbs may be broken — documented limitation). Cache-miss shows friendly banner.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Safe-area comprehensive pass (#6A)
**Goal:** Every fixed/sticky/top/bottom surface respects iOS safe-area insets on iPhone.

**Components (from HIG audit, all under `.platform-ios` scope):**
- `src/RoadTripMap/wwwroot/{index,create,post,trips}.html` — viewport meta adds `viewport-fit=cover`.
- `src/RoadTripMap/wwwroot/ios.css` — new safe-area rules for:
  - **Top insets:** `.map-header`, `.page-header`, `.hero`, `.resume-banner`.
  - **Bottom insets:** `.toast-container`, `.view-carousel-container`, `.map-control`.
  - **Both:** `.homescreen-modal-overlay`.
- Visual verification on iPhone: no element clipped by notch or home indicator, across all pages.

**Dependencies:** Phase 2 (unrelated but clean ordering).

**ACs covered:** `ios-shell-hardening.AC6.safeArea.*`.

**Done when:** Visual pass on iPhone — zero elements under the status bar or home indicator on any page. Regular-browser behavior unchanged (rules scoped `.platform-ios`).
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: HIG cleanup (#6B)
**Goal:** Remaining HIG gaps from the audit — tap-target minimums, iOS input attributes, momentum scrolling.

**Components (from HIG audit):**
- `src/RoadTripMap/wwwroot/ios.css` — 44pt minimums for: `.copy-button`, `.carousel-action-btn`, `.photo-popup-delete`, `.upload-panel__toggle`, `.upload-panel__retry` / `.upload-panel__pin-drop` / `.upload-panel__discard` (padding widened to match hit zone), `.map-back`, `.poi-action-btn`.
- `src/RoadTripMap/wwwroot/ios.css` — add `-webkit-overflow-scrolling: touch` to `.upload-panel__body`.
- `src/RoadTripMap/wwwroot/post.html` — `#captionInput`: add `autocorrect="on" autocapitalize="sentences"`.
- `src/RoadTripMap/wwwroot/create.html` — trip-name input: `autocapitalize="words"`; description textarea: `autocapitalize="sentences"`.
- Dark mode: documented as out-of-scope (see Additional Considerations).
- Visual + interaction verification on iPhone.

**Dependencies:** Phase 6.

**ACs covered:** `ios-shell-hardening.AC6.hig.*`.

**Done when:** Visual + interaction pass on iPhone. Every listed button feels full-sized. Caption input auto-capitalizes. Upload-panel internal scrolling feels native. Dark mode explicitly deferred.
<!-- END_PHASE_7 -->

<!-- START_PHASE_8 -->
### Phase 8: On-device smoke + CLAUDE.md update
**Goal:** Formal on-device smoke sign-off by Patrick; documentation caught up.

**Components:**
- On-device smoke checklist (created by implementation plan; lives next to implementation-plan doc). Covers: 5+ cross-page navs produce clean console; airplane-mode create shows friendly copy; airplane-mode trip page shows cached list or friendly banner; share-trip link starts with `https://` and pastes correctly in Safari on another device; safe-areas respected on every page; every listed tap target feels right; caption input capitalizes correctly.
- `CLAUDE.md` Invariants additions:
  - "Page scripts in `wwwroot/js/*` register lifecycle handlers via `RoadTrip.onPageLoad(pageName, fn)` — never raw `document.addEventListener('DOMContentLoaded', ...)`."
  - "Shell `_recreateScripts` tracks executed `src` URLs and skips re-injection; inline scripts always re-execute."
  - "`RoadTrip.appOrigin()` is the only sanctioned way to assemble shareable URLs in page scripts; `window.location.origin` is shell-unsafe."
  - "Every `wwwroot/*.html` page's `<body>` carries a `data-page` attribute; `RoadTrip.onPageLoad` uses it to scope handler dispatch."
- `CLAUDE.md` Key Files: add `wwwroot/js/roadTrip.js`, `wwwroot/js/offlineError.js`, `src/bootstrap/listenerShim.js`.
- `CLAUDE.md` freshness date bumped.

**Dependencies:** Phases 1–7.

**ACs covered:** None directly — validates all prior ACs collectively.

**Done when:** Smoke checklist signed off by Patrick on iPhone. `CLAUDE.md` committed. No outstanding regressions identified.
<!-- END_PHASE_8 -->

## Additional Considerations

- **Dark mode.** The HIG audit identified `prefers-color-scheme: dark` support as a gap. A proper implementation requires a color-token restructure (neither `styles.css` nor `ios.css` uses CSS custom properties for color). Out of scope here; tracked as a follow-up design plan.
- **Blob-image offline.** Cached photo *list* is served from IndexedDB after Phase 5; individual blob-image URLs (Azure) are not cached. Offline thumbnails render as broken-image placeholders. Acceptable scope boundary (list visibility > image visibility offline) and will be documented in `CLAUDE.md` Gotchas.
- **Inline script re-execution.** Script-src tracking skips external scripts on re-execution but always re-runs inline scripts. If any `wwwroot/*.html` page introduces a top-level `const` in an inline `<script>`, it will regress the cascade. No wwwroot page currently does this; enforcement is documentation-only.
- **Tap-target audit drift.** Phase 7 targets the 20 findings from the HIG audit run at design time. Buttons added to `wwwroot` after this plan lands are not automatically covered. Adding a lint / test to enforce the minimum is out of scope.
- **Branch hygiene.** Plan phases commit onto the existing `ios-offline-shell` branch. Merge to `develop` remains gated on the prior plan's Phase 7 sign-off (real-world phone testing + device-smoke matrix), which is explicitly out of scope for this plan.

