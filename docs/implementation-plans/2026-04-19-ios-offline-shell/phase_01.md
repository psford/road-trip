# iOS Offline Shell — Phase 1: Page-cache IDB layer + `cachedFetch` wrapper

**Goal:** A standalone `cachedFetch(url, opts)` utility backed by a new `RoadTripPageCache` IDB database, with cache-first + background revalidate semantics and explicit `mapCache.js`-bypass logic.

**Architecture:** Pure-JS IIFE module at `src/bootstrap/cachedFetch.js` matching the loader.js IIFE / mapCache.js IDB-open style already in this codebase. Two object stores (`pages` for HTML, `api` for JSON) keyed by URL. Cache-first read returns immediately; background revalidation runs fire-and-forget on every cache hit and updates IDB on `200`, no-ops on `304`, swallows network errors silently. Live document is never updated by background revalidation (Phase 3 enforces). Bypass list (`^/api/(poi|park-boundaries)`) skips cache entirely so `mapCache.js` retains exclusive ownership of those URLs. Graceful IDB-unavailable fallback (returns null, falls through to network) matches the existing mapCache pattern.

**Tech Stack:** Vanilla JS (ES2020), browser IndexedDB API, browser `fetch` API. Tests via vitest 4.0.0 + jsdom + fake-indexeddb 6.0.0 (already configured in `vitest.config.js` and `tests/js/setup.js`).

**Scope:** Phase 1 of 8 from the iOS Offline Shell design.

**Codebase verified:** 2026-04-19.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ios-offline-shell.AC3: Aggressive offline-first cache
- **ios-offline-shell.AC3.1 Success:** First online visit to any page caches it in `RoadTripPageCache.pages` with `cachedAt`, `etag`, `lastModified`.
- **ios-offline-shell.AC3.2 Success:** Subsequent visit to a cached URL renders from cache immediately (cache-first).
- **ios-offline-shell.AC3.3 Success:** Online cache hit fires background revalidate with conditional headers; updates IDB on `200`, no-op on `304`.
- **ios-offline-shell.AC3.5 Success:** Offline launch with a cached default trip → renders from cache; background revalidate fails silently.
- **ios-offline-shell.AC3.7 Edge:** URLs matching `^/api/(poi|park-boundaries)` are NOT touched by `cachedFetch`; `mapCache.js` continues to handle them.

(AC3.4 — background revalidate does NOT swap live DOM — is verified in Phase 3 once `fetchAndSwap` exists. AC3.6 — offline + cache miss → `fallback.html` — is verified in Phase 5 by the loader.)

---

## Module contract

- File: `src/bootstrap/cachedFetch.js` (IIFE, installs `globalThis.CachedFetch`).
- Public surface:
  - `CachedFetch.cachedFetch(url, { asJson = false, signal } = {})` → `Promise<{ response: Response, source: 'cache' | 'network' }>`
  - `CachedFetch.isBypassed(url)` → `boolean`
- Internal (test-only) surface: `CachedFetch._internals = { _getDb, _putRecord, _getRecord, _deleteRecord, DB_NAME }`.
- IDB: `RoadTripPageCache` v1.
  - Store `pages` (out-of-line key — URL passed to `put(value, key)`). Value: `{ html, etag, lastModified, cachedAt }`.
  - Store `api` (out-of-line key). Value: `{ body, contentType, etag, lastModified, cachedAt }`. `body` is the raw response text (not parsed).
- `asJson: true` → `api` store; `asJson: false` (default) → `pages` store.
- Returned `Response` is a real `new Response(body, init)` with `Content-Type`, `ETag`, `Last-Modified` re-attached when present.
- Bypass: `cachedFetch` checks `isBypassed(url)` first; bypassed URLs are passed straight to `fetch()` with no IDB read or write. `isBypassed` is also exposed publicly so callers can short-circuit before invoking `cachedFetch` (per design: "Caller must consult before invoking cachedFetch for /api/* routes").
- IDB unavailable (private browsing / `_getDb()` resolves null): always fetch from network, no caching, no throw.
- Background revalidate: fires only on cache hit, fire-and-forget, with `If-None-Match` / `If-Modified-Since` if cached record carries them. `200` → write through. `304` or any other status / network error → no-op, no throw, no `console.error`. Live document is never updated (Phase 3 enforces).

