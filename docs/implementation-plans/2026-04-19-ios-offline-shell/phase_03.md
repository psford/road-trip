# iOS Offline Shell — Phase 3: `fetchAndSwap` engine

**Goal:** A single `fetchAndSwap(url, options)` function that fetches a URL via `cachedFetch`, parses the HTML, swaps the live document's content in place, recreates `<script>` tags so they execute, fires synthetic lifecycle events, and notifies `TripStorage.markOpened`. Includes an on-device spike up front to validate script re-execution in real iOS WebKit before building the rest.

**Architecture:** IIFE module at `src/bootstrap/fetchAndSwap.js` installing `globalThis.FetchAndSwap = { fetchAndSwap }`. Calls `CachedFetch.cachedFetch(url, options)` from Phase 1, parses with `DOMParser`, injects `<base href>` so relative URLs resolve to the App Service, swaps `document.head` and `document.body` content (with scripts stripped to avoid inert duplicates), recreates each script via `document.createElement('script')` with attributes copied (Turbo Drive's pattern, spec-mandated workaround for the WHATWG "already started" flag), awaits external script `load`/`error` sequentially, dispatches synthetic `DOMContentLoaded` then `load`, and finally calls `TripStorage.markOpened(url)` for AC2.3. The on-device spike (Task 1) is the load-bearing verification for AC1.3 because jsdom cannot execute external `<script src="https://...">` tags.

**Tech Stack:** Vanilla JS (ES2020), browser DOM (`DOMParser`, `document.createElement`, `appendChild`, dispatch). Tests via vitest 4 + jsdom + fake-indexeddb. iOS Simulator + Safari Web Inspector for the spike.

**Scope:** Phase 3 of 8 from the iOS Offline Shell design.

**Codebase verified:** 2026-04-19.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ios-offline-shell.AC1: Server pages render and behave inside the iOS shell
- **ios-offline-shell.AC1.1 Success:** First page (home or default trip) loads and renders in the iOS shell within 3s of launch when cached. *(Phase 3 builds the engine; the 3s budget is verified jointly with Phase 5's loader and Phase 7's on-device matrix.)*
- **ios-offline-shell.AC1.3 Success:** Scripts in the fetched page execute (e.g., `addPhotoButton` handler wires up; `MapUI.init` runs). *(Spike in Task 1 validates the technique on real WKWebView; jsdom tests verify the recreation mechanics.)*
- **ios-offline-shell.AC1.4 Success:** Relative URLs in fetched HTML (`<a href="/">`, `<form action="/api/...">`, `fetch('/api/...')`) resolve to the App Service origin via injected `<base href>`.

### ios-offline-shell.AC2: Saved-trips routing
- **ios-offline-shell.AC2.3 Success:** `fetchAndSwap` of a saved trip URL calls `TripStorage.markOpened(url)`, updating `lastOpenedAt`.

### ios-offline-shell.AC3: Aggressive offline-first cache
- **ios-offline-shell.AC3.4 Success:** Background revalidate with new content does NOT swap live DOM; cached version stays until next navigation. *(Verified by an isolation test in Task 5 that cross-checks Phase 1's contract.)*

---

## Codebase findings

- ✓ All 4 server pages ([index.html](../../../src/RoadTripMap/wwwroot/index.html), [post.html](../../../src/RoadTripMap/wwwroot/post.html), [trips.html](../../../src/RoadTripMap/wwwroot/trips.html), [create.html](../../../src/RoadTripMap/wwwroot/create.html)) use only relative URLs for assets. None contain a `<base href>` already — safe to inject.
- ✓ post.html has 25 sequential script tags (relative + 2 external CDN: MapLibre, exifr). trips.html has an inline `MapUI.init(viewToken)` AFTER its `/js/mapUI.js` script — the recreation loop must preserve source order.
- ✓ Only `postUI.js:1272-1284` registers a `DOMContentLoaded` listener unconditionally; `versionProtocol.js:124-131` checks `readyState` and self-inits. Most modules expose objects/functions only and are initialized by inline scripts.
- ✓ `MapUI.init` ([wwwroot/js/mapUI.js:33-49](../../../src/RoadTripMap/wwwroot/js/mapUI.js#L33-L49)) and the `addPhotoButton` click wiring ([wwwroot/js/postUI.js:31-33](../../../src/RoadTripMap/wwwroot/js/postUI.js#L31-L33), inside `PostUI.init`) are real init code that AC1.3 will validate.
- ✓ `DOMParser` and `Response` are available in jsdom.
- ✗ jsdom CANNOT execute scripts inserted via `appendChild` with external `src` (jsdom doesn't fetch remote scripts). Inline scripts MAY execute via `textContent` depending on jsdom version; we don't rely on this. The on-device spike + Phase 7 matrix are the load-bearing verifications for actual script execution.
- ✓ Capacitor sync workflow: `npm run build:bundle` (optional) → `npx cap sync ios` → open Xcode → run on Simulator. `capacitor.config.js` has `webDir: 'src/bootstrap'`.
- ✓ Module export style — IIFE installing a single global, matches `loader.js` and `cachedFetch.js`.

## Known limitations (not Phase 3 scope; documented for Phase 5 follow-up)

- **`window.location.origin` reads in fetched scripts.** Two known callers — [postUI.js:232](../../../src/RoadTripMap/wwwroot/js/postUI.js#L232) and [mapUI.js:190](../../../src/RoadTripMap/wwwroot/js/mapUI.js#L190) — read `window.location.origin` to construct share-link URLs. After document-swap on the iOS shell, `window.location.origin === 'capacitor://localhost'`, so the constructed share URLs will be wrong on iOS. `<base href>` injection does not affect runtime `window.location` reads. Phase 3's on-device spike will likely surface this. The fix lives in Phase 5 (the loader can install a `window.location` shim before `fetchAndSwap` runs) or as a follow-up. **Out of Phase 3 scope.**

## External research findings (Phase 3C)

- ✓ WHATWG HTML spec: cloned script elements inherit "already started" → won't execute on re-insertion. `document.createElement('script')` produces fresh elements with the flag clear, so appending them executes. Source: https://html.spec.whatwg.org/multipage/scripting.html#the-script-element
- ✓ Hotwire/Turbo Drive uses exactly this pattern in production (createElement + attribute copy + await load/error). Source: https://turbo.hotwired.dev/handbook/building
- ⚠️ WKWebView enforces CSP on dynamically-inserted external scripts more strictly than desktop browsers. The on-device spike must verify external CDN scripts (MapLibre, exifr) load.
- ⚠️ Synthetic `dispatchEvent(new Event('DOMContentLoaded'))` correctly fires currently-attached listeners. Scripts that self-init via `if (document.readyState === 'loading') ...` work without our dispatch (they auto-init on re-execution). Scripts that listen unconditionally (postUI.js) fire when we dispatch.

---

## Module contract

```js
globalThis.FetchAndSwap = { fetchAndSwap };

async function fetchAndSwap(url, options = {}) {
    // options: { asJson?: false (always false for HTML pages), signal?: AbortSignal }
    // 1. CachedFetch.cachedFetch(url, options) (Phase 1)
    // 2. response.text() — reject on non-OK status
    // 3. parse with DOMParser into a temp document
    // 4. inject <base href="https://app-roadtripmap-prod.azurewebsites.net/"> into temp head
    // 5. extract scripts in source order; remove them from the temp doc
    // 6. swap live document.head.innerHTML and document.body.innerHTML with the script-stripped temp
    // 7. recreate scripts via createElement, copy attrs, append in order; await load/error for src scripts
    // 8. dispatch synthetic DOMContentLoaded then load
    // 9. if (typeof TripStorage?.markOpened === 'function') call TripStorage.markOpened(url) inside try/catch
    // returns Promise<void>
}
```

---

<!-- START_TASK_1 -->
### Task 1: On-device spike — validate script re-execution in WKWebView

**Verifies:** None directly (de-risks the design's load-bearing assumption before the rest of the phase).

**Files (all temporary — DELETED at end of task except the result doc):**
- Create (temp): `src/bootstrap/spike-launcher.html`
- Create (temp): `src/bootstrap/spike-target.html`
- Modify temporarily: `src/bootstrap/index.html` (add a one-line meta-refresh redirect to spike-launcher.html for the duration of the spike) — restore at end of task.
- Create (kept): `docs/implementation-plans/2026-04-19-ios-offline-shell/phase-3-spike-result.md`

**Implementation:**

1. **`src/bootstrap/spike-launcher.html`** — minimal page with a "Run spike" button. The button handler runs an inline minimal fetchAndSwap (NOT the eventual Phase 3 module — just enough to validate the technique):

   ```html
   <!doctype html>
   <html>
   <head><meta charset="utf-8"><title>Spike</title></head>
   <body>
       <button id="run">Run spike</button>
       <pre id="result"></pre>
       <script>
       document.getElementById('run').addEventListener('click', async () => {
           const res = await fetch('spike-target.html');
           const text = await res.text();
           const doc = new DOMParser().parseFromString(text, 'text/html');
           const scripts = Array.from(doc.querySelectorAll('script'));
           scripts.forEach((s) => s.remove());
           document.body.innerHTML = doc.body.innerHTML;
           for (const old of scripts) {
               const fresh = document.createElement('script');
               for (const attr of old.attributes) fresh.setAttribute(attr.name, attr.value);
               if (old.src) {
                   await new Promise((resolve) => {
                       fresh.onload = resolve;
                       fresh.onerror = resolve;
                       document.body.appendChild(fresh);
                   });
               } else {
                   fresh.textContent = old.textContent;
                   document.body.appendChild(fresh);
               }
           }
           document.getElementById('result').textContent =
               'spikeRan=' + window.spikeRan +
               ' externalRan=' + window.externalRan;
       });
       </script>
   </body>
   </html>
   ```

2. **`src/bootstrap/spike-target.html`** — page being fetched. Contains both an inline script and an App Service-served absolute-URL script to validate both paths. Using an App Service file (instead of an unpkg.com CDN) keeps the spike deterministic and offline-safe regardless of CDN reachability:

   ```html
   <!doctype html>
   <html>
   <head><meta charset="utf-8"><title>Target</title></head>
   <body>
       <h1>Spike target</h1>
       <script>window.spikeRan = true;</script>
       <script src="https://app-roadtripmap-prod.azurewebsites.net/js/api.js"
               onload="window.externalRan = (typeof API !== 'undefined');"></script>
   </body>
   </html>
   ```

   Notes:
   - `/js/api.js` defines a top-level `const API = { ... }`; on successful execution `typeof API !== 'undefined'` (in the parent eval scope, since recreated `<script>` runs in document context).
   - The CORS policy `IosAppOrigin` already allows `capacitor://localhost` per `Program.cs`, so the cross-origin fetch returns the script.

3. **`src/bootstrap/index.html`** — temporarily add a meta-refresh redirect to spike-launcher (revert at end):
   ```html
   <meta http-equiv="refresh" content="0;url=spike-launcher.html">
   ```

4. **Run the spike**:
   ```bash
   npx cap sync ios
   open ios/App/App.xcodeproj
   # In Xcode: select an iPhone simulator (any iOS 18+ image), press Cmd+R.
   # In Safari (Mac): Develop → Simulator → [App page] to attach Web Inspector.
   ```

5. **Tap "Run spike"** in the simulator. In Web Inspector console, verify:
   ```js
   window.spikeRan          // → true       (inline script ran)
   window.externalRan       // → true       (external CDN script loaded + parsed; exifr defined)
   document.getElementById('result').textContent
                             // → "spikeRan=true externalRan=true"
   ```

6. **Document the result** in `docs/implementation-plans/2026-04-19-ios-offline-shell/phase-3-spike-result.md`. Include: iOS Simulator version (e.g., iPhone 15 / iOS 18.x), exact Web Inspector console output, screenshot. If either result is `false` / `undefined`, **STOP** and surface — the entire Phase 3 design needs revisiting (likely a CSP or Capacitor 8 limitation we missed).

7. **Revert all spike scaffolding**:
   ```bash
   git checkout -- src/bootstrap/index.html
   rm src/bootstrap/spike-launcher.html src/bootstrap/spike-target.html
   git status -s
   # Expected: only docs/implementation-plans/2026-04-19-ios-offline-shell/phase-3-spike-result.md is untracked
   ```

**Verification:**
- `phase-3-spike-result.md` exists with PASS results.
- No spike scaffolding files left: `ls src/bootstrap/spike-* 2>&1` returns "No such file".
- `git diff -- src/bootstrap/index.html` is empty.

**Commit:** `docs(ios-offline-shell): record Phase 3 on-device spike results`
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-4) -->

<!-- START_TASK_2 -->
### Task 2: `fetchAndSwap` skeleton — DOMParser + `<base href>` injection

**Verifies:** `ios-offline-shell.AC1.4` (relative URLs resolve via injected base href).

**Files:**
- Create: `src/bootstrap/fetchAndSwap.js`
- Create: `tests/js/fetchAndSwap.test.js`

**Implementation:**

`src/bootstrap/fetchAndSwap.js`:

```js
(function () {
    const APP_BASE = 'https://app-roadtripmap-prod.azurewebsites.net/';

    async function fetchAndSwap(url, options = {}) {
        if (typeof CachedFetch === 'undefined' || typeof CachedFetch.cachedFetch !== 'function') {
            throw new Error('fetchAndSwap: CachedFetch is not loaded');
        }
        const { response } = await CachedFetch.cachedFetch(url, options);
        if (!response.ok) {
            throw new Error(`fetchAndSwap: HTTP ${response.status} for ${url}`);
        }
        const html = await response.text();
        const parsed = new DOMParser().parseFromString(html, 'text/html');

        // Inject <base href> if not already present (AC1.4)
        if (!parsed.head.querySelector('base[href]')) {
            const base = parsed.createElement('base');
            base.setAttribute('href', APP_BASE);
            parsed.head.insertBefore(base, parsed.head.firstChild);
        }

        // Strip scripts from the parsed doc — they'd be inert if included via innerHTML
        // (parser-inserted + already-started). They're recreated in Task 3.
        const scriptsInOrder = Array.from(parsed.querySelectorAll('script'));
        scriptsInOrder.forEach((s) => s.remove());

        // Swap document content
        document.head.innerHTML = parsed.head.innerHTML;
        document.body.innerHTML = parsed.body.innerHTML;

        // Tasks 3 + 4 add: script recreation, lifecycle dispatch, markOpened hook.
    }

    globalThis.FetchAndSwap = { fetchAndSwap, _APP_BASE: APP_BASE };
})();
```

Test file `tests/js/fetchAndSwap.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHED_FETCH_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/cachedFetch.js'), 'utf8');
const FETCH_AND_SWAP_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/fetchAndSwap.js'), 'utf8');

beforeEach(async () => {
    delete globalThis.CachedFetch;
    delete globalThis.FetchAndSwap;
    await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('RoadTripPageCache');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    eval(CACHED_FETCH_SRC);
    eval(FETCH_AND_SWAP_SRC);
    document.head.innerHTML = '<title>shell</title>';
    document.body.innerHTML = '<div id="bootstrap-progress">Loading…</div>';
});

afterEach(() => {
    vi.restoreAllMocks();
});
```

Tests required:

- **AC1.4 — base href injected when missing**:
  - Mock `globalThis.fetch = vi.fn().mockResolvedValue(new Response('<!doctype html><html><head><title>T</title></head><body><a href="/api/x">link</a></body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))`.
  - `await FetchAndSwap.fetchAndSwap('/post/abc');`
  - `document.head.querySelector('base[href]').getAttribute('href')` equals `'https://app-roadtripmap-prod.azurewebsites.net/'`.
  - `document.body.querySelector('a').href` resolves to `'https://app-roadtripmap-prod.azurewebsites.net/api/x'` (jsdom honors `<base href>` for `a.href`).

- **AC1.4 — preserves an existing `<base href>`**:
  - Mock returns `<head><base href="https://example.com/"><title>T</title></head><body></body>`.
  - After swap, `document.head.querySelector('base[href]').href === 'https://example.com/'`.

- **swap replaces both head and body content**:
  - Mock returns `<head><meta name="x" content="y"></head><body><h1>Hello</h1></body>`.
  - `document.head.querySelector('meta[name="x"]')` is non-null; `document.body.querySelector('h1').textContent === 'Hello'`; the original `#bootstrap-progress` is gone.

- **non-OK response rejects**:
  - Mock returns `new Response('not found', { status: 404 })`.
  - `await expect(FetchAndSwap.fetchAndSwap('/post/abc')).rejects.toThrow(/HTTP 404/);`

- **CachedFetch missing throws clear error**:
  - `delete globalThis.CachedFetch;` then `eval(FETCH_AND_SWAP_SRC);`
  - `await expect(FetchAndSwap.fetchAndSwap('/post/abc')).rejects.toThrow(/CachedFetch is not loaded/);`

**Verification:**
- `node --check src/bootstrap/fetchAndSwap.js` passes.
- `npm test -- fetchAndSwap` — all tests pass.
- `npm test -- cachedFetch` — Phase 1 tests still pass.

**Commit:** `feat(ios-offline-shell): fetchAndSwap skeleton with DOMParser + base href`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Script-recreation helper

**Verifies:** `ios-offline-shell.AC1.3` (recreation mechanics — full execution validated by Task 1's spike + Phase 7 matrix).

**Files:**
- Modify: `src/bootstrap/fetchAndSwap.js` — add `_recreateScripts(scriptsInOrder, parentNode)` and call after the document swap.
- Modify: `tests/js/fetchAndSwap.test.js` — add `describe('script recreation')`.

**Implementation:**

Add to the IIFE:

```js
async function _recreateScripts(scriptsInOrder, parentNode) {
    for (const oldScript of scriptsInOrder) {
        const fresh = document.createElement('script');
        for (const attr of oldScript.attributes) {
            fresh.setAttribute(attr.name, attr.value);
        }
        if (oldScript.src) {
            // External script: await load or error before continuing (sequential).
            // jsdom won't fetch remote URLs, so onerror fires; that's fine for unit tests.
            // Real execution is verified by Task 1's spike + Phase 7's on-device matrix.
            await new Promise((resolve) => {
                fresh.onload = () => resolve();
                fresh.onerror = () => resolve();
                parentNode.appendChild(fresh);
            });
        } else {
            // Inline script: textContent set, append. Browsers execute synchronously on append.
            fresh.textContent = oldScript.textContent;
            parentNode.appendChild(fresh);
        }
    }
}
```

Wire into `fetchAndSwap`, after the innerHTML swap from Task 2:

```js
await _recreateScripts(scriptsInOrder, document.body);
```

Tests:

- **scripts are recreated with correct attributes**:
  - Mock fetch returns `<head><script src="/js/api.js"></script><script src="/js/mapUI.js" type="text/javascript"></script></head><body><script>window.inlineRan = true;</script></body>`.
  - `await FetchAndSwap.fetchAndSwap('/post/abc');`
  - `document.querySelectorAll('script').length === 3`.
  - First script: `getAttribute('src') === '/js/api.js'`, no `type` attribute.
  - Second script: `getAttribute('src') === '/js/mapUI.js'`, `getAttribute('type') === 'text/javascript'`.
  - Third script: no src, `textContent === 'window.inlineRan = true;'`.

- **script source order is preserved**:
  - Mock returns `<head><script src="/a.js"></script></head><body><div></div><script>window.x='body';</script></body>`.
  - Recreated scripts in `document.body` appear in the original source order (head's `/a.js` first, then body inline). Verify by index.

- **external script `load`/`error` is awaited**:
  - Mock fetch returns a head with one external script.
  - Wrap `document.createElement` to spy on the script element's `appendChild` time vs. `onload` resolution. Simpler: assert that `await FetchAndSwap.fetchAndSwap(...)` doesn't resolve until after `onload`/`onerror` fired (use a deferred promise + manual settle).

  Pragmatic alternative: stub `HTMLScriptElement.prototype` so any appended script's `onload` is invoked synchronously after a `setTimeout(0)`; assert the recreation loop iterated through all scripts in order (use `vi.fn()` listener attached during stub).

- **scripts are NOT duplicated by innerHTML**:
  - `document.querySelectorAll('script').length` matches the source script count after swap (innerHTML didn't include scripts because Task 2 stripped them from the parsed doc).

- **handles a page with zero scripts**:
  - Mock returns `<head></head><body><p>No scripts</p></body>`.
  - `await FetchAndSwap.fetchAndSwap('/x');` resolves cleanly. `document.querySelectorAll('script').length === 0`.

**Verification:**
- `npm test -- fetchAndSwap` — all tests pass.
- `npm test` — full suite passes.

**Commit:** `feat(ios-offline-shell): fetchAndSwap script recreation via createElement`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Synthetic lifecycle events + after-swap `markOpened` hook

**Verifies:** `ios-offline-shell.AC1.1` (engine ready — 3s budget verified jointly in Phase 5 + 7), `ios-offline-shell.AC1.3` (full chain — spike validates execution), `ios-offline-shell.AC2.3` (markOpened called).

**Files:**
- Modify: `src/bootstrap/fetchAndSwap.js` — add lifecycle event dispatch + `TripStorage.markOpened` hook.
- Modify: `tests/js/fetchAndSwap.test.js` — add `describe('lifecycle + markOpened')`.

**Implementation:**

Append to `fetchAndSwap` after `_recreateScripts`:

```js
// Synthetic DOMContentLoaded for handlers attached during script execution.
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

Tests:

The test file's `beforeEach` should ensure `TripStorage` is available. If Phase 2's Task 1 already added `tripStorage.js` to `tests/js/setup.js`, no additional load is needed (verify at execution). Otherwise, eval `tripStorage.js` in beforeEach with the same `globalThis.X` rewrite as setup.js does.

Tests required:

- **DOMContentLoaded fires after script recreation**:
  - `const handler = vi.fn(); document.addEventListener('DOMContentLoaded', handler);`
  - Mock fetch returns minimal HTML.
  - `await FetchAndSwap.fetchAndSwap('/post/abc');`
  - `expect(handler).toHaveBeenCalledTimes(1)`.

- **load fires after DOMContentLoaded**:
  - Track invocation order via two `vi.fn()` listeners. After fetchAndSwap, `loadHandler.mock.invocationCallOrder[0] > domHandler.mock.invocationCallOrder[0]`.

- **AC2.3: `TripStorage.markOpened(url)` updates lastOpenedAt**:
  - `TripStorage.saveTrip('A', '/post/abc', '/trips/aaa');`
  - `await FetchAndSwap.fetchAndSwap('/post/abc');`
  - `typeof TripStorage.getTrips()[0].lastOpenedAt === 'number'`.

- **AC2.3: markOpened called even for URL not in storage (no-op match)**:
  - No pre-save. `await FetchAndSwap.fetchAndSwap('/post/never-saved');` resolves cleanly (markOpened returns false silently).

- **TripStorage absent → fetchAndSwap still resolves**:
  - `delete globalThis.TripStorage;` then mock fetch + `await FetchAndSwap.fetchAndSwap('/post/abc');` resolves.

- **markOpened that throws does not propagate**:
  - `globalThis.TripStorage = { markOpened: () => { throw new Error('boom'); } };`
  - `await expect(FetchAndSwap.fetchAndSwap('/post/abc')).resolves.toBeUndefined();`

**Verification:**
- `npm test -- fetchAndSwap` — all tests pass.
- `npm test` — full suite passes.

```bash
# Confirm Phase 3 didn't touch out-of-scope files
git diff --stat src/RoadTripMap/wwwroot/js/uploadTransport.js src/RoadTripMap/wwwroot/js/mapCache.js
# Expected: empty (AC4.4 + AC4.5 will be re-verified at Phase 5)
```

**Commit:** `feat(ios-offline-shell): fetchAndSwap lifecycle events + TripStorage.markOpened hook`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_5 -->
### Task 5: AC3.4 — background revalidate isolation test

**Verifies:** `ios-offline-shell.AC3.4` (background revalidate with new content does NOT swap live DOM; cached version stays until next navigation).

**Files:**
- Modify: `tests/js/cachedFetch.test.js` (preferred — single integration-style test that exercises Phase 1 + the document state Phase 3 cares about).

**Implementation:**

The test asserts that calling `cachedFetch` on a cached URL while a background revalidate fires does NOT mutate `document.body` or `document.head`. Phase 1's contract enforces this by construction (cachedFetch never calls fetchAndSwap in revalidate). This task just adds the cross-module proof.

```js
describe('AC3.4: background revalidate does not swap live DOM', () => {
    it('cached page renders via cachedFetch only — live document is untouched', async () => {
        // Pre-seed cache with old HTML
        await CachedFetch._internals._putRecord('pages', '/post/abc', {
            html: '<html><body>old</body></html>',
            etag: 'W/"v1"',
            lastModified: null,
            cachedAt: 1
        });

        // Set a recognizable live document state
        document.head.innerHTML = '<title>shell</title>';
        document.body.innerHTML = '<div id="bootstrap-progress">Loading…</div>';
        const headBefore = document.head.innerHTML;
        const bodyBefore = document.body.innerHTML;

        // Mock fetch so the background revalidate returns NEW content
        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response('<html><body>new</body></html>', { status: 200, headers: { 'ETag': 'W/"v2"' } })
        );

        // Trigger cachedFetch (cache hit triggers fire-and-forget revalidate)
        const result = await CachedFetch.cachedFetch('/post/abc');
        expect(result.source).toBe('cache');

        // Flush microtasks so the background revalidate completes
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));

        // The IDB record IS updated (Phase 1 AC3.3)
        const after = await CachedFetch._internals._getRecord('pages', '/post/abc');
        expect(after.html).toBe('<html><body>new</body></html>');

        // BUT the live document remains untouched (AC3.4)
        expect(document.head.innerHTML).toBe(headBefore);
        expect(document.body.innerHTML).toBe(bodyBefore);
    });
});
```

**Verification:**
- `npm test -- cachedFetch` — passes.
- `npm test` — full suite passes.

**Commit:** `test(ios-offline-shell): AC3.4 background revalidate leaves live DOM unchanged`
<!-- END_TASK_5 -->
