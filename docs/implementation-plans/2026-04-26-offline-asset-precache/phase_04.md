# Offline Asset Pre-Cache — Phase 4: Pre-fetch triggers and end-to-end AC

**Goal:** Trigger the pre-cache automatically (eager from the bootstrap loader, lazy from the page-fetch success path) and pin the locked DoD acceptance test as an integration test. Also pin AC1.1 (manifest produced) as an automated assertion against the checked-in `asset-manifest.json`.

**Architecture:** Two trigger paths.
- **Eager (bootstrap):** After the first swap completes and the bootstrap-progress shim is removed, `loader.js` fires `void AssetCache.precacheFromManifest()` as fire-and-forget — does not block paint.
- **Lazy (per page):** When `cachedFetch` writes through a fresh HTML response (cache miss + 200, or background revalidate + 200), `cachedFetch.js` fires `void AssetCache.lazyPrecacheFromHtml(html)`. The new helper parses the HTML with `DOMParser`, extracts `<link rel="stylesheet">` + `<script src>` URLs, filters them through the Phase 3 allow-list (`_isCacheableAssetUrl`), skips entries already in IDB, and downloads the rest with a server-bytes-derived sha256 (computed via `crypto.subtle.digest('SHA-256', ...)`) so a future eager pre-fetch can reconcile against the manifest without a needless re-download.

The Phase 4 wiring closes the loop: the device populates `pages` + `assets` opportunistically while online, and Phase 3's render-time rewrite serves them when offline. The new `tests/js/assetCache-integration.test.js` simulates the full kill-app → airplane mode → launch → navigate flow to prove the AC.

**Tech Stack:** Vanilla ES2017 JS, `DOMParser`, `crypto.subtle.digest`. Tests: vitest + JSDOM + `fake-indexeddb`. No new external dependencies.

**Scope:** Phase 4 of 4 from `docs/design-plans/2026-04-26-offline-asset-precache.md`.

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### offline-asset-precache.AC1: Manifest produced and consumed
- **offline-asset-precache.AC1.1 Success:** `npm run build:bundle` produces a syntactically valid `src/RoadTripMap/wwwroot/asset-manifest.json` containing one entry per file under `wwwroot/css/*.css`, `wwwroot/js/*.js`, and `wwwroot/ios.css`, each with a non-zero `size` (number, bytes) and a 64-character hex `sha256`.

### offline-asset-precache.AC3: Offline rendering (DoD acceptance test)
- **offline-asset-precache.AC3.1 Success:** Given the `RoadTripPageCache` `pages` and `assets` stores are populated for a given page from a prior online session, and `globalThis.fetch` rejects all requests, navigating to that page via `FetchAndSwap.fetchAndSwap` produces a document whose `<head>` contains the cached CSS as `<style>` and applied to the `<body>`.
- **offline-asset-precache.AC3.2 Success:** Under the same conditions, every cached `<script src>` reference resolves through a blob URL and the script's side effects (e.g., `RoadTrip.onPageLoad` registration, page-specific module init) are observable in the document.

### offline-asset-precache.AC4: Invariants preserved
- **offline-asset-precache.AC4.5 Success:** When `precacheFromManifest()` is invoked on bootstrap, it does not block the first paint: the eager pre-fetch fires after the first swap completes (i.e., the user-visible render proceeds without awaiting the manifest fetch).

### offline-asset-precache.AC5: Lazy fallback
- **offline-asset-precache.AC5.1 Success:** When the manifest fetch fails on first launch online but a page fetch succeeds via `cachedFetch`, the lazy pre-fetch path extracts that page's `/css/*`, `/js/*`, `/ios.css` references and writes their bytes into the `assets` IDB store as a side effect of the successful navigation. After this path runs, AC3.1 and AC3.2 hold for that page on a subsequent offline visit.

---

## Codebase verification findings (2026-04-27)

These notes drove the task design — read for context, skip for action.

- ✓ `src/bootstrap/loader.js` lines 52-56 are the bootstrap-completion sequence: `await FetchAndSwap.fetchAndSwap(bootUrl)` (line 52) → progress shim removal (lines 54-56) → `} catch (err) {` (line 57). Phase 4 inserts the eager-fire-and-forget call between line 56 and the `catch` block.
- ✓ `src/bootstrap/cachedFetch.js` line 293 is the cache-miss success write-through path: `await _writeThrough(storeName, url, response.clone(), asJson)`. Phase 4 inserts the lazy trigger immediately after this on the HTML path (`asJson === false`).
- ✓ `cachedFetch.js` lines 213-254 are `_backgroundRevalidate`. The 200 path also calls `_writeThrough` (around line 245). Phase 4 mirrors the lazy trigger here so a stale cache that gets revalidated to a newer page also re-scans for new asset URLs.
- ✓ Browser sha256 API: `crypto.subtle.digest('SHA-256', arrayBuffer)` returns a Promise of an ArrayBuffer; hex-encode by mapping each byte to a 2-digit hex string. Available in JSDOM via the `webcrypto` polyfill (already present in vitest's JSDOM environment as of v1+; verify by spot-checking that `crypto.subtle` is not undefined in `tests/js/setup.js`'s globals).
- ✓ Integration test precedent: `tests/js/trip-photos-offline.test.js` (~11 KB) pre-populates IDB, stubs `globalThis.fetch` with `vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))`, calls `FetchAndSwap.fetchAndSwap`, asserts DOM state. Mirror this pattern for `tests/js/assetCache-integration.test.js`.
- ⚠ JSDOM does NOT execute `<script src>` bytes (confirmed Phase 3 finding). For AC3.2 the test must verify the rewrite plumbing (blob URL minted, `dataset.assetCacheOrigin` set) AND simulate execution by `eval`-ing the cached bytes against `globalThis` once the integration test has confirmed the swap is complete. This is acceptable because: (a) the cached bytes ARE what a browser would execute; (b) JSDOM's appendChild-stubbed onload fires with no-op execution. Document this limitation in the test.
- ✓ CLAUDE.md (root) "Invariants" section currently says: "iOS Offline Shell page cache lives in IndexedDB RoadTripPageCache with two object stores: pages (HTML documents) and api (JSON payloads...)". This is stale after Phase 2 — there are now THREE stores. Phase 4 updates it.

---

## Skills to activate before implementing

- `ed3d-house-style:coding-effectively` — always
- `ed3d-house-style:writing-good-tests` — for the integration test, prefer integration-style assertions over unit-style mocks.
- `ed3d-house-style:howto-functional-vs-imperative` — `lazyPrecacheFromHtml`'s URL-extraction logic is pure (input: HTML string + cached summaries set, output: list of URLs to fetch). Keep it pure-ish so it can be tested without IDB mocks.
- `ed3d-plan-and-execute:test-driven-development` — for the integration test, write the AC assertion first, then drive the wiring tasks until it passes.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add `lazyPrecacheFromHtml` to `src/bootstrap/assetCache.js`