---

## House-style notes

- Match the [src/RoadTripMap/wwwroot/js/mapCache.js:24-61](../../../src/RoadTripMap/wwwroot/js/mapCache.js#L24-L61) IDB-open style: lazy `_getDb()`, `_db` instance cache, return `null` on private-browsing.
- Follow the [src/bootstrap/loader.js](../../../src/bootstrap/loader.js) IIFE pattern (single self-executing function, exposes a single global, no ES module export).
- Follow the [tests/js/bootstrap-loader.test.js:5-62](../../../tests/js/bootstrap-loader.test.js#L5-L62) test-loading mechanism: read source as string, eval into a `beforeEach` so each test gets fresh state.
- Follow the [tests/js/storageAdapter.test.js:1-35](../../../tests/js/storageAdapter.test.js#L1-L35) IDB-cleanup mechanism: `indexedDB.deleteDatabase('RoadTripPageCache')` in `beforeEach`.
- Test behavior, not implementation. Do NOT spy on `indexedDB.open`. Assert IDB *state* and Response *contents*.
- Per `CLAUDE.md`: JS tests do not run in CI — `npm test` must pass locally before commits.
- This file is loaded only by the iOS shell loader via a script tag in `src/bootstrap/index.html` (Phase 5). It is NOT bundled into `wwwroot/bundle/app.js`. `scripts/build-bundle.js` is unchanged in Phase 1.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: IDB layer + bypass classifier

**Verifies:** `ios-offline-shell.AC3.7` (bypass classifier piece — full passthrough verified in Task 4).

**Files:**
- Create: `src/bootstrap/cachedFetch.js`

**Implementation:**

A single IIFE that installs `globalThis.CachedFetch`. Internals:

- Constants:
  ```js
  const DB_NAME = 'RoadTripPageCache';
  const DB_VERSION = 1;
  const STORE_PAGES = 'pages';
  const STORE_API = 'api';
  const BYPASS_REGEX = /^\/api\/(poi|park-boundaries)(?:[/?]|$)/;
  const APP_BASE = 'https://app-roadtripmap-prod.azurewebsites.net';
  ```
- `_getDb()` — lazy open following the [mapCache.js:24-61](../../../src/RoadTripMap/wwwroot/js/mapCache.js#L24-L61) pattern. Returns `null` on `onerror` (private browsing). `onupgradeneeded` creates both stores if missing in a single transaction:
  ```js
  request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_PAGES)) db.createObjectStore(STORE_PAGES);
      if (!db.objectStoreNames.contains(STORE_API)) db.createObjectStore(STORE_API);
  };
  ```
- `_putRecord(storeName, url, value)` — wraps a `readwrite` transaction over a single store; resolves on `tx.oncomplete`, rejects on `tx.onerror` or `req.onerror`.
- `_getRecord(storeName, url)` — wraps a `readonly` transaction; resolves with `req.result` (which is `undefined` for missing keys).
- `_deleteRecord(storeName, url)` — wraps `readwrite` `store.delete(url)`. Test-only convenience.
- `isBypassed(url)`:
  ```js
  function isBypassed(url) {
      let pathname;
      try {
          pathname = new URL(url, APP_BASE).pathname;
      } catch {
          return false;
      }
      return BYPASS_REGEX.test(pathname);
  }
  ```
- Stub `cachedFetch`:
  ```js
  async function cachedFetch(url, opts) {
      throw new Error('cachedFetch NOT_IMPLEMENTED — see Task 3');
  }
  ```
- Exposure:
  ```js
  globalThis.CachedFetch = {
      cachedFetch,
      isBypassed,
      _internals: { _getDb, _putRecord, _getRecord, _deleteRecord, DB_NAME, DB_VERSION, STORE_PAGES, STORE_API }
  };
  ```

The `_internals` namespace lets tests reach IDB helpers without re-implementing them. Production code (the loader in Phase 5) uses only `cachedFetch` and `isBypassed`.

**Verification:**
- File parses cleanly: `node --check src/bootstrap/cachedFetch.js`. Expected: no output, exit 0.
- Task 2's tests cover behavior. Run with `npm test -- cachedFetch` after Task 2 lands.

**Commit:** `feat(ios-offline-shell): add cachedFetch IDB layer + bypass classifier`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tests — IDB round-trip + bypass classifier

**Verifies:** `ios-offline-shell.AC3.7` (classifier portion).

**Files:**
- Create: `tests/js/cachedFetch.test.js`

**Implementation:**

Mirror the test-bootstrap pattern from [tests/js/bootstrap-loader.test.js:5-62](../../../tests/js/bootstrap-loader.test.js#L5-L62) and the IDB-deletion pattern from [tests/js/storageAdapter.test.js:1-35](../../../tests/js/storageAdapter.test.js#L1-L35).

Test file structure:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOURCE_PATH = path.resolve(__dirname, '../../src/bootstrap/cachedFetch.js');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');

async function deleteDb(name) {
    await new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();  // fake-indexeddb fires this in some scenarios
    });
}

beforeEach(async () => {
    delete globalThis.CachedFetch;
    await deleteDb('RoadTripPageCache');
    eval(SOURCE);  // installs globalThis.CachedFetch
});

afterEach(() => {
    delete globalThis.CachedFetch;
});
```

Tests required:

**`describe('isBypassed')`:**
- `'/api/poi'` → true
- `'/api/poi?minLat=1&maxLat=2'` → true
- `'/api/park-boundaries'` → true
- `'/api/park-boundaries?detail=full'` → true
- `'https://app-roadtripmap-prod.azurewebsites.net/api/poi?x=1'` → true
- `'/api/photos/abc/123/display'` → false
- `'/api/trips/view/xyz'` → false
- `'/post/abc'` → false
- `'/'` → false
- `'not a url at all'` → false (defensive — must not throw)

**`describe('IDB layer (private)')`:**
Use `CachedFetch._internals` for direct put/get.
- Round-trip on `pages`: `_putRecord('pages', '/post/abc', { html: '<html>x</html>', etag: 'W/"v1"', lastModified: 'Wed, 01 Jan 2026 00:00:00 GMT', cachedAt: 1234567890 })`; `_getRecord('pages', '/post/abc')` returns deep-equal record.
- Round-trip on `api`: `_putRecord('api', '/api/trips/view/xyz', { body: '{"foo":"bar"}', contentType: 'application/json', etag: null, lastModified: null, cachedAt: 1700000000 })`; `_getRecord('api', '/api/trips/view/xyz')` returns deep-equal record.
- `_getRecord` of a never-put URL returns `undefined`.
- Stores are independent: put on `pages['/x']` does not affect `api['/x']`.
- IDB persists across DB handle re-open: put a record, manually re-open the DB by clearing the cached `_db` and calling `_getDb()` again, get the record, verify it survived. (Reaches into `_internals` is fine.)

Tests must verify behavior. Do NOT spy on `indexedDB.open`. Do NOT assert transaction counts.

**Verification:**
Run: `npm test -- cachedFetch`
Expected: all tests pass. Approximate count: ~14 cases.

Run: `npm test`
Expected: full suite still passes. No regressions.

**Commit:** `test(ios-offline-shell): cover cachedFetch IDB layer + bypass classifier`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: `cachedFetch` cache-miss + bypass + asJson routing

**Verifies:** `ios-offline-shell.AC3.1`, `ios-offline-shell.AC3.2`, `ios-offline-shell.AC3.7` (network passthrough).

**Files:**
- Modify: `src/bootstrap/cachedFetch.js` — replace the Task 1 `cachedFetch` stub with the cache-first read + write-through-on-miss implementation. Background revalidate is added in Task 5 (do NOT add it yet).

**Implementation:**

```js
async function cachedFetch(url, opts = {}) {
    const { asJson = false, signal } = opts;

    // Bypass: never cache, never read cache. Per AC3.7, mapCache owns these.
    if (isBypassed(url)) {
        const response = await fetch(url, { signal });
        return { response, source: 'network' };
    }

    const storeName = asJson ? STORE_API : STORE_PAGES;
    const db = await _getDb();

    // Cache-first read
    if (db) {
        const cached = await _getRecord(storeName, url);
        if (cached) {
            return { response: _toResponse(cached, asJson), source: 'cache' };
            // Background revalidate added in Task 5
        }
    }

    // Cache miss: fetch from network and write through
    const response = await fetch(url, { signal });
    if (response.ok && db) {
        await _writeThrough(storeName, url, response.clone(), asJson);
    }
    return { response, source: 'network' };
}
```

Helpers:

```js
function _toResponse(cached, asJson) {
    const headers = new Headers();
    headers.set('Content-Type', asJson ? (cached.contentType || 'application/json') : 'text/html');
    if (cached.etag) headers.set('ETag', cached.etag);
    if (cached.lastModified) headers.set('Last-Modified', cached.lastModified);
    const body = asJson ? cached.body : cached.html;
    return new Response(body, { status: 200, headers });
}

async function _writeThrough(storeName, url, responseClone, asJson) {
    const text = await responseClone.text();
    const etag = responseClone.headers.get('etag') || null;
    const lastModified = responseClone.headers.get('last-modified') || null;
    const cachedAt = Date.now();
    if (asJson) {
        const contentType = responseClone.headers.get('content-type') || 'application/json';
        await _putRecord(storeName, url, { body: text, contentType, etag, lastModified, cachedAt });
    } else {
        await _putRecord(storeName, url, { html: text, etag, lastModified, cachedAt });
    }
}
```

Notes for executor:
- `response.clone()` is essential: the original Response is returned to the caller; `.clone()` lets `_writeThrough` drain the body without consuming the caller's copy.
- AC3.1's three required fields (`cachedAt`, `etag`, `lastModified`) — `cachedAt` is always set (`Date.now()`); `etag` and `lastModified` are `null` when the response lacked the header. Tests assert both present-and-absent paths.
- AC3.2's "renders from cache immediately" — the `_toResponse` branch must never `await` a network call before returning. Verified in tests.
- AC3.7 — `mapCache.js` is unchanged; `git diff src/RoadTripMap/wwwroot/js/mapCache.js` must be empty after this phase.

**Verification:**
- File parses: `node --check src/bootstrap/cachedFetch.js`.
- Tests added in Task 4. Run: `npm test -- cachedFetch`. Expected: Task 2's tests still pass; Task 4's new tests pass after they land.

**Commit:** `feat(ios-offline-shell): cachedFetch cache-first read with write-through on miss`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Tests — cache-miss, cache-hit, bypass, asJson, offline, signal

**Verifies:** `ios-offline-shell.AC3.1`, `ios-offline-shell.AC3.2`, `ios-offline-shell.AC3.7`.

**Files:**
- Modify: `tests/js/cachedFetch.test.js` — add `describe('cachedFetch (cache-miss + cache-hit, no revalidate yet)')` block.

**Implementation:**

Mock `globalThis.fetch = vi.fn(...)` per test (matches [tests/js/bootstrap-loader.test.js:244](../../../tests/js/bootstrap-loader.test.js#L244)). Restore after each test (`afterEach(() => { vi.restoreAllMocks(); })`). Use the real `Response` constructor (jsdom provides it) for mock return values.

Tests required:

- **AC3.1 — write-through on first online visit (with headers)**:
  - Mock `fetch.mockResolvedValueOnce(new Response('<html>x</html>', { status: 200, headers: { 'ETag': 'W/"v1"', 'Last-Modified': 'Wed, 01 Jan 2026 00:00:00 GMT', 'Content-Type': 'text/html' } }))`.
  - `await CachedFetch.cachedFetch('/post/abc')` → returns `{ source: 'network' }`.
  - `_internals._getRecord('pages', '/post/abc')` returns a record with `html === '<html>x</html>'`, `etag === 'W/"v1"'`, `lastModified === 'Wed, 01 Jan 2026 00:00:00 GMT'`, and `typeof cachedAt === 'number'`.

- **AC3.1 — write-through when response lacks ETag/Last-Modified**:
  - Mock `fetch` to return a 200 with body `'<html>y</html>'` and no `ETag` / `Last-Modified` headers.
  - After `cachedFetch`, IDB record has `etag: null`, `lastModified: null`, `cachedAt` numeric.

- **AC3.2 — cache-first (cached response returned without awaiting any network call)**:
  - Pre-seed: `_internals._putRecord('pages', '/post/abc', { html: '<html>cached</html>', etag: 'W/"v1"', lastModified: null, cachedAt: 1 })`.
  - Mock `globalThis.fetch = vi.fn();` (Task 4 implementation does not yet fire background revalidate; Task 5 adds it).
  - `const result = await CachedFetch.cachedFetch('/post/abc')`.
  - `result.source === 'cache'` and `await result.response.text() === '<html>cached</html>'`.
  - `result.response.headers.get('Content-Type') === 'text/html'`.
  - `result.response.headers.get('ETag') === 'W/"v1"'`.
  - **Forward-compatible assertion** (works under both Task 4's no-revalidate state AND Task 5's revalidate state): assert that `result.source === 'cache'` and the returned response body matches the cached html — do NOT assert anything about `fetch` call count here. Task 6 adds dedicated tests covering when/how the background revalidate fetch is called. This way Task 5 doesn't need to retroactively edit this test.

- **AC3.7 — bypass passthrough (`/api/poi`)**:
  - Mock `fetch.mockResolvedValueOnce(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))`.
  - `await CachedFetch.cachedFetch('/api/poi?minLat=1')` → `{ source: 'network' }`.
  - **No IDB write occurred**: `_internals._getRecord('pages', '/api/poi?minLat=1')` and `_internals._getRecord('api', '/api/poi?minLat=1')` both return `undefined`.

- **AC3.7 — bypass passthrough (`/api/park-boundaries`)**: same shape with `/api/park-boundaries?detail=full`.

- **`asJson` routing**:
  - Mock `fetch.mockResolvedValueOnce(new Response('{"x":1}', { status: 200, headers: { 'Content-Type': 'application/json' } }))`.
  - `await CachedFetch.cachedFetch('/api/trips/view/xyz', { asJson: true })`.
  - IDB write went to `api` store: `_internals._getRecord('api', '/api/trips/view/xyz')` returns `{ body: '{"x":1}', contentType: 'application/json', etag: null, lastModified: null, cachedAt: <number> }`.
  - `_internals._getRecord('pages', '/api/trips/view/xyz')` returns `undefined`.
  - Subsequent call returns `{ source: 'cache' }`; `await response.json()` returns `{ x: 1 }`.

- **Cache miss + network failure rejects**:
  - `globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Network request failed'))`.
  - `await expect(CachedFetch.cachedFetch('/post/abc')).rejects.toThrow('Network request failed')`.
  - IDB stays empty: `_internals._getRecord('pages', '/post/abc')` returns `undefined`.

- **Cache miss + non-OK response → no write but resolves**:
  - Mock `fetch` returns `new Response('not found', { status: 404 })`.
  - `cachedFetch('/post/abc')` resolves with `{ source: 'network', response }`; `response.status === 404`.
  - IDB record is NOT written (cache only successful responses).

- **`signal` propagation**:
  - `const ctrl = new AbortController(); globalThis.fetch = vi.fn().mockResolvedValue(new Response('x'));`
  - `await CachedFetch.cachedFetch('/post/abc', { signal: ctrl.signal });`
  - `expect(globalThis.fetch).toHaveBeenCalledWith('/post/abc', expect.objectContaining({ signal: ctrl.signal }));`

- **IDB unavailable → network passthrough, no caching, no throw**:
  - Monkey-patch `indexedDB.open` to fire `onerror` synchronously: `vi.spyOn(indexedDB, 'open').mockImplementation((name, ver) => { const req = {}; setTimeout(() => req.onerror && req.onerror({ target: req }), 0); return req; });`
  - Mock fetch returns 200.
  - `cachedFetch('/post/abc')` resolves with `{ source: 'network' }` (does NOT throw).
  - Restore `indexedDB.open` in afterEach.

**Verification:**
Run: `npm test -- cachedFetch`
Expected: all tests pass. Combined cachedFetch test count ~24.

Run: `npm test`
Expected: full suite passes.

**Commit:** `test(ios-offline-shell): cache-miss/cache-hit/bypass/asJson coverage for cachedFetch`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-6) -->

<!-- START_TASK_5 -->
### Task 5: Background revalidate (cache-hit path)

**Verifies:** `ios-offline-shell.AC3.3`, `ios-offline-shell.AC3.5`.

**Files:**
- Modify: `src/bootstrap/cachedFetch.js` — add `_backgroundRevalidate` helper and wire it into the cache-hit branch of `cachedFetch` from Task 3.

**Implementation:**

```js
async function _backgroundRevalidate(url, asJson, cached) {
    const headers = {};
    if (cached.etag) headers['If-None-Match'] = cached.etag;
    if (cached.lastModified) headers['If-Modified-Since'] = cached.lastModified;
    let response;
    try {
        response = await fetch(url, { headers });
    } catch {
        return;  // AC3.5: silent on network error
    }
    if (response.status === 304) return;  // not modified — keep cache
    if (!response.ok) return;             // server error — keep stale
    const db = await _getDb();
    if (!db) return;
    const storeName = asJson ? STORE_API : STORE_PAGES;
    await _writeThrough(storeName, url, response, asJson);
    // Live document is NOT updated. Phase 3 (fetchAndSwap) enforces this externally for AC3.4.
}
```

Update the cache-hit branch of `cachedFetch` from Task 3:

```js
if (cached) {
    void _backgroundRevalidate(url, asJson, cached);  // fire-and-forget; intentional un-awaited promise
    return { response: _toResponse(cached, asJson), source: 'cache' };
}
```

Notes for executor:
- The unawaited `void _backgroundRevalidate(...)` is required by AC3.2 (cache-first). The cached response must be returned without awaiting any network call.
- The background promise must not throw into the caller's stack. The `try { await fetch(...) } catch { return; }` catches network errors. Other code paths (`response.status === 304`, `!response.ok`, `_getDb() === null`) all return without throwing. `_writeThrough` may reject if IDB is broken between the read and the write — wrap the call in `try { await _writeThrough(...) } catch { /* swallow */ }` or chain `.catch(() => {})` to keep the promise quiet. (Pick whichever; tests assert via `console.error` not being called.)
- Conditional headers are sent ONLY when the cached record carries them. Don't send `If-None-Match: null`.
- A `200` response means content changed → write through to IDB exactly the way Task 3's miss path does (reuse `_writeThrough`).
- A `304` or any non-OK response → keep stale cache, no write.

**Verification:**
- `node --check src/bootstrap/cachedFetch.js`.
- Tests added in Task 6. After Task 6: `npm test -- cachedFetch` passes; Tasks 2 and 4 tests still pass.

**Commit:** `feat(ios-offline-shell): background revalidate on cache hit (cache-first + revalidate)`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Tests — background revalidate (200 updates, 304 no-op, network error swallow)

**Verifies:** `ios-offline-shell.AC3.3`, `ios-offline-shell.AC3.5`.

**Files:**
- Modify: `tests/js/cachedFetch.test.js` — add `describe('cachedFetch background revalidate')` block.

(Task 4's AC3.2 test was written forward-compatibly — it asserts `source === 'cache'` + body match, with NO `fetch` call-count assertion — so no retroactive edit to Task 4 is needed.)

**Implementation:**

Background revalidation is fire-and-forget. To make tests deterministic, follow the project pattern from [tests/js/bootstrap-loader.test.js:53-56](../../../tests/js/bootstrap-loader.test.js#L53-L56) — flush microtasks + the next macrotask:

```js
async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
}
```

Tests required:

- **AC3.3 — 200 updates IDB, sends `If-None-Match`**:
  - Pre-seed `pages['/post/abc']` with `{ html: 'old', etag: 'W/"v1"', lastModified: 'Wed, 01 Jan 2026 00:00:00 GMT', cachedAt: 1 }`.
  - Mock `fetch.mockResolvedValueOnce(new Response('new', { status: 200, headers: { 'ETag': 'W/"v2"' } }))`.
  - `const result = await CachedFetch.cachedFetch('/post/abc');`
  - Immediately: `result.source === 'cache'` and `await result.response.text() === 'old'` (caller sees stale per AC3.2 + AC3.4).
  - `await flushPromises();`
  - IDB now: `_getRecord('pages', '/post/abc')` returns `{ html: 'new', etag: 'W/"v2"', lastModified: null, cachedAt: <number greater than 1> }`.
  - The conditional fetch carried the right header: `expect(fetch).toHaveBeenCalledWith('/post/abc', expect.objectContaining({ headers: expect.objectContaining({ 'If-None-Match': 'W/"v1"', 'If-Modified-Since': 'Wed, 01 Jan 2026 00:00:00 GMT' }) }))`.

- **AC3.3 — 304 no-op**:
  - Pre-seed same as above. Mock `fetch.mockResolvedValueOnce(new Response(null, { status: 304 }))`.
  - `await CachedFetch.cachedFetch('/post/abc'); await flushPromises();`
  - IDB record unchanged (`html === 'old'`, `etag === 'W/"v1"'`, `cachedAt === 1`).

- **AC3.5 — network error swallowed**:
  - Pre-seed `pages['/post/abc']`. Mock `fetch.mockRejectedValueOnce(new TypeError('offline'))`.
  - `const errSpy = vi.spyOn(console, 'error');`
  - `const result = await CachedFetch.cachedFetch('/post/abc');` → `{ source: 'cache', response }` (does NOT reject).
  - `await flushPromises();`
  - IDB record unchanged.
  - `expect(errSpy).not.toHaveBeenCalled()` — revalidate failures are silent.

- **AC3.3 — no conditional headers when cached has none**:
  - Pre-seed cached record with `etag: null, lastModified: null, html: 'old'`.
  - Mock `fetch.mockResolvedValueOnce(new Response('new', { status: 200 }))`.
  - `await CachedFetch.cachedFetch('/post/abc'); await flushPromises();`
  - The fetch call carried headers `{}` (no `If-None-Match`, no `If-Modified-Since`):
    `expect(fetch).toHaveBeenCalledWith('/post/abc', { headers: {} })`.
  - IDB updated: `html === 'new'`.

- **AC3.3 — asJson path updates `api` store, not `pages`**:
  - Pre-seed `api['/api/trips/view/xyz']` with `{ body: '{"a":1}', contentType: 'application/json', etag: 'W/"v1"', lastModified: null, cachedAt: 1 }`.
  - Mock `fetch.mockResolvedValueOnce(new Response('{"a":2}', { status: 200, headers: { 'Content-Type': 'application/json', 'ETag': 'W/"v2"' } }))`.
  - `await CachedFetch.cachedFetch('/api/trips/view/xyz', { asJson: true }); await flushPromises();`
  - `_getRecord('api', '/api/trips/view/xyz')` → `body === '{"a":2}'`, `etag === 'W/"v2"'`.
  - `_getRecord('pages', '/api/trips/view/xyz')` → `undefined`.

- **AC3.3 — 5xx response no-op**:
  - Pre-seed cached record. Mock `fetch.mockResolvedValueOnce(new Response('boom', { status: 500 }))`.
  - `await CachedFetch.cachedFetch('/post/abc'); await flushPromises();`
  - IDB record unchanged. `console.error` not called.

**Verification:**
Run: `npm test -- cachedFetch`
Expected: all cachedFetch tests pass. Combined count ~32 cases.

Run: `npm test`
Expected: full suite passes. No other test file regressed.

Run final regression check:
```bash
git diff --stat src/RoadTripMap/wwwroot/js/mapCache.js src/RoadTripMap/wwwroot/js/uploadTransport.js
# Expected: empty (Phase 1 must not touch these files; AC3.7 + AC4.4/4.5 verify in later phases)
```

**Commit:** `test(ios-offline-shell): background revalidate (200/304/error/5xx) coverage`
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_C -->
