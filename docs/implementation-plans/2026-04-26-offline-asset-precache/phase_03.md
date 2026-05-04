# Offline Asset Pre-Cache — Phase 3: Render-time rewrite

**Goal:** Wire the asset cache (built in Phase 2) into the document-swap path so that, before the live `<head>` is replaced, every cached `<link rel="stylesheet">` becomes an inline `<style>` and every cached `<script src>` becomes a `blob:` URL. Cache misses pass through unchanged. Non-asset URLs (CDN scripts, `/lib/exifr/...`) are never touched. The same upgrade is applied to `loader.js`'s `_ensureIosCss` so the iOS-shell stylesheet is served from cache when present.

**Architecture:** A new `AssetCache.rewriteAssetTags(parsedDoc)` method walks the parsed document's `<head>` and any `<script src>` element and substitutes cached bytes in place. It is hooked into `_swapFromHtml` immediately after the parser runs (before scripts are extracted) so the script `src` attributes are already rewritten when `_recreateScripts` reads them. Because `_recreateScripts` dedupes already-executed scripts via a Set keyed on the absolutized src, blob URLs (which are unique per swap) would defeat the dedup; the rewrite annotates each rewritten `<script>` with `dataset.assetCacheOrigin` carrying the canonical path, and `_recreateScripts` is updated to prefer that annotation as the dedup key. Blob URLs are revoked at the end of every swap to avoid leaking memory in the SPA-style shell.

**Tech Stack:** Vanilla ES2017 JS, DOM mutation, `URL.createObjectURL` / `URL.revokeObjectURL`, vitest + JSDOM. No new external dependencies.

**Scope:** Phase 3 of 4 from `docs/design-plans/2026-04-26-offline-asset-precache.md`.

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### offline-asset-precache.AC2: Render-time tag rewrite
- **offline-asset-precache.AC2.1 Success:** When the `assets` store contains `/css/styles.css`, `_swapFromHtml` rewrites the parsed `<link rel="stylesheet" href="/css/styles.css">` to `<style>...cached text...</style>` *before* the head innerHTML swap. After the swap, no `<link>` to `/css/styles.css` is present in `document.head`.
- **offline-asset-precache.AC2.2 Success:** When the `assets` store contains `/js/foo.js`, `_swapFromHtml` rewrites the parsed `<script src="/js/foo.js">` to `<script src="blob:...">` whose blob bytes match the cached entry. The synchronous load order of the document's scripts is preserved.
- **offline-asset-precache.AC2.3 Success:** When `loader.js`'s `_ensureIosCss` runs and the `assets` store contains `/ios.css`, a `<style data-ios-css>` is injected with cached bytes. When the cache misses, the existing `<link data-ios-css href="/ios.css">` fallback is injected.
- **offline-asset-precache.AC2.4 Failure:** When the `assets` store does not contain a referenced asset, the `<link>` or `<script src>` tag is left untouched and the browser performs its normal fetch (which succeeds online, fails offline).
- **offline-asset-precache.AC2.5 Failure:** Asset URLs outside `/css/*`, `/js/*`, and `/ios.css` (e.g., `https://unpkg.com/maplibre-gl@...`, `/lib/exifr/full.umd.js`) are never rewritten, regardless of cache state.

### offline-asset-precache.AC4: Invariants preserved
- **offline-asset-precache.AC4.3 Success:** The `RoadTripPageCache` `pages` and `api` object stores retain identical semantics after the version 1 → 2 upgrade. Existing `cachedFetch.js` reads and writes against these stores succeed unchanged.
- **offline-asset-precache.AC4.4 Success:** `src/RoadTripMap/wwwroot/js/mapCache.js` continues to own `/api/poi` and `/api/park-boundaries` caching against its own `RoadTripMapCache` IDB. The asset cache never touches those paths or that database.

---

## Codebase verification findings (2026-04-27)

These notes drove the task design — read for context, skip if you don't care.

- ✓ `src/bootstrap/fetchAndSwap.js` `_swapFromHtml` (lines 60-119) parses HTML at line 61, injects `<base href>` at lines 64-68, extracts scripts at line 72 (`scriptsInOrder = Array.from(parsed.querySelectorAll('script'))`), removes them from `parsed` at line 73, and only at line 76 swaps `document.head.innerHTML`. **Phase 3 inserts `await AssetCache.rewriteAssetTags(parsed)` between lines 68 and 72** so the rewrite operates on the canonical parsed Document while scripts are still attached to it.
- ✓ `_recreateScripts` (lines 19-58) computes `absoluteSrc = _absolutizeSrc(rawSrc)` (line 25) and adds it to `_executedScriptSrcs` on successful onload (line 39). **Critical:** if rewriteAssetTags swaps `src` to a unique blob URL, `_executedScriptSrcs` gets blob URLs that are different on every swap — the dedup mechanism breaks. The fix is to give each rewritten `<script>` a `dataset.assetCacheOrigin` attribute carrying the canonical path (e.g., `/js/foo.js`), and update `_recreateScripts` to prefer that as the dedup key.
- ✓ `loader.js` `_ensureIosCss` (lines 62-70) is currently synchronous — it injects a `<link data-ios-css>`. Phase 3 turns it `async` and checks `AssetCache.getCachedText('/ios.css')` first. The wrapper at lines 13-18 already uses `await original(url, options)` then `_ensureIosCss()` — adding `await` to the call site is a one-line change.
- ✓ All wwwroot pages reference assets via root-relative paths (`/js/foo.js`, `/css/styles.css?v=4`). The `?v=4` query suffix in `post.html` line 11 means rewriteAssetTags must normalize URLs to their `pathname` (strip query) before looking up in IDB — the manifest emits `/css/styles.css` (no query).
- ✓ AC2.5 edge cases verified: `post.html` has `https://unpkg.com/maplibre-gl@5.21.0/dist/maplibre-gl.css` (CDN, never rewrite) and `/lib/exifr/full.umd.js` (root-relative but outside `/js/`, never rewrite).
- ✓ `src/RoadTripMap/wwwroot/css/styles.css` and `src/RoadTripMap/wwwroot/ios.css` contain **zero** `@import` and `url(...)` directives — inlining as `<style>` is safe (no broken asset references).
- ✓ `mapCache.js` uses `_dbName: 'roadtripmap-cache'` and `_storeName: 'map-data'` (lines 10-11) — distinct from the asset cache's `RoadTripPageCache` / `assets`. AC4.4 is preserved by construction; we'll add a defensive test.
- ✓ JSDOM does not execute `<script src>` bytes; the `appendChild` stub in `tests/js/fetchAndSwap.test.js:49-56` simulates `onload`. AC2.2 unit tests therefore verify the rewrite mechanism (blob URL is set, bytes match cached entry, dataset annotation is present); the actual execution is verified by Phase 4's integration test.
- ✓ The only existing `URL.revokeObjectURL` use in the bootstrap shell is via `imageProcessor.js` (revoke immediately after image load). Phase 3 mirrors the pattern but at swap-end granularity.