**Verifies (in concert with Task 2's tests):** `offline-asset-precache.AC5.1` (mechanism — full AC verified end-to-end in Task 6).

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/src/bootstrap/assetCache.js` (add `lazyPrecacheFromHtml`, `_extractAssetUrlsFromHtml`, `_computeSha256Hex`, `_downloadAssetUnknownSha256`; update `_internals` and the public export).

**Step 1: Add a sha256 helper**

Below the existing `_guessContentType` helper (added in Phase 2), insert:

```javascript
  // Browser sha256: Uint8Array → 64-char hex string.
  // crypto.subtle.digest is part of WebCrypto, available in modern browsers and JSDOM.
  async function _computeSha256Hex(arrayBuffer) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const bytes = new Uint8Array(digest);
      let hex = '';
      for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
      }
      return hex;
    } catch {
      return null;
    }
  }
```

**Step 2: Add a sha256-unknown download helper**

Below `_computeSha256Hex`, insert:

```javascript
  // Lazy pre-fetch variant of _downloadAsset: no expected sha256 (no manifest).
  // Computes sha256 from the response bytes and stores it. A subsequent eager
  // precacheFromManifest can then diff against the manifest sha256 normally
  // (likely a no-op since we just downloaded the deployed bytes).
  async function _downloadAssetUnknownSha256(url) {
    try {
      const response = await fetch(_absoluteUrl(url), {
        method: 'GET',
        cache: 'no-cache',
      });
      if (!response || !response.ok) {
        return;
      }
      const bytes = await response.arrayBuffer();
      const sha256 = await _computeSha256Hex(bytes);
      if (sha256 === null) {
        return; // crypto.subtle unavailable — abort defensively
      }
      const contentType = response.headers.get('Content-Type') || _guessContentType(url);
      const etag = response.headers.get('ETag');
      const lastModified = response.headers.get('Last-Modified');

      const record = {
        url,
        bytes,
        contentType,
        sha256,
        etag: etag || null,
        lastModified: lastModified || null,
        cachedAt: Date.now(),
      };
      await _putAsset(record);
    } catch (err) {
      // Swallow — lazy pre-fetch is best-effort.
    }
  }
```

**Step 3: Add the URL-extraction helper (pure function)**

Below `_downloadAssetUnknownSha256`, insert:

```javascript
  // Pure (no I/O): given an HTML string, extract every cacheable asset URL
  // (filtered by the Phase 3 allow-list). Returns an array of canonical
  // pathnames — duplicates removed, query strings stripped.
  function _extractAssetUrlsFromHtml(html) {
    if (typeof html !== 'string' || html.length === 0) {
      return [];
    }
    let parsed;
    try {
      parsed = new DOMParser().parseFromString(html, 'text/html');
    } catch {
      return [];
    }

    const urls = new Set();

    const linkEls = parsed.querySelectorAll('link[rel="stylesheet"][href]');
    for (const link of linkEls) {
      const href = link.getAttribute('href');
      if (!href) continue;
      const pathname = _normalizeAssetUrl(href);
      if (_isCacheableAssetUrl(pathname)) {
        urls.add(pathname);
      }
    }

    const scriptEls = parsed.querySelectorAll('script[src]');
    for (const script of scriptEls) {
      const src = script.getAttribute('src');
      if (!src) continue;
      const pathname = _normalizeAssetUrl(src);
      if (_isCacheableAssetUrl(pathname)) {
        urls.add(pathname);
      }
    }

    return Array.from(urls);
  }
```

**Step 4: Add the public `lazyPrecacheFromHtml` method**

Below `_extractAssetUrlsFromHtml`, insert:

```javascript
  // AC5.1: extract asset URLs from a freshly-fetched HTML page and download
  // any not yet in IDB. Best-effort — every error is swallowed. Designed
  // to be invoked as `void lazyPrecacheFromHtml(html)` (fire-and-forget).
  async function lazyPrecacheFromHtml(html) {
    const urls = _extractAssetUrlsFromHtml(html);
    if (urls.length === 0) {
      return;
    }

    let summaries;
    try {
      summaries = await _listAssetSummaries();
    } catch {
      summaries = new Map();
    }

    const missing = urls.filter((u) => !summaries.has(u));
    if (missing.length === 0) {
      return;
    }

    await Promise.allSettled(missing.map((u) => _downloadAssetUnknownSha256(u)));
  }
```

**Step 5: Update the module export**

Add `lazyPrecacheFromHtml` to the public surface and the new helpers to `_internals`:

```javascript
  globalThis.AssetCache = {
    precacheFromManifest,
    lazyPrecacheFromHtml,
    getCachedText,
    getCachedBlobUrl,
    rewriteAssetTags,
    _internals: {
      _getDb,
      _closeDb,
      _putAsset,
      _getAsset,
      _deleteAsset,
      _listAssetSummaries,
      _absoluteUrl,
      _mintBlobUrl,
      _diffManifest,
      _downloadAsset,
      _downloadAssetUnknownSha256,
      _computeSha256Hex,
      _extractAssetUrlsFromHtml,
      _guessContentType,
      _normalizeAssetUrl,
      _isCacheableAssetUrl,
      _revokePendingBlobUrls,
      _pendingBlobUrls,
      DB_NAME,
      DB_VERSION,
      STORE_ASSETS,
      MANIFEST_PATH,
      APP_BASE,
    },
  };
```

**Step 6: Smoke-check syntax**

```bash
node --check src/bootstrap/assetCache.js
```

Expected: no output.

**Do NOT commit yet** — Task 2 adds the tests.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Extend `tests/js/assetCache.test.js` with `lazyPrecacheFromHtml` tests

**Verifies:** Mechanism for `offline-asset-precache.AC5.1` (URL extraction, IDB-skip semantics, sha256 computation). Full AC5.1 verified end-to-end in Task 6.

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/tests/js/assetCache.test.js`

**Step 1: Append new `describe` blocks**

