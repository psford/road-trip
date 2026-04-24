# iOS Shell Hardening — Phase 4: Offline create copy

**Goal:** Replace the raw error message surfaced by the create-trip form's catch block (today `error.message || 'Failed to create trip'`, which on iOS surfaces the WebKit-native string `"Load failed"` when offline) with a friendly, context-aware string produced by `OfflineError.friendlyMessage(err, 'create')`.

**Architecture:** Two small edits to `src/RoadTripMap/wwwroot/create.html` — load `offlineError.js` after `roadTrip.js`, and swap one line in the existing catch block. Update `tests/js/create-flow.test.js` to exercise the offline-submit path against the real `OfflineError` module.

**Tech Stack:** Vanilla JS + HTML; vitest + jsdom; no new dependencies.

**Scope:** Phase 4 of 8 from `docs/design-plans/2026-04-21-ios-shell-hardening.md`.

**Codebase verified:** 2026-04-22 (branch `ios-offline-shell`).

**Branch:** `ios-offline-shell` (same as Phases 1–3).

**Dependencies:** Phase 2 (`src/RoadTripMap/wwwroot/js/offlineError.js` exists and is tested; `create.html` has `data-page="create"` and loads `roadTrip.js` first in head).

---

## Acceptance Criteria Coverage

### ios-shell-hardening.AC4: Friendly offline message on create

- **ios-shell-hardening.AC4.3 Success:** Offline submit on `/create` shows `"Can't create a trip while offline. Try again when you're back online."` (final copy — matches the string defined in `offlineError.js` for the `'create'` context).

