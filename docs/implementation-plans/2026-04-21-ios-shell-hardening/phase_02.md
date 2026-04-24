# iOS Shell Hardening — Phase 2: wwwroot helpers + listener/origin migration

**Goal:** Introduce page-side primitives `RoadTrip` (lifecycle + origin) and `OfflineError` (network-error classification + friendly copy). Tag every `wwwroot/*.html` page with a `data-page` attribute. Migrate every `DOMContentLoaded` listener in `wwwroot/js/*.js` to `RoadTrip.onPageLoad(...)`. Migrate every shareable-URL `window.location.origin` use to `RoadTrip.appOrigin()`.

**Architecture:** Two new IIFE modules installed idempotently via `globalThis.X ??= {}` (the first use of that pattern in this codebase — justified as an anti-duplicate-const measure). `RoadTrip.onPageLoad(pageName, fn)` subscribes `fn` to a `document` `app:page-load` listener that filters by `document.body.dataset.page === pageName` (or the `'*'` wildcard). In regular browsers, the first `onPageLoad` call installs a one-shot `DOMContentLoaded → dispatch('app:page-load')` bridge so the same code path fires in both runtimes. In the iOS shell, `fetchAndSwap` dispatches `app:page-load` directly (wired in Phase 1). `RoadTrip.appOrigin()` returns `'https://app-roadtripmap-prod.azurewebsites.net'` in the shell, `window.location.origin` elsewhere.

**Tech Stack:** Vanilla JS; vitest + jsdom; no new runtime dependencies.

**Scope:** Phase 2 of 8 from `docs/design-plans/2026-04-21-ios-shell-hardening.md`.

**Codebase verified:** 2026-04-22 (branch `ios-offline-shell`).

**Branch:** `ios-offline-shell` (same as Phase 1).

**Dependencies:** Phase 1 complete (ListenerShim installed and `fetchAndSwap` dispatches `app:page-load`).

---

## Acceptance Criteria Coverage

### ios-shell-hardening.AC2: No stale-handler listener cascade (scope subgroup)

- **ios-shell-hardening.AC2.scope.1 Success:** `RoadTrip.onPageLoad('post', fn)` runs `fn` on `app:page-load` iff `document.body.dataset.page === 'post'`.
- **ios-shell-hardening.AC2.scope.2 Success:** `RoadTrip.onPageLoad('*', fn)` runs on every `app:page-load` regardless of `data-page` (cross-cutting concerns).
- **ios-shell-hardening.AC2.scope.3 Success:** In a regular browser, `RoadTrip.onPageLoad('home', fn)` fires on initial load via a synthesized `app:page-load` dispatched from `DOMContentLoaded`.
- **ios-shell-hardening.AC2.scope.4 Failure:** `postUI.js`'s migrated handler does NOT fire on the `/create` page (`data-page="create" !== "post"`).

### ios-shell-hardening.AC3: Shareable URLs are valid `https://…`

- **ios-shell-hardening.AC3.1 Success:** In iOS shell (`Capacitor.isNativePlatform() === true`), `RoadTrip.appOrigin()` returns `"https://app-roadtripmap-prod.azurewebsites.net"`.
- **ios-shell-hardening.AC3.2 Success:** In a regular browser (`window.Capacitor` undefined), `RoadTrip.appOrigin()` returns `window.location.origin`.
- **ios-shell-hardening.AC3.3 Success:** On iPhone, the "Share This Trip" view link reads `https://…/trips/{guid}` — never `capacitor://localhost/…`. (On-device verification tracked in Phase 8; Phase 2 proves it via `postUI.js` wiring + unit tests.)
- **ios-shell-hardening.AC3.4 Success:** `mapUI.js`'s assembled URL uses the same helper.
- **ios-shell-hardening.AC3.5 Edge:** Audit pass finds no other `window.location.origin` use for shareable-URL assembly in `wwwroot/js/`.

### ios-shell-hardening.AC4: Friendly offline message — unit-test cases only

- **ios-shell-hardening.AC4.1 Success:** `OfflineError.isOfflineError(err)` returns true for `err instanceof TypeError`.
- **ios-shell-hardening.AC4.2 Success:** `OfflineError.isOfflineError(err)` returns true when `navigator.onLine === false` regardless of `err` shape.
- **ios-shell-hardening.AC4.4 Failure:** Non-offline errors (e.g. 400 validation) do NOT classify as offline; they show their normal message.

(AC4.3 — the integration into `create.html` — is implemented and tested in Phase 4.)

---

## Codebase baseline (verified 2026-04-22)

- **DOMContentLoaded sites in `src/RoadTripMap/wwwroot/js/`** (exhaustive):
  - `postUI.js:1271–1284` — page-scoped handler that extracts `secretToken` from `window.location.pathname.split('/')` and calls `PostUI.init(secretToken)`. Migration: `RoadTrip.onPageLoad('post', ...)`.
  - `versionProtocol.js:122–129` — two-branch init (`if (document.readyState === 'loading') addEventListener else init directly`). The handler reads `meta[name=client-version]`, wraps `fetch` for response-header monitoring — fully page-agnostic. Migration: `RoadTrip.onPageLoad('*', ...)` (which handles the already-loaded case internally, collapsing the two-branch construct to one call).
  - No other sites.