```javascript
describe('AssetCache._internals._extractAssetUrlsFromHtml (pure)', () => {
  it('extracts /css/styles.css from a <link rel="stylesheet"> in head', () => {
    const html = '<html><head><link rel="stylesheet" href="/css/styles.css?v=4"></head><body></body></html>';
    const urls = globalThis.AssetCache._internals._extractAssetUrlsFromHtml(html);
    expect(urls).toContain('/css/styles.css');
  });

  it('extracts /js/foo.js from a <script src> in head or body', () => {
    const html = '<html><head><script src="/js/foo.js"></script></head><body><script src="/js/bar.js"></script></body></html>';
    const urls = globalThis.AssetCache._internals._extractAssetUrlsFromHtml(html);
    expect(urls).toContain('/js/foo.js');
    expect(urls).toContain('/js/bar.js');
  });

  it('does NOT include external CDN URLs (AC2.5)', () => {
    const html = '<html><head><link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css"></head><body></body></html>';
    const urls = globalThis.AssetCache._internals._extractAssetUrlsFromHtml(html);
    expect(urls).not.toContain('https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css');
    expect(urls.length).toBe(0);
  });

  it('does NOT include /lib/exifr/full.umd.js (AC2.5)', () => {
    const html = '<html><body><script src="/lib/exifr/full.umd.js"></script></body></html>';
    const urls = globalThis.AssetCache._internals._extractAssetUrlsFromHtml(html);
    expect(urls.length).toBe(0);
  });

  it('deduplicates repeated references', () => {
    const html = '<html><head><link rel="stylesheet" href="/css/styles.css"><link rel="stylesheet" href="/css/styles.css?v=4"></head><body></body></html>';
    const urls = globalThis.AssetCache._internals._extractAssetUrlsFromHtml(html);
    expect(urls.filter((u) => u === '/css/styles.css').length).toBe(1);
  });

  it('returns [] on malformed HTML', () => {
    const urls = globalThis.AssetCache._internals._extractAssetUrlsFromHtml('not html at all');
    expect(Array.isArray(urls)).toBe(true);
  });

  it('returns [] on empty/non-string input', () => {
    expect(globalThis.AssetCache._internals._extractAssetUrlsFromHtml('')).toEqual([]);
    expect(globalThis.AssetCache._internals._extractAssetUrlsFromHtml(null)).toEqual([]);
    expect(globalThis.AssetCache._internals._extractAssetUrlsFromHtml(undefined)).toEqual([]);
  });
});

describe('AssetCache._internals._computeSha256Hex', () => {
  it('returns a 64-character hex string for known input', async () => {
    // sha256('hello') = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    const bytes = new TextEncoder().encode('hello').buffer;
    const hex = await globalThis.AssetCache._internals._computeSha256Hex(bytes);
    expect(hex).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('returns null when crypto.subtle is unavailable', async () => {
    // Stub crypto.subtle.digest to throw.
    const originalDigest = crypto.subtle.digest;
    crypto.subtle.digest = vi.fn(() => { throw new Error('unavailable'); });
    try {
      const bytes = new TextEncoder().encode('hello').buffer;
      const hex = await globalThis.AssetCache._internals._computeSha256Hex(bytes);
      expect(hex).toBeNull();
    } finally {
      crypto.subtle.digest = originalDigest;
    }
  });
});

describe('AssetCache.lazyPrecacheFromHtml', () => {
  it('downloads every cacheable URL not already in IDB', async () => {
    // Empty cache. HTML references /css/styles.css and /js/foo.js.
    const html = '<html><head><link rel="stylesheet" href="/css/styles.css"><script src="/js/foo.js"></script></head></html>';
    const cssBytes = new TextEncoder().encode('body{}').buffer;
    const jsBytes = new TextEncoder().encode('//').buffer;

    globalThis.fetch = vi.fn(async (url) => {
      if (url.endsWith('/css/styles.css')) {
        return new Response(cssBytes, { status: 200, headers: { 'Content-Type': 'text/css' } });
      }
      if (url.endsWith('/js/foo.js')) {
        return new Response(jsBytes, { status: 200, headers: { 'Content-Type': 'application/javascript' } });
      }
      return new Response(null, { status: 404 });
    });

    await globalThis.AssetCache.lazyPrecacheFromHtml(html);

    const cssRecord = await globalThis.AssetCache._internals._getAsset('/css/styles.css');
    expect(cssRecord).not.toBeNull();
    expect(cssRecord.contentType).toBe('text/css');
    expect(typeof cssRecord.sha256).toBe('string');
    expect(cssRecord.sha256.length).toBe(64);

    const jsRecord = await globalThis.AssetCache._internals._getAsset('/js/foo.js');
    expect(jsRecord).not.toBeNull();
  });

  it('skips URLs already in IDB (sha256 match not required)', async () => {
    // Pre-populate /css/styles.css.
    const existingBytes = new TextEncoder().encode('cached body').buffer;
    await globalThis.AssetCache._internals._putAsset({
      url: '/css/styles.css',
      bytes: existingBytes,
      contentType: 'text/css',
      sha256: 'preexisting-sha',
      etag: null,
      lastModified: null,
      cachedAt: Date.now() - 60000,
    });

    // Stub fetch to throw on any call — should never be invoked.
    globalThis.fetch = vi.fn(() => { throw new Error('lazy should not re-download'); });

    const html = '<html><head><link rel="stylesheet" href="/css/styles.css"></head></html>';
    await globalThis.AssetCache.lazyPrecacheFromHtml(html);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    const record = await globalThis.AssetCache._internals._getAsset('/css/styles.css');
    expect(record.sha256).toBe('preexisting-sha'); // unchanged
  });

  it('does NOT touch /api/* even if a malformed page references them', async () => {
    const html = '<html><body><script src="/api/poi"></script></body></html>';
    globalThis.fetch = vi.fn(() => { throw new Error('should not fetch /api/poi'); });
    await globalThis.AssetCache.lazyPrecacheFromHtml(html);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('swallows individual fetch failures (best-effort)', async () => {
    const html = '<html><head><script src="/js/a.js"></script><script src="/js/b.js"></script></head></html>';
    globalThis.fetch = vi.fn(async (url) => {
      if (url.endsWith('/js/a.js')) {
        throw new TypeError('Failed to fetch'); // simulated network error
      }
      return new Response(new TextEncoder().encode('//').buffer, { status: 200, headers: { 'Content-Type': 'application/javascript' } });
    });

    await expect(globalThis.AssetCache.lazyPrecacheFromHtml(html)).resolves.toBeUndefined();

    // /js/a.js failed → no record
    expect(await globalThis.AssetCache._internals._getAsset('/js/a.js')).toBeNull();
    // /js/b.js succeeded
    expect(await globalThis.AssetCache._internals._getAsset('/js/b.js')).not.toBeNull();
  });

  it('handles HTML with no cacheable URLs gracefully', async () => {
    const html = '<html><body>just text</body></html>';
    globalThis.fetch = vi.fn();
    await expect(globalThis.AssetCache.lazyPrecacheFromHtml(html)).resolves.toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run the test file**

```bash
npm test -- tests/js/assetCache.test.js
```

Expected: existing tests pass; new tests pass.

**Step 3: Run the full JS suite**

```bash
npm test
```

Expected: all tests pass.

**Step 4: Commit**

```bash
git add src/bootstrap/assetCache.js tests/js/assetCache.test.js
git commit -m "$(cat <<'EOF'
feat(bootstrap): add AssetCache.lazyPrecacheFromHtml for per-page asset pre-fetch

Adds lazyPrecacheFromHtml(html) to AssetCache. Parses an HTML string
with DOMParser, extracts every <link rel="stylesheet"> and <script src>
URL whose pathname matches the /css/, /js/, /ios.css allow-list (Phase 3
_isCacheableAssetUrl), skips entries already in the assets IDB store,
and downloads the rest with sha256 computed from the response bytes via
crypto.subtle.digest.

