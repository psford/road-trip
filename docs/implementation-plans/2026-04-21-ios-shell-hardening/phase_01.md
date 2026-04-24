# iOS Shell Hardening — Phase 1: Listener shim + event rename

**Goal:** Install a tracked-listener shim in the iOS shell and replace the synthetic `DOMContentLoaded` + `window.load` dispatch with a custom `app:page-load` event. Shell-side lifecycle primitives in place so Phase 2 can migrate page scripts onto them.

**Architecture:** A new `src/bootstrap/listenerShim.js` IIFE wraps `document.addEventListener` / `removeEventListener`, tracking only `DOMContentLoaded` and `load` registrations against `document`. `ListenerShim.clearPageLifecycleListeners()` bulk-removes every tracked handler via the real (un-wrapped) `removeEventListener`. `src/bootstrap/fetchAndSwap.js:_swapFromHtml` calls `ListenerShim.clearPageLifecycleListeners()` before dispatching a new `app:page-load` CustomEvent. The synthetic `document.dispatchEvent(new Event('DOMContentLoaded'))` and `window.dispatchEvent(new Event('load'))` calls are removed.

**Tech Stack:** Vanilla JS IIFE modules; vitest + jsdom for tests; no new dependencies.

**Scope:** Phase 1 of 8 from `docs/design-plans/2026-04-21-ios-shell-hardening.md`.

**Codebase verified:** 2026-04-22 (branch `ios-offline-shell`).

**Branch:** `ios-offline-shell` (already checked out — all Phase 1 commits land on this branch per the design).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ios-shell-hardening.AC2: No stale-handler listener cascade (shim + event subgroup only)

- **ios-shell-hardening.AC2.shim.1 Success:** `ListenerShim.install()` wraps `document.addEventListener` / `removeEventListener`; tracks `DOMContentLoaded` and `load` only.
- **ios-shell-hardening.AC2.shim.2 Success:** `ListenerShim.clearPageLifecycleListeners()` removes every tracked handler via the real `removeEventListener` and clears the internal tracking map.
- **ios-shell-hardening.AC2.shim.3 Failure:** Non-lifecycle events (`click`, `submit`, `change`, etc.) pass through untracked and are never cleared by the shim.
- **ios-shell-hardening.AC2.shim.4 Edge:** Listeners added to targets other than `document` (e.g. `window.addEventListener`) are not tracked.
- **ios-shell-hardening.AC2.event.1 Success:** `fetchAndSwap` dispatches `app:page-load` (not synthetic `DOMContentLoaded`) after every swap, after the shim clear.

The page-side `RoadTrip.onPageLoad` scope cases (AC2.scope.1–4) are implemented in Phase 2 and are explicitly NOT in Phase 1's scope.

---

## Codebase baseline (verified 2026-04-22)

- `src/bootstrap/fetchAndSwap.js` is 85 lines. The IIFE exposes `globalThis.FetchAndSwap = { fetchAndSwap, _swapFromHtml, _APP_BASE }`. Inside `_swapFromHtml`, lines 61–62 dispatch the synthetic events that must be replaced:
  ```javascript
  document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
  window.dispatchEvent(new Event('load'));
  ```
  These are the only synthetic dispatch sites. The file does not currently reference `ListenerShim`.