- **`window.location.origin` sites in `src/RoadTripMap/wwwroot/js/` classified as shareable-URL assembly (Class A)**:
  - `postUI.js:232` — `const origin = window.location.origin; ... textContent = origin + trip.viewUrl;` inside the "Show view link for sharing" block. User-facing copy-to-clipboard target. Migration: `RoadTrip.appOrigin()`.
  - `mapUI.js:190` — `const fullUrl = window.location.origin + url; await navigator.share({ title, url: fullUrl });` inside `MapUI.sharePhoto`. Migration: `RoadTrip.appOrigin()`.
  - `postUI.js:1274` is `window.location.pathname` (not `.origin`) — Class B (internal token parsing), stays.
  - No other Class A sites.
- **HTML pages** (all under `src/RoadTripMap/wwwroot/`):
  - `index.html` — `<body>` at line 10, no `data-page`. Proposed `data-page="home"`.
  - `create.html` — `<body>` at line 10, no `data-page`. Proposed `data-page="create"`.
  - `post.html` — `<body>` at line 13, no `data-page`. Proposed `data-page="post"`. Has `<meta name="client-version" content="1.0.0">` in head.
  - `trips.html` — `<body class="map-page">` at line 12, no `data-page`. Proposed `data-page="view"` (design glossary says the view-only page value is `view`). Preserve the existing `class="map-page"`.
- **New files do not exist yet:**
  - `src/RoadTripMap/wwwroot/js/roadTrip.js` (absent)
  - `src/RoadTripMap/wwwroot/js/offlineError.js` (absent)
  - `tests/js/roadTrip.test.js` (absent)
  - `tests/js/offlineError.test.js` (absent)
