# iOS Offline Shell — Phase 4: Click + form intercept

**Goal:** Turbo-style delegated `click` and `submit` handlers on `document`, plus a `popstate` handler on `window`, that route internal navigation through `FetchAndSwap.fetchAndSwap` while letting external URLs and special cases (modifier keys, middle-click, opt-outs, hash-only) pass through. Plus a small modification to the existing `create.html` inline script so the create-trip flow stays inside the iOS shell.

**Architecture:** IIFE module at `src/bootstrap/intercept.js` installing `globalThis.Intercept = { installIntercept }`. The classifier resolves anchor URLs via `anchor.href` (which honors `<base href>` to give an absolute URL), compares origin against the App Service base, and applies exclusion rules (modifier keys, middle-click, `target="_blank"`, `data-no-shell="true"`, hash-only, exotic form methods, external origins). Internal clicks `event.preventDefault()` then `history.pushState` then `fetchAndSwap`. Form GET serializes fields to a query string and routes through cachedFetch. Form POST bypasses cache and uses raw `fetch()` followed by a `_swapFromHtml` extracted from the Phase 3 `fetchAndSwap` body. `popstate` re-fetches the current URL via `fetchAndSwap` without a fresh `pushState`. `installIntercept` is idempotent.

**Tech Stack:** Vanilla JS (ES2020), browser DOM events, `history.pushState`/`popstate`, `FormData`/`URLSearchParams`. Tests via vitest + jsdom.

**Scope:** Phase 4 of 8 from the iOS Offline Shell design.

**Codebase verified:** 2026-04-19.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ios-offline-shell.AC1: Server pages render and behave inside the iOS shell
- **ios-offline-shell.AC1.2 Success:** Clicking an internal `<a href>` triggers fetch+swap; new page renders without full WebView reload.
- **ios-offline-shell.AC1.5 Failure:** Click on a link to an external origin is NOT intercepted; passes through to native handling.
- **ios-offline-shell.AC1.6 Edge:** Click with Cmd/Ctrl/Shift/Alt held, or middle-click, is NOT intercepted.