(AC4.1, AC4.2, AC4.4 — the underlying classification behavior — are verified by Phase 2's `tests/js/offlineError.test.js`. Phase 4 proves the wiring into the create-form catch block.)

---

## Codebase baseline (verified 2026-04-22)

- `src/RoadTripMap/wwwroot/create.html:3–9` is the current `<head>` block. Post-Phase-2, it contains (in order): meta charset, meta viewport, meta robots, `<script src="/js/roadTrip.js"></script>` (first, added by Phase 2), `<title>`, `<link rel="stylesheet">`.
- `src/RoadTripMap/wwwroot/create.html:10` is `<body data-page="create">` (post-Phase-2).
- `src/RoadTripMap/wwwroot/create.html:20` contains `<div id="errorMessage" class="message error hidden"></div>` — the DOM target the catch block writes to.
- The submit-handler catch block spans roughly lines 89–95 (exact numbering may shift slightly by Phase 2's script addition — match by content, not line number, at execution time). Current body:
  ```javascript
  } catch (error) {
      errorEl.textContent = error.message || 'Failed to create trip';
      errorEl.classList.remove('hidden');
      const btn = document.getElementById('createButton');
      btn.disabled = false;
      btn.textContent = 'Create Trip';
  }
  ```
- `tests/js/create-flow.test.js` (154 lines today) already has two happy-path tests — one for the browser branch (no `FetchAndSwap`) and one for the iOS-shell branch (with `FetchAndSwap`). The test extracts the inline form-handler script from `create.html` via regex and eval's it into the test scope. No test currently exercises the catch path.
- No other wwwroot site surfaces a raw `'Load failed'` string for an offline scenario. `postUI.js:341, :777, :883` render `err.message` to toasts — these are Phase 5's domain (Phase 5 will migrate the photo-fetch catch path). Phase 4 leaves them unchanged.
- `src/RoadTripMap/wwwroot/js/offlineError.js` provides `OfflineError.friendlyMessage(err, 'create')`, which returns `"Can't create a trip while offline. Try again when you're back online."` when `OfflineError.isOfflineError(err) === true`, and falls through to `err.message || 'Something went wrong.'` otherwise.

---

## Tasks

<!-- START_TASK_1 -->
### Task 1: Load `offlineError.js` on `create.html`

**Verifies:** Operational precondition for AC4.3. No new AC by itself.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/create.html` — insert `<script src="/js/offlineError.js"></script>` immediately AFTER the `<script src="/js/roadTrip.js"></script>` tag added by Phase 2, still inside `<head>`.

**Change:**

The Phase-2 head block (post-Task-3 of Phase 2) contains, in order:
```html
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <script src="/js/roadTrip.js"></script>
    <title>Create a Road Trip - Road Trip Map</title>
    <link rel="stylesheet" href="/css/styles.css?v=4">
</head>
```

Target:
```html
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <script src="/js/roadTrip.js"></script>
    <script src="/js/offlineError.js"></script>
    <title>Create a Road Trip - Road Trip Map</title>
    <link rel="stylesheet" href="/css/styles.css?v=4">
</head>
```

**Why after `roadTrip.js`:** No dependency between the two modules exists today, but keeping wwwroot helpers together at the top of `<head>` is the convention this phase establishes. Synchronous `<script>` (not defer/async) ensures `OfflineError` is defined before the inline submit handler at the end of `<body>` runs.

**Verification:**
- `grep -n 'offlineError.js' src/RoadTripMap/wwwroot/create.html` → exactly 1 match.
- `grep -n 'roadTrip.js' src/RoadTripMap/wwwroot/create.html` → exactly 1 match (the Phase 2 tag, still present).

**Commit:** `chore(create): load offlineError.js for friendly offline copy`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Route the create-form catch block through `OfflineError.friendlyMessage`

**Verifies:** ios-shell-hardening.AC4.3 (implementation; test in Task 3).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/create.html` — the submit-handler catch block (currently ~line 90, one line change).

**Current code (the catch block, any exact line numbers match the current file):**
```javascript
} catch (error) {
    errorEl.textContent = error.message || 'Failed to create trip';
    errorEl.classList.remove('hidden');
    const btn = document.getElementById('createButton');
    btn.disabled = false;
    btn.textContent = 'Create Trip';
}
```

**Target code (same block, one line change):**
```javascript
} catch (error) {
    errorEl.textContent = OfflineError.friendlyMessage(error, 'create');
    errorEl.classList.remove('hidden');
    const btn = document.getElementById('createButton');
    btn.disabled = false;
    btn.textContent = 'Create Trip';
}
```

**Why this preserves non-offline behavior:** `OfflineError.friendlyMessage(error, 'create')` returns `error.message || 'Something went wrong.'` when `isOfflineError` is false — so a 400-validation error with `error.message === 'Trip name required'` still renders `'Trip name required'`, matching the current contract for non-offline failures. Only offline-classified errors get swapped for the friendly copy.

**Non-goals:**
- Do NOT change any other part of the submit handler (the success path, the button-disable logic, the `errorEl.classList.remove('hidden')` call, etc.).
- Do NOT rewrap the error. `OfflineError.friendlyMessage` is read-only.
- Do NOT fall back to `'Failed to create trip'` as a secondary default — `OfflineError.friendlyMessage` already handles both null errors and missing messages.

**Verification:**
- Manual inspection — the catch block now calls `OfflineError.friendlyMessage(error, 'create')`.
- Full suite covered in Task 3.

**Commit:** `fix(create): show friendly offline copy via OfflineError.friendlyMessage`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Extend `tests/js/create-flow.test.js` to cover the offline-submit path

**Verifies:** ios-shell-hardening.AC4.3 (end-to-end: DOM shows the exact friendly string on an offline submit).

**Files:**
- Modify: `tests/js/create-flow.test.js` — add a new `describe('offline submit', ...)` block (or append to the existing top-level describe) after the two existing happy-path tests.
- Modify: the setup of the file so the new tests also have `RoadTrip` and `OfflineError` installed in `globalThis`.

**Test harness notes:**
- At the top of the file, add source loads for the two new modules (next to the existing `fs.readFileSync` calls):
  ```javascript
  const ROAD_TRIP_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/roadTrip.js'), 'utf8');
  const OFFLINE_ERROR_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/offlineError.js'), 'utf8');
  ```
- Inside `beforeEach`: `delete globalThis.RoadTrip;` and `delete globalThis.OfflineError;` BEFORE eval'ing the inline handler; then `eval(ROAD_TRIP_SRC); eval(OFFLINE_ERROR_SRC);` BEFORE eval'ing the create-form inline script.
- Set `document.body.dataset.page = 'create'` before eval (if not already done for the existing tests) — inline handler + roadTrip onPageLoad expect it.
- In `afterEach`: `delete globalThis.OfflineError; delete globalThis.RoadTrip;` to prevent leak between tests.

**Tests required:**

1. **AC4.3 (offline: TypeError path) — renders the friendly copy.**
   - Arrange: stub `globalThis.API = { createTrip: vi.fn().mockRejectedValue(new TypeError('Load failed')) };` (or whatever global the existing test stubs). Keep `navigator.onLine` unchanged — `TypeError` is sufficient to classify as offline (AC4.1).
   - Act: fill the form fields (match the existing happy-path test's form setup), dispatch `submit` on the form, await microtasks.
   - Assert: `document.getElementById('errorMessage').textContent === "Can't create a trip while offline. Try again when you're back online."`.
   - Assert: `document.getElementById('errorMessage').classList.contains('hidden') === false`.
   - Assert: the create button is re-enabled with text `'Create Trip'`.

2. **AC4.3 (offline: navigator.onLine === false path) — renders the friendly copy regardless of error shape.**
   - Arrange: `Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });` stub `globalThis.API.createTrip = vi.fn().mockRejectedValue(new Error('Any non-TypeError'))`.
   - Act: submit the form.
   - Assert: `errorMessage` textContent is the friendly `"Can't create a trip while offline..."` string (because `isOfflineError` returns true based on `navigator.onLine === false`).
   - Restore `navigator.onLine` to `true` (default) in `afterEach`.

3. **Regression — non-offline validation error still shows its original message.**
   - Arrange: stub `globalThis.API.createTrip = vi.fn().mockRejectedValue(Object.assign(new Error('Trip name required'), { name: 'ValidationError', status: 400 }));`. `navigator.onLine === true`.
   - Act: submit the form.
   - Assert: `errorMessage` textContent is `'Trip name required'` (NOT the offline copy).

4. **Regression — existing happy-path tests still pass.**
   - The two pre-existing tests ("Browser branch success" and "Shell branch success") must continue to pass with the new setup/teardown that loads `roadTrip.js` + `offlineError.js` first. If either regresses, adjust the setup so these new module loads are idempotent — the happy-path tests should not have their DOM/error state affected.
   - **Scope risk note:** if the existing test file uses a shared top-level `beforeEach` rather than per-`describe` setups, the module loads described above will apply to every test in the file (happy-path and offline). Both should tolerate them (the modules are idempotent), but if you discover a test-isolation issue — e.g., `RoadTrip._firedOnce` carrying across tests — scope the new loads to a nested `describe('offline submit', ...)` block so the happy-path setup is untouched. Prefer isolation over sharing if in doubt.

**Verification:**
- Run `npx vitest run tests/js/create-flow.test.js` — all tests green (the 2 existing + 3 new).
- Run `npm test` — full suite green.

**Commit:** `test(create): cover offline-submit friendly copy + validation-error passthrough`
<!-- END_TASK_3 -->

---

## Phase 4 done checklist

- [ ] `src/RoadTripMap/wwwroot/create.html` loads `offlineError.js` immediately after `roadTrip.js` in `<head>`.
- [ ] `src/RoadTripMap/wwwroot/create.html` catch block uses `OfflineError.friendlyMessage(error, 'create')` for the error render.
- [ ] `tests/js/create-flow.test.js` has 3 new tests covering offline-TypeError, navigator.onLine=false, and non-offline-validation passthrough.
- [ ] All pre-existing happy-path tests in `tests/js/create-flow.test.js` still pass.
- [ ] `npm test` green end-to-end.
- [ ] All 3 tasks committed on `ios-offline-shell`.
- [ ] On-device verification (airplane-mode submit on iPhone shows the friendly copy) recorded in Phase 8's smoke checklist.