- **Module idiom in `wwwroot/js/` today:** top-level `const ModuleName = {...}` (e.g., `api.js`, `postUI.js`, `mapUI.js`, `versionProtocol.js`) or IIFE-returning-object (e.g., `featureFlags.js`, `storageAdapter.js`'s `_storageAdapterImpl` + alias seam). No existing `??=` use. Phase 2 introduces `globalThis.RoadTrip ??= {}` as a NEW pattern — justified because these modules must tolerate being re-executed (current `_swapFromHtml` re-runs scripts until Phase 3) without throwing duplicate-const SyntaxError.
- **`src/RoadTripMap/wwwroot/js/api.js:138–147`:** `getTripPhotos(viewToken)` is an async method on `const API = { baseUrl: '/api', ... }`. Phase 2 does NOT modify `api.js` — Phase 5 routes `getTripPhotos` through `CachedFetch`.
- **Existing tests:** `tests/js/versionProtocol.test.js` exists and may exercise the current DOMContentLoaded init path. The migration preserves `VersionProtocol.init()` behavior; the test file must be updated to drive init via a synthesized `app:page-load` event instead of a DOMContentLoaded dispatch.
- **`src/RoadTripMap/CLAUDE.md`** has no directives for `wwwroot/js/` module idiom; `wwwroot/` has no local `CLAUDE.md` or `AGENTS.md`. The new `??=` idempotent-install convention is documented in Phase 8.

---

## Temporary state between Phase 2 and Phase 3

Because `_recreateScripts` in `fetchAndSwap.js` still re-executes scripts on every swap (dedup lands in Phase 3), a page script re-executed on cross-page navigation will call `RoadTrip.onPageLoad(...)` again — adding a second copy of the handler subscribed to `app:page-load`. On subsequent visits to that page, the handler fires multiple times. This is the same class of accumulation Phase 1's listener shim already protects `DOMContentLoaded` / `load` against; the general shim does not cover `app:page-load` (AC2.shim.1 restricts coverage intentionally). Phase 3's script-src dedup eliminates the re-execution, which in turn collapses the accumulation at its root. Do not ship `ios-offline-shell` between Phase 2 and Phase 3.

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

### Subcomponent A — `RoadTrip` namespace, tests, and page wiring

Delivers `globalThis.RoadTrip` with `appOrigin()`, `isNativePlatform()`, and `onPageLoad(pageName, fn)`; tests the three; wires `roadTrip.js` into every page and adds `data-page` attributes.

<!-- START_TASK_1 -->
### Task 1: Implement `src/RoadTripMap/wwwroot/js/roadTrip.js`

**Verifies:** ios-shell-hardening.AC3.1, ios-shell-hardening.AC3.2 (implementation). Scope cases (AC2.scope.*) verified in Task 2 tests.

**Files:**
- Create: `src/RoadTripMap/wwwroot/js/roadTrip.js`.

**Implementation contract:**

The module is idempotent — re-executing it must NOT throw and must NOT re-install listeners. Use the following skeleton verbatim:

```javascript
/**
 * RoadTrip — unified shell-aware lifecycle + origin helper.
 *
 * Idempotent install: re-evaluation (e.g., on a document swap before
 * Phase 3 dedup lands) must not re-register listeners or throw.
 *
 * Public API:
 *   RoadTrip.appOrigin(): string            — "https://app-roadtripmap-prod.azurewebsites.net" in iOS shell, window.location.origin in browser.
 *   RoadTrip.isNativePlatform(): boolean    — sugar over Capacitor.isNativePlatform().
 *   RoadTrip.onPageLoad(pageName, fn): void — run fn on every app:page-load where
 *                                             document.body.dataset.page === pageName
 *                                             (or pageName === '*').
 */
globalThis.RoadTrip ??= {};

(function () {
    const RT = globalThis.RoadTrip;

    // Guard against repeat install (idempotency)
    if (RT._installed) return;
    RT._installed = true;

    const SHELL_ORIGIN = 'https://app-roadtripmap-prod.azurewebsites.net';

    // Has app:page-load fired at least once in this realm?
    // Used so late registrations (after the regular-browser synthesizer already fired)
    // still get a callback via microtask.
    RT._firedOnce = false;
    document.addEventListener('app:page-load', () => { RT._firedOnce = true; });

    function isNative() {
        const cap = globalThis.Capacitor;
        return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
    }

    // Regular-browser-only: bridge the real DOMContentLoaded to our custom event once.
    // In the iOS shell, fetchAndSwap dispatches app:page-load directly; doing it here
    // too would double-fire handlers.
    if (!isNative()) {
        const dispatchAppPageLoad = () => {
            document.dispatchEvent(new Event('app:page-load', { bubbles: true, cancelable: true }));
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', dispatchAppPageLoad, { once: true });
        } else {
            // Already interactive/complete — schedule microtask so any synchronous
            // RoadTrip.onPageLoad() calls made immediately after load register first.
            queueMicrotask(dispatchAppPageLoad);
        }
    }

    RT.appOrigin = function appOrigin() {
        return isNative() ? SHELL_ORIGIN : window.location.origin;
    };

    RT.isNativePlatform = function isNativePlatform() {
        return isNative();
    };

    RT.onPageLoad = function onPageLoad(pageName, fn) {
        if (typeof pageName !== 'string' || typeof fn !== 'function') {
            throw new TypeError('RoadTrip.onPageLoad(pageName: string, fn: function)');
        }
        const handler = function () {
            const currentPage = (document.body && document.body.dataset && document.body.dataset.page) || null;
            if (pageName === '*' || currentPage === pageName) {
                try { fn(); } catch (err) { console.error('[RoadTrip.onPageLoad:' + pageName + ']', err); }
            }
        };
        document.addEventListener('app:page-load', handler);
        // Late-registration catch-up: if the event already fired in this realm
        // (regular browser, script loaded after DOMContentLoaded), schedule one run.
        if (RT._firedOnce) queueMicrotask(handler);
    };
})();
```

**Non-goals:**
- Do NOT implement any iOS-shell-specific dispatch here. `fetchAndSwap.js` is the source of `app:page-load` in the shell.
- Do NOT expose internals beyond `_installed` and `_firedOnce`. Tests read these as state inspection; no other `_internals` surface is required.
- Do NOT depend on any other wwwroot or shell module — `roadTrip.js` is the first script loaded on every page (Task 3 enforces).

**Verification:**
- Run `node --check src/RoadTripMap/wwwroot/js/roadTrip.js` — expect no output.

**Commit:** `feat(wwwroot): add RoadTrip namespace with onPageLoad, appOrigin, isNativePlatform`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tests for `RoadTrip`

**Verifies:** ios-shell-hardening.AC2.scope.1, ios-shell-hardening.AC2.scope.2, ios-shell-hardening.AC2.scope.3, ios-shell-hardening.AC2.scope.4, ios-shell-hardening.AC3.1, ios-shell-hardening.AC3.2.

**Files:**
- Create: `tests/js/roadTrip.test.js` (unit).

**Test harness notes:**
- Follow the eval-from-source pattern used across `tests/js/` (see `tests/js/cachedFetch.test.js` or `tests/js/intercept.test.js` for the template): read `roadTrip.js` once at the top of the test file (`fs.readFileSync(path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/roadTrip.js'), 'utf8')`), and inside `beforeEach` do `delete globalThis.RoadTrip; eval(SOURCE);`.
- `document.body` must be present before `onPageLoad` callbacks can inspect `dataset.page`. Reset DOM in `beforeEach`: `document.body.outerHTML = '<body data-page="home"></body>';` (or set `document.body.dataset.page = 'home'` directly after DOM reset).
- `globalThis.Capacitor` toggling follows the pattern described in `tests/js/setup.js`. For `isNative()` true: `globalThis.Capacitor = { isNativePlatform: vi.fn().mockReturnValue(true) };`. For `isNative()` false: `delete globalThis.Capacitor;`.
- `app:page-load` dispatch in tests: `document.dispatchEvent(new Event('app:page-load', { bubbles: true, cancelable: true }));`. Do NOT spy on `document.dispatchEvent` globally for these tests — we need the real dispatch to exercise the listeners.
- `queueMicrotask` calls are flushed with `await Promise.resolve();` or `await new Promise(r => queueMicrotask(r));` — use whichever matches the repo's existing pattern (`tests/js/cachedFetch.test.js:39–43` has a `flushPromises` helper; follow that).

**Tests required (one `describe` per AC case, named after the case ID):**

1. **AC2.scope.1 — `onPageLoad('post', fn)` fires iff `data-page === 'post'`.**
   - Arrange: `document.body.dataset.page = 'post';` register `const fn = vi.fn(); RoadTrip.onPageLoad('post', fn);`.
   - Dispatch `app:page-load`. Assert `fn` called exactly once.
   - Change `document.body.dataset.page = 'create';` and dispatch `app:page-load` again. Assert `fn` call count is still exactly 1.

2. **AC2.scope.2 — `onPageLoad('*', fn)` fires on every dispatch regardless of data-page.**
   - Register `const fn = vi.fn(); RoadTrip.onPageLoad('*', fn);`.
   - Set body to each of `home`, `create`, `post`, `view`, `map` in turn (5 different values), dispatching `app:page-load` after each change.
   - Assert `fn` call count is exactly 5.

3. **AC2.scope.3 — In a regular browser, `onPageLoad('home', fn)` fires on initial load via synthesized `app:page-load`.**
   - Arrange — strict ordering:
     1. `delete globalThis.Capacitor;` set `document.body.dataset.page = 'home'`.
     2. Force `document.readyState === 'loading'` (use `Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading', writable: true });`).
     3. `delete globalThis.RoadTrip; eval(SOURCE);` — NOW the module installs the DOMContentLoaded bridge against the `loading` state.
     4. Register `const fn = vi.fn(); RoadTrip.onPageLoad('home', fn);`. Registration MUST happen BEFORE the next step or the handler will miss the synthesized dispatch.
     5. Dispatch `new Event('DOMContentLoaded')` on `document`.
   - Assert `fn` called exactly once (the bridge dispatched `app:page-load`; the handler matched via `data-page='home'` and fired).

4. **AC2.scope.4 — `postUI`'s migrated handler does NOT fire on `/create`.**
   - Arrange: `document.body.dataset.page = 'create';` register `const postInit = vi.fn(); RoadTrip.onPageLoad('post', postInit);`.
   - Dispatch `app:page-load`. Assert `postInit` NOT called.

5. **AC3.1 — `appOrigin()` returns the baked-in host in the iOS shell.**
   - Arrange: `globalThis.Capacitor = { isNativePlatform: vi.fn().mockReturnValue(true) };` → `delete globalThis.RoadTrip; eval(SOURCE);`.
   - Assert `RoadTrip.appOrigin() === 'https://app-roadtripmap-prod.azurewebsites.net'`.

6. **AC3.2 — `appOrigin()` returns `window.location.origin` in a regular browser.**
   - Arrange: `delete globalThis.Capacitor;` → re-eval the module.
   - Assert `RoadTrip.appOrigin() === window.location.origin`. (In jsdom the value is typically `http://localhost`.)

7. **Late-registration catch-up (supports AC2.scope.3).**
   - Arrange: `delete globalThis.Capacitor;` → re-eval.
   - Let the DOMContentLoaded-bridge fire (dispatch DOMContentLoaded explicitly so `RT._firedOnce === true`).
   - AFTER the dispatch, register `const fn = vi.fn(); RoadTrip.onPageLoad('home', fn);` while `document.body.dataset.page === 'home'`.
   - Flush microtasks. Assert `fn` was called exactly once.

8. **Idempotent re-install — re-evaluating `roadTrip.js` does NOT double-register listeners.**
   - Arrange: `document.body.dataset.page = 'post';` register `const fn = vi.fn(); RoadTrip.onPageLoad('post', fn);`.
   - Re-eval the source (do NOT `delete globalThis.RoadTrip` — simulate a swap's re-injection).
   - Dispatch `app:page-load`. Assert `fn` called exactly once (re-eval did not subscribe a second listener, and did not clear state).

9. **TypeError guard — invalid args.**
   - Assert `() => RoadTrip.onPageLoad(123, () => {})` throws `TypeError`.
   - Assert `() => RoadTrip.onPageLoad('post', 'not-a-function')` throws `TypeError`.

**Verification:**
- Run `npx vitest run tests/js/roadTrip.test.js` — all tests green.
- Run `npm test` — full suite green.

**Commit:** `test(wwwroot): cover RoadTrip scope filter, platform-aware origin, late registration, idempotency`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Load `roadTrip.js` into every `wwwroot/*.html` and tag `<body>` with `data-page`

**Verifies:** Operational precondition for all AC2.scope.* and AC3.* tests at runtime. No new AC case by itself.

**Files (all 4):**

Consistent insertion rule for every page: place `<script src="/js/roadTrip.js"></script>` as the LAST `<meta>`-adjacent tag — that is, AFTER the trailing `<meta>` on the page (so existing metas stay above the script block for readability) and BEFORE any `<link rel="stylesheet">` or `<title>`. Since `roadTrip.js` has no dependency on meta values and no other wwwroot script runs before it in the `<head>`, this position guarantees `RoadTrip` is defined before any later `<script>` or inline handler runs.

- Modify: `src/RoadTripMap/wwwroot/index.html` — insert `<script src="/js/roadTrip.js"></script>` after the last `<meta>` and before `<title>` / `<link>`. Change `<body>` (line 10) to `<body data-page="home">`.
- Modify: `src/RoadTripMap/wwwroot/create.html` — insert in the same position. Change `<body>` (line 10) to `<body data-page="create">`.
- Modify: `src/RoadTripMap/wwwroot/post.html` — insert AFTER `<meta name="client-version">` (the last `<meta>` on this page) and before `<title>` / `<link>`. Change `<body>` (line 13) to `<body data-page="post">`.
- Modify: `src/RoadTripMap/wwwroot/trips.html` — insert in the same position. Change `<body class="map-page">` (line 12) to `<body class="map-page" data-page="view">` (preserve the existing class).

**Why this position:** `roadTrip.js` must execute before any other `wwwroot/js/` module calls `RoadTrip.onPageLoad` or `RoadTrip.appOrigin`. Placing it after the meta block and before `<link>` / `<title>` is consistent across all 4 pages, reads cleanly in source, and has zero dependency ordering implications (meta values are read by later scripts, not by roadTrip). Non-defer, non-async — standard synchronous `<script>`.

**Verification:**
- `grep -rn 'roadTrip.js' src/RoadTripMap/wwwroot/*.html` → 4 matches (one per HTML file).
- `grep -rn 'data-page' src/RoadTripMap/wwwroot/*.html` → 4 matches.
- `grep -rn 'class="map-page"' src/RoadTripMap/wwwroot/trips.html` → 1 match (preserved).
- `npm test` — full suite green (no test changes; the HTML files are not loaded by vitest, but any snapshot test that reads these files must now be regenerated. The investigator found none.).

**Commit:** `chore(wwwroot): load roadTrip.js and tag every page with data-page`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

### Subcomponent B — `OfflineError` classifier module

Delivers the error-classification helper used by Phase 4 (`create.html` offline copy) and Phase 5 (trip-page photos).

<!-- START_TASK_4 -->
### Task 4: Implement `src/RoadTripMap/wwwroot/js/offlineError.js`

**Verifies:** ios-shell-hardening.AC4.1, ios-shell-hardening.AC4.2, ios-shell-hardening.AC4.4 (implementation; tests in Task 5).

**Files:**
- Create: `src/RoadTripMap/wwwroot/js/offlineError.js`.

**Implementation contract:**

Idempotent install, no state. Module shape:

```javascript
/**
 * OfflineError — classify network failures and produce friendly copy.
 *
 * Public API:
 *   OfflineError.isOfflineError(err): boolean
 *     Returns true for TypeError (fetch network failure), DOMException
 *     NetworkError, or when navigator.onLine === false regardless of
 *     err shape.
 *
 *   OfflineError.friendlyMessage(err, context): string
 *     Returns a human-readable copy string for a given context. Known
 *     contexts: 'create', 'photos', 'generic'. Unknown contexts fall
 *     back to 'generic'. Non-offline errors fall through to a plain
 *     (err.message || 'Something went wrong.') to preserve diagnostic
 *     detail for validation failures etc.
 */
globalThis.OfflineError ??= {};

(function () {
    const OE = globalThis.OfflineError;
    if (OE._installed) return;
    OE._installed = true;

    const OFFLINE_COPY = {
        create: "Can't create a trip while offline. Try again when you're back online.",
        photos: "Photos unavailable offline. Reconnect to see the latest.",
        generic: "You're offline. Reconnect and try again.",
    };

    OE.isOfflineError = function isOfflineError(err) {
        // navigator.onLine is the strongest signal and wins regardless of err shape
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
        // TypeError from fetch is the canonical "network unreachable" in browsers
        if (err instanceof TypeError) return true;
        // DOMException with name 'NetworkError' (WebKit dispatches this for XHR)
        if (err && typeof err === 'object' && err.name === 'NetworkError') return true;
        return false;
    };

    OE.friendlyMessage = function friendlyMessage(err, context) {
        if (OE.isOfflineError(err)) {
            const key = (context && Object.prototype.hasOwnProperty.call(OFFLINE_COPY, context)) ? context : 'generic';
            return OFFLINE_COPY[key];
        }
        return (err && err.message) ? err.message : 'Something went wrong.';
    };
})();
```

**Non-goals:**
- Do NOT wrap or mutate the `err` argument; classification is read-only.
- Do NOT mutate `navigator`; read-only.
- Do NOT throw for unknown contexts — fall back to `generic`.

**Verification:**
- Run `node --check src/RoadTripMap/wwwroot/js/offlineError.js` — expect no output.

**Commit:** `feat(wwwroot): add OfflineError classifier with per-context friendly copy`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Tests for `OfflineError`

**Verifies:** ios-shell-hardening.AC4.1, ios-shell-hardening.AC4.2, ios-shell-hardening.AC4.4.

**Files:**
- Create: `tests/js/offlineError.test.js` (unit).

**Test harness notes:**
- Same eval-from-source pattern as Task 2. `beforeEach`: `delete globalThis.OfflineError; eval(SOURCE);`.
- Stub `navigator.onLine` via `Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => <value> });` because in jsdom `navigator` is a live object and `vi.stubGlobal('navigator', ...)` can interfere with other tests' expectations.
- Restore `navigator.onLine` to default (`true`) after each test: `Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });`.

**Tests required:**

1. **AC4.1 — `isOfflineError(err)` returns true for `TypeError`.**
   - With `navigator.onLine = true`, assert `OfflineError.isOfflineError(new TypeError('Load failed'))` is `true`.
   - Assert it is `true` for `new TypeError('NetworkError when attempting to fetch resource')`.

2. **AC4.2 — `isOfflineError(err)` returns true when `navigator.onLine === false` regardless of err shape.**
   - With `navigator.onLine = false`:
     - Assert `isOfflineError(undefined)` is `true`.
     - Assert `isOfflineError(null)` is `true`.
     - Assert `isOfflineError(new Error('any message'))` is `true`.
     - Assert `isOfflineError('string')` is `true`.
     - Assert `isOfflineError({})` is `true`.

3. **AC4.4 — Non-offline errors do NOT classify as offline.**
   - With `navigator.onLine = true`:
     - Assert `isOfflineError(new Error('Trip name required'))` is `false`.
     - Assert `isOfflineError({ status: 400, message: 'Bad Request' })` is `false`.
     - Assert `isOfflineError({ name: 'ValidationError' })` is `false`.

4. **`friendlyMessage` — context-specific copy when offline.**
   - With `navigator.onLine = false` and `err = new TypeError('x')`:
     - Assert `friendlyMessage(err, 'create')` is the exact create copy: `"Can't create a trip while offline. Try again when you're back online."`.
     - Assert `friendlyMessage(err, 'photos')` is the exact photos copy: `"Photos unavailable offline. Reconnect to see the latest."`.
     - Assert `friendlyMessage(err, 'generic')` is the generic copy.
     - Assert `friendlyMessage(err, 'unknown')` falls back to the generic copy.
     - Assert `friendlyMessage(err)` (no context) falls back to the generic copy.

5. **`friendlyMessage` — non-offline preserves `err.message`.**
   - With `navigator.onLine = true`:
     - Assert `friendlyMessage(new Error('Trip name required'), 'create')` returns `'Trip name required'`.
     - Assert `friendlyMessage({ message: 'Bad Request' }, 'create')` returns `'Bad Request'`.
     - Assert `friendlyMessage(null, 'create')` returns `'Something went wrong.'`.

6. **Idempotent re-install.**
   - After a first eval + usage, re-eval the source. Assert `OfflineError.isOfflineError(new TypeError())` still returns true (state preserved, no crash, no re-init loop).

**Verification:**
- Run `npx vitest run tests/js/offlineError.test.js` — all tests green.
- Run `npm test` — full suite green.

**Commit:** `test(wwwroot): cover OfflineError classification and per-context copy`
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-7) -->

### Subcomponent C — Listener migration off raw `DOMContentLoaded`

<!-- START_TASK_6 -->
### Task 6: Migrate `postUI.js` init to `RoadTrip.onPageLoad('post', ...)`

**Verifies:** ios-shell-hardening.AC2.scope.1, ios-shell-hardening.AC2.scope.4 at runtime (the migrated handler is the subject of AC2.scope.4's assertion that the post-page handler does not fire on /create).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js:1271–1284` (the trailing DOMContentLoaded registration).

**Current code (lines 1270–1284):**
```javascript
// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    // Extract secret token from URL
    const pathParts = window.location.pathname.split('/');
    const secretToken = pathParts[pathParts.length - 1];

    if (!secretToken || secretToken === 'post') { // pragma: allowlist secret
        document.getElementById('errorMessage').textContent = 'Invalid trip URL';
        document.getElementById('errorMessage').classList.remove('hidden');
        return;
    }

    PostUI.init(secretToken);
});
```

**Target code (same position):**
```javascript
// Initialize when page loads (iOS shell dispatches app:page-load after swap;
// regular browsers fire it via RoadTrip's DOMContentLoaded bridge).
RoadTrip.onPageLoad('post', () => {
    // Extract secret token from URL
    const pathParts = window.location.pathname.split('/');
    const secretToken = pathParts[pathParts.length - 1];

    if (!secretToken || secretToken === 'post') { // pragma: allowlist secret
        document.getElementById('errorMessage').textContent = 'Invalid trip URL';
        document.getElementById('errorMessage').classList.remove('hidden');
        return;
    }

    PostUI.init(secretToken);
});
```

**Non-goals:**
- Do NOT change `PostUI.init` behavior.
- Do NOT change `postUI.js:232` in this task — that's Task 8.

**Verification:**
- `grep -n "document.addEventListener('DOMContentLoaded'" src/RoadTripMap/wwwroot/js/postUI.js` → 0 results.
- `grep -n "RoadTrip.onPageLoad('post'" src/RoadTripMap/wwwroot/js/postUI.js` → 1 result.
- `node --check src/RoadTripMap/wwwroot/js/postUI.js` — expect no output.
- `npm test` — if any existing postUI-related test drove init via a DOMContentLoaded dispatch on document, update it to dispatch `app:page-load` after setting `document.body.dataset.page = 'post'`. (The investigator noted no dedicated `tests/js/postUI.test.js` exists; `postUI-upload.test.js`, `postUI-processing.test.js`, `postUI-failure-routing.test.js` test upload flows that call `PostUI.init` explicitly, not via DOMContentLoaded.) Full suite must stay green.

**Commit:** `refactor(postUI): migrate page init off DOMContentLoaded to RoadTrip.onPageLoad('post')`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Migrate `versionProtocol.js` init to `RoadTrip.onPageLoad('*', ...)`

**Verifies:** ios-shell-hardening.AC2.scope.2 at runtime.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/versionProtocol.js:121–130` (the trailing two-branch init).

**Current code (lines 121–130):**
```javascript
// Auto-initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        VersionProtocol.init();
    });
} else {
    // Already loaded
    VersionProtocol.init();
}
```

**Target code (same position):**
```javascript
// Auto-initialize on every page load (cross-cutting). RoadTrip.onPageLoad
// handles the already-loaded case via a microtask catch-up on late registration.
RoadTrip.onPageLoad('*', () => {
    VersionProtocol.init();
});
```

**Non-goals:**
- Do NOT change the `VersionProtocol.init()` body or any of the `VersionProtocol` object's methods.
- Do NOT add any `isNative()` guard — `VersionProtocol` runs on every page, shell or browser.

**Verification:**
- `grep -n "DOMContentLoaded" src/RoadTripMap/wwwroot/js/versionProtocol.js` → 0 results.
- `grep -n "RoadTrip.onPageLoad" src/RoadTripMap/wwwroot/js/versionProtocol.js` → 1 result.
- `node --check src/RoadTripMap/wwwroot/js/versionProtocol.js` — expect no output.
- Inspect `tests/js/versionProtocol.test.js`. If any test invokes `VersionProtocol.init` by dispatching `DOMContentLoaded` on document, update it to dispatch `app:page-load` after eval'ing both `roadTrip.js` and `versionProtocol.js` into the test scope. If any test calls `VersionProtocol.init()` directly, leave it unchanged.
- `npm test` — full suite green.

**Commit:** `refactor(versionProtocol): migrate auto-init to RoadTrip.onPageLoad('*')`
<!-- END_TASK_7 -->

<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D (tasks 8-10) -->

### Subcomponent D — Origin-leak migration + exhaustive audit

<!-- START_TASK_8 -->
### Task 8: Migrate `postUI.js:232` share-link assembly to `RoadTrip.appOrigin()`

**Verifies:** ios-shell-hardening.AC3.3 (wiring), ios-shell-hardening.AC3.1, ios-shell-hardening.AC3.2 (wired-through).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js:229–244` (the "Show view link for sharing" block).