Designed as the safety-net pre-fetch for the case where the eager
manifest pre-fetch fails on first launch but a page fetch still
succeeds — wired up in cachedFetch.js in the next commit.

Verifies the mechanism for offline-asset-precache.AC5.1; the full AC
is pinned end-to-end in Phase 4's integration test.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->
### Task 3: Wire eager pre-fetch trigger into `loader.js`

**Verifies:** `offline-asset-precache.AC4.5` (with Task 5's tests).

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/src/bootstrap/loader.js`

**Step 1: Insert the fire-and-forget call after the first swap and progress shim removal**

The current sequence at lines 52-57:

```javascript
        await FetchAndSwap.fetchAndSwap(bootUrl);

        // Remove the bootstrap-progress shim now that the real page has rendered.
        const progress = document.getElementById('bootstrap-progress');
        if (progress) progress.remove();
    } catch (err) {
```

Insert the eager pre-fetch call between the progress removal and the catch:

```javascript
        await FetchAndSwap.fetchAndSwap(bootUrl);

        // Remove the bootstrap-progress shim now that the real page has rendered.
        const progress = document.getElementById('bootstrap-progress');
        if (progress) progress.remove();

        // AC4.5: Eager pre-fetch fires AFTER the first swap completes and is
        // strictly fire-and-forget. The .catch swallows any rejection so an
        // unhandled-rejection warning never fires on a transient manifest
        // outage. AssetCache.precacheFromManifest itself swallows network/
        // parse/IDB errors, but the .catch is defensive belt-and-suspenders.
        if (typeof globalThis.AssetCache !== 'undefined' && typeof globalThis.AssetCache.precacheFromManifest === 'function') {
            void globalThis.AssetCache.precacheFromManifest().catch(() => {});
        }
    } catch (err) {
```

**Step 2: Smoke-check syntax**

```bash
node --check src/bootstrap/loader.js
```

Expected: no output.

**Step 3: Do NOT commit yet** — Task 5 adds the tests.
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Wire lazy pre-fetch trigger into `cachedFetch.js`

**Verifies:** `offline-asset-precache.AC5.1` (with Task 5's + Task 6's tests).

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/src/bootstrap/cachedFetch.js`

**Step 1: Add a small helper near the top of the IIFE**

After the existing constants (around line 11, after `APP_BASE`), add:

```javascript
  // AC5.1 lazy pre-fetch: fire-and-forget after a fresh HTML write-through.
  // Defensive: AssetCache may not be loaded (test environments evaluating
  // cachedFetch.js without first eval'ing assetCache.js).
  function _maybeLazyPrecache(html, asJson) {
    if (asJson) return; // never run on JSON pages
    if (typeof globalThis.AssetCache === 'undefined') return;
    if (typeof globalThis.AssetCache.lazyPrecacheFromHtml !== 'function') return;
    void globalThis.AssetCache.lazyPrecacheFromHtml(html).catch(() => {});
  }
```

**Step 2: Wire the helper into the cache-miss success path**

The existing block at lines 290-294 (numbers approximate; locate by content):

```javascript
        const response = await fetch(_absoluteUrl(url), { signal });
        if (response.ok && db) {
          await _writeThrough(storeName, url, response.clone(), asJson);
        }
```

Capture the HTML body so we can pass it to the lazy helper without consuming the response a second time. Replace the block with:

```javascript
        const response = await fetch(_absoluteUrl(url), { signal });
        if (response.ok) {
          // Buffer body once so we can both write through and lazy-pre-fetch
          // without double-consuming response.body.
          const bodyText = await response.clone().text();
          if (db) {
            await _writeThrough(storeName, url, response.clone(), asJson);
          }
          _maybeLazyPrecache(bodyText, asJson);
        }
```

**Step 3: Wire the helper into `_backgroundRevalidate`**

The existing 200 path inside `_backgroundRevalidate` (lines 237-249 of `cachedFetch.js`) reads:

```javascript
      const db = await _getDb();
      if (!db) {
        // IDB unavailable — silently skip write
        return;
      }

      const storeName = asJson ? STORE_API : STORE_PAGES;
      try {
        await _writeThrough(storeName, url, response, asJson);
      } catch {
        // IDB write error — swallowed silently
        return;
      }
```

Replace it with the following — note that `_writeThrough` consumes its `responseClone` argument by calling `.text()` on it, so we must `clone()` the response BEFORE calling `_writeThrough`, AND we capture `bodyText` from a separate clone to feed `_maybeLazyPrecache`:

```javascript
      const db = await _getDb();
      if (!db) {
        // IDB unavailable — silently skip write
        return;
      }

      // Phase 4: buffer body once for both write-through and lazy pre-fetch.
      let bodyText;
      try {
        bodyText = await response.clone().text();
      } catch {
        // Body read failed — keep stale cache, no lazy pre-fetch.
        return;
      }

      const storeName = asJson ? STORE_API : STORE_PAGES;
      try {
        await _writeThrough(storeName, url, response.clone(), asJson);
      } catch {
        // IDB write error — swallowed silently
        return;
      }
      _maybeLazyPrecache(bodyText, asJson);
```

The change-set is:
1. Insert the `let bodyText; try { bodyText = await response.clone().text(); } catch { return; }` block between the `if (!db)` check and the `const storeName = ...` line.
2. Change `_writeThrough(storeName, url, response, asJson)` to `_writeThrough(storeName, url, response.clone(), asJson)` (was passing `response` directly; now passes a fresh clone — both are valid because the function only consumes its third argument).
3. Append `_maybeLazyPrecache(bodyText, asJson);` after the `try {} catch {}` write-through block.

**Step 4: Smoke-check syntax**

```bash
node --check src/bootstrap/cachedFetch.js
```

Expected: no output.

**Step 5: Do NOT commit yet** — Task 5 adds the tests for both triggers.
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Tests for eager + lazy triggers (and AC4.5 non-blocking assertion)

**Verifies:** `offline-asset-precache.AC4.5` (eager doesn't block first paint), and the wiring half of `offline-asset-precache.AC5.1`.

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/tests/js/bootstrap-loader.test.js` (eager-trigger tests)
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/tests/js/cachedFetch.test.js` (lazy-trigger tests)

**Step 1: Append eager-trigger tests to `bootstrap-loader.test.js`**

Inside a new `describe('Phase 4 eager pre-fetch trigger', ...)` block at the end of the file:

```javascript
describe('Phase 4 eager pre-fetch trigger', () => {
  it('fires AssetCache.precacheFromManifest after the first swap completes', async () => {
    const precacheSpy = vi.fn(() => Promise.resolve());

    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('<html><body>home</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }))
    );

    // beforeEach must have eval'd assetCache.js. Replace its precacheFromManifest with the spy.
    globalThis.AssetCache.precacheFromManifest = precacheSpy;

    await runLoader();

    expect(precacheSpy).toHaveBeenCalledTimes(1);
    // Body content is rendered (proves first paint completed before AssetCache call).
    expect(document.body.textContent).toContain('home');
  });

  it('AC4.5: precacheFromManifest does not block first paint', async () => {
    // Stub precacheFromManifest to return a never-resolving Promise.
    let precacheCalled = false;
    globalThis.AssetCache.precacheFromManifest = vi.fn(() => {
      precacheCalled = true;
      return new Promise(() => {}); // intentionally never settles
    });

    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('<html><body>home</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }))
    );

    await runLoader();

    // Loader completed (body rendered) despite precache promise not settling.
    expect(precacheCalled).toBe(true);
    expect(document.body.textContent).toContain('home');
    expect(document.body.classList.contains('platform-ios')).toBe(true);
  });

  it('manifest-fail does NOT throw or break the loader', async () => {
    globalThis.AssetCache.precacheFromManifest = vi.fn(() =>
      Promise.reject(new Error('manifest 500'))
    );

    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('<html><body>home</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }))
    );

    // The loader's try/catch should NOT catch this — eager pre-fetch is
    // outside the bootstrap's success path. The .catch() in the void call
    // swallows it before it propagates.
    await expect(runLoader()).resolves.not.toThrow();
    expect(document.body.textContent).toContain('home');
  });
});
```

**Step 2: Append lazy-trigger tests to `cachedFetch.test.js`**

**Before adding tests, add `globalThis.AssetCache` cleanup to the file's existing `beforeEach` and `afterEach`** (around lines 45-70 and 77-90 of the existing file). Test isolation requires this — without cleanup, an earlier test's `globalThis.AssetCache = {...}` assignment leaks into later tests' `_writeThrough` calls and either errors or pollutes spy counts. Locate the existing `beforeEach` block and add `delete globalThis.AssetCache;` alongside the existing `delete globalThis.CachedFetch;`. Do the same in the `afterEach` block. Example (the existing `beforeEach` already calls `_closeDb` + `deleteDatabase`; add the line marked `// NEW`):

```javascript
beforeEach(async () => {
    if (typeof CachedFetch !== 'undefined' && CachedFetch._internals) {
        CachedFetch._internals._closeDb();
    }
    delete globalThis.CachedFetch;
    delete globalThis.AssetCache; // NEW — Phase 4 lazy-trigger test isolation
    // ... existing deleteDatabase + eval logic ...
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (typeof CachedFetch !== 'undefined' && CachedFetch._internals && CachedFetch._internals._closeDb) {
        CachedFetch._internals._closeDb();
    }
    delete globalThis.AssetCache; // NEW — symmetric cleanup
});
```

Then inside a new `describe('Phase 4 lazy pre-fetch trigger', ...)` block at the end of the file:

```javascript
describe('Phase 4 lazy pre-fetch trigger', () => {
  it('calls AssetCache.lazyPrecacheFromHtml after a successful HTML write-through', async () => {
    const lazySpy = vi.fn(() => Promise.resolve());
    globalThis.AssetCache = {
      lazyPrecacheFromHtml: lazySpy,
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<html><head><link rel="stylesheet" href="/css/styles.css"></head><body>x</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html', 'ETag': 'W/"v1"' },
      })
    );

    await globalThis.CachedFetch.cachedFetch('/post/abc');

    expect(lazySpy).toHaveBeenCalledTimes(1);
    expect(typeof lazySpy.mock.calls[0][0]).toBe('string');
    expect(lazySpy.mock.calls[0][0]).toContain('<link rel="stylesheet" href="/css/styles.css">');
  });

  it('does NOT call lazyPrecacheFromHtml for asJson responses (e.g., /api/photos)', async () => {
    const lazySpy = vi.fn();
    globalThis.AssetCache = { lazyPrecacheFromHtml: lazySpy };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('{"data": []}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await globalThis.CachedFetch.cachedFetch('/api/trips/abc/photos', { asJson: true });

    expect(lazySpy).not.toHaveBeenCalled();
  });

  it('does NOT call lazyPrecacheFromHtml when AssetCache is undefined (defensive)', async () => {
    delete globalThis.AssetCache;

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<html><body>x</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    await expect(globalThis.CachedFetch.cachedFetch('/post/abc')).resolves.toBeDefined();
  });

  it('lazyPrecacheFromHtml rejection does NOT propagate to cachedFetch caller', async () => {
    globalThis.AssetCache = {
      lazyPrecacheFromHtml: vi.fn(() => Promise.reject(new Error('boom'))),
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<html><body>x</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    await expect(globalThis.CachedFetch.cachedFetch('/post/abc')).resolves.toBeDefined();
  });
});
```

**Step 3: Run the test files**

```bash
npm test -- tests/js/bootstrap-loader.test.js tests/js/cachedFetch.test.js
```

Expected: all existing tests pass; all new tests pass.

**Step 4: Run the full JS suite**

```bash
npm test
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/bootstrap/loader.js src/bootstrap/cachedFetch.js tests/js/bootstrap-loader.test.js tests/js/cachedFetch.test.js
git commit -m "$(cat <<'EOF'
feat(bootstrap): wire eager + lazy pre-fetch triggers

Loader: after the first swap completes and the bootstrap-progress
shim is removed, fire-and-forget AssetCache.precacheFromManifest()
with a defensive .catch — this is the eager (boot-time) pre-fetch.
Does not block first paint (offline-asset-precache.AC4.5).

CachedFetch: when an HTML page is fetched fresh online and write-
through completes (cache-miss success or background-revalidate 200),
fire-and-forget AssetCache.lazyPrecacheFromHtml(html). The helper
extracts asset URLs from the HTML and downloads any not yet in IDB.
Skips JSON (asJson=true) and is defensive about AssetCache being
undefined in test environments.

Verifies the wiring half of offline-asset-precache.AC4.5 and AC5.1.
End-to-end AC pinned in the integration test in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-7) -->

<!-- START_TASK_6 -->
### Task 6: Create `tests/js/assetCache-integration.test.js` (DoD acceptance)

**Verifies:** `offline-asset-precache.AC1.1` (manifest produced and consumed end-to-end), `offline-asset-precache.AC3.1` (offline + cached page → CSS as `<style>` applied), `offline-asset-precache.AC3.2` (offline + cached page → cached `<script src>` resolved through blob URL with observable side effects), `offline-asset-precache.AC5.1` (lazy pre-fetch → previously-uncached page fetched online → next offline visit hits AC3.1/AC3.2).

**Files:**
- Create: `/Users/patrickford/Documents/claudeProjects/road-trip/tests/js/assetCache-integration.test.js`

**Step 1: Generate the integration test file**

The file's structure has three `describe` blocks (one per AC bundle). Use the inlined `beforeEach`/`afterEach` below — they're modeled on the existing `bootstrap-loader.test.js` and `fetchAndSwap.test.js` patterns but customized for the integration scope (no `runLoader` helper; we call `FetchAndSwap.fetchAndSwap` directly).

```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const SHELL = path.join(REPO_ROOT, 'src/bootstrap');

const SOURCES = {
  cachedFetch: fs.readFileSync(path.join(SHELL, 'cachedFetch.js'), 'utf8'),
  assetCache: fs.readFileSync(path.join(SHELL, 'assetCache.js'), 'utf8'),
  listenerShim: fs.readFileSync(path.join(SHELL, 'listenerShim.js'), 'utf8'),
  tripStorage: fs.readFileSync(path.join(SHELL, 'tripStorage.js'), 'utf8'),
  fetchAndSwap: fs.readFileSync(path.join(SHELL, 'fetchAndSwap.js'), 'utf8'),
};

// Mirrors the appendChild stub in tests/js/fetchAndSwap.test.js — JSDOM does not execute
// <script src> elements, so we synchronously fire onload after appendChild to unblock
// the await new Promise(...) inside _recreateScripts. Without this, the swap hangs.
function _installScriptOnloadStub() {
  const realAppendChild = Node.prototype.appendChild;
  return vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function (node) {
    const result = realAppendChild.call(this, node);
    if (node && node.tagName === 'SCRIPT' && node.getAttribute && node.getAttribute('src')) {
      setTimeout(() => { if (node.onload) node.onload(); }, 0);
    }
    return result;
  });
}

function _deleteDb(name) {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
    setTimeout(resolve, 50); // belt-and-suspenders
  });
}

