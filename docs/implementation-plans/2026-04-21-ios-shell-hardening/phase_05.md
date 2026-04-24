# iOS Shell Hardening — Phase 5: Offline trip-page photos

**Goal:** Cache the view-only trip photo list through the iOS shell's `CachedFetch.cachedFetch(url, { asJson: true })` wrapper so that a cached photo list renders instantly (and survives offline) on repeat visits to `trips.html`. Replace the raw `"Failed to load photos"` toast on `post.html` with a friendly offline copy rendered via `OfflineError.friendlyMessage(err, 'photos')`.

**Architecture:** `src/RoadTripMap/wwwroot/js/api.js:getTripPhotos` becomes platform-aware: when `globalThis.CachedFetch` exists (iOS shell runtime), it routes through `cachedFetch(url, { asJson: true })` — first visit = live fetch + IDB write-through; repeat visit = cached JSON immediate-return + background revalidate. When `CachedFetch` is absent (regular browsers), the function falls through to raw `fetch` (unchanged behavior). The post page's photo-fetch error render (`postUI.js`'s `loadPhotoList` catch block, which uses `this.showToast(...)`) is rewritten to surface `OfflineError.friendlyMessage(err, 'photos')`. `offlineError.js` is loaded on `post.html`. No changes to the owner-scoped `/api/post/{secretToken}/photos` endpoint or to `PostService.listPhotos` — caching is view-only by design (shared links must not expose post-delete stale state on the owner path).

**Tech Stack:** Vanilla JS + HTML; vitest + jsdom + fake-indexeddb; no new runtime dependencies.

**Scope:** Phase 5 of 8 from `docs/design-plans/2026-04-21-ios-shell-hardening.md`.

**Codebase verified:** 2026-04-22 (branch `ios-offline-shell`).

**Branch:** `ios-offline-shell` (same as Phases 1–4).

**Dependencies:** Phase 2 (`offlineError.js` exists and is tested; `post.html` has `<script src="/js/roadTrip.js"></script>` and `data-page="post"`).

---

## Acceptance Criteria Coverage

### ios-shell-hardening.AC5: Offline trip-page photos

- **ios-shell-hardening.AC5.1 Success:** `API.getTripPhotos(token)` is served through `CachedFetch.cachedFetch(url, { asJson: true })`.
- **ios-shell-hardening.AC5.2 Success:** Second visit to a previously-online trip page while offline renders the cached JSON photo list (no "Failed to load photos" message).
- **ios-shell-hardening.AC5.3 Success:** First visit to a trip page while offline (cache miss) shows `"Photos unavailable offline. Reconnect to see the latest."`.
- **ios-shell-hardening.AC5.4 Edge:** Online visit after offline cache-hit triggers background revalidate; `RoadTripPageCache.api` updates to the latest server response (existing `CachedFetch` contract).

---

## Codebase baseline (verified 2026-04-22)

- `src/RoadTripMap/wwwroot/js/api.js:143–147` is the current `getTripPhotos(viewToken)` function:
  ```javascript
  async getTripPhotos(viewToken) {
      const response = await fetch(`${this.baseUrl}/trips/view/${viewToken}/photos`);
      if (!response.ok) throw new Error('Failed to load photos');
      return response.json();
  },
  ```
  URL shape: `/api/trips/view/{viewToken}/photos`. Return shape: parsed-JSON array of photo objects.