**Current code (lines 229–234):**
```javascript
            // Show view link for sharing
            if (trip.viewUrl) {
                const section = document.getElementById('viewLinkSection');
                const origin = window.location.origin;
                document.getElementById('viewUrlValue').textContent = origin + trip.viewUrl;
                section.style.display = '';
```

**Target code (same lines, only line 232 changes):**
```javascript
            // Show view link for sharing
            if (trip.viewUrl) {
                const section = document.getElementById('viewLinkSection');
                const origin = RoadTrip.appOrigin();
                document.getElementById('viewUrlValue').textContent = origin + trip.viewUrl;
                section.style.display = '';
```

**Verification:**
- `grep -n "window.location.origin" src/RoadTripMap/wwwroot/js/postUI.js` → 0 results.
- `grep -n "RoadTrip.appOrigin" src/RoadTripMap/wwwroot/js/postUI.js` → 1 result.
- `node --check src/RoadTripMap/wwwroot/js/postUI.js` — expect no output.
- `npm test` — full suite green.

**Commit:** `fix(postUI): use RoadTrip.appOrigin for share-trip view link (unblocks iOS sharing)`
<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: Migrate `mapUI.js:190` photo-share assembly to `RoadTrip.appOrigin()`

**Verifies:** ios-shell-hardening.AC3.4.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/mapUI.js:188–196` (inside `MapUI.sharePhoto`).

**Current code (lines 188–195):**
```javascript
    async sharePhoto(url, title) {
        try {
            const fullUrl = window.location.origin + url;
            await navigator.share({ title: title || 'Photo', url: fullUrl });
        } catch (err) {
            if (err.name !== 'AbortError') console.warn('Share failed:', err);
        }
    },
