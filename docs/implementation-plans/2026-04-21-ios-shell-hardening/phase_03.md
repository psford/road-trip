# iOS Shell Hardening — Phase 3: Script-src tracking (eliminates the duplicate-`const` cascade)

**Goal:** Eliminate the duplicate-`const` cascade on iOS-shell cross-page navigation by deduplicating external-script re-execution. Verify the post-failure cascade from Issue #7 resolves as a side effect. Mitigate one design-assumption discrepancy the investigator discovered: two `wwwroot/*.html` pages currently declare top-level `const` identifiers in INLINE scripts, which the script-src dedup does not cover (inline scripts always re-execute per design).

**Architecture:** Add a module-scoped `Set<string>` named `_executedScriptSrcs` to `src/bootstrap/fetchAndSwap.js`. Inside `_recreateScripts`, absolutize each external script's `src` via `new URL(src, APP_BASE).href` (wrapped in try/catch for safety), check the Set before recreation, skip recreation if present, and add to the Set only on successful `onload` (not `onerror`). Expose the Set on `globalThis.FetchAndSwap._executedScriptSrcs` for test inspection. Inline scripts retain their current behavior (always re-executed). Wrap the top-level-`const` inline scripts on `index.html` and `trips.html` in IIFEs to prevent SyntaxError on the second swap.

**Tech Stack:** Vanilla JS; vitest + jsdom; no new dependencies.

**Scope:** Phase 3 of 8 from `docs/design-plans/2026-04-21-ios-shell-hardening.md`.

**Codebase verified:** 2026-04-22 (branch `ios-offline-shell`).

**Branch:** `ios-offline-shell` (same as Phases 1–2).

**Dependencies:** Phase 1 (ListenerShim + `app:page-load`), Phase 2 (RoadTrip + page data-page tags).

---

## Acceptance Criteria Coverage

### ios-shell-hardening.AC1: No duplicate-`const` cascade