- `src/bootstrap/cachedFetch.js:269–296` is `cachedFetch(url, opts = {})`. With `{ asJson: true }`: stores the response body text in IDB object-store `api`; returns `{ response, source: 'cache' | 'network' }` where `response.json()` yields the cached/live JSON. On cache-miss + offline (network fetch rejects), `cachedFetch` REJECTS — caller must handle. `isBypassed('/api/trips/view/{token}/photos')` is `false` (bypass list is `/api/poi` and `/api/park-boundaries` only), so the photo-list URL IS cacheable.
- `CachedFetch` lives in `src/bootstrap/`. It is loaded via `src/bootstrap/index.html` and therefore exists on `globalThis` when the iOS shell renders any page. It is NOT loaded by regular browsers visiting the App Service directly. `api.js` must therefore branch on `globalThis.CachedFetch`.
- `src/RoadTripMap/wwwroot/js/postUI.js:900` calls `PostService.listPhotos(this.secretToken)` — this hits `/api/post/{secretToken}/photos`, NOT `/api/trips/view/{viewToken}/photos`. So `postUI.js` is NOT a consumer of `API.getTripPhotos`. Phase 5's `api.js` change benefits `trips.html`'s view path (through `MapService.loadTrip → API.getTripPhotos(viewToken)`), not `post.html`'s owner path. The post-page offline copy is a UX polish layered on top of the existing `PostService.listPhotos` failure — `OfflineError.friendlyMessage` renders a context-aware string but does not change caching behavior there.
- `src/RoadTripMap/wwwroot/js/postUI.js:938–942` is the photo-fetch catch block:
  ```javascript
  } catch (err) {
      console.error('Error loading photos:', err);
      this.showToast('Failed to load photos', 'error');
  }
  ```
  Phase 5 keeps the toast surface (it's the existing error channel — no dedicated banner element exists on post.html today) and replaces the literal `'Failed to load photos'` with `OfflineError.friendlyMessage(err, 'photos')`.
- `src/RoadTripMap/wwwroot/js/mapService.js:13–19` is `loadTrip(viewToken)` which calls `API.getTripPhotos(viewToken)` via `Promise.all(...)`. When cacheable, `trips.html`'s view flow benefits. `mapUI.js:45–48` catches init failures and calls `this.showError('Failed to load trip')` — Phase 5 leaves this alone (the design scopes the friendly-copy change to `postUI.js` only; `trips.html` gets the caching benefit without the messaging change).
- `src/RoadTripMap/wwwroot/post.html` does NOT currently load `offlineError.js` (Phase 4 only added it to `create.html`). Phase 5 adds it.
- **No existing test covers `API.getTripPhotos`.** `tests/js/api.test.js` covers other `API.*` methods but not this one. Phase 5 creates `tests/js/trip-photos-offline.test.js` as the home for the caching and error-copy tests.
- `tests/js/cachedFetch.test.js:1–70` is the canonical harness for eval'ing `cachedFetch.js` into tests. Phase 5 reuses the same pattern.

---

## Known limitations (documented, not fixed by Phase 5)

- The owner-scoped `/api/post/{secretToken}/photos` endpoint is not cached. Post-page offline-UX gets the friendly message but not a cached photo list. Rationale: owner flows should see current server state to avoid stale-post actions after deletes.
- Individual photo image URLs (Azure Blob signed URLs) are not cached. Offline thumbnails on repeat trip-page visits render as broken-image placeholders. The JSON list is populated; the image DOM renders but each `<img>` fails network. Acceptable per the design's Additional Considerations and documented here for Phase 8's CLAUDE.md Gotchas update.

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

### Subcomponent A — `api.js:getTripPhotos` platform-aware caching

<!-- START_TASK_1 -->
### Task 1: Route `getTripPhotos` through `CachedFetch` (iOS shell) with a browser fallback

**Verifies:** ios-shell-hardening.AC5.1 (implementation; tests in Task 2).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/api.js:143–147` (the `getTripPhotos` method body).

**Current code (lines 143–147):**
```javascript
async getTripPhotos(viewToken) {
    const response = await fetch(`${this.baseUrl}/trips/view/${viewToken}/photos`);
    if (!response.ok) throw new Error('Failed to load photos');
    return response.json();
},
```

**Target code (same position):**
```javascript
async getTripPhotos(viewToken) {
    const url = `${this.baseUrl}/trips/view/${viewToken}/photos`;

    // iOS shell path: route through CachedFetch for cache-first + bg revalidate.
    // Bypass list never includes /api/trips/view — but check defensively so any
    // future bypass-regex change doesn't silently skip caching here.
    if (globalThis.CachedFetch && !globalThis.CachedFetch.isBypassed(url)) {
        const { response } = await globalThis.CachedFetch.cachedFetch(url, { asJson: true });
        if (!response.ok) throw new Error('Failed to load photos');
        return response.json();
    }

    // Regular-browser path: CachedFetch is iOS-shell-only. Fall back to raw fetch.
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load photos');
    return response.json();
},
```

**Contract preservation:**
- Return shape is unchanged (`Promise<PhotoResponse[]>`).
- The thrown `Error('Failed to load photos')` on non-OK status stays as the rejection for non-network failures (404, 5xx).
- Network failures (TypeError from fetch) propagate up from `cachedFetch` or raw `fetch` — callers can classify via `OfflineError.isOfflineError`.
- `cachedFetch`'s background-revalidate-on-cache-hit (AC5.4) happens automatically per the `CachedFetch` contract; no extra wiring in `api.js`.

**Non-goals:**
- Do NOT invalidate/clear the cache from here — `CachedFetch` owns its cache lifecycle.
- Do NOT attempt to cache the post-page endpoint `/api/post/{secretToken}/photos`. That endpoint is untouched.
- Do NOT change any other `API.*` method.

**Verification:**
- `node --check src/RoadTripMap/wwwroot/js/api.js` — expect no output.
- Full test coverage in Task 2.

**Commit:** `feat(api): route getTripPhotos through CachedFetch in the iOS shell, raw fetch in browsers`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tests for `getTripPhotos` caching + offline behavior

**Verifies:** ios-shell-hardening.AC5.1, ios-shell-hardening.AC5.2, ios-shell-hardening.AC5.4.

**Files:**
- Create: `tests/js/trip-photos-offline.test.js` (new, unit).

**Test harness notes:**
- Follow the `tests/js/cachedFetch.test.js:1–70` template: read the sources once at the top of the file, clean IDB + `delete globalThis.CachedFetch` + `delete globalThis.API` in `beforeEach`, eval the sources back into scope:
  ```javascript
  const CACHED_FETCH_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/cachedFetch.js'), 'utf8');
  const API_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/api.js'), 'utf8');
  ```
- `beforeEach`: close any existing `CachedFetch._internals._db`, `await deleteDb('RoadTripPageCache');`, `delete globalThis.CachedFetch; delete globalThis.API;`, then eval both modules. Because `api.js` defines `const API = { ... }` at the top level, re-eval within the same realm would throw `SyntaxError: Identifier 'API' has already been declared`. Follow the same test-harness trick `tests/js/setup.js` uses to load wwwroot modules: rewrite the top-level `const API = ` to `globalThis.API = ` at test-eval time only (the on-disk file is unchanged). Concrete setup:
  ```javascript
  beforeEach(async () => {
      if (globalThis.CachedFetch?._internals?._closeDb) {
          try { globalThis.CachedFetch._internals._closeDb(); } catch { /* ignore */ }
      }
      await deleteDb('RoadTripPageCache').catch(() => {});
      delete globalThis.CachedFetch;
      delete globalThis.API;

      eval(CACHED_FETCH_SRC);
      // Rewrite api.js's top-level const binding for re-eval idempotency (test-harness only).
      const apiEvalable = API_SRC.replace(/^const API = /m, 'globalThis.API = ');
      eval(apiEvalable);
  });
  ```
- Stub `globalThis.fetch` per-test to a `vi.fn()` that returns a `Response` with either `ok: true` + JSON body, or rejects with `new TypeError('Load failed')`. `CachedFetch`'s internal `_absoluteUrl` call resolves the URL — match your stub response with the absolute form.
- Use `await flushPromises()` (copied from `tests/js/cachedFetch.test.js:39–43`) to drain background-revalidate promises before assertions.

**Tests required:**

1. **AC5.1 — `getTripPhotos` calls through `CachedFetch.cachedFetch` with `{ asJson: true }` when `CachedFetch` is present.**
   - Arrange: stub `globalThis.fetch` to return a successful `Response` with 2 photos. Call `await API.getTripPhotos('abc-viewtoken')`.
   - Assert: the IDB `api` store contains a record keyed by `/api/trips/view/abc-viewtoken/photos`.
   - Assert: the returned value is the parsed JSON array.

2. **AC5.2 — Second visit while offline renders cached photos.**
   - Arrange: first call with `globalThis.fetch` mocked to succeed (seeds the cache). Await the call.
   - Act: replace `globalThis.fetch` with `vi.fn().mockRejectedValue(new TypeError('Load failed'))`. Call `await API.getTripPhotos('abc-viewtoken')` again.
   - Assert: the returned value equals the previously-cached photos. No rejection.
   - Flush promises; assert the background-revalidate fetch was attempted once and swallowed (the IDB state is unchanged — still the old cached record, because the background fetch failed).

3. **AC5.3 — First visit while offline (cache miss) rejects with a network error.**
   - Arrange: clean IDB, `globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Load failed'));`.
   - Act: `const promise = API.getTripPhotos('abc-viewtoken');`.
   - Assert: `await expect(promise).rejects.toThrow(TypeError);`.
   - Assert: the IDB `api` store has no record for this URL.

4. **AC5.4 — Online visit after a cache-hit triggers background revalidate; cache updates on fresh 200.**
   - Arrange: seed cache with photos v1 (first online call).
   - Act: `globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(photosV2), { status: 200, headers: { 'Content-Type': 'application/json' } }));`. Call `await API.getTripPhotos('abc-viewtoken')` a second time. Flush promises.
   - Assert: the immediate return is photos v1 (cache-first).
   - Assert: after `await flushPromises()`, the IDB `api` record body matches photos v2 (background revalidate wrote through).

5. **Regular-browser fallback — when `globalThis.CachedFetch` is absent, raw `fetch` is called.**
   - Arrange: `delete globalThis.CachedFetch;`. Stub `globalThis.fetch` to return 200 + JSON.
   - Act: `await API.getTripPhotos('xyz');`.
   - Assert: `globalThis.fetch` called exactly once with the absolute URL. No IDB write (can't write without `CachedFetch`).

6. **Regular-browser fallback — non-OK response throws the legacy error.**
   - Arrange: `delete globalThis.CachedFetch;`. Stub `globalThis.fetch` to return `new Response('', { status: 404 })`.
   - Act: `await expect(API.getTripPhotos('xyz')).rejects.toThrow('Failed to load photos');`.

**Verification:**
- Run `npx vitest run tests/js/trip-photos-offline.test.js` — all 6 tests green.
- Run `npm test` — full suite green. In particular, existing `tests/js/api.test.js` tests for other `API.*` methods must stay green (they don't exercise `getTripPhotos`).

**Commit:** `test(api): cover getTripPhotos caching, offline hit/miss, browser fallback`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

### Subcomponent B — `post.html` friendly photo-fetch copy

<!-- START_TASK_3 -->
### Task 3: Load `offlineError.js` on `post.html`

**Verifies:** Operational precondition for AC5.3 rendering. No new AC by itself.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/post.html` — insert `<script src="/js/offlineError.js"></script>` in `<head>` immediately after the Phase 2 `<script src="/js/roadTrip.js"></script>` insertion.

**Change (head block, post-Phase-2 state):**

Current (Phase 2 added `roadTrip.js` at the top of `<head>`):
```html
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <meta name="client-version" content="1.0.0">
    <script src="/js/roadTrip.js"></script>
    <title>Post Photo - Road Trip Map</title>
    <link rel="stylesheet" href="/css/styles.css?v=4">
    <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.21.0/..." ...>
</head>
```

Target:
```html
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <meta name="client-version" content="1.0.0">
    <script src="/js/roadTrip.js"></script>
    <script src="/js/offlineError.js"></script>
    <title>Post Photo - Road Trip Map</title>
    <link rel="stylesheet" href="/css/styles.css?v=4">
    <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.21.0/..." ...>
</head>
```

**Verification:**
- `grep -n 'offlineError.js' src/RoadTripMap/wwwroot/post.html` → exactly 1 match.

**Commit:** `chore(post): load offlineError.js for friendly photo-fetch copy`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Route `postUI.loadPhotoList` catch through `OfflineError.friendlyMessage`

**Verifies:** ios-shell-hardening.AC5.3 (implementation; test in Task 5).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js:938–942` (the `loadPhotoList` catch block).

**Current code (lines 938–942):**
```javascript
} catch (err) {
    console.error('Error loading photos:', err);
    this.showToast('Failed to load photos', 'error');
}
```

**Target code (same position):**
```javascript
} catch (err) {
    console.error('Error loading photos:', err);
    this.showToast(OfflineError.friendlyMessage(err, 'photos'), 'error');
}
```

**Rationale for keeping `showToast` vs introducing a persistent banner:** `postUI.js`'s existing error surface is the toast. The design's phrase "existing banner slot" is interpreted as "the existing error surface on this page" — which is the toast. Introducing a new persistent banner element would be scope creep. `OfflineError.friendlyMessage` returns the exact AC5.3 string `"Photos unavailable offline. Reconnect to see the latest."` when classified as offline, and falls back to `err.message || 'Something went wrong.'` for non-offline failures (e.g. 500 errors) — preserving prior behavior for non-offline paths.

**Non-goals:**
- Do NOT change `postUI.js`'s photo-fetch call site (still `PostService.listPhotos(this.secretToken)`).
- Do NOT migrate `PostService.listPhotos` to `CachedFetch` — owner-path caching is explicitly out of scope.
- Do NOT alter `this.showToast` signature or implementation.

**Verification:**
- `grep -n "showToast('Failed to load photos'" src/RoadTripMap/wwwroot/js/postUI.js` → 0 matches.
- `grep -n "OfflineError.friendlyMessage(err, 'photos')" src/RoadTripMap/wwwroot/js/postUI.js` → 1 match.
- `node --check src/RoadTripMap/wwwroot/js/postUI.js` — expect no output.

**Commit:** `fix(post): route photo-fetch failures through OfflineError.friendlyMessage('photos')`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Tests for the `postUI` photo-fetch friendly-copy wiring

**Verifies:** ios-shell-hardening.AC5.3 (end-to-end: the toast text on the post page).

**Files:**
- Modify: `tests/js/trip-photos-offline.test.js` — add a new `describe('postUI photo-fetch catch copy', ...)` block.

**Test harness notes:**
- The existing `postUI-*` test suites eval `postUI.js` into scope via the `tests/js/setup.js` pre-loader. Use the same approach, but in this new test file you may need to explicitly stub `PostService.listPhotos` and `this.showToast`.
- Stub `globalThis.PostService = { listPhotos: vi.fn().mockRejectedValue(new TypeError('Load failed')) };` and `globalThis.API = {...minimal stubs...};` as needed.
- The `PostUI` object exposes `loadPhotoList` as a method. You can call it directly on the object after setting `PostUI.secretToken = 'some-token'` (don't go through the full init flow — isolate the failure path).
- Capture toast calls by replacing `PostUI.showToast = vi.fn();` before calling `loadPhotoList`.

**Tests required:**

1. **AC5.3 (offline: TypeError path) — toast shows friendly photo copy.**
   - Arrange: `globalThis.OfflineError` installed via eval. `PostService.listPhotos` mocked to reject with `new TypeError('Load failed')`. `PostUI.showToast = vi.fn();`. `PostUI.secretToken = 'abc';`.
   - Act: `await PostUI.loadPhotoList();`.
   - Assert: `PostUI.showToast` called exactly once with `('Photos unavailable offline. Reconnect to see the latest.', 'error')`.

2. **AC5.3 (navigator.onLine false path) — same copy even with a non-TypeError.**
   - Arrange: `Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });`. `PostService.listPhotos` rejects with `new Error('unknown')`.
   - Act: `await PostUI.loadPhotoList();`.
   - Assert: toast text is the photos friendly copy.
   - Restore `navigator.onLine` in `afterEach`.

3. **Regression — non-offline error preserves its message.**
   - Arrange: `navigator.onLine === true`. `PostService.listPhotos` rejects with `new Error('Server exploded')` (no TypeError).
   - Act: `await PostUI.loadPhotoList();`.
   - Assert: toast text is `'Server exploded'` (non-offline path — falls through to `err.message`).

**Verification:**
- Run `npx vitest run tests/js/trip-photos-offline.test.js` — all tests (6 from Task 2 + 3 new) green.
- Run `npm test` — full suite green. Ensure no regression in `postUI-upload.test.js`, `postUI-processing.test.js`, `postUI-failure-routing.test.js`.

**Commit:** `test(post): cover friendly offline copy on photo-fetch failure`
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

---

## Phase 5 done checklist

- [ ] `src/RoadTripMap/wwwroot/js/api.js:getTripPhotos` is platform-aware: routes through `CachedFetch.cachedFetch(url, { asJson: true })` in the iOS shell, falls back to raw `fetch` in regular browsers.
- [ ] `src/RoadTripMap/wwwroot/post.html` loads `offlineError.js` immediately after `roadTrip.js` in `<head>`.
- [ ] `src/RoadTripMap/wwwroot/js/postUI.js`'s `loadPhotoList` catch block uses `OfflineError.friendlyMessage(err, 'photos')` as the toast text.
- [ ] `tests/js/trip-photos-offline.test.js` covers AC5.1 through AC5.4 plus the browser fallback and the post-page friendly copy.
- [ ] `npm test` green end-to-end.
- [ ] All 5 tasks committed on `ios-offline-shell`.
- [ ] On-device verification (airplane-mode revisit to a cached view-link, airplane-mode first-visit to an uncached view-link, post-page offline toast copy) recorded in Phase 8's smoke checklist.