```

**Target code (same range, only the `const fullUrl` line changes):**
```javascript
    async sharePhoto(url, title) {
        try {
            const fullUrl = RoadTrip.appOrigin() + url;
            await navigator.share({ title: title || 'Photo', url: fullUrl });
        } catch (err) {
            if (err.name !== 'AbortError') console.warn('Share failed:', err);
        }
    },
```

**Verification:**
- `grep -n "window.location.origin" src/RoadTripMap/wwwroot/js/mapUI.js` → 0 results.
- `grep -n "RoadTrip.appOrigin" src/RoadTripMap/wwwroot/js/mapUI.js` → 1 result.
- `node --check src/RoadTripMap/wwwroot/js/mapUI.js` — expect no output.
- `npm test` — full suite green.

**Commit:** `fix(mapUI): use RoadTrip.appOrigin for sharePhoto (unblocks iOS sharing)`
<!-- END_TASK_9 -->

<!-- START_TASK_10 -->
### Task 10: Exhaustive audit — no remaining `window.location.origin` shareable-URL sites

**Verifies:** ios-shell-hardening.AC3.5.

**Files:** none (inspection task; produces a commit only if a new site is found that the investigator missed).

**Procedure:**

1. Run `grep -rn 'window.location.origin' src/RoadTripMap/wwwroot/js/` and inspect every hit. Expected result after Tasks 8 and 9: zero hits remain. If the grep returns any hit, classify it:
   - Class A (shareable-URL assembly intended for user copy/share/display) → migrate to `RoadTrip.appOrigin()` in this task. Add a test case in `tests/js/roadTrip.test.js` or a module-specific test file that exercises the call site.
   - Class B (internal navigation, comparison, URL parsing) → leave unchanged; record a one-line comment above the line explaining why it stays (e.g., `// same-origin comparison, not user-facing`).