- **ios-shell-hardening.AC1.1 Success:** After `post → create → post` navigation, `FetchAndSwap._executedScriptSrcs` contains each shared script's absolutized `src` exactly once; no `SyntaxError: Can't create duplicate variable` in console.
- **ios-shell-hardening.AC1.2 Success:** Inline scripts re-execute on every swap (not tracked by the `src` Set).
- **ios-shell-hardening.AC1.3 Edge:** Script `src` URLs with different query-strings (`?v=1` vs `?v=2`) are treated as distinct — allows cache-bust to force re-run.
- **ios-shell-hardening.AC1.4 Success:** If the same `<script src>` appears twice within one page, the second instance is skipped after the first executes (idempotent per page).

### ios-shell-hardening.AC7: Issue #7 verification

- **ios-shell-hardening.AC7.1 Success:** After Phase 3 lands, on-device repro of "fetchAndSwap fails offline on an uncached URL" produces a clean console (no cascade).
- **ios-shell-hardening.AC7.2 Failure-fallback:** If AC7.1 fails on-device, a follow-up investigation issue is opened (instrumentation + trace); plan completion is not blocked.

(AC7.1 is operational — Phase 3 unit-tests verify the mechanism; Phase 8 smoke checklist captures the on-device repro.)

---

## Codebase baseline (verified 2026-04-22)

- `src/bootstrap/fetchAndSwap.js:8–29` is the current `_recreateScripts` function. It has no deduplication today — every external script is recreated on every swap.
- `src/bootstrap/fetchAndSwap.js:83` is the public-surface export: `globalThis.FetchAndSwap = { fetchAndSwap, _swapFromHtml, _APP_BASE: APP_BASE };`.
- `src/bootstrap/fetchAndSwap.js:6` defines `const APP_BASE = 'https://app-roadtripmap-prod.azurewebsites.net/';`. No URL-absolutization helper exists in the module.
- `src/bootstrap/intercept.js:9–15` has `_absoluteUrl(url)` that wraps `new URL(url, APP_BASE).href` in try/catch. Phase 3 does NOT reuse it cross-module (intercept loads AFTER fetchAndSwap in `src/bootstrap/index.html`); Phase 3 inlines an equivalent small helper in `fetchAndSwap.js`.
- `tests/js/fetchAndSwap.test.js:170–290` contains the `describe('script recreation', ...)` block with 5 existing tests: `'recreates scripts with src attributes'` (171–189), `'recreates inline scripts'` (191–209), `'preserves script order (head before body)'` (211–230), `'handles zero scripts'` (232–248), `'awaits external script onload before dispatching lifecycle events'` (250–289).
- `tests/js/fetchAndSwap.test.js:47–54` has the `appendChild` stub that fires `onload` synchronously via `setTimeout(() => node.onload(), 0)` for external scripts only. This stub is the test harness that lets jsdom exercise the "success" path of script injection.
- `src/RoadTripMap/wwwroot/post.html` loads 23 same-origin `<script src="...">` tags (no query-strings). `src/RoadTripMap/wwwroot/trips.html` and `src/RoadTripMap/wwwroot/index.html` load fewer scripts plus one inline block each. `create.html`'s inline block has no top-level declarations.
- **Design-assumption discrepancy:** the design's "Additional Considerations → Inline script re-execution" note claims "No wwwroot page currently [declares a top-level const in an inline `<script>`]." The investigator contradicted this:
  - `src/RoadTripMap/wwwroot/index.html:35–51` contains `const trips = TripStorage.getTrips(); ...` at top level of its inline script.
  - `src/RoadTripMap/wwwroot/trips.html:35–38` contains `const viewToken = window.location.pathname.split('/').filter(Boolean).pop(); MapUI.init(viewToken);` at top level of its inline script.
  - Both would throw `SyntaxError: Identifier 'trips' / 'viewToken' has already been declared` on the second iOS-shell visit to the page if left as-is. Phase 3 closes this gap by wrapping each in an IIFE (Subcomponent B).

---

## Known temporary state

**Phases 1 + 2 + 3 are a single deployable unit.** Phase 1's done-checklist warns "do not merge Phase 1 alone"; Phase 2's done-checklist warns "do not merge Phase 2 alone"; this phase closes the chain. After Phase 3 lands, the listener cascade, origin leak, and duplicate-const cascade are all addressed — the shell is internally consistent and the transient states documented in Phases 1 and 2 are resolved. Do not ship `ios-offline-shell` to any device or user until Phase 3 is merged; between Phase 2 and Phase 3 the `app:page-load` handler registered by page scripts accumulates on every swap because script-src dedup is not yet in place.

After Phase 3, Phase 4+ add offline UX polish but do not depend on Phase 3's shape. The `ios-offline-shell` branch is mergeable to `develop` (from a cascade-safety standpoint) after Phase 3 — but per the design's Out-of-Scope list, the actual merge gate is Phase 7 on-device sign-off from a prior plan, not this plan's Phase 8.

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

### Subcomponent A — Script-src dedup in `_recreateScripts`

<!-- START_TASK_1 -->
### Task 1: Add `_executedScriptSrcs` Set and dedup logic to `fetchAndSwap.js`

**Verifies:** ios-shell-hardening.AC1.1, ios-shell-hardening.AC1.2, ios-shell-hardening.AC1.3, ios-shell-hardening.AC1.4 (implementation; tests in Task 2).

**Files:**
- Modify: `src/bootstrap/fetchAndSwap.js:6–7` (add Set declaration after APP_BASE).
- Modify: `src/bootstrap/fetchAndSwap.js:8–29` (rewrite `_recreateScripts` body to dedup external scripts).
- Modify: `src/bootstrap/fetchAndSwap.js:83` (expose `_executedScriptSrcs` on the global).

**Change 1 — Module-scoped Set (insert after line 6, the `APP_BASE` declaration):**

Current line 6:
```javascript
    const APP_BASE = 'https://app-roadtripmap-prod.azurewebsites.net/';