- `src/bootstrap/index.html` loads shell modules via 5 `<script defer>` tags in this order: `cachedFetch.js`, `tripStorage.js`, `fetchAndSwap.js`, `intercept.js`, `loader.js` (lines 7–11).
- `src/bootstrap/listenerShim.js` does not exist.
- `tests/js/fetchAndSwap.test.js` (430 lines) has two tests under a `describe('lifecycle events')` block at lines 372–413 that currently assert the DOMContentLoaded + load dispatch. These must be rewritten to assert `app:page-load` dispatch and the `clearPageLifecycleListeners` call order.
- Test harness: vitest + jsdom; tests read shell source with `fs.readFileSync` and `eval()` inside `setupTest()` (see `tests/js/fetchAndSwap.test.js:7–9,66–69`). `document.dispatchEvent` and `window.dispatchEvent` are spied (`vi.spyOn(...).mockImplementation(() => true)`) before the module is eval'd so listeners don't side-effect the test. See `tests/js/setup.js:1–112` for globals (fake-indexeddb/auto, wwwroot module preload, per-test DOM/mocks cleanup).
- Shell module convention (confirmed in `cachedFetch.js`, `fetchAndSwap.js`, `intercept.js`): IIFE wrapping, expose `globalThis.ModuleName = { publicAPI..., _internals: { testHelpers } }`. The `_internals` object is the sanctioned escape hatch for tests.
- CLAUDE.md states: "JS tests do not run in CI. Run `npm test` locally before pushing any change to `src/RoadTripMap/wwwroot/js/*`, `src/bootstrap/*`, or `scripts/build-bundle.js`." Every task that changes shell code in this phase must end with a local `npm test` run.

---

## Known temporary state between Phase 1 and Phase 2

After Phase 1 lands, `DOMContentLoaded` handlers registered by `postUI.js`, `versionProtocol.js`, etc. will no longer fire after an iOS-shell swap (the synthetic dispatch is gone). Those page scripts are migrated to `RoadTrip.onPageLoad(...)` in Phase 2. Regular browsers are unaffected (real `DOMContentLoaded` still fires on full page loads). All unit tests continue to pass because tests target the shell's dispatch behavior, not the downstream handlers. Do NOT ship `ios-offline-shell` between Phase 1 and Phase 2.

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

### Subcomponent A — `ListenerShim` module and load-order wiring

Delivers the new shell primitive and ensures it loads before anything else in the shell could register lifecycle listeners.

<!-- START_TASK_1 -->
### Task 1: Implement `src/bootstrap/listenerShim.js`

**Verifies:** ios-shell-hardening.AC2.shim.1, ios-shell-hardening.AC2.shim.3, ios-shell-hardening.AC2.shim.4 (implementation; tests added in Task 2).

**Files:**
- Create: `src/bootstrap/listenerShim.js`

**Implementation contract:**

File is a single IIFE in the existing shell-module convention (same shape as `src/bootstrap/intercept.js`). The IIFE:

1. Declares module-scoped state:
   - `const TRACKED_EVENTS = new Set(['DOMContentLoaded', 'load']);` — the only event types the shim tracks.
   - `const tracked = new Map();` — keys are event-type strings (`'DOMContentLoaded'` | `'load'`); values are `Set` instances holding `{ handler, options }` records for each registered listener. Using a Set (not an array) ensures the same `(handler, options)` pair is stored once per type.
   - `let installed = false;`
   - `let _originalAdd = null;` and `let _originalRemove = null;` — captured bindings of the real `document.addEventListener` / `document.removeEventListener` (captured at install time).

2. `install()`:
   - Idempotent — returns early if `installed === true`.
   - Captures `_originalAdd = document.addEventListener.bind(document);` and `_originalRemove = document.removeEventListener.bind(document);` BEFORE overwriting.
   - Overwrites `document.addEventListener` with a wrapper that:
     - For every call where `type` is in `TRACKED_EVENTS`, adds `{ handler, options }` to `tracked.get(type)` (creating the inner Set on first use).
     - Always delegates to `_originalAdd(type, handler, options)` (tracked or not) so the listener still works normally.
   - Overwrites `document.removeEventListener` with a wrapper that:
     - For every call where `type` is in `TRACKED_EVENTS` and `tracked.has(type)`, finds the first entry in `tracked.get(type)` whose `entry.handler === handler` and removes it from the Set.
     - Always delegates to `_originalRemove(type, handler, options)`.
   - Sets `installed = true;`.