let _appendSpy;

beforeEach(async () => {
  // Close any cached IDB handles from a previous test before deleting the database.
  if (typeof globalThis.CachedFetch !== 'undefined' && globalThis.CachedFetch._internals) {
    globalThis.CachedFetch._internals._closeDb();
  }
  if (typeof globalThis.AssetCache !== 'undefined' && globalThis.AssetCache._internals) {
    globalThis.AssetCache._internals._closeDb();
  }

  // Reset globals.
  delete globalThis.CachedFetch;
  delete globalThis.AssetCache;
  delete globalThis.ListenerShim;
  delete globalThis.TripStorage;
  delete globalThis.FetchAndSwap;

  // Reset DOM.
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  Array.from(document.body.attributes).forEach((a) => document.body.removeAttribute(a.name));

  // Delete the test IDBs so each test starts cold.
  await _deleteDb('RoadTripPageCache');
  await _deleteDb('roadtripmap-cache');
  // Wait a tick to let fake-indexeddb finalize.
  await new Promise((r) => setTimeout(r, 10));

  // Install the script-onload stub before evaluating any module that calls appendChild.
  _appendSpy = _installScriptOnloadStub();

  // Eval bootstrap modules in production load order.
  eval(SOURCES.cachedFetch);
  eval(SOURCES.assetCache);
  eval(SOURCES.listenerShim);
  eval(SOURCES.tripStorage);
  eval(SOURCES.fetchAndSwap);
});