```

Append immediately after (new lines):
```javascript
    const APP_BASE = 'https://app-roadtripmap-prod.azurewebsites.net/';

    // Module-scoped registry of external script srcs that have been injected
    // into this JS realm. Phase 3 (ios-shell-hardening.AC1) — prevents duplicate-
    // const cascade when a cross-page swap tries to re-inject an already-executed
    // script. Inline scripts are NOT tracked here (by design — they can be page-
    // local and have no identity to dedup against).
    const _executedScriptSrcs = new Set();

    function _absolutizeSrc(src) {
        try { return new URL(src, APP_BASE).href; } catch { return src; }
    }
```

**Change 2 — Rewrite `_recreateScripts` (lines 8–29):**

Current body:
```javascript
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

Target body:
```javascript
    async function _recreateScripts(scriptsInOrder, parentNode) {
        for (const oldScript of scriptsInOrder) {
            const rawSrc = oldScript.getAttribute('src');

            // External script path (has a non-empty src attribute)
            if (rawSrc) {
                const absoluteSrc = _absolutizeSrc(rawSrc);
                if (_executedScriptSrcs.has(absoluteSrc)) {
                    // Already executed in this realm (previous page, or earlier in this page).
                    // Skip recreation to avoid the duplicate-const cascade.
                    continue;
                }
                const fresh = document.createElement('script');
                for (const attr of oldScript.attributes) {
                    fresh.setAttribute(attr.name, attr.value);
                }
                await new Promise((resolve) => {
                    fresh.onload = () => {
                        // Only add on successful load. onerror does not guarantee the
                        // script's top-level declarations executed, so we allow retry.
                        _executedScriptSrcs.add(absoluteSrc);
                        resolve();
                    };
                    fresh.onerror = () => resolve();
                    parentNode.appendChild(fresh);
                });
                continue;
            }

            // Inline script path (no src). Re-executes on every swap by design —
            // wwwroot pages must avoid top-level const/let in inline <script> (see
            // Subcomponent B in this phase for the two pages we fixed up-front).
            const fresh = document.createElement('script');
            for (const attr of oldScript.attributes) {
                fresh.setAttribute(attr.name, attr.value);
            }
            fresh.textContent = oldScript.textContent;
            parentNode.appendChild(fresh);
        }
    }
```

**Change 3 — Expose on global (line 83):**

Current:
```javascript
    globalThis.FetchAndSwap = { fetchAndSwap, _swapFromHtml, _APP_BASE: APP_BASE };
```

Target:
```javascript
    globalThis.FetchAndSwap = { fetchAndSwap, _swapFromHtml, _APP_BASE: APP_BASE, _executedScriptSrcs };
```

**Non-goals:**
- Do NOT change inline-script behavior (AC1.2 explicitly requires they still re-execute every swap).
- Do NOT reuse `Intercept._internals._absoluteUrl` — intercept.js is loaded after fetchAndSwap.js and may not be defined when `_recreateScripts` runs. The inline `_absolutizeSrc` is a local helper with the same try/catch shape.
- Do NOT add onerror-path Set insertion. If a script fails to load (404, network error, parse error), leave the src out of the Set so subsequent swaps can retry.
- Do NOT provide a public API to clear `_executedScriptSrcs`. The Set is cleared only when the JS realm is destroyed (app relaunch).

**Verification:**
- Run `node --check src/bootstrap/fetchAndSwap.js` — expect no output.

**Commit:** `feat(ios-shell): dedup external-script re-execution via _executedScriptSrcs Set`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tests for script-src dedup

**Verifies:** ios-shell-hardening.AC1.1, ios-shell-hardening.AC1.2, ios-shell-hardening.AC1.3, ios-shell-hardening.AC1.4.

**Files:**
- Modify: `tests/js/fetchAndSwap.test.js` — append a new `describe('script-src deduplication', ...)` block after the existing `describe('script recreation', ...)` block (after line 290).