(Strengthens DoD #1 "no cross-origin WebView nav" via Task 5's create.html modification, which closes the only remaining cross-origin nav path in the existing app.)

---

## Codebase findings

- ✓ Internal `<a>` patterns: static (`/`, `/create`) and dynamic (`/post/{secretToken}` via `card.href = trip.postUrl` in [index.html:42-48](../../../src/RoadTripMap/wwwroot/index.html#L42-L48)).
- ✓ External `<a>`: `https://github.com/psford` (footer), `mailto:patrick@psford.com`. No `<a target="_blank">` or `data-no-shell` anywhere.
- ✓ Only one form: [create.html:24-47](../../../src/RoadTripMap/wwwroot/create.html#L24-L47), JS-orchestrated (`e.preventDefault()` + `fetch()`); no native form submit happens in production today.
- ⚠️ **Critical gap fixed by Task 5**: After successful create, [create.html:79](../../../src/RoadTripMap/wwwroot/create.html#L79) does `window.location.href = result.postUrl`. This is a full WebView navigation that delegated listeners cannot intercept — in the iOS shell it would navigate WebView to `capacitor://localhost/post/{token}`, exiting the shell. Task 5 modifies the inline script to prefer `FetchAndSwap.fetchAndSwap` when available.
- ✓ No existing `history.pushState` / `popstate` / document-level click+submit delegation. Phase 4 introduces them with no collision risk.
- ✓ External hosts to exclude: `unpkg.com`, `api.maptiler.com`, `github.com`, plus special schemes (`mailto:`, `tel:`, `data:`, `blob:`).
- ✓ jsdom supports `MouseEvent`, `event.preventDefault()`, `history.pushState`. `popstate` firing on `history.back()` is sometimes delayed in jsdom — tests dispatch `new PopStateEvent('popstate')` manually for reliability.
- ✓ `anchor.href` (property) returns the resolved absolute URL when `<base href>` is present. The classifier uses `new URL(anchor.href).origin` for comparison.

**External dependency findings:** N/A — covered by Phase 3's research (Hotwire/Turbo intercept pattern, WHATWG event semantics).

**Skills to activate at execution:** `ed3d-house-style:howto-functional-vs-imperative`, `ed3d-house-style:writing-good-tests`, `ed3d-plan-and-execute:test-driven-development`, `ed3d-plan-and-execute:verification-before-completion`.

## Module contract

```js
globalThis.Intercept = { installIntercept, _internals: {...}, APP_BASE };

function installIntercept() {
    // Idempotent. Attaches:
    //   document.addEventListener('click', _onClick, { capture: false });
    //   document.addEventListener('submit', _onSubmit, { capture: false });
    //   window.addEventListener('popstate', _onPopState);
    // Internal click → event.preventDefault(); history.pushState({}, '', resolvedUrl); FetchAndSwap.fetchAndSwap(resolvedUrl).
    // External / modifier-key / middle-click / target=_blank / data-no-shell / hash-only → pass through.
    // Form GET → preventDefault; serialize FormData to query string; pushState; fetchAndSwap(url+'?'+qs).
    // Form POST → preventDefault; raw fetch (bypass cache); FetchAndSwap._swapFromHtml(html, url).
    // popstate → fetchAndSwap(window.location.pathname + window.location.search) WITHOUT pushState.
}
```

`fetchAndSwap.js` is amended to expose `_swapFromHtml(html, url)` (the parse + swap + lifecycle + markOpened body, extracted from Phase 3's `fetchAndSwap`). `fetchAndSwap` is implemented in terms of `_swapFromHtml` — semantically identical to Phase 3.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Classifier helpers + intercept.js skeleton

**Verifies:** `ios-offline-shell.AC1.5`, `ios-offline-shell.AC1.6`.

**Files:**
- Create: `src/bootstrap/intercept.js`
- Create: `tests/js/intercept.test.js`

**Implementation:**

`src/bootstrap/intercept.js` — IIFE installing `globalThis.Intercept`. Initial scope: pure classifier helpers + skeleton `installIntercept` that attaches no-op listeners (filled in by Tasks 2-4).

```js
(function () {
    const APP_BASE = 'https://app-roadtripmap-prod.azurewebsites.net';

    function _isModifiedClick(event) {
        return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    }

    function _isMiddleClick(event) {
        return event.button !== 0;
    }

    function _isOptedOut(element) {
        return element.closest('[data-no-shell="true"]') !== null;
    }

    function _isExternalUrl(url) {
        try {
            return new URL(url, APP_BASE).origin !== APP_BASE;
        } catch {
            return true;  // Malformed → treat as external (let native handle).
        }
    }

    function _isHashOnlyNav(url) {
        try {
            const target = new URL(url, window.location.href);
            const current = new URL(window.location.href);
            return target.pathname === current.pathname
                && target.search === current.search
                && target.hash !== current.hash;
        } catch {
            return false;
        }
    }

    function _classifyClick(event) {
        if (_isModifiedClick(event)) return { intercept: false, reason: 'modifier-key' };
        if (_isMiddleClick(event)) return { intercept: false, reason: 'non-primary-button' };
        const anchor = event.target.closest('a[href]');
        if (!anchor) return { intercept: false, reason: 'no-anchor' };
        if (anchor.target === '_blank') return { intercept: false, reason: 'target-blank' };
        if (_isOptedOut(anchor)) return { intercept: false, reason: 'data-no-shell' };
        const href = anchor.href;
        if (_isExternalUrl(href)) return { intercept: false, reason: 'external' };
        if (_isHashOnlyNav(href)) return { intercept: false, reason: 'hash-only' };
        const u = new URL(href);
        const url = u.pathname + u.search + u.hash;
        return { intercept: true, url };
    }

    function _classifySubmit(event) {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return { intercept: false, reason: 'not-form' };
        if (_isOptedOut(form)) return { intercept: false, reason: 'data-no-shell' };
        const method = (form.method || 'get').toLowerCase();
        if (method !== 'get' && method !== 'post') return { intercept: false, reason: 'exotic-method' };
        const action = form.action || window.location.href;
        if (_isExternalUrl(action)) return { intercept: false, reason: 'external' };
        const u = new URL(action, APP_BASE);
        return { intercept: true, method, url: u.pathname + u.search, form };
    }

    function installIntercept() {
        if (installIntercept._installed) return;
        installIntercept._installed = true;
        document.addEventListener('click', _onClick, { capture: false });   // Filled by Task 2
        document.addEventListener('submit', _onSubmit, { capture: false }); // Filled by Task 3
        window.addEventListener('popstate', _onPopState);                   // Filled by Task 4
    }

    function _onClick(_event) { /* Task 2 */ }
    function _onSubmit(_event) { /* Task 3 */ }
    function _onPopState(_event) { /* Task 4 */ }

    globalThis.Intercept = {
        installIntercept,
        _internals: { _classifyClick, _classifySubmit, _isExternalUrl, _isHashOnlyNav, _isOptedOut, _isModifiedClick, _isMiddleClick },
        APP_BASE
    };
})();
```

Test scaffold for `tests/js/intercept.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/intercept.js'), 'utf8');

beforeEach(() => {
    delete globalThis.Intercept;
    eval(SRC);
    document.head.innerHTML = '<base href="https://app-roadtripmap-prod.azurewebsites.net/">';
    document.body.innerHTML = '';
});

afterEach(() => { vi.restoreAllMocks(); });
```

Tests required:

**`describe('_isExternalUrl')`:**
- AC1.5: `https://github.com/psford` → true.
- AC1.5: `mailto:foo@bar.com` → true.
- AC1.5: `tel:+15551234567` → true.
- `https://app-roadtripmap-prod.azurewebsites.net/post/abc` → false.
- `/post/abc` → false.
- `not a url` → true.

**`describe('_classifyClick')`:**
- Internal anchor + plain primary click → `{intercept: true, url: '/post/abc'}`.
- Internal anchor + `metaKey: true` → `{intercept: false, reason: 'modifier-key'}` (AC1.6).
- Internal anchor + `button: 1` → `{intercept: false, reason: 'non-primary-button'}` (AC1.6).
- External anchor → `{intercept: false, reason: 'external'}` (AC1.5).
- `target="_blank"` anchor → `{intercept: false, reason: 'target-blank'}`.
- `data-no-shell="true"` anchor → `{intercept: false, reason: 'data-no-shell'}`.
- Click on a `<span>` inside an internal anchor (event.target is span; closest('a') finds it) → `{intercept: true, url: '/post/abc'}`.
- Click on a `<button>` (no anchor in tree) → `{intercept: false, reason: 'no-anchor'}`.
- `<a href="#section">` clicked while pathname matches → `{intercept: false, reason: 'hash-only'}`.

**`describe('_classifySubmit')`:**
- `<form action="/api/x" method="post">` → `{intercept: true, method: 'post', url: '/api/x', form}`.
- `<form action="/search" method="get">` → `{intercept: true, method: 'get', url: '/search', form}`.
- `<form method="put">` → `{intercept: false, reason: 'exotic-method'}`.
- External action → `{intercept: false, reason: 'external'}`.
- `data-no-shell="true"` form → `{intercept: false, reason: 'data-no-shell'}`.
- Form with no `action` (defaults to current URL) → classified as internal.

**`describe('installIntercept')`:**
- Calling twice: spy on `document.addEventListener`; click listener attached exactly once.

**Verification:**
- `node --check src/bootstrap/intercept.js`.
- `npm test -- intercept` — passes.

**Commit:** `feat(ios-offline-shell): intercept classifier helpers + skeleton`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Click intercept handler + history.pushState

**Verifies:** `ios-offline-shell.AC1.2`.

**Files:**
- Modify: `src/bootstrap/intercept.js` — replace the `_onClick` no-op with the real handler.
- Modify: `tests/js/intercept.test.js` — add `describe('click handler')`.

**Implementation:**

```js
function _onClick(event) {
    const result = _classifyClick(event);
    if (!result.intercept) return;
    if (typeof FetchAndSwap === 'undefined' || typeof FetchAndSwap.fetchAndSwap !== 'function') {
        return;  // Defensive: if FetchAndSwap isn't loaded yet, fall through to native nav.
    }
    event.preventDefault();
    history.pushState({}, '', result.url);
    FetchAndSwap.fetchAndSwap(result.url).catch((err) => {
        // Phase 5's loader-level error handler renders fallback.html when needed.
        console.error('Intercept: fetchAndSwap failed for', result.url, err);
    });
}
```

Test additions:

```js
beforeEach(() => {
    globalThis.FetchAndSwap = { fetchAndSwap: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(history, 'pushState');
});
```

- **AC1.2 — internal click triggers fetchAndSwap and pushState**:
  - `document.body.innerHTML = '<a id="x" href="/post/abc">x</a>';`
  - `Intercept.installIntercept();`
  - Dispatch `new MouseEvent('click', {bubbles: true, cancelable: true, button: 0})` on `#x`.
  - `expect(FetchAndSwap.fetchAndSwap).toHaveBeenCalledWith('/post/abc');`
  - `expect(history.pushState).toHaveBeenCalledWith({}, '', '/post/abc');`

- **`event.preventDefault()` was called for internal clicks**:
  - Construct the click event explicitly, dispatch via `target.dispatchEvent(evt)`, assert `evt.defaultPrevented === true`.

- **AC1.5 — external click NOT intercepted** (end-to-end):
  - `<a href="https://github.com/psford">x</a>`.
  - Dispatch click. `expect(FetchAndSwap.fetchAndSwap).not.toHaveBeenCalled();` `evt.defaultPrevented === false`.

- **AC1.6 — modifier-key click NOT intercepted** (end-to-end):
  - Internal anchor with `metaKey: true`. `expect(FetchAndSwap.fetchAndSwap).not.toHaveBeenCalled();`

- **AC1.6 — middle-click NOT intercepted** (end-to-end):
  - Internal anchor with `button: 1`. `expect(FetchAndSwap.fetchAndSwap).not.toHaveBeenCalled();`

- **`data-no-shell` opt-out NOT intercepted**.

- **Click on nested element bubbles to anchor and is intercepted**:
  - `<a href="/post/abc"><span id="inner">x</span></a>`.
  - Dispatch click on `#inner`. `expect(FetchAndSwap.fetchAndSwap).toHaveBeenCalledWith('/post/abc');`

- **`fetchAndSwap` rejection is logged but doesn't throw to event loop**:
  - `FetchAndSwap.fetchAndSwap = vi.fn().mockRejectedValue(new Error('boom'));`
  - `vi.spyOn(console, 'error');`
  - Click internal anchor. `await new Promise(r => setTimeout(r, 0));` `expect(console.error).toHaveBeenCalled();`.

- **FetchAndSwap missing → falls through (no preventDefault)**:
  - `delete globalThis.FetchAndSwap;`
  - Click internal anchor. `evt.defaultPrevented === false`.

**Verification:**
- `npm test -- intercept` — passes.
- `npm test` — full suite passes.

**Commit:** `feat(ios-offline-shell): intercept click handler + history.pushState`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Form intercept handler + `_swapFromHtml` extraction

**Verifies:** None new (form intercept is future-proofing per design; strengthens DoD #1).

**Files:**
- Modify: `src/bootstrap/fetchAndSwap.js` — extract the parse+swap body into `_swapFromHtml(html, url)` exposed as `FetchAndSwap._swapFromHtml`. `fetchAndSwap` becomes thin: `cachedFetch → response.text() → _swapFromHtml`.
- Modify: `src/bootstrap/intercept.js` — replace `_onSubmit` no-op with real handler.
- Modify: `tests/js/intercept.test.js` — add `describe('submit handler')`.
- Modify: `tests/js/fetchAndSwap.test.js` — add a test that `_swapFromHtml(html, url)` works directly (used by intercept POST path).

**Implementation:**

In `fetchAndSwap.js`:

```js
async function _swapFromHtml(html, url) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    if (!parsed.head.querySelector('base[href]')) {
        const base = parsed.createElement('base');
        base.setAttribute('href', APP_BASE);
        parsed.head.insertBefore(base, parsed.head.firstChild);
    }
    const scriptsInOrder = Array.from(parsed.querySelectorAll('script'));
    scriptsInOrder.forEach((s) => s.remove());
    document.head.innerHTML = parsed.head.innerHTML;
    document.body.innerHTML = parsed.body.innerHTML;
    await _recreateScripts(scriptsInOrder, document.body);
    document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
    window.dispatchEvent(new Event('load'));
    if (typeof TripStorage !== 'undefined' && typeof TripStorage.markOpened === 'function') {
        try { TripStorage.markOpened(url); } catch { /* swallow */ }
    }
}

async function fetchAndSwap(url, options = {}) {
    if (typeof CachedFetch === 'undefined' || typeof CachedFetch.cachedFetch !== 'function') {
        throw new Error('fetchAndSwap: CachedFetch is not loaded');
    }
    const { response } = await CachedFetch.cachedFetch(url, options);
    if (!response.ok) {
        throw new Error(`fetchAndSwap: HTTP ${response.status} for ${url}`);
    }
    const html = await response.text();
    await _swapFromHtml(html, url);
}

globalThis.FetchAndSwap = { fetchAndSwap, _swapFromHtml, _APP_BASE: APP_BASE };
```

In `intercept.js`:

```js
async function _onSubmit(event) {
    const result = _classifySubmit(event);
    if (!result.intercept) return;
    if (typeof FetchAndSwap === 'undefined' || typeof FetchAndSwap.fetchAndSwap !== 'function') return;
    event.preventDefault();
    if (result.method === 'get') {
        const fd = new FormData(result.form);
        const params = new URLSearchParams();
        for (const [k, v] of fd.entries()) {
            if (typeof v === 'string') params.append(k, v);
        }
        const fullUrl = result.url + (params.toString() ? '?' + params.toString() : '');
        history.pushState({}, '', fullUrl);
        FetchAndSwap.fetchAndSwap(fullUrl).catch((err) => {
            console.error('Intercept: GET form fetchAndSwap failed for', fullUrl, err);
        });
    } else {
        // POST: bypass cache. Raw fetch + _swapFromHtml.
        try {
            const response = await fetch(result.url, {
                method: 'POST',
                body: new FormData(result.form)
            });
            if (!response.ok) throw new Error(`POST ${result.url} returned ${response.status}`);
            const html = await response.text();
            history.pushState({}, '', result.url);
            await FetchAndSwap._swapFromHtml(html, result.url);
        } catch (err) {
            console.error('Intercept: POST form failed for', result.url, err);
        }
    }
}
```

Tests for `intercept.test.js`:

- **GET form serializes fields and calls fetchAndSwap**:
  - `<form id="f" action="/search" method="get"><input name="q" value="hello"><input name="x" value="1"></form>`.
  - `Intercept.installIntercept(); document.querySelector('#f').dispatchEvent(new SubmitEvent('submit', {bubbles: true, cancelable: true}));`
  - `expect(FetchAndSwap.fetchAndSwap).toHaveBeenCalledWith('/search?q=hello&x=1');`
  - `evt.defaultPrevented === true`.

- **POST form calls raw fetch + `_swapFromHtml`** (NOT cachedFetch):
  - `globalThis.fetch = vi.fn().mockResolvedValue(new Response('<html><body>posted</body></html>', { status: 200 }));`
  - `globalThis.FetchAndSwap = { fetchAndSwap: vi.fn(), _swapFromHtml: vi.fn().mockResolvedValue(undefined) };`
  - DOM: `<form id="f" action="/api/something" method="post"><input name="x" value="y"></form>`.
  - Submit. Await microtasks.
  - `expect(globalThis.fetch).toHaveBeenCalledWith('/api/something', expect.objectContaining({ method: 'POST' }));`
  - `expect(FetchAndSwap._swapFromHtml).toHaveBeenCalledWith('<html><body>posted</body></html>', '/api/something');`
  - `expect(FetchAndSwap.fetchAndSwap).not.toHaveBeenCalled();`

- **External form action not intercepted**:
  - `<form action="https://example.com/x" method="post">`. Submit. `expect(globalThis.fetch).not.toHaveBeenCalled();`

- **Exotic method (`method="put"`) not intercepted**:
  - `<form action="/x" method="put">`. Submit. `evt.defaultPrevented === false`.

- **POST failure logs but doesn't throw**:
  - `globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'));` Submit. Await microtasks. `expect(console.error).toHaveBeenCalled();`

Test for `fetchAndSwap.test.js`:

- **`_swapFromHtml` works without going through cachedFetch**:
  - `await FetchAndSwap._swapFromHtml('<html><head><title>X</title></head><body><h1>Hi</h1></body></html>', '/post/abc');`
  - `document.body.querySelector('h1').textContent === 'Hi'`. `document.head.querySelector('base[href]')` is non-null. (And if TripStorage is loaded with a saved trip at `/post/abc`, `lastOpenedAt` is set.)

**Verification:**
- `npm test -- intercept fetchAndSwap` — both pass.
- `npm test` — full suite passes.

**Commit:** `feat(ios-offline-shell): intercept submit handler (GET + POST) + _swapFromHtml extraction`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

<!-- START_TASK_4 -->
### Task 4: `popstate` handler + idempotency confirmation

**Verifies:** None new.

**Files:**
- Modify: `src/bootstrap/intercept.js` — replace `_onPopState` no-op with real handler.
- Modify: `tests/js/intercept.test.js` — add `describe('popstate')`.

**Implementation:**

```js
function _onPopState(_event) {
    if (typeof FetchAndSwap === 'undefined' || typeof FetchAndSwap.fetchAndSwap !== 'function') return;
    const url = window.location.pathname + window.location.search;
    // Do NOT pushState here — the browser's history already moved.
    FetchAndSwap.fetchAndSwap(url).catch((err) => {
        console.error('Intercept: popstate fetchAndSwap failed for', url, err);
    });
}
```

Tests:

- **popstate triggers fetchAndSwap with current URL**:
  - `history.pushState({}, '', '/post/abc');`
  - Dispatch `new PopStateEvent('popstate')` on window. (Manual dispatch — jsdom popstate firing on history.back() can be flaky.)
  - `expect(FetchAndSwap.fetchAndSwap).toHaveBeenCalledWith('/post/abc');`

- **popstate does NOT call pushState (avoid double-history-entry)**:
  - Dispatch popstate manually. `expect(history.pushState).not.toHaveBeenCalled();`

- **popstate handles fetchAndSwap rejection silently**:
  - `FetchAndSwap.fetchAndSwap = vi.fn().mockRejectedValue(new Error('offline'));`
  - Dispatch popstate. Await microtask. `expect(console.error).toHaveBeenCalled();` No throw.

- **installIntercept idempotency confirmed end-to-end**:
  - Spy on `document.addEventListener` and `window.addEventListener`.
  - Call `installIntercept()` 3 times. Each event type registered exactly once.

**Verification:**
- `npm test -- intercept` — passes.
- `npm test` — full suite passes.

**Commit:** `feat(ios-offline-shell): intercept popstate handler + idempotent install`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Modify `create.html` to keep create-trip flow inside the iOS shell

**Verifies:** None new (closes a hidden gap in DoD #1 "no cross-origin WebView nav"). Strengthens AC1.2's "all internal navigation is intercepted in JS" intent.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/create.html` — change [line ~79](../../../src/RoadTripMap/wwwroot/create.html#L79) `window.location.href = result.postUrl;` to prefer `FetchAndSwap.fetchAndSwap` when available.

**Implementation:**

The current inline script block (around [create.html:54-87](../../../src/RoadTripMap/wwwroot/create.html#L54-L87)) ends with:

```js
const result = await API.createTrip(name, description || null);
TripStorage.saveTrip(name, result.postUrl, result.viewUrl || '');
window.location.href = result.postUrl;
```

Change the last line to:

```js
TripStorage.saveTrip(name, result.postUrl, result.viewUrl || '');
if (typeof FetchAndSwap !== 'undefined' && typeof FetchAndSwap.fetchAndSwap === 'function') {
    history.pushState({}, '', result.postUrl);
    FetchAndSwap.fetchAndSwap(result.postUrl);
} else {
    window.location.href = result.postUrl;
}
```

Why this is safe:
- **Regular browser** (no iOS shell loaded): `FetchAndSwap` is `undefined` → existing `window.location.href` fallback runs. Zero behavior change.
- **iOS shell** (Phase 5's loader has installed `FetchAndSwap`): the create flow stays inside the shell.
- The `history.pushState` mirrors what Phase 4's intercept does for `<a>` clicks, keeping back-button behavior consistent.

**Verification (BOTH steps required — create.html ships to all web users, not just the iOS shell):**

**Step 1 — Automated regression test (required).**

Create `tests/js/create-flow.test.js` (or add to an existing test file if one already covers create.html). Extract the inline submit handler logic into a testable function — easiest pattern is to read the inline `<script>` body from `create.html` via `fs.readFileSync` + a regex (matching the bootstrap-loader test pattern), eval it after stubbing `globalThis.API.createTrip` and `globalThis.TripStorage.saveTrip`, then dispatch a synthetic `submit` on a constructed form. Assert both branches:

- **Browser branch (FetchAndSwap undefined):** Stub `Object.defineProperty(window.location, 'href', { configurable: true, set: vi.fn() })` then submit. Assert `globalThis.FetchAndSwap` is undefined (precondition) and the `href` setter was called with `result.postUrl`. Restore the property after the test.
- **Shell branch:** Set `globalThis.FetchAndSwap = { fetchAndSwap: vi.fn().mockResolvedValue(undefined) };`. Submit. Assert `FetchAndSwap.fetchAndSwap` was called with `result.postUrl` and `window.location.href` setter was NOT called.

If extracting the inline handler is too awkward, refactor it into a small importable function `_handleCreateSubmit(API, TripStorage, FetchAndSwap, formEl)` exported on `globalThis` from a new `wwwroot/js/createFlow.js` (added to setup.js's loader list). The inline script in create.html becomes a 2-line caller. This is more invasive but yields a clean unit test.

**Step 2 — Local browser smoke (required, not optional).**

```bash
dotnet run --project src/RoadTripMap
```

In a regular browser (Chrome / Safari) at `http://localhost:5100/create`:
1. Fill in a trip name, submit.
2. Confirm the browser redirects to `/post/{token}` (the regular-browser fallback path runs since `FetchAndSwap` is not loaded outside the iOS shell).
3. Confirm the new trip is saved to localStorage (DevTools → Application → Local Storage → `roadtripmap_trips` key).

If the redirect fails or the trip isn't saved, the conditional broke the regular-browser flow. Revert + investigate.

**Verification command:**
```bash
git diff src/RoadTripMap/wwwroot/create.html
# Expected: ~4 added lines (the if/else), 1 removed line (the bare assignment).
```

(Phase 7's on-device matrix re-verifies the shell branch end-to-end.)

**Commit:** `feat(ios-offline-shell): create-trip flow uses FetchAndSwap when in iOS shell`
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->