afterEach(() => {
  if (_appendSpy) {
    _appendSpy.mockRestore();
    _appendSpy = undefined;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (typeof globalThis.CachedFetch !== 'undefined' && globalThis.CachedFetch._internals) {
    globalThis.CachedFetch._internals._closeDb();
  }
  if (typeof globalThis.AssetCache !== 'undefined' && globalThis.AssetCache._internals) {
    globalThis.AssetCache._internals._closeDb();
  }
});

describe('AC1.1: checked-in asset-manifest.json is well-formed', () => {
  it('exists and parses as JSON', () => {
    const manifestPath = path.join(REPO_ROOT, 'src/RoadTripMap/wwwroot/asset-manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(typeof manifest.version).toBe('string');
    expect(Array.isArray(manifest.files)).toBe(true);
  });

  it('every entry has a non-empty url, positive size, and 64-char hex sha256', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src/RoadTripMap/wwwroot/asset-manifest.json'), 'utf8'));
    for (const entry of manifest.files) {
      expect(typeof entry.url).toBe('string');
      expect(entry.url.startsWith('/')).toBe(true);
      expect(typeof entry.size).toBe('number');
      expect(entry.size).toBeGreaterThan(0);
      expect(typeof entry.sha256).toBe('string');
      expect(/^[0-9a-f]{64}$/.test(entry.sha256)).toBe(true);
    }
  });

  it('contains an entry for every wwwroot/css/*.css', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src/RoadTripMap/wwwroot/asset-manifest.json'), 'utf8'));
    const manifestUrls = new Set(manifest.files.map((f) => f.url));
    const cssDir = path.join(REPO_ROOT, 'src/RoadTripMap/wwwroot/css');
    const cssFiles = fs.readdirSync(cssDir).filter((f) => f.endsWith('.css'));
    for (const name of cssFiles) {
      expect(manifestUrls.has(`/css/${name}`)).toBe(true);
    }
  });

  it('contains an entry for every wwwroot/js/*.js', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src/RoadTripMap/wwwroot/asset-manifest.json'), 'utf8'));
    const manifestUrls = new Set(manifest.files.map((f) => f.url));
    const jsDir = path.join(REPO_ROOT, 'src/RoadTripMap/wwwroot/js');
    const jsFiles = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));
    for (const name of jsFiles) {
      expect(manifestUrls.has(`/js/${name}`)).toBe(true);
    }
  });

  it('contains an entry for /ios.css', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src/RoadTripMap/wwwroot/asset-manifest.json'), 'utf8'));
    const manifestUrls = new Set(manifest.files.map((f) => f.url));
    expect(manifestUrls.has('/ios.css')).toBe(true);
  });
});