**Test harness notes:**
- Reuse the existing `setupTest()` / `teardownTest()` helpers at the top of the file. The `appendChild` stub at lines 47–54 already fires `onload` synchronously via `setTimeout(0)` for scripts with a `src` attribute — this is how tests exercise the onload "success" path that populates `_executedScriptSrcs`.
- In `setupTest()` BEFORE the new tests run, the module is eval'd fresh via `eval(FETCH_AND_SWAP_SRC)`. Because `_executedScriptSrcs` is module-scoped inside the IIFE, each eval yields a fresh empty Set. Do NOT add teardown that tries to reach into the Set — the eval isolation is enough.
- To dispatch a swap, use `await globalThis.FetchAndSwap._swapFromHtml(html, 'https://app-roadtripmap-prod.azurewebsites.net/trips/abc');` — the URL is only used for TripStorage.markOpened (which is noop-safe without a real store).
- To inspect the Set in assertions: `globalThis.FetchAndSwap._executedScriptSrcs` returns the live Set. Use `.has(...)` and `.size` for assertions.

**Tests required:**

1. **AC1.1 — `post → create → post` navigation populates the Set with each src exactly once; no duplicate-const SyntaxError.**
   - Arrange: build three HTML strings simulating a `post` page body with `<script src="/js/shared.js"></script>`, a `create` page body with the same `<script src="/js/shared.js"></script>` + a distinct `<script src="/js/only-create.js"></script>`, and a second `post` page body identical to the first.
   - Act: run three sequential swaps (`await _swapFromHtml(postHtml, postUrl); await _swapFromHtml(createHtml, createUrl); await _swapFromHtml(postHtml, postUrl);`).
   - Assert: `globalThis.FetchAndSwap._executedScriptSrcs.size === 2`. `.has('https://app-roadtripmap-prod.azurewebsites.net/js/shared.js') === true`. `.has('https://app-roadtripmap-prod.azurewebsites.net/js/only-create.js') === true`. (No 404s, because the appendChild stub always fires onload.)
   - Assert via spy: `document.createElement('script')` is called exactly 3 times across the 3 swaps (shared: once — second and third skipped; only-create: once; 3 TOTAL). Use `vi.spyOn(document, 'createElement')` wrapping the real implementation — remember to restore in teardown.

2. **AC1.2 — Inline scripts re-execute on every swap (not tracked by the Set).**
   - Arrange: build an HTML string with an inline `<script>window.inlineCount = (window.inlineCount || 0) + 1;</script>` body.
   - Act: run the same swap 3 times in sequence.
   - Assert: `window.inlineCount === 3` (the inline script ran once per swap).
   - Assert: `globalThis.FetchAndSwap._executedScriptSrcs.size === 0` (inline scripts never enter the Set).

3. **AC1.3 — Cache-busting query-strings produce distinct entries.**
   - Arrange: build two page HTML strings, one with `<script src="/js/a.js?v=1"></script>`, the other with `<script src="/js/a.js?v=2"></script>`.
   - Act: swap to page 1, then page 2.
   - Assert: Set contains both absolutized forms (`...js/a.js?v=1` and `...js/a.js?v=2`) — `.size === 2`.

4. **AC1.4 — Same `<script src>` twice in one page is idempotent within that page.**
   - Arrange: build an HTML body with `<script src="/js/dup.js"></script><script src="/js/dup.js"></script>` (same src twice).
   - Act: swap to that page.
   - Assert: `globalThis.FetchAndSwap._executedScriptSrcs.has('https://app-roadtripmap-prod.azurewebsites.net/js/dup.js') === true` and `.size === 1`.
   - Assert: exactly one `<script>` with `src="/js/dup.js"` was actually appended to the document (use a `querySelectorAll('script[src="/js/dup.js"]')` count check in a separate spy that counts `parentNode.appendChild` calls for script nodes with that src).