3. `clearPageLifecycleListeners()`:
   - No-op if `installed === false`.
   - Iterates every `[type, entries]` pair in `tracked`. For each entry in `entries`, calls `_originalRemove(type, entry.handler, entry.options)` — this bypasses the wrapper so the internal tracking map doesn't double-shrink during iteration.
   - After iterating a type's Set, calls `entries.clear()` to empty the internal map.

4. Exposes the module:
   ```javascript
   globalThis.ListenerShim = {
       install,
       clearPageLifecycleListeners,
       _internals: {
           TRACKED_EVENTS,
           _tracked: tracked,
           _isInstalled: () => installed,
       },
   };
   ```

5. Auto-invokes `install()` at the end of the IIFE (so callers don't have to). This is safe because `install()` is idempotent — tests can still call it explicitly to exercise AC2.shim.1.

**Non-goals:**
- Do NOT track `addEventListener` calls on `window`, `Element`, or any target other than `document` (AC2.shim.4).
- Do NOT track any event type outside `TRACKED_EVENTS` (AC2.shim.3). Non-lifecycle events must pass through completely untracked.
- Do NOT dispatch any events from this module — dispatch is `fetchAndSwap`'s responsibility (Subcomponent B).

**Verification:**
- Run `node --check src/bootstrap/listenerShim.js` — expect no output (syntax valid).

**Commit:** `feat(ios-shell): add ListenerShim for page-lifecycle handler tracking`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tests for `ListenerShim`

**Verifies:** ios-shell-hardening.AC2.shim.1, ios-shell-hardening.AC2.shim.2, ios-shell-hardening.AC2.shim.3, ios-shell-hardening.AC2.shim.4.

**Files:**
- Create: `tests/js/listenerShim.test.js` (unit).

**Test harness notes (follow these exactly):**
- Match the eval-from-source pattern used in `tests/js/cachedFetch.test.js` and `tests/js/intercept.test.js`. Read the source once at the top of the test file via `fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/listenerShim.js'), 'utf8')`.
- **Cache the jsdom originals ONCE at module load, before any test runs:**
  ```javascript
  const JSDOM_ADD = document.addEventListener;
  const JSDOM_REMOVE = document.removeEventListener;
  ```
- In `beforeEach`: restore `document.addEventListener = JSDOM_ADD; document.removeEventListener = JSDOM_REMOVE;` FIRST, then `delete globalThis.ListenerShim;`. Do NOT eval the source here — let each test eval it when needed, so tests that want to assert the pre-install state can do so.
- In `afterEach`: restore `document.addEventListener = JSDOM_ADD; document.removeEventListener = JSDOM_REMOVE;`, then `vi.restoreAllMocks()` and `delete globalThis.ListenerShim;`. This prevents wrapper leakage between tests.
- Because the IIFE at the bottom of `listenerShim.js` auto-invokes `install()`, eval'ing the source inside a test immediately wraps `document.addEventListener`. Tests that assert the pre-install state simply skip the eval; tests that assert wrapped behavior eval at the top.

**Tests required (follow project idioms — one `describe` per AC case):**

1. **AC2.shim.1 — `install()` wraps document.addEventListener / removeEventListener; tracks DOMContentLoaded and load only.**
   - Before any eval: assert `document.addEventListener === JSDOM_ADD` (confirms clean starting state per the `beforeEach` restore).
   - `eval(SOURCE);` (module IIFE auto-invokes `install()`).
   - Assert `document.addEventListener !== JSDOM_ADD` and `document.removeEventListener !== JSDOM_REMOVE` — wrappers are in place.
   - Assert `ListenerShim._internals._isInstalled() === true`.
   - Register a `DOMContentLoaded` handler on `document`; assert `ListenerShim._internals._tracked.get('DOMContentLoaded')` contains exactly one entry whose `handler` reference matches.
   - Register a `load` handler on `document`; assert the `'load'` tracking bucket contains it.
   - Call `ListenerShim.install()` a second time explicitly; assert `document.addEventListener` reference unchanged (same wrapper), and `_tracked` bucket sizes unchanged — idempotent.

2. **AC2.shim.2 — `clearPageLifecycleListeners()` removes every tracked handler and clears the map.**
   - Register 3 distinct `DOMContentLoaded` handlers and 2 distinct `load` handlers on `document`. Attach spies to each so you can detect whether they fire.
   - Call `ListenerShim.clearPageLifecycleListeners()`.
   - Dispatch a real `new Event('DOMContentLoaded')` and a real `new Event('load')` to `document`. Assert none of the 5 spies fire.
   - Assert `ListenerShim._internals._tracked.get('DOMContentLoaded').size === 0` and `_tracked.get('load').size === 0` (or the buckets were removed; either is acceptable — assert the union).

3. **AC2.shim.3 — Non-lifecycle events pass through untracked.**
   - Register handlers on `document` for `'click'`, `'submit'`, `'change'`, `'keydown'`. Attach spies.
   - Dispatch real events of each type. Assert every spy fires exactly once (the wrapper delegates to the real `addEventListener`).
   - Assert `ListenerShim._internals._tracked.has('click') === false` (and same for the other three) — non-tracked events create no map entry.
   - Call `clearPageLifecycleListeners()`; re-dispatch the same non-lifecycle events. Assert the spies fire again (non-lifecycle handlers are untouched by the clear).

4. **AC2.shim.4 — Listeners on targets other than `document` are not tracked.**
   - Register a `DOMContentLoaded` handler on `window` (NOT `document`). Attach a spy.
   - Register a `load` handler on `window`. Attach a spy.
   - Register a `DOMContentLoaded` handler on a freshly-created `HTMLDivElement`. Attach a spy.
   - Assert `ListenerShim._internals._tracked.get('DOMContentLoaded')` has no entries for the window or div handlers (size is 0 or bucket absent).
   - Call `clearPageLifecycleListeners()`. Dispatch real `DOMContentLoaded` on `window` and on the div. Assert both spies still fire (the clear did not touch window/element listeners).

**Verification:**
- Run `npx vitest run tests/js/listenerShim.test.js` — expect all tests green.
- Run `npm test` — full suite must still be green (the auto-install affects other tests' `document.addEventListener` only when `listenerShim.js` has been eval'd in that test file's scope, which it hasn't been elsewhere yet).

**Commit:** `test(ios-shell): cover ListenerShim install/clear/passthrough/target-scope`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire `listenerShim.js` into `src/bootstrap/index.html`

**Verifies:** Operational only — no new AC case. Supports all AC2.shim.* cases at runtime.

**Files:**
- Modify: `src/bootstrap/index.html:7` (insert new `<script>` tag immediately AFTER `cachedFetch.js` line, BEFORE `tripStorage.js` line).

**Change:**

The current block at lines 7–11:
```html
  <script src="cachedFetch.js" defer></script>
  <script src="tripStorage.js" defer></script>
  <script src="fetchAndSwap.js" defer></script>
  <script src="intercept.js" defer></script>
  <script src="loader.js" defer></script>
```

Becomes:
```html
  <script src="cachedFetch.js" defer></script>
  <script src="listenerShim.js" defer></script>
  <script src="tripStorage.js" defer></script>
  <script src="fetchAndSwap.js" defer></script>
  <script src="intercept.js" defer></script>
  <script src="loader.js" defer></script>
```

**Why this position:** `listenerShim.js` must run before any other shell module so that `document.addEventListener` is already wrapped if some later module registers a lifecycle listener during its own init. `cachedFetch.js` is kept first because it has no lifecycle-event dependency and is the lowest-level data primitive.

**Verification:**
- Confirm the file has exactly 6 `<script defer>` tags in the order above.
- Run `npm test` — full suite must still be green (this change doesn't affect jsdom tests, which load modules via `fs.readFileSync` + `eval`, not the shell HTML).

**Commit:** `chore(ios-shell): load listenerShim.js before other shell modules`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

### Subcomponent B — `fetchAndSwap` event rename

Replaces the synthetic `DOMContentLoaded` + `load` dispatch with `app:page-load`, preceded by a `ListenerShim.clearPageLifecycleListeners()` call.

<!-- START_TASK_4 -->
### Task 4: Update `_swapFromHtml` to call `ListenerShim.clearPageLifecycleListeners()` and dispatch `app:page-load`

**Verifies:** ios-shell-hardening.AC2.event.1 (implementation; test updates in Task 5).

**Files:**
- Modify: `src/bootstrap/fetchAndSwap.js:55–63` (the block after script recreation, before `TripStorage.markOpened`).

**Current code (lines 55–68):**
```javascript
    await _recreateScripts(scriptsInOrder, document.body);

    // Task 4: Synthetic DOMContentLoaded for handlers attached during script execution.
    // Scripts that self-init via document.readyState === 'complete' have already run;
    // this dispatch covers handlers like postUI.js that listen unconditionally.
    document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
    window.dispatchEvent(new Event('load'));

    // AC2.3: notify TripStorage that a saved-trip URL was opened.
    // Defensive: TripStorage may not be loaded; markOpened may throw on storage error.
    if (typeof TripStorage !== 'undefined' && typeof TripStorage.markOpened === 'function') {
        try { TripStorage.markOpened(url); } catch { /* never block render on storage */ }
    }
```

**Target code (replaces lines 57–62 — keep lines 55–56 and lines 64–68 unchanged):**
```javascript
    await _recreateScripts(scriptsInOrder, document.body);

    // Clear lifecycle handlers accumulated from prior swaps BEFORE dispatching the
    // new page-load event, so a stale handler does not fire on the new page body.
    // ListenerShim is loaded earlier in src/bootstrap/index.html.
    if (globalThis.ListenerShim && typeof globalThis.ListenerShim.clearPageLifecycleListeners === 'function') {
        globalThis.ListenerShim.clearPageLifecycleListeners();
    }

    // Custom page-load event (replaces synthetic DOMContentLoaded + window.load).
    // Page scripts register via RoadTrip.onPageLoad(...) in Phase 2.
    document.dispatchEvent(new Event('app:page-load', { bubbles: true, cancelable: true }));

    // AC2.3: notify TripStorage that a saved-trip URL was opened.
    // Defensive: TripStorage may not be loaded; markOpened may throw on storage error.
    if (typeof TripStorage !== 'undefined' && typeof TripStorage.markOpened === 'function') {
        try { TripStorage.markOpened(url); } catch { /* never block render on storage */ }
    }
```

**Required properties of the new dispatch (verified in Task 5's tests):**
- Order: `ListenerShim.clearPageLifecycleListeners()` is called strictly before `document.dispatchEvent(...app:page-load...)`. If `ListenerShim` is absent, the guard skips the clear silently — this keeps Phase 1 testable in jsdom harnesses that may not load `listenerShim.js`, and preserves a degraded-but-functional shell if a future refactor removes the module.
- Event shape: plain `Event` (not `CustomEvent`); `bubbles: true`, `cancelable: true`; type `'app:page-load'`.
- `window.load` dispatch is gone — no replacement.

**Non-goals:**
- Do NOT change `_recreateScripts` (that's Phase 3).
- Do NOT migrate any page script's `DOMContentLoaded` handler (that's Phase 2).
- Do NOT export any new symbol from `FetchAndSwap` — the public surface is unchanged.

**Verification:**
- Run `node --check src/bootstrap/fetchAndSwap.js` — expect no output.

**Commit:** `feat(ios-shell): swap synthetic DOMContentLoaded+load for app:page-load; clear tracked handlers before dispatch`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Update `tests/js/fetchAndSwap.test.js` to cover the new dispatch

**Verifies:** ios-shell-hardening.AC2.event.1.

**Files:**
- Modify: `tests/js/fetchAndSwap.test.js` (the existing `describe('lifecycle events')` block spanning roughly lines 372–413, plus `setupTest()` around lines 25–30 and 65–69).

**Setup changes (in `setupTest()`):**
- Load `listenerShim.js` source once at file top: `const LISTENER_SHIM_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/listenerShim.js'), 'utf8');`.
- Inside `setupTest()`: BEFORE `eval(FETCH_AND_SWAP_SRC)`, add `delete globalThis.ListenerShim;` and `eval(LISTENER_SHIM_SRC);` so `fetchAndSwap`'s `globalThis.ListenerShim` guard sees a real module during tests.
- The existing spies on `document.dispatchEvent` and `window.dispatchEvent` (lines 25–30) stay — update their expected values in the rewritten tests below.
- In `teardownTest()`: add `delete globalThis.ListenerShim;`.

**Replace existing tests with these cases (drop the `'dispatches DOMContentLoaded after script recreation'` and `'dispatches load on window after DOMContentLoaded on document'` tests):**

1. **AC2.event.1 (positive) — dispatches `app:page-load` on `document` after a swap.**
   - Arrange: load `listenerShim.js` + `fetchAndSwap.js`. Prepare an HTML string with a trivial body.
   - Act: `await globalThis.FetchAndSwap._swapFromHtml(html, 'https://app-roadtripmap-prod.azurewebsites.net/trips/abc');`.
   - Assert: `document.dispatchEvent` was called with an `Event` whose `.type === 'app:page-load'`.

2. **AC2.event.1 (negative) — does NOT dispatch synthetic `DOMContentLoaded` or `window.load`.**
   - Same swap as test 1.
   - Assert: no `document.dispatchEvent` call has `.type === 'DOMContentLoaded'`. No `window.dispatchEvent` call occurred at all (the call count on the window spy is 0).

3. **AC2.event.1 (ordering) — `clearPageLifecycleListeners` is called before `app:page-load` is dispatched.**
   - Before the swap, install a `vi.spyOn(globalThis.ListenerShim, 'clearPageLifecycleListeners')`.
   - Run the swap.
   - Assert: the spy's `invocationCallOrder[0]` is less than the `document.dispatchEvent` spy's `invocationCallOrder` for the `app:page-load` call.

4. **Regression — `ListenerShim` absent path.**
   - Before running the swap, `delete globalThis.ListenerShim;` (simulates the module failing to load).
   - Run the swap. Assert no throw, and `document.dispatchEvent` still received one `app:page-load` event.

**Verification:**
- Run `npx vitest run tests/js/fetchAndSwap.test.js` — all tests green, including the 4 above and every prior non-lifecycle test.
- Run `npm test` — full suite green. CLAUDE.md invariant: JS tests do not run in CI, so `npm test` locally is the gate.

**Commit:** `test(ios-shell): assert app:page-load dispatch + clear ordering, drop DOMContentLoaded/load assertions`
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

---

## Phase 1 done checklist

- [ ] `src/bootstrap/listenerShim.js` exists, passes `node --check`, exposes `install`, `clearPageLifecycleListeners`, and `_internals`.
- [ ] `tests/js/listenerShim.test.js` exists and all 4 AC-case tests pass.
- [ ] `src/bootstrap/index.html` loads `listenerShim.js` between `cachedFetch.js` and `tripStorage.js`.
- [ ] `src/bootstrap/fetchAndSwap.js:_swapFromHtml` calls `ListenerShim.clearPageLifecycleListeners()` and dispatches `app:page-load`. The `DOMContentLoaded` and `window.load` dispatch lines are gone.
- [ ] `tests/js/fetchAndSwap.test.js` asserts `app:page-load` dispatch + clear ordering + ListenerShim-absent fallback.
- [ ] `npm test` is green end-to-end.
- [ ] All 5 tasks committed on the `ios-offline-shell` branch with the commit messages above.
- [ ] Do not merge Phase 1 alone — ship it only after Phase 2 migrates page scripts onto `RoadTrip.onPageLoad`.