describe('AC3.1 + AC3.2: offline + cached page renders styled with cached JS', () => {
  it('renders a previously-cached page with cached CSS (AC3.1) and cached JS (AC3.2) when fetch rejects', async () => {
    // Spy on URL.createObjectURL BEFORE the swap so we can inspect the Blob that
    // _mintBlobUrl produced for /js/foo.js. Phase 3 Task 3 Step 2 revokes blob URLs
    // at swap-end, so we cannot fetch the blob URL after the swap. Inspecting the
    // Blob argument at mint-time is the strongest in-JSDOM proof that the cached
    // bytes would execute correctly in a real browser.
    const createSpy = vi.spyOn(URL, 'createObjectURL');

    // 1) Seed the pages store with cached HTML for /post/abc.
    const cachedHtml = `<html>
      <head>
        <link rel="stylesheet" href="/css/styles.css?v=4">
        <script src="/js/foo.js"></script>
      </head>
      <body data-page="post">cached body content</body>
    </html>`;
    await globalThis.CachedFetch._internals._putRecord(
      globalThis.CachedFetch._internals.STORE_PAGES,
      '/post/abc',
      { html: cachedHtml, etag: null, lastModified: null, cachedAt: Date.now() }
    );

    // 2) Seed the assets store with cached bytes for /css/styles.css and /js/foo.js.
    const cssBytes = new TextEncoder().encode('body { color: red; }').buffer;
    await globalThis.AssetCache._internals._putAsset({
      url: '/css/styles.css',
      bytes: cssBytes,
      contentType: 'text/css',
      sha256: 'css-sha',
      etag: null,
      lastModified: null,
      cachedAt: Date.now(),
    });

    const jsSource = 'globalThis.__cachedJsExecuted = true;';
    const jsBytes = new TextEncoder().encode(jsSource).buffer;
    await globalThis.AssetCache._internals._putAsset({
      url: '/js/foo.js',
      bytes: jsBytes,
      contentType: 'application/javascript',
      sha256: 'js-sha',
      etag: null,
      lastModified: null,
      cachedAt: Date.now(),
    });

    // 3) Simulate offline.
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    // 4) Navigate to the cached page.
    await globalThis.FetchAndSwap.fetchAndSwap('/post/abc');

    // 5) AC3.1: cached CSS as <style> applied; no <link> to /css/styles.css remains.
    expect(document.head.querySelector('link[href*="/css/styles.css"]')).toBeNull();
    const style = document.head.querySelector('style');
    expect(style).not.toBeNull();
    expect(style.textContent).toContain('color: red');

    // 6) AC3.2 plumbing: cached <script src> rewritten to a blob URL with the
    // canonical path on dataset.assetCacheOrigin. _recreateScripts moves all
    // <script> elements to document.body in the offline shell.
    const script = document.body.querySelector('script[data-asset-cache-origin]');
    expect(script).not.toBeNull();
    expect(script.dataset.assetCacheOrigin).toBe('/js/foo.js');
    expect(script.getAttribute('src')).toMatch(/^blob:/);

    // 7) AC3.2 bytes-correctness: verify URL.createObjectURL was called with a
    // Blob whose type === 'application/javascript' and whose contents are byte-
    // identical to the cached jsBytes. This proves a real browser would execute
    // the correct cached bytes, even though JSDOM cannot execute <script src=blob:>.
    const jsCreateCall = createSpy.mock.calls.find((call) => {
      const blob = call[0];
      return blob && blob.type === 'application/javascript';
    });
    expect(jsCreateCall).toBeDefined();
    const blob = jsCreateCall[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/javascript');
    const blobText = await blob.text();
    expect(blobText).toBe(jsSource);
    // Side-effect demonstration: eval-ing those exact bytes produces the expected
    // global, so a real-browser-executed <script src=blob:> would do the same.
    // (JSDOM does NOT execute remote-src scripts; this eval is a parity check, not
    //  a substitute for a real-browser integration test.)
    eval.call(globalThis, blobText);
    expect(globalThis.__cachedJsExecuted).toBe(true);
    delete globalThis.__cachedJsExecuted;

    // 8) Cached page body content rendered with body attributes.
    expect(document.body.textContent).toContain('cached body content');
    expect(document.body.dataset.page).toBe('post');

    createSpy.mockRestore();
  });
});

describe('AC4.2: regular browsers (non-shell) never load assetCache.js', () => {
  // The asset cache is shell-gated by file location: src/bootstrap/* is the Capacitor
  // webDir, served only inside the iOS shell. App Service serves wwwroot/*. Any
  // wwwroot/*.html that loaded assetCache.js would break this invariant. Static check.
  it('no wwwroot/*.html page references assetCache.js', () => {
    const wwwrootDir = path.join(REPO_ROOT, 'src/RoadTripMap/wwwroot');
    const htmlFiles = fs.readdirSync(wwwrootDir).filter((f) => f.endsWith('.html'));
    expect(htmlFiles.length).toBeGreaterThan(0); // sanity: index.html, post.html, view.html, etc. exist
    for (const name of htmlFiles) {
      const contents = fs.readFileSync(path.join(wwwrootDir, name), 'utf8');
      expect(contents).not.toMatch(/assetCache\.js/);
    }
  });

  it('only src/bootstrap/index.html references assetCache.js (the Capacitor webDir entry)', () => {
    const bootstrapHtml = fs.readFileSync(path.join(SHELL, 'index.html'), 'utf8');
    expect(bootstrapHtml).toMatch(/assetCache\.js/);
  });
});

describe('AC5.1: lazy fallback fills the asset cache from a fresh HTML page', () => {
  it('after a successful page fetch online, asset URLs in the page are downloaded into IDB', async () => {
    // No prior asset cache. Mock fetch:
    //   1st call (HTML for /post/abc) → 200 with assets referenced in body
    //   subsequent calls (asset GETs) → 200 with bytes
    const cssBytes = new TextEncoder().encode('body { color: blue; }').buffer;
    const jsBytes = new TextEncoder().encode('//').buffer;

    globalThis.fetch = vi.fn(async (urlArg) => {
      const url = typeof urlArg === 'string' ? urlArg : urlArg.url;
      if (url.endsWith('/post/abc')) {
        return new Response('<html><head><link rel="stylesheet" href="/css/styles.css"><script src="/js/foo.js"></script></head><body data-page="post">x</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      if (url.endsWith('/css/styles.css')) {
        return new Response(cssBytes, { status: 200, headers: { 'Content-Type': 'text/css' } });
      }
      if (url.endsWith('/js/foo.js')) {
        return new Response(jsBytes, { status: 200, headers: { 'Content-Type': 'application/javascript' } });
      }
      return new Response(null, { status: 404 });
    });

    await globalThis.CachedFetch.cachedFetch('/post/abc');

    // Condition-based wait for the fire-and-forget lazy pre-fetch. Poll IDB until
    // the records appear or we hit a generous timeout — avoids the flaky-by-design
    // "sleep N ms" pattern that degrades with system load.
    async function waitForAsset(url, timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const record = await globalThis.AssetCache._internals._getAsset(url);
        if (record !== null) return record;
        await new Promise((r) => setTimeout(r, 10));
      }
      return null;
    }

    const cssRecord = await waitForAsset('/css/styles.css');
    expect(cssRecord).not.toBeNull();
    expect(cssRecord.bytes.byteLength).toBe(cssBytes.byteLength);

    const jsRecord = await waitForAsset('/js/foo.js');
    expect(jsRecord).not.toBeNull();
  });
});
```

**Step 3: Run the new file**

```bash
npm test -- tests/js/assetCache-integration.test.js
```

Expected: all tests pass.

**Step 4: Run the full JS suite**

```bash
npm test
```

Expected: every test in every file passes.

**Step 5: Do NOT commit yet** — Task 7 lands the CLAUDE.md update + the final Phase 4 commit.
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Update CLAUDE.md (Invariants section) and final Phase 4 verification

**Verifies:** Documentation freshness; final operational sanity check.

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/CLAUDE.md`

**Step 1: Update the "Invariants" entry that names `RoadTripPageCache`'s object stores**

In `CLAUDE.md`, find the entry that begins:

```
- iOS Offline Shell page cache lives in IndexedDB `RoadTripPageCache` with two object stores: `pages` (HTML documents) and `api` (JSON payloads, opt-in via `cachedFetch(url, { asJson: true })`).
```

Replace `two object stores: \`pages\` (HTML documents) and \`api\` (JSON payloads...` with `three object stores: \`pages\` (HTML documents), \`api\` (JSON payloads...`, and append a sentence about `assets`. The full updated entry reads:

```
- iOS Offline Shell page cache lives in IndexedDB `RoadTripPageCache` (version 2) with three object stores: `pages` (HTML documents), `api` (JSON payloads, opt-in via `cachedFetch(url, { asJson: true })`), and `assets` (bytes for `/css/*.css`, `/js/*.js`, and `/ios.css`, owned by `src/bootstrap/assetCache.js`). Cached records carry `{ etag, lastModified, cachedAt }` for conditional revalidate. `CachedFetch.cachedFetch` is cache-first: on hit it returns the cached response and fires a background revalidate (fetch with `If-None-Match`/`If-Modified-Since`; 304 keeps stale cache, 200 write-through, network + IDB write errors are swallowed). `/api/poi` and `/api/park-boundaries` are bypassed — `mapCache.js` retains ownership of those and writes to its own `RoadTripMapCache` DB. Offline with a full cache miss → `loader.js` renders `src/bootstrap/fallback.html`. The `assets` store is populated by an eager pre-fetch (`AssetCache.precacheFromManifest()` fired fire-and-forget after the first swap, consumes `/asset-manifest.json`) and a lazy pre-fetch (`AssetCache.lazyPrecacheFromHtml(html)` fired fire-and-forget after every successful HTML write-through). At render time, `_swapFromHtml` calls `AssetCache.rewriteAssetTags(parsed)` to substitute cached `<link rel="stylesheet">` with inline `<style>` and cached `<script src>` with blob URLs (with the canonical path preserved on `dataset.assetCacheOrigin` for the `_executedScriptSrcs` dedup). Blob URLs are revoked at swap-end. The previous `RoadTripBundle` / `files` / key `bundle` IDB store is no longer read or written by the shipped shell.
```

**Step 2: Add a new "Key Files" entry for `src/bootstrap/assetCache.js`**

In `CLAUDE.md`'s Key Files section, find the line for `src/bootstrap/cachedFetch.js`. Add a new entry immediately after it:

```
- `src/bootstrap/assetCache.js` -- IIFE; exposes `globalThis.AssetCache = { precacheFromManifest, lazyPrecacheFromHtml, getCachedText, getCachedBlobUrl, rewriteAssetTags, _internals }`. Adds the `assets` object store to `RoadTripPageCache` (DB version 1 → 2). `precacheFromManifest()` consumes `/asset-manifest.json` and downloads sha256-mismatched entries; `lazyPrecacheFromHtml(html)` extracts cacheable asset URLs from a fetched page and fills gaps; `rewriteAssetTags(parsedDoc)` substitutes cached `<link>`/`<script src>` with inline styles / blob URLs at render time. All errors swallowed (manifest fetch failure, network throw, malformed JSON, individual asset 404, IDB write error).
```

**Step 3: Bump the "Last verified" date at the top of CLAUDE.md to today's actual date**

The date was last set to `2026-04-27` by Phase 1 Task 2. If the implementation actually completes on a later date (likely — the four phases will run sequentially), bump the line to the current date when this task runs:

```bash
date +%Y-%m-%d
```

Use that output. If the date is still `2026-04-27`, no change is needed.

**Step 4: Run the full test suite one more time**

```bash
npm test
```

Expected: all tests pass across every file.

**Step 5: Run the build to confirm nothing in `scripts/build-bundle.js` regressed**

```bash
npm run build:bundle
```

Expected: clean build, asset-manifest.json regenerated identically (modulo version), bundle/* unchanged.

**Step 6: `git diff --stat` sanity check**

```bash
git diff --stat HEAD~10
```

Expected (rough): the changes across Phases 2-4 should be limited to:
- `src/bootstrap/assetCache.js` (new)
- `src/bootstrap/cachedFetch.js` (modified)
- `src/bootstrap/fetchAndSwap.js` (modified)
- `src/bootstrap/loader.js` (modified)
- `src/bootstrap/index.html` (modified — one line)
- `tests/js/assetCache.test.js` (new)
- `tests/js/cachedFetch.test.js` (modified)
- `tests/js/fetchAndSwap.test.js` (modified)
- `tests/js/bootstrap-loader.test.js` (modified)
- `tests/js/assetCache-integration.test.js` (new)
- `scripts/build-bundle.js` (modified, from Phase 1)
- `src/RoadTripMap/wwwroot/asset-manifest.json` (new, from Phase 1)
- `CLAUDE.md` (modified, from Phase 1 and this task)

No other files should appear. If they do, investigate before committing.

**Step 7: Commit**

```bash
git add CLAUDE.md tests/js/assetCache-integration.test.js
git commit -m "$(cat <<'EOF'
test(integration): pin offline-asset-precache DoD acceptance test

Adds tests/js/assetCache-integration.test.js with three describe blocks:

1. AC1.1: validates the checked-in asset-manifest.json's shape and that
   it contains an entry for every wwwroot/css/*.css, wwwroot/js/*.js,
   and wwwroot/ios.css.

2. AC3.1 + AC3.2: seeds the pages store with cached HTML and the assets
   store with cached CSS/JS bytes for a previously-visited page,
   simulates offline (fetch rejects), and verifies that a navigation
   renders styled (cached <style> in head, no <link> for the cached
   url remains) and the cached <script src> is resolved through a
   blob URL with dataset.assetCacheOrigin set. Side-effect execution
   is simulated via eval (JSDOM does not execute <script src> bytes).

3. AC5.1: confirms the lazy pre-fetch fills the asset cache as a side
   effect of a successful HTML page fetch.

Also bumps the CLAUDE.md Invariants section to describe the new
RoadTripPageCache.assets store and the eager + lazy pre-fetch flows,
and adds a Key Files entry for src/bootstrap/assetCache.js.

Closes the offline-asset-precache implementation (Phase 4 of 4).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
<!-- END_TASK_7 -->

<!-- END_SUBCOMPONENT_C -->

---

## Phase 4 done when

- All seven tasks above committed to `offline-asset-precache`.
- `npm test` passes for every test file.
- `npm run build:bundle` regenerates `asset-manifest.json` cleanly; `bundle/*` artifacts unchanged.
- `tests/js/assetCache-integration.test.js` passes the locked DoD scenario: previously-cached page renders styled with cached `<style>` and the cached `<script src>` is rewritten to a blob URL.
- The CLAUDE.md Invariants section is up-to-date with the new `assets` object store and the eager + lazy pre-fetch flows.
- The branch is ready for PR review against `develop`.