5. **Regression — onerror does NOT add to the Set (allows retry on next swap).**
   - The existing `appendChild` stub (tests/js/fetchAndSwap.test.js:47–54) unconditionally fires `onload` for any `<script src="...">`. For this test, replace the stub with one that fires `onerror` instead. Concrete per-test replacement:
     ```javascript
     it('does not add to _executedScriptSrcs on onerror', async () => {
         // Inside setupTest() the onload stub was installed. Restore + replace for this test.
         Node.prototype.appendChild.mockRestore();
         const realAppendChild = Node.prototype.appendChild;
         vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function (node) {
             const result = realAppendChild.call(this, node);
             if (node && node.tagName === 'SCRIPT' && node.getAttribute && node.getAttribute('src')) {
                 setTimeout(() => { if (node.onerror) node.onerror(); }, 0);
             }
             return result;
         });

         const html = '<html><head><base href="https://app-roadtripmap-prod.azurewebsites.net/"></head><body><script src="/js/fail.js"></script></body></html>';
         await globalThis.FetchAndSwap._swapFromHtml(html, 'https://app-roadtripmap-prod.azurewebsites.net/');

         expect(globalThis.FetchAndSwap._executedScriptSrcs.has(
             'https://app-roadtripmap-prod.azurewebsites.net/js/fail.js'
         )).toBe(false);
     });
     ```
   - Perform a second swap of the same HTML — count `document.querySelectorAll('script[src="/js/fail.js"]').length` or the number of `appendChild` calls for a script with that src. Assert the second swap DID re-inject (a second script element was appended) because the src is still absent from the Set — retry is intentional.

**Verification:**
- Run `npx vitest run tests/js/fetchAndSwap.test.js` — all tests green, including the 5 new above and the existing 5 in `describe('script recreation', ...)`.
- Run `npm test` — full suite green.

**Commit:** `test(ios-shell): cover script-src dedup across swaps, query-strings, intra-page dups, onerror retry`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

### Subcomponent B — Inline-script `const` mitigation on `index.html` and `trips.html`

Closes a design-assumption gap: inline scripts always re-execute (AC1.2), and two wwwroot pages currently declare top-level `const` in inline scripts that would throw on the second swap. Fix is an IIFE wrap — minimal, local, and leaves the scripts inline per the current page style.

<!-- START_TASK_3 -->
### Task 3: Wrap `index.html` inline script in an IIFE

**Verifies:** Supports ios-shell-hardening.AC1.1 operationally (prevents SyntaxError on second home-page swap). No new AC.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/index.html:35–51` (the trailing inline `<script>` block).

**Current code (lines 35–51, exact content may vary by a few characters):**
```html
<script>
    const trips = TripStorage.getTrips();
    if (trips.length > 0) {
        const section = document.getElementById('myTripsSection');
        const list = document.getElementById('myTripsList');
        // ... rendering of myTripsList children ...
    }
</script>
```

**Target code (same position, same inner logic, wrapped in IIFE):**
```html
<script>
    (function () {
        const trips = TripStorage.getTrips();
        if (trips.length > 0) {
            const section = document.getElementById('myTripsSection');
            const list = document.getElementById('myTripsList');
            // ... rendering of myTripsList children ...
        }
    })();
</script>
```

**Why IIFE:** the `const trips` becomes a function-scoped local instead of a top-level realm binding. Re-execution on every swap (unchanged by Phase 3) can no longer collide with a prior declaration in the same realm. No visible behavioral change on first load or on regular-browser navigation.

**Non-goals:**
- Do NOT migrate this script's logic to an external file or to `RoadTrip.onPageLoad('home', ...)` — that would be a richer refactor outside this plan's scope. The IIFE wrap is the minimal correct fix.
- Do NOT change the rendering logic inside the block.

**Verification:**
- Open `src/RoadTripMap/wwwroot/index.html` and confirm the inline `<script>` body starts with `(function () {` and ends with `})();`.
- Run `npm test` — full suite green (no existing test drives this inline block via vitest; the HTML is static).

**Commit:** `fix(home): IIFE-wrap inline script so re-execution on swap doesn't redeclare 'trips'`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Wrap `trips.html` inline script in an IIFE