2. Run `grep -rn 'window.location.href' src/RoadTripMap/wwwroot/js/` and repeat the classification. Investigator reported no Class A hits here; the grep is a belt-and-suspenders check.
3. Produce a short summary in the commit body: which grep hits were reviewed, how each was classified, and (if any) which new Class A hits were migrated.

**Verification:**
- `grep -rn 'window.location.origin' src/RoadTripMap/wwwroot/js/` returns only Class B hits (or zero).
- `npm test` — full suite green.

**Commit:** `audit(wwwroot): verify no remaining shareable-URL window.location.origin sites` (only commit if grep or classification notes warrant — if already clean, a documented inspection summary is not committed).
<!-- END_TASK_10 -->

<!-- END_SUBCOMPONENT_D -->

---

## Phase 2 done checklist

- [ ] `src/RoadTripMap/wwwroot/js/roadTrip.js` exists, idempotent, exposes `appOrigin`, `isNativePlatform`, `onPageLoad`.
- [ ] `src/RoadTripMap/wwwroot/js/offlineError.js` exists, exposes `isOfflineError`, `friendlyMessage`.
- [ ] `tests/js/roadTrip.test.js` — all 9 tests green.
- [ ] `tests/js/offlineError.test.js` — all 6 tests green.
- [ ] All 4 wwwroot HTML pages load `roadTrip.js` first in `<head>` and have `data-page` on `<body>`.
- [ ] `postUI.js` has no raw `DOMContentLoaded` listener; init runs through `RoadTrip.onPageLoad('post', ...)`.
- [ ] `versionProtocol.js` has no raw `DOMContentLoaded` listener; init runs through `RoadTrip.onPageLoad('*', ...)`.
- [ ] Both shareable-URL `window.location.origin` sites migrated to `RoadTrip.appOrigin()`.
- [ ] Grep `grep -rn 'DOMContentLoaded' src/RoadTripMap/wwwroot/js/` returns 0 matches.
- [ ] Grep `grep -rn 'window.location.origin' src/RoadTripMap/wwwroot/js/` returns 0 matches (or only Class B, documented).
- [ ] `npm test` is green end-to-end.
- [ ] All tasks committed on `ios-offline-shell`.
- [ ] Do not merge Phase 2 alone — Phase 3 must land immediately after to eliminate `app:page-load` handler accumulation.