---

## Skills to activate before implementing

- `ed3d-house-style:coding-effectively` — always
- `ed3d-house-style:howto-functional-vs-imperative` — `rewriteAssetTags` should be a thin imperative wrapper over a pure-ish "look up cached entry, return replacement element" function. Easier to test.
- `ed3d-house-style:writing-good-tests` — test behavior (e.g., "no `<link>` to `/css/styles.css` remains in head after swap"), not method calls.
- `ed3d-plan-and-execute:test-driven-development` — for the rewrite logic, write the assertion then the implementation.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add `rewriteAssetTags` to `src/bootstrap/assetCache.js`

**Verifies (in concert with Task 2's tests):** `offline-asset-precache.AC2.1`, `offline-asset-precache.AC2.4` (the rewrite-side, not the swap-side), `offline-asset-precache.AC2.5`. Provides the helper that AC2.2 (Task 3) and AC2.3 (Task 5) call into.

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/src/bootstrap/assetCache.js` (add new helpers + `rewriteAssetTags`; update `_internals`)

**Step 1: Add a module-scoped Set for tracking minted blob URLs**

Near the top of the IIFE, just under the `_db = null` line that Phase 2 introduced, add:

```javascript
  const _pendingBlobUrls = new Set();
```

**Step 2: Update `_mintBlobUrl` to track minted URLs**

Phase 2's `_mintBlobUrl` mints a URL but doesn't track it. Replace it with:

```javascript
  function _mintBlobUrl(record) {
    const blob = new Blob([record.bytes], {
      type: record.contentType || 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    _pendingBlobUrls.add(url);
    return url;
  }
```

**Step 3: Add `_revokePendingBlobUrls` (called by `_swapFromHtml` at swap-end in Task 3)**

Below `_mintBlobUrl`, add:

```javascript
  function _revokePendingBlobUrls() {
    for (const url of _pendingBlobUrls) {
      try { URL.revokeObjectURL(url); } catch (err) { /* swallow */ }
    }
    _pendingBlobUrls.clear();
  }
```

**Step 4: Add URL helpers**

Below `_revokePendingBlobUrls`, add:

```javascript
  // Strip query string + normalize to pathname so /css/styles.css?v=4
  // and /css/styles.css both look up the same IDB entry.
  function _normalizeAssetUrl(href) {
    try {
      return new URL(href, APP_BASE).pathname;
    } catch {
      return typeof href === 'string' ? href : '';
    }
  }

  // The strict allow-list: /css/*.css, /js/*.js, /ios.css. Anything else
  // (CDN URLs, /lib/*, /api/*) MUST pass through unchanged — AC2.5.
  function _isCacheableAssetUrl(pathname) {
    if (typeof pathname !== 'string') return false;
    if (pathname === '/ios.css') return true;
    if (pathname.startsWith('/css/') && pathname.endsWith('.css')) return true;
    if (pathname.startsWith('/js/') && pathname.endsWith('.js')) return true;
    return false;
  }
```

**Step 5: Add `rewriteAssetTags`**

Below the URL helpers, add the public method:

```javascript
  // Walks the parsed document and substitutes cached assets:
  //   <link rel="stylesheet" href="/css/X"> → <style>{cached bytes as text}</style>
  //   <script src="/js/X"> → src=blob: with cached bytes; dataset.assetCacheOrigin
  //                                 holds the canonical path for _recreateScripts dedup.
  // Cache misses leave the original tag untouched (AC2.4). Non-allow-list URLs are
  // never rewritten, regardless of cache state (AC2.5).
  async function rewriteAssetTags(parsedDoc) {
    if (!parsedDoc || !parsedDoc.head) {
      return;
    }

    // CSS: walk parsed.head only (stylesheet links live in <head>).
    const linkEls = Array.from(parsedDoc.head.querySelectorAll('link[rel="stylesheet"]'));
    for (const link of linkEls) {
      const href = link.getAttribute('href');
      if (!href) continue;
      const pathname = _normalizeAssetUrl(href);
      if (!_isCacheableAssetUrl(pathname)) continue;
      let text;
      try {
        text = await getCachedText(pathname);
      } catch {
        text = null;
      }
      if (text === null) continue; // cache miss → leave the <link> alone (AC2.4)

      const style = parsedDoc.createElement('style');
      // Preserve any data-* attributes from the original (e.g., data-ios-css).
      for (const attr of Array.from(link.attributes)) {
        if (attr.name === 'href' || attr.name === 'rel' || attr.name === 'integrity' || attr.name === 'crossorigin') {
          continue;
        }
        style.setAttribute(attr.name, attr.value);
      }
      style.textContent = text;
      link.replaceWith(style);
    }

    // JS: walk the entire parsed document — wwwroot pages put scripts in <head>,
    // but inline scripts and shell-injected scripts may live in <body>.
    const scriptEls = Array.from(parsedDoc.querySelectorAll('script[src]'));
    for (const script of scriptEls) {
      const src = script.getAttribute('src');
      if (!src) continue;
      const pathname = _normalizeAssetUrl(src);
      if (!_isCacheableAssetUrl(pathname)) continue;
      let blobUrl;
      try {
        blobUrl = await getCachedBlobUrl(pathname);
      } catch {
        blobUrl = null;
      }
      if (blobUrl === null) continue; // cache miss → leave alone (AC2.4)

      // Annotate before mutating src so _recreateScripts can dedup against the
      // canonical path even after src has been rewritten to a unique blob URL.
      script.dataset.assetCacheOrigin = pathname;
      script.setAttribute('src', blobUrl);
    }
  }
```

**Step 6: Expose new helpers via `_internals` and the public API**

Update the `globalThis.AssetCache` export block:

```javascript
  globalThis.AssetCache = {
    precacheFromManifest,
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

`rewriteAssetTags` joins the public surface; `_revokePendingBlobUrls` and the helpers are exposed via `_internals` for tests and for `_swapFromHtml` to call (Task 3).

**Step 7: Smoke-check syntax**

```bash
node --check src/bootstrap/assetCache.js
```

Expected: no output.

**Do NOT commit yet** — Task 2 adds the tests; commit them together.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Extend `tests/js/assetCache.test.js` with `rewriteAssetTags` tests

**Verifies:** `offline-asset-precache.AC2.1`, `offline-asset-precache.AC2.4` (cache miss → unchanged), `offline-asset-precache.AC2.5` (non-allow-list ignored), and `offline-asset-precache.AC4.4` (invariant: asset writes never touch `roadtripmap-cache`).

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/tests/js/assetCache.test.js` (append new `describe` blocks at the bottom)

**Step 1: Append `rewriteAssetTags` tests**

Add these `describe` blocks at the bottom of the existing file (Phase 2's tests stay intact). Each `it` describes the behavior to verify; implement the assertions using the file's existing arrange-act-assert pattern.

```javascript
describe('AssetCache._internals._normalizeAssetUrl', () => {
  it('strips query strings', () => {
    expect(globalThis.AssetCache._internals._normalizeAssetUrl('/css/styles.css?v=4')).toBe('/css/styles.css');
  });

  it('keeps root-relative paths unchanged', () => {
    expect(globalThis.AssetCache._internals._normalizeAssetUrl('/js/foo.js')).toBe('/js/foo.js');
  });

  it('returns the pathname for absolute URLs', () => {
    // 'https://app-roadtripmap-prod.azurewebsites.net/css/styles.css' → '/css/styles.css'
    expect(globalThis.AssetCache._internals._normalizeAssetUrl('https://app-roadtripmap-prod.azurewebsites.net/css/styles.css')).toBe('/css/styles.css');
  });
});

describe('AssetCache._internals._isCacheableAssetUrl', () => {
  it('accepts /css/*.css', () => {
    expect(globalThis.AssetCache._internals._isCacheableAssetUrl('/css/styles.css')).toBe(true);
  });

  it('accepts /js/*.js', () => {
    expect(globalThis.AssetCache._internals._isCacheableAssetUrl('/js/foo.js')).toBe(true);
  });

  it('accepts /ios.css', () => {
    expect(globalThis.AssetCache._internals._isCacheableAssetUrl('/ios.css')).toBe(true);
  });

  it('rejects /lib/exifr/full.umd.js (AC2.5)', () => {
    expect(globalThis.AssetCache._internals._isCacheableAssetUrl('/lib/exifr/full.umd.js')).toBe(false);
  });

  it('rejects external CDN URLs after normalization', () => {
    // _normalizeAssetUrl('https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js') → '/dist/maplibre-gl.js'
    // not in the /js/ scope → not cacheable
    expect(globalThis.AssetCache._internals._isCacheableAssetUrl('/dist/maplibre-gl.js')).toBe(false);
  });

  it('rejects /api/poi (mapCache territory)', () => {
    expect(globalThis.AssetCache._internals._isCacheableAssetUrl('/api/poi')).toBe(false);
  });
});

describe('AssetCache.rewriteAssetTags — cache hit (AC2.1)', () => {
  it('replaces a cached <link rel="stylesheet" href="/css/styles.css"> with a <style> containing the cached text', async () => {
    // Pre-populate IDB with /css/styles.css bytes 'body { color: red; }'.
    // Build a parsed Document via DOMParser with `<link rel="stylesheet" href="/css/styles.css">`.
    // Call await AssetCache.rewriteAssetTags(parsed).
    // Assert: parsed.head.querySelector('link[href="/css/styles.css"]') === null
    // Assert: parsed.head.querySelector('style')?.textContent === 'body { color: red; }'
  });

  it('strips the query string when matching against the cache', async () => {
    // Pre-populate IDB with key '/css/styles.css' (no query).
    // Parsed doc has `<link rel="stylesheet" href="/css/styles.css?v=4">`.
    // After rewriteAssetTags, the <link> is replaced with a <style>.
  });

  it('preserves data-* attributes from the original <link> on the new <style>', async () => {
    // Pre-populate /ios.css.
    // Parsed doc has `<link rel="stylesheet" href="/ios.css" data-ios-css="true">`.
    // After rewrite, parsed.head.querySelector('style[data-ios-css]')?.textContent matches cache.
  });
});

describe('AssetCache.rewriteAssetTags — script src (AC2.2 mechanism)', () => {
  it('rewrites <script src="/js/foo.js"> to a blob URL when cached', async () => {
    // Pre-populate /js/foo.js bytes 'window.fooLoaded = true;'.
    // Stub URL.createObjectURL to return 'blob:fake-foo-url'.
    // Parsed doc has `<script src="/js/foo.js"></script>` in head.
    // Call await AssetCache.rewriteAssetTags(parsed).
    // Assert: parsed.head.querySelector('script')?.getAttribute('src') === 'blob:fake-foo-url'
    // Assert: parsed.head.querySelector('script')?.dataset.assetCacheOrigin === '/js/foo.js'
  });

  it('rewrites <script src> regardless of which descendant of parsed it lives in', async () => {
    // Place the <script> in parsed.body (some pages do this). Verify rewriteAssetTags still finds it.
  });

  it('annotates with the canonical path even when the original src had a query string', async () => {
    // <script src="/js/foo.js?v=4"></script> + cache hit on '/js/foo.js'
    // → dataset.assetCacheOrigin === '/js/foo.js' (the normalized form, not the queried form)
  });
});

describe('AssetCache.rewriteAssetTags — cache miss (AC2.4)', () => {
  it('leaves a <link> untouched when the asset is not cached', async () => {
    // Empty cache. Parsed doc has `<link rel="stylesheet" href="/css/never-cached.css">`.
    // After rewrite, the <link> still exists with its original href; no <style> appears.
  });

  it('leaves a <script src> untouched when the asset is not cached', async () => {
    // Empty cache. Parsed doc has `<script src="/js/never-cached.js"></script>`.
    // After rewrite, the script still has src '/js/never-cached.js' and no dataset.assetCacheOrigin.
  });
});

describe('AssetCache.rewriteAssetTags — non-allow-list passthrough (AC2.5)', () => {
  it('does NOT rewrite https://unpkg.com/maplibre-gl@5.21.0/dist/maplibre-gl.css', async () => {
    // Even if some bizarre cache entry existed for that path, the URL is outside the allow-list
    // and must pass through unchanged.
    // Verify: link.getAttribute('href') === 'https://unpkg.com/...' (unchanged)
  });

  it('does NOT rewrite /lib/exifr/full.umd.js', async () => {
    // Even with an allow-list miss for /lib/, no rewrite happens — the URL was never
    // a candidate, so the cache lookup is skipped entirely.
  });

  it('does NOT rewrite /api/poi-style URLs', async () => {
    // mapCache territory. Asset cache stays out (AC4.4).
  });
});

describe('AssetCache.rewriteAssetTags — blob URL bookkeeping', () => {
  it('tracks every minted blob URL in _pendingBlobUrls', async () => {
    // After two cache-hit rewrites for /js/foo.js and /js/bar.js,
    // expect AssetCache._internals._pendingBlobUrls.size to be 2.
  });

  it('_revokePendingBlobUrls clears the set and revokes each URL', async () => {
    // Stub URL.revokeObjectURL with vi.fn().
    // Mint 2 blob URLs via rewriteAssetTags.
    // Call AssetCache._internals._revokePendingBlobUrls().
    // Assert URL.revokeObjectURL called twice (once per minted URL).
    // Assert AssetCache._internals._pendingBlobUrls.size === 0.
  });
});

describe('AC4.4 invariant: asset cache does not touch RoadTripMapCache', () => {
  it('AssetCache._internals.DB_NAME equals "RoadTripPageCache"', () => {
    expect(globalThis.AssetCache._internals.DB_NAME).toBe('RoadTripPageCache');
  });

  it('writes go to RoadTripPageCache, never roadtripmap-cache', async () => {
    // Pre-condition: roadtripmap-cache database does not exist (or is empty).
    // Call _putAsset({...}).
    // Assert RoadTripPageCache exists with an `assets` store.
    // Open roadtripmap-cache (read-only); assert it's empty / unchanged.
    // (Use indexedDB.open('roadtripmap-cache') and check object store contents.)
  });
});
```

**Step 2: Run the test file**

```bash
npm test -- tests/js/assetCache.test.js
```

Expected: every new test passes; Phase 2's tests still pass.

**Step 3: Run the full JS suite**

```bash
npm test
```

Expected: all tests pass.

**Step 4: Commit**

```bash
git add src/bootstrap/assetCache.js tests/js/assetCache.test.js
git commit -m "$(cat <<'EOF'
feat(bootstrap): add AssetCache.rewriteAssetTags for cached-asset rendering

Adds rewriteAssetTags(parsedDoc) to AssetCache. Walks the parsed document:
- Cached <link rel="stylesheet" href="/css/X"> → inline <style> with cached
  text (AC2.1).
- Cached <script src="/js/X"> → src rewritten to a blob: URL minted from
  cached bytes; the original canonical path is annotated as
  dataset.assetCacheOrigin so fetchAndSwap.js _recreateScripts can dedup
  against the canonical path on subsequent swaps (AC2.2 mechanism).
- Cache misses pass the tag through unchanged (AC2.4).
- URLs outside /css/, /js/, /ios.css are NEVER rewritten (AC2.5).

Tracks every minted blob URL in a module-scoped Set so they can be revoked
at swap-end (next phase commit) — prevents memory leaks in the SPA-style
shell where the document never unloads.

Adds _normalizeAssetUrl, _isCacheableAssetUrl helpers, exposes new
internals + tests for AC4.4 invariant (asset cache never touches
mapCache.js's RoadTripMapCache database).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Hook `rewriteAssetTags` into `_swapFromHtml` and update `_recreateScripts` dedup

**Verifies (in concert with Task 4's tests):** Activates the rewrite at swap time (AC2.1, AC2.2 wiring), preserves the `_executedScriptSrcs` invariant for blob-rewritten scripts.

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/src/bootstrap/fetchAndSwap.js` (insert hook in `_swapFromHtml`; update `_recreateScripts` to use the dataset annotation)

**Step 1: Insert the rewrite call in `_swapFromHtml`**

The current `_swapFromHtml` (lines 60-119) flow is: parse HTML (line 61) → inject `<base href>` (lines 64-68) → extract scripts (line 72) → remove from parsed (line 73) → swap head/body (lines 76-77) → recreate scripts (line 101).

Insert the rewrite call **between line 68 and line 70** (i.e., after the `<base href>` injection block, before the script extraction). The exact existing block at lines 68-72:

```javascript
        }

        // Strip scripts from the parsed doc — they'd be inert if included via innerHTML
        // (parser-inserted + already-started). They're recreated in Task 3.
        const scriptsInOrder = Array.from(parsed.querySelectorAll('script'));
```

Replace with:

```javascript
        }

        // Phase 3: rewrite cached <link rel="stylesheet"> → <style> and cached
        // <script src> → blob: URL BEFORE scripts are extracted, so the
        // scriptsInOrder array picks up the rewritten src + dataset annotation.
        // Defensive: AssetCache may not be loaded in test environments that
        // eval fetchAndSwap.js without first eval'ing assetCache.js.
        if (typeof globalThis.AssetCache !== 'undefined' && typeof globalThis.AssetCache.rewriteAssetTags === 'function') {
            try {
                await globalThis.AssetCache.rewriteAssetTags(parsed);
            } catch (err) {
                // Never block render on a rewrite failure — fall through with the
                // unmutated parsed doc. The browser will fetch from the network
                // (online) or fail silently (offline; acceptable per AC scope).
            }
        }

        // Strip scripts from the parsed doc — they'd be inert if included via innerHTML
        // (parser-inserted + already-started). They're recreated in Task 3.
        const scriptsInOrder = Array.from(parsed.querySelectorAll('script'));
```

**Step 2: Add the swap-end blob-URL revocation**

At the end of `_swapFromHtml`, after the `TripStorage.markOpened(url)` block (currently lines 116-118), insert:

```javascript
        // Phase 3: revoke blob URLs minted by rewriteAssetTags. Each <script src=blob:>
        // has loaded (or errored) by now — _recreateScripts awaits onload/onerror per
        // script. Revoke synchronously to avoid leaking memory in the SPA-style shell.
        if (typeof globalThis.AssetCache !== 'undefined' && globalThis.AssetCache._internals && typeof globalThis.AssetCache._internals._revokePendingBlobUrls === 'function') {
            try {
                globalThis.AssetCache._internals._revokePendingBlobUrls();
            } catch (err) {
                // Swallow — leak is preferable to throwing during the render path.
            }
        }
```

**Step 3: Update `_recreateScripts` dedup to use `dataset.assetCacheOrigin`**

Locate `_recreateScripts` (lines 19-58). The current external-script branch reads:

```javascript
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
```

Replace it with (changes: derive `dedupKey` from `dataset.assetCacheOrigin || _absolutizeSrc(rawSrc)`; revoke blob URLs on load/error):

```javascript
            // External script path (has a non-empty src attribute)
            if (rawSrc) {
                // Phase 3: when rewriteAssetTags has substituted a blob: URL, the canonical
                // path lives in dataset.assetCacheOrigin. Use it as the dedup key so blob URLs
                // (which are unique per swap) don't defeat the _executedScriptSrcs invariant.
                const dedupKey = oldScript.dataset.assetCacheOrigin
                    ? _absolutizeSrc(oldScript.dataset.assetCacheOrigin)
                    : _absolutizeSrc(rawSrc);
                if (_executedScriptSrcs.has(dedupKey)) {
                    // Already executed in this realm (previous page, or earlier in this page).
                    // Skip recreation to avoid the duplicate-const cascade.
                    continue;
                }
                const fresh = document.createElement('script');
                for (const attr of oldScript.attributes) {
                    fresh.setAttribute(attr.name, attr.value);
                }
                // Carry the dataset annotation onto the fresh element so a future
                // _recreateScripts call sees the canonical path even if the blob URL changed.
                if (oldScript.dataset.assetCacheOrigin) {
                    fresh.dataset.assetCacheOrigin = oldScript.dataset.assetCacheOrigin;
                }
                await new Promise((resolve) => {
                    fresh.onload = () => {
                        // Only add on successful load. onerror does not guarantee the
                        // script's top-level declarations executed, so we allow retry.
                        _executedScriptSrcs.add(dedupKey);
                        resolve();
                    };
                    fresh.onerror = () => resolve();
                    parentNode.appendChild(fresh);
                });
                continue;
            }
```

**Step 4: Smoke-check syntax**

```bash
node --check src/bootstrap/fetchAndSwap.js
```

Expected: no output.

**Step 5: Do NOT commit yet** — Task 4 adds the integration tests; commit them together.
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Extend `tests/js/fetchAndSwap.test.js` with integration tests

**Verifies:** End-to-end flow of `offline-asset-precache.AC2.1`, `offline-asset-precache.AC2.2`, `offline-asset-precache.AC2.4`, `offline-asset-precache.AC2.5`, `offline-asset-precache.AC4.3`.

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/tests/js/fetchAndSwap.test.js`

**Step 1: Update the test bootstrap to also load `assetCache.js`**

The existing `setupTest` reads several module sources via `fs.readFileSync`. Add an entry for `assetCache.js` near the top of the file (after the existing `FETCH_AND_SWAP_SRC` declaration):

```javascript
const ASSET_CACHE_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/assetCache.js'), 'utf8');
```

Inside `setupTest()`, between the `eval(CACHED_FETCH_SRC)` call and `eval(LISTENER_SHIM_SRC)` call (mirroring the production load order in `index.html`), add:

```javascript
delete globalThis.AssetCache;
eval(ASSET_CACHE_SRC);
```

**Step 2: Append a new `describe` block at the bottom of the file**

```javascript
describe('Phase 3: rewriteAssetTags hook in _swapFromHtml', () => {
  it('AC2.1: cached /css/styles.css is rewritten to <style> before head swap; no <link> remains', async () => {
    await setupTest();
    try {
      // Pre-populate IDB with bytes for /css/styles.css.
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

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head><link rel="stylesheet" href="/css/styles.css?v=4"></head><body></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        )
      );

      await FetchAndSwap.fetchAndSwap('/post/abc');

      // No <link> for /css/styles.css remains in the live document.
      expect(document.head.querySelector('link[href*="/css/styles.css"]')).toBeNull();
      // A <style> with the cached text was injected.
      const style = document.head.querySelector('style');
      expect(style).not.toBeNull();
      expect(style.textContent).toBe('body { color: red; }');
    } finally {
      teardownTest();
    }
  });

  it('AC2.2: cached /js/foo.js is rewritten to a blob URL with dataset.assetCacheOrigin', async () => {
    await setupTest();
    try {
      const jsBytes = new TextEncoder().encode('console.log("foo");').buffer;
      await globalThis.AssetCache._internals._putAsset({
        url: '/js/foo.js',
        bytes: jsBytes,
        contentType: 'application/javascript',
        sha256: 'js-sha',
        etag: null,
        lastModified: null,
        cachedAt: Date.now(),
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head><script src="/js/foo.js"></script></head><body></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        )
      );

      await FetchAndSwap.fetchAndSwap('/post/abc');

      // _recreateScripts moves all <script> to body in the offline shell.
      const script = document.body.querySelector('script');
      expect(script).not.toBeNull();
      expect(script.getAttribute('src')).toMatch(/^blob:/);
      expect(script.dataset.assetCacheOrigin).toBe('/js/foo.js');
    } finally {
      teardownTest();
    }
  });

  it('AC2.2 dedup: a second swap with the same /js/foo.js does NOT call appendChild for the script (uses dataset.assetCacheOrigin as dedup key)', async () => {
    await setupTest();
    try {
      const jsBytes = new TextEncoder().encode('console.log("foo");').buffer;
      await globalThis.AssetCache._internals._putAsset({
        url: '/js/foo.js',
        bytes: jsBytes,
        contentType: 'application/javascript',
        sha256: 'js-sha',
        etag: null,
        lastModified: null,
        cachedAt: Date.now(),
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head><script src="/js/foo.js"></script></head><body></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        )
      );

      // Note on shape: _swapFromHtml runs `body.innerHTML = parsed.body.innerHTML` BEFORE
      // _recreateScripts. So a second swap wipes the first swap's recreated <script>. The
      // dedup invariant is verified not by counting <script> elements at the end (which is
      // 0 after a second swap that dedups), but by counting SCRIPT appendChild calls across
      // both swaps — exactly 1 (the first swap appended; the second swap's _recreateScripts
      // hit the dedup branch and skipped).
      let scriptAppendCount = 0;
      const realAppendChild = Node.prototype.appendChild;
      const appendSpy = vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function (node) {
        if (node && node.tagName === 'SCRIPT') {
          scriptAppendCount++;
        }
        const result = realAppendChild.call(this, node);
        // Preserve the existing test-harness behavior: synchronously fire onload for
        // appended scripts so the await new Promise(...) inside _recreateScripts resolves.
        if (node && node.tagName === 'SCRIPT' && node.getAttribute && node.getAttribute('src')) {
          setTimeout(() => { if (node.onload) node.onload(); }, 0);
        }
        return result;
      });

      try {
        await FetchAndSwap.fetchAndSwap('/post/page1');
        const afterFirst = scriptAppendCount;
        expect(afterFirst).toBe(1); // first swap appended the cached <script src=blob:...>

        // _executedScriptSrcs should contain the canonical absolutized path (NOT the blob URL).
        expect(FetchAndSwap._executedScriptSrcs.has('https://app-roadtripmap-prod.azurewebsites.net/js/foo.js')).toBe(true);

        await FetchAndSwap.fetchAndSwap('/post/page2');
        // Despite blob URLs being unique per swap, the dedup key is the canonical path,
        // so _recreateScripts MUST NOT have appended a new <script> element this swap.
        expect(scriptAppendCount).toBe(afterFirst);
      } finally {
        appendSpy.mockRestore();
      }
    } finally {
      teardownTest();
    }
  });

  it('AC2.4: cache miss leaves <link> untouched', async () => {
    await setupTest();
    try {
      // Empty cache — no _putAsset call.
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head><link rel="stylesheet" href="/css/styles.css"></head><body></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        )
      );

      await FetchAndSwap.fetchAndSwap('/post/abc');

      const link = document.head.querySelector('link[href="/css/styles.css"]');
      expect(link).not.toBeNull();
      expect(document.head.querySelector('style')).toBeNull();
    } finally {
      teardownTest();
    }
  });

  it('AC2.4: cache miss leaves <script src> untouched', async () => {
    await setupTest();
    try {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head><script src="/js/never-cached.js"></script></head><body></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        )
      );

      await FetchAndSwap.fetchAndSwap('/post/abc');

      const script = document.body.querySelector('script');
      expect(script).not.toBeNull();
      expect(script.getAttribute('src')).toBe('/js/never-cached.js');
      expect(script.dataset.assetCacheOrigin).toBeUndefined();
    } finally {
      teardownTest();
    }
  });

  it('AC2.5: external CDN URL is never rewritten, even with cache state', async () => {
    await setupTest();
    try {
      // We do NOT put anything in cache for this URL — but the test would still pass
      // even if we did, because the URL is outside the allow-list.
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head><link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.21.0/dist/maplibre-gl.css"></head><body></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        )
      );

      await FetchAndSwap.fetchAndSwap('/post/abc');

      const link = document.head.querySelector('link[href*="unpkg.com"]');
      expect(link).not.toBeNull();
      expect(link.getAttribute('href')).toBe('https://unpkg.com/maplibre-gl@5.21.0/dist/maplibre-gl.css');
    } finally {
      teardownTest();
    }
  });

  it('AC2.5: /lib/exifr/full.umd.js is never rewritten', async () => {
    await setupTest();
    try {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head><script src="/lib/exifr/full.umd.js"></script></head><body></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        )
      );

      await FetchAndSwap.fetchAndSwap('/post/abc');

      const script = document.body.querySelector('script');
      expect(script).not.toBeNull();
      expect(script.getAttribute('src')).toBe('/lib/exifr/full.umd.js');
      expect(script.dataset.assetCacheOrigin).toBeUndefined();
    } finally {
      teardownTest();
    }
  });

  it('AC4.3: pages and api stores still work after rewriteAssetTags integration', async () => {
    await setupTest();
    try {
      // The CachedFetch flow must continue to write to RoadTripPageCache pages store.
      // Stub a page fetch and verify CachedFetch caches it.
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head></head><body>page</body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html', 'ETag': 'W/"abc"' } }
        )
      );
      await FetchAndSwap.fetchAndSwap('/post/abc');

      // After the swap, CachedFetch should have written to the pages store.
      const cachedRecord = await globalThis.CachedFetch._internals._getRecord('pages', '/post/abc');
      expect(cachedRecord).not.toBeNull();
      expect(cachedRecord).not.toBeUndefined();
    } finally {
      teardownTest();
    }
  });

  it('blob URLs are revoked at swap-end', async () => {
    await setupTest();
    try {
      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
      const jsBytes = new TextEncoder().encode('//').buffer;
      await globalThis.AssetCache._internals._putAsset({
        url: '/js/foo.js',
        bytes: jsBytes,
        contentType: 'application/javascript',
        sha256: 'js-sha',
        etag: null,
        lastModified: null,
        cachedAt: Date.now(),
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head><script src="/js/foo.js"></script></head><body></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        )
      );

      await FetchAndSwap.fetchAndSwap('/post/abc');

      // _revokePendingBlobUrls was called — at minimum once with a blob: URL.
      expect(revokeSpy).toHaveBeenCalled();
      const revokedAtLeastOneBlob = revokeSpy.mock.calls.some((call) => typeof call[0] === 'string' && call[0].startsWith('blob:'));
      expect(revokedAtLeastOneBlob).toBe(true);

      revokeSpy.mockRestore();
    } finally {
      teardownTest();
    }
  });
});
```

**Step 3: Run the test file**

```bash
npm test -- tests/js/fetchAndSwap.test.js
```

Expected: every existing test in this file still passes, and every new test passes.

**Step 4: Run the full JS suite**

```bash
npm test
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/bootstrap/fetchAndSwap.js tests/js/fetchAndSwap.test.js
git commit -m "$(cat <<'EOF'
feat(bootstrap): wire AssetCache.rewriteAssetTags into _swapFromHtml

In _swapFromHtml, after <base href> injection and before scripts are
extracted, await AssetCache.rewriteAssetTags(parsed). Cached
<link rel="stylesheet" href="/css/X"> tags are inlined as <style>
elements; cached <script src="/js/X"> tags are rewritten to blob:
URLs. Cache misses pass through unchanged; non-asset URLs are never
touched.

Updates _recreateScripts to use the dataset.assetCacheOrigin
annotation (set by rewriteAssetTags) as the dedup key so blob URLs —
which are unique per swap — don't defeat the _executedScriptSrcs
invariant.

At swap-end, calls AssetCache._internals._revokePendingBlobUrls()
to release minted blob URLs and prevent memory leaks in the
SPA-style shell.

Verifies offline-asset-precache.AC2.1, AC2.2, AC2.4, AC2.5, AC4.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-6) -->

<!-- START_TASK_5 -->
### Task 5: Upgrade `_ensureIosCss` in `loader.js` to use `AssetCache`

**Verifies (in concert with Task 6's tests):** `offline-asset-precache.AC2.3`.

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/src/bootstrap/loader.js` (function declaration on lines 62-70 and the wrapper call on line 17)

**Step 1: Make `_ensureIosCss` async and check the cache**

Replace the existing function (lines 62-70):

```javascript
    function _ensureIosCss() {
        if (!document.head.querySelector('link[data-ios-css]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/ios.css';
            link.setAttribute('data-ios-css', 'true');
            document.head.appendChild(link);
        }
    }
```

with:

```javascript
    async function _ensureIosCss() {
        if (document.head.querySelector('[data-ios-css]')) {
            // Already present — could be a cached <style> from a prior swap or
            // the <link> fallback. Don't double-inject.
            return;
        }

        // AC2.3: prefer cached bytes if available, fall back to <link> on miss.
        let cachedText = null;
        if (typeof globalThis.AssetCache !== 'undefined' && typeof globalThis.AssetCache.getCachedText === 'function') {
            try {
                cachedText = await globalThis.AssetCache.getCachedText('/ios.css');
            } catch {
                cachedText = null;
            }
        }

        if (cachedText) {
            const style = document.createElement('style');
            style.setAttribute('data-ios-css', 'true');
            style.textContent = cachedText;
            document.head.appendChild(style);
            return;
        }

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/ios.css';
        link.setAttribute('data-ios-css', 'true');
        document.head.appendChild(link);
    }
```

**Step 2: Update the wrapper call to `await` the async function**

The wrapper at lines 13-18 currently reads:

```javascript
        if (FetchAndSwap && typeof FetchAndSwap.fetchAndSwap === 'function') {
            const original = FetchAndSwap.fetchAndSwap;
            FetchAndSwap.fetchAndSwap = async function (url, options) {
                await original(url, options);
                _ensureIosCss();
            };
```

Change the `_ensureIosCss();` call (currently line 17) to `await _ensureIosCss();`:

```javascript
        if (FetchAndSwap && typeof FetchAndSwap.fetchAndSwap === 'function') {
            const original = FetchAndSwap.fetchAndSwap;
            FetchAndSwap.fetchAndSwap = async function (url, options) {
                await original(url, options);
                await _ensureIosCss();
            };
```

**Step 3: Smoke-check syntax**

```bash
node --check src/bootstrap/loader.js
```

Expected: no output.

**Step 4: Do NOT commit yet** — Task 6 adds the tests.
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Extend `tests/js/bootstrap-loader.test.js` with `_ensureIosCss` cache hit/miss tests

**Verifies:** `offline-asset-precache.AC2.3`.

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/tests/js/bootstrap-loader.test.js`

**Step 1: Update the test bootstrap to also load `assetCache.js`**

The existing `SOURCES` object reads several module sources. Add an entry for `assetCache.js`:

```javascript
const SOURCES = {
    cachedFetch: fs.readFileSync(path.join(SHELL, 'cachedFetch.js'), 'utf8'),
    assetCache: fs.readFileSync(path.join(SHELL, 'assetCache.js'), 'utf8'),
    tripStorage: fs.readFileSync(path.join(SHELL, 'tripStorage.js'), 'utf8'),
    fetchAndSwap: fs.readFileSync(path.join(SHELL, 'fetchAndSwap.js'), 'utf8'),
    intercept: fs.readFileSync(path.join(SHELL, 'intercept.js'), 'utf8'),
    loader: fs.readFileSync(path.join(SHELL, 'loader.js'), 'utf8'),
};
```

In the `beforeEach` block (where modules are eval'd), add `eval(SOURCES.assetCache);` between `eval(SOURCES.cachedFetch)` and `eval(SOURCES.tripStorage)` — mirroring the production load order in `index.html`. Also add `delete globalThis.AssetCache;` to the global cleanup section if there is one.

**Step 2: Append AC2.3 tests to the existing `'ios.css injection'` describe block**

Inside the existing `describe('ios.css injection', ...)` block, append:

```javascript
    it('AC2.3 cache hit: injects <style data-ios-css> with cached bytes when AssetCache has /ios.css', async () => {
        // Pre-populate /ios.css in AssetCache. AssetCache must be eval'd by beforeEach.
        const iosCssBytes = new TextEncoder().encode('.platform-ios { padding-top: 1rem; }').buffer;
        await globalThis.AssetCache._internals._putAsset({
            url: '/ios.css',
            bytes: iosCssBytes,
            contentType: 'text/css',
            sha256: 'ios-sha',
            etag: null,
            lastModified: null,
            cachedAt: Date.now(),
        });

        globalThis.fetch = vi.fn().mockImplementation(() =>
            Promise.resolve(
                new Response('<html><body>page</body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            )
        );

        await runLoader();

        const style = document.head.querySelector('style[data-ios-css]');
        expect(style).not.toBeNull();
        expect(style.textContent).toBe('.platform-ios { padding-top: 1rem; }');
        expect(document.head.querySelector('link[data-ios-css]')).toBeNull();
    });

    it('AC2.3 cache miss: falls back to <link data-ios-css href="/ios.css"> when AssetCache has no entry', async () => {
        // No _putAsset call — empty cache.
        globalThis.fetch = vi.fn().mockImplementation(() =>
            Promise.resolve(
                new Response('<html><body>page</body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            )
        );

        await runLoader();

        expect(document.head.querySelector('style[data-ios-css]')).toBeNull();
        const link = document.head.querySelector('link[data-ios-css]');
        expect(link).not.toBeNull();
        expect(link.getAttribute('href')).toBe('/ios.css');
    });

    it('AC2.3: does not double-inject when both <style> and a swap fire', async () => {
        // Pre-populate cache so first injection produces <style>.
        const iosCssBytes = new TextEncoder().encode('.platform-ios { padding: 0; }').buffer;
        await globalThis.AssetCache._internals._putAsset({
            url: '/ios.css',
            bytes: iosCssBytes,
            contentType: 'text/css',
            sha256: 'ios-sha',
            etag: null,
            lastModified: null,
            cachedAt: Date.now(),
        });

        globalThis.fetch = vi.fn().mockImplementation(() =>
            Promise.resolve(
                new Response('<html><body>page</body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            )
        );

        await runLoader();
        await FetchAndSwap.fetchAndSwap('/post/page2');

        // After two swaps, only one [data-ios-css] element exists in document.head.
        const tagged = document.head.querySelectorAll('[data-ios-css]');
        expect(tagged.length).toBe(1);
    });
```

**Step 3: Run the test file**

```bash
npm test -- tests/js/bootstrap-loader.test.js
```

Expected: existing tests pass; new AC2.3 tests pass.

**Step 4: Run the full JS suite**

```bash
npm test
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/bootstrap/loader.js tests/js/bootstrap-loader.test.js
git commit -m "$(cat <<'EOF'
feat(bootstrap): _ensureIosCss serves /ios.css from AssetCache when available

Upgrades _ensureIosCss in loader.js to be async and consult
AssetCache.getCachedText('/ios.css') first. On cache hit, injects
<style data-ios-css> with the cached bytes; on miss, retains the
existing <link data-ios-css href="/ios.css"> fallback.

The wrapper around FetchAndSwap.fetchAndSwap now awaits the call
so subsequent code can rely on the stylesheet being installed.

Verifies offline-asset-precache.AC2.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_C -->

---

## Phase 3 done when

- All six tasks above committed to `offline-asset-precache`.
- `npm test` passes.
- With the IDB pre-populated for `/css/styles.css`, `/js/foo.js`, and `/ios.css`, a `FetchAndSwap.fetchAndSwap(...)` call:
  - Replaces the parsed `<link rel="stylesheet" href="/css/styles.css?v=4">` with `<style>` containing the cached bytes (no `<link>` for that URL remains in `document.head`).
  - Replaces the parsed `<script src="/js/foo.js">` with a `blob:` URL whose backing bytes match the cached entry; the script element carries `dataset.assetCacheOrigin = '/js/foo.js'`.
  - Triggers the loader's `_ensureIosCss` to inject `<style data-ios-css>` from the cached bytes.
- Cache misses leave tags untouched; non-allow-list URLs (CDN, `/lib/...`) are never rewritten.
- A second swap to a page with the same `/js/foo.js` reference does NOT re-execute the script — `_recreateScripts` dedupes against the canonical path via `dataset.assetCacheOrigin`.
- Blob URLs are revoked at swap-end (no pending URLs leak between swaps).
- `RoadTripPageCache.pages` and `RoadTripPageCache.api` semantics are unchanged (`AC4.3`); `mapCache.js`'s `RoadTripMapCache` database is untouched (`AC4.4`, verified by Phase 2's invariant test that still passes here).