**Verifies:** Supports ios-shell-hardening.AC1.1 operationally. No new AC.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/trips.html:35–38` (the trailing inline `<script>` block).

**Current code (lines 35–38):**
```html
<script>
    const viewToken = window.location.pathname.split('/').filter(Boolean).pop();
    MapUI.init(viewToken);
</script>
```

**Target code:**
```html
<script>
    (function () {
        const viewToken = window.location.pathname.split('/').filter(Boolean).pop();
        MapUI.init(viewToken);
    })();
</script>
```

**Verification:**
- Open `src/RoadTripMap/wwwroot/trips.html` and confirm the inline `<script>` body is IIFE-wrapped.
- Run `npm test` — full suite green.

**Commit:** `fix(trips): IIFE-wrap inline script so re-execution on swap doesn't redeclare 'viewToken'`
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->

### Task 5: Audit remaining inline scripts in `wwwroot/*.html`

**Verifies:** Operational — closes the "no other inline top-level `const`" check to ensure Phase 3 leaves no residual SyntaxError vector.

**Files:** inspection-only (no code commit unless audit finds a hit).

**Procedure:**

1. List every inline `<script>...</script>` block (opening tag with NO `src=` attribute) across wwwroot:
   ```bash
   grep -nE '<script>\s*$' src/RoadTripMap/wwwroot/*.html
   ```
   This pattern matches `<script>` at end of line (no `src` attribute), which is how inline blocks open on the wwwroot pages. External `<script src="...">` tags have `src=` on the same line and are excluded. If a page uses any other inline pattern (e.g., `<script type="module">`), also grep for `<script [^>]*>` and eyeball each hit.
2. For each hit:
   - Inline block on `index.html` — fixed by Task 3. Verify the IIFE wrap is present.
   - Inline block on `trips.html` — fixed by Task 4. Verify the IIFE wrap is present.
   - Inline block on `create.html` (lines 53–97 per investigator) — read the block. The investigator classified it as "safe" (only an event handler, no top-level declarations). Re-verify by eye: any `const X`, `let Y`, or `function Z` at the block's TOP level (outside the event-handler closure) is a redeclaration hazard.
   - `post.html` has no inline `<script>` block — confirm via grep.
3. If a NEW top-level declaration is found anywhere, add an IIFE wrap (same pattern as Tasks 3/4) in this task's commit.

**Verification:**
- Audit completed; summary noted in the commit message or as a code-review comment.
- If new wraps were needed, `npm test` remains green.

**Commit (only if wraps added):** `fix(wwwroot): IIFE-wrap residual inline scripts flagged by Phase 3 audit`
<!-- END_TASK_5 -->

---

## Phase 3 done checklist

- [ ] `src/bootstrap/fetchAndSwap.js` declares module-scoped `const _executedScriptSrcs = new Set();` and `_absolutizeSrc(src)` helper near the top of the IIFE.
- [ ] `_recreateScripts` skips recreation for any external src already in the Set; adds to the Set only on successful `onload`.
- [ ] Inline-script path preserved — they still re-execute on every swap.
- [ ] `globalThis.FetchAndSwap._executedScriptSrcs` exposes the Set for test inspection.
- [ ] `tests/js/fetchAndSwap.test.js` has a new `describe('script-src deduplication', ...)` block covering AC1.1 through AC1.4 + onerror-retry regression.
- [ ] `src/RoadTripMap/wwwroot/index.html` inline script IIFE-wrapped.
- [ ] `src/RoadTripMap/wwwroot/trips.html` inline script IIFE-wrapped.
- [ ] Audit confirms no other wwwroot HTML page declares a top-level `const`/`let`/`function` in an inline `<script>`.
- [ ] `npm test` green end-to-end.
- [ ] All tasks committed on `ios-offline-shell`.
- [ ] AC7.1 (on-device repro) deferred to Phase 8 smoke checklist. Record in the Phase 8 checklist that Issue #7 should be explicitly re-tested after Phase 3 lands (open a follow-up issue per AC7.2 if cascade persists).
