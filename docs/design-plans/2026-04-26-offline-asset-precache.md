# Offline Asset Pre-Cache Design

## Summary

The offline asset pre-cache solves a specific bug in the iOS Capacitor shell: when `_swapFromHtml` replaces `document.head.innerHTML`, the browser immediately fires network requests for the freshly-inserted `<link>` and `<script src>` tags — requests that fail offline, leaving the page unstyled and non-functional. The fix is an IDB-backed asset cache with render-time tag rewrite, populated by an eager-plus-lazy pre-fetch: cached CSS is inlined as `<style>` elements and cached JS is served via blob URLs, both substituted into the parsed document before the head swap completes, so no network request for those assets is ever issued.

Service Workers are not an option on Capacitor's `capacitor://localhost` scheme (the API throws on non-HTTP/HTTPS origins), which collapses the design to a single viable architecture. The new `assetCache.js` module extends the existing `RoadTripPageCache` IndexedDB database with a third object store, follows the same IIFE conventions and error-swallow semantics already established by `cachedFetch.js`, and is gated to the Capacitor shell by file location alone — no runtime platform checks required. This design ships first because a reliable offline asset layer is a prerequisite for the planned offline-uploads feature.

## Definition of Done

**Primary deliverable:** An IDB-backed pre-cache for wwwroot static assets that ensures pages in the iOS Capacitor shell render with full styles and JS when offline.

**In scope:**
- `wwwroot/css/styles.css`
- `wwwroot/js/*.js` (currently 26 files)
- `wwwroot/ios.css`
- Shell-gated execution; structured for later browser flip

**Out of scope:**
- MapTiler tiles (separate plan)
- Photo blob caching (existing scope boundary in CLAUDE.md Gotchas)
- `src/bootstrap/*.js` (already shipped in Capacitor `webDir`, never network-fetched)
- First-launch-offline UX (existing `fallback.html` is sufficient)
- Browser activation now (designed for; not enabled)

**Invariants preserved:**
- `Cache-Control: no-cache` on `/js/*` + `/css/*` stays in place (deploy-reaches-device)
- Regular browsers visiting App Service directly behave exactly as today (no regressions)
- `RoadTripPageCache` HTML/API caching is unchanged
- `mapCache.js` retains ownership of `/api/poi` + `/api/park-boundaries`
- The asset cache is the source of truth at render time, independent of whether the manifest can be fetched at that moment

**Acceptance test (proves done):**
Kill app → airplane mode → launch → navigate to a previously-visited page → renders styled (parity with online).

**Open for brainstorming:**
- Architecture: Service Worker vs boot-time pre-fetch + asset rewrite vs hybrid
- Manifest source: revive `scripts/build-bundle.js` vs build a new pipeline vs runtime enumeration
- Strategy: eager (boot-time pre-fetch all manifest entries) vs lazy (fetch-on-visit)
- Asset rewrite: inline `<style>`/`<script>` vs `blob:` URL vs SW intercept
- Eviction policy: version-mismatch vs LRU vs never
- Boot ordering / loading-state UX

## Acceptance Criteria

### offline-asset-precache.AC1: Manifest produced and consumed

- **offline-asset-precache.AC1.1 Success:** `npm run build:bundle` produces a syntactically valid `src/RoadTripMap/wwwroot/asset-manifest.json` containing one entry per file under `wwwroot/css/*.css`, `wwwroot/js/*.js`, and `wwwroot/ios.css`, each with a non-zero `size` (number, bytes) and a 64-character hex `sha256`.
- **offline-asset-precache.AC1.2 Success:** `AssetCache.precacheFromManifest()` fetches `/asset-manifest.json`, downloads every listed asset whose cached `sha256` differs from the manifest, and writes them to the `assets` IDB store with `{ url, bytes, contentType, sha256, etag, lastModified, cachedAt }` populated.
- **offline-asset-precache.AC1.3 Success:** When the manifest version changes and a previously-cached URL is no longer present in the manifest, that URL is deleted from the `assets` IDB store on the next `precacheFromManifest()` call.
- **offline-asset-precache.AC1.4 Failure:** `precacheFromManifest()` resolves (does not reject) when the manifest fetch returns a non-2xx status, when the network throws, or when the manifest body is malformed JSON. The IDB store is unchanged in any of these cases.

### offline-asset-precache.AC2: Render-time tag rewrite

- **offline-asset-precache.AC2.1 Success:** When the `assets` store contains `/css/styles.css`, `_swapFromHtml` rewrites the parsed `<link rel="stylesheet" href="/css/styles.css">` to `<style>...cached text...</style>` *before* the head innerHTML swap. After the swap, no `<link>` to `/css/styles.css` is present in `document.head`.
- **offline-asset-precache.AC2.2 Success:** When the `assets` store contains `/js/foo.js`, `_swapFromHtml` rewrites the parsed `<script src="/js/foo.js">` to `<script src="blob:...">` whose blob bytes match the cached entry. The synchronous load order of the document's scripts is preserved.
- **offline-asset-precache.AC2.3 Success:** When `loader.js`'s `_ensureIosCss` runs and the `assets` store contains `/ios.css`, a `<style data-ios-css>` is injected with cached bytes. When the cache misses, the existing `<link data-ios-css href="/ios.css">` fallback is injected.
- **offline-asset-precache.AC2.4 Failure:** When the `assets` store does not contain a referenced asset, the `<link>` or `<script src>` tag is left untouched and the browser performs its normal fetch (which succeeds online, fails offline).
- **offline-asset-precache.AC2.5 Failure:** Asset URLs outside `/css/*`, `/js/*`, and `/ios.css` (e.g., `https://unpkg.com/maplibre-gl@...`, `/lib/exifr/full.umd.js`) are never rewritten, regardless of cache state.

### offline-asset-precache.AC3: Offline rendering (DoD acceptance test)

- **offline-asset-precache.AC3.1 Success:** Given the `RoadTripPageCache` `pages` and `assets` stores are populated for a given page from a prior online session, and `globalThis.fetch` rejects all requests, navigating to that page via `FetchAndSwap.fetchAndSwap` produces a document whose `<head>` contains the cached CSS as `<style>` and applied to the `<body>`.
- **offline-asset-precache.AC3.2 Success:** Under the same conditions, every cached `<script src>` reference resolves through a blob URL and the script's side effects (e.g., `RoadTrip.onPageLoad` registration, page-specific module init) are observable in the document.

### offline-asset-precache.AC4: Invariants preserved

- **offline-asset-precache.AC4.1 Success:** `Cache-Control: no-cache` continues to be set on `/js/*` and `/css/*` responses by [src/RoadTripMap/Program.cs](../../src/RoadTripMap/Program.cs) `OnPrepareResponse`. This design does not modify the static-files middleware configuration.
- **offline-asset-precache.AC4.2 Success:** A page loaded directly from `https://app-roadtripmap-prod.azurewebsites.net/` (i.e., not through the Capacitor shell) loads `assetCache.js` zero times and creates no IDB store named `assets`.
- **offline-asset-precache.AC4.3 Success:** The `RoadTripPageCache` `pages` and `api` object stores retain identical semantics after the version 1 → 2 upgrade. Existing `cachedFetch.js` reads and writes against these stores succeed unchanged.
- **offline-asset-precache.AC4.4 Success:** [src/RoadTripMap/wwwroot/js/mapCache.js](../../src/RoadTripMap/wwwroot/js/mapCache.js) continues to own `/api/poi` and `/api/park-boundaries` caching against its own `RoadTripMapCache` IDB. The asset cache never touches those paths or that database.
- **offline-asset-precache.AC4.5 Success:** When `precacheFromManifest()` is invoked on bootstrap, it does not block the first paint: the eager pre-fetch fires after the first swap completes (i.e., the user-visible render proceeds without awaiting the manifest fetch).

### offline-asset-precache.AC5: Lazy fallback

- **offline-asset-precache.AC5.1 Success:** When the manifest fetch fails on first launch online but a page fetch succeeds via `cachedFetch`, the lazy pre-fetch path extracts that page's `/css/*`, `/js/*`, `/ios.css` references and writes their bytes into the `assets` IDB store as a side effect of the successful navigation. After this path runs, AC3.1 and AC3.2 hold for that page on a subsequent offline visit.

## Glossary

- **asset cache**: The new `assets` object store added to the existing `RoadTripPageCache` IndexedDB database (version 1 → 2) by this design. Stores raw asset bytes keyed by URL (e.g. `/css/styles.css`) alongside metadata used for cache validation (`sha256`, `etag`, `contentType`). Distinct from the existing `pages` and `api` stores, which cache HTML documents and JSON API responses respectively.

- **asset-manifest.json**: A new build artifact emitted by `scripts/build-bundle.js` alongside the existing `bundle/manifest.json`. Lists every `wwwroot/css/*`, `wwwroot/js/*`, and `ios.css` file with its `url`, `size`, and `sha256`, and is served as a static file from App Service. The existing `bundle/manifest.json` describes the concatenated bundle files (`app.js`, `app.css`, etc.) used as a rollback lever; `asset-manifest.json` describes the individual unbundled source assets consumed by the new pre-cache.

- **render-time rewrite**: The transformation applied to a parsed document's `<head>` inside `_swapFromHtml` before the `innerHTML` swap occurs. Cached `<link rel="stylesheet">` tags are replaced with inline `<style>` elements; cached `<script src>` tags have their `src` rewritten to a blob URL. The goal is to eliminate the browser's synchronous network fetches that the head swap would otherwise trigger.

- **eager pre-fetch**: A boot-time fetch of `asset-manifest.json` fired as a fire-and-forget call after the first page swap renders. Diffs the manifest against IDB, downloads missing or stale entries, and deletes orphaned URLs. Does not block first paint.

- **lazy pre-fetch**: A per-navigation fallback that extracts asset URLs from a freshly-fetched HTML page (when online) and queues any not yet in IDB for download. Safety net for the case where the manifest fetch failed on boot or a page was visited for the first time in a session where the eager pre-fetch did not yet run.

- **render-time choke point**: `_swapFromHtml` in `src/bootstrap/fetchAndSwap.js` — the single function through which all document swaps pass. Because every navigation in the shell funnels through here, inserting the `rewriteAssetTags` hook immediately before the `innerHTML` swap covers all navigation paths without additional wiring.

- **document-swap shell**: The Capacitor bootstrap architecture (`src/bootstrap/`) in which the iOS app fetches live HTML from App Service, caches it in IndexedDB, and replaces the current document's `<head>` and `<body>` in-place using DOMParser. Contrast with the prior bundle-injection approach where a concatenated JS/CSS bundle was shipped in the Capacitor `webDir`.

- **Capacitor `webDir`**: The directory (`src/bootstrap/`) that Capacitor packages into the iOS app bundle and serves as the shell's local origin (`capacitor://localhost`). Files here are available without a network request; this is why bootstrap modules like `cachedFetch.js` and `loader.js` can run before any App Service fetch completes, and why Service Worker registration fails (the scheme is not HTTP/HTTPS).

- **blob URL minting**: The operation `URL.createObjectURL(new Blob([bytes], { type: contentType }))` that produces a short-lived `blob:` URL pointing to in-memory bytes. Used here to rewrite `<script src="/js/foo.js">` to `<script src="blob:...">` so the browser executes cached bytes without issuing a network request. Blob URLs must be explicitly revoked or they persist until the document unloads.

- **RoadTripPageCache**: The existing IndexedDB database used by the iOS Offline Shell, currently at version 1 with `pages` (cached HTML) and `api` (cached JSON) object stores. This design bumps it to version 2 and adds the `assets` store. The name is also used loosely in the codebase to refer to the overall caching subsystem.

## Architecture

The bug surfaces at one specific line: `document.head.innerHTML = parsed.head.innerHTML` in `_swapFromHtml` ([src/bootstrap/fetchAndSwap.js](../../src/bootstrap/fetchAndSwap.js)). That line drops the prior page's stylesheets and inserts the new page's `<link>` tags, which the browser fetches synchronously. Offline → those fetches fail → unstyled page. `_recreateScripts` has the same shape for `<script src>`.

Service Workers are not viable on Capacitor's `capacitor://localhost` scheme — `navigator.serviceWorker.register()` requires HTTP/HTTPS and throws on custom schemes ([Capacitor issue #7069](https://github.com/ionic-team/capacitor/issues/7069), closed "not planned"). That eliminates the SW option from the research note and collapses the design space to a single architecture.

**Single architecture: IDB asset cache + render-time tag rewrite + dual-trigger pre-fetch.**

### Component 1: IDB asset cache

A new `assets` object store added to the existing `RoadTripPageCache` IDB database (version bump 1 → 2). Records keyed by URL (e.g. `/css/styles.css`):

```typescript
type AssetRecord = {
  url: string;             // primary key
  bytes: ArrayBuffer;      // raw response body
  contentType: string;     // for blob URL minting
  sha256: string;          // for manifest diff
  etag: string | null;
  lastModified: string | null;
  cachedAt: number;        // Date.now()
};
```

Write-through semantics mirror [src/bootstrap/cachedFetch.js](../../src/bootstrap/cachedFetch.js): 200 → write through, 304 → keep stale, network/non-OK → keep stale, errors swallowed.

### Component 2: Render-time tag rewrite

Hook in `_swapFromHtml` *before* the head innerHTML swap. The rewrite walks the parsed document head:

- Cached `<link rel="stylesheet" href="/css/...">` → replaced with `<style>` containing cached text. Safe because the codebase has no `@import` or `url(...)` in CSS (verified during investigation; the Asset URL conventions section in CLAUDE.md is consistent with this).
- Cached `<script src="/js/...">` → `src` rewritten to a freshly-minted blob URL. Preserves synchronous execution order. Avoids the inline-script duplicate-const trap that the codebase has explicit Gotchas around (see CLAUDE.md "Script-src dedup" note).
- Cache miss → tag is left untouched. Browser fetches normally (online) or fails silently (offline; acceptable per AC scope).
- Non-`/css/` / `/js/` / `/ios.css` URLs (e.g. MapLibre CDN scripts, exifr) pass through unchanged.

### Component 3: Dual-trigger pre-fetch

- **Eager (boot-time).** After the first swap renders, fire-and-forget `AssetCache.precacheFromManifest()`. Fetches `/asset-manifest.json`, diffs against IDB, downloads missing/stale entries, deletes orphaned entries. Manifest fetch failure swallowed.
- **Lazy (on swap).** When a page is fetched online, opportunistically pre-fetch any of its referenced `/css/*` `/js/*` assets that aren't yet in IDB. Safety net for the manifest-fail case and for first-visit pages.

### Component 4: New module `src/bootstrap/assetCache.js`

IIFE following the same shape as the existing bootstrap modules. Exposes on `globalThis.AssetCache`:

```typescript
type AssetCacheModule = {
  precacheFromManifest(): Promise<void>;
  getCachedText(url: string): Promise<string | null>;
  getCachedBlobUrl(url: string): Promise<string | null>;
  rewriteAssetTags(parsedDoc: Document): Promise<void>;
  _internals: {
    _getDb: () => Promise<IDBDatabase>;
    _putAsset: (record: AssetRecord) => Promise<void>;
    _getAsset: (url: string) => Promise<AssetRecord | null>;
    _deleteAsset: (url: string) => Promise<void>;
    _diffManifest: (manifest: AssetManifest) => Promise<DiffResult>;
    _mintBlobUrl: (record: AssetRecord) => string;
    DB_NAME: string;
    DB_VERSION: number;
    STORE_ASSETS: string;
  };
};
```

The `onupgradeneeded` handler creates the `assets` store when migrating from version 1 to 2; existing `pages` and `api` stores are untouched.

### Component 5: Manifest pipeline

[scripts/build-bundle.js](../../scripts/build-bundle.js) is extended to *also* emit `src/RoadTripMap/wwwroot/asset-manifest.json` alongside the existing `bundle/*` artifacts. Schema:

```typescript
type AssetManifest = {
  version: string;        // same git-SHA-derived version as existing bundle manifest
  files: Array<{
    url: string;          // e.g. "/js/roadTrip.js"
    size: number;
    sha256: string;
  }>;
};
```

Checked into git, served by App Service's existing static-files middleware. No new endpoint, no `Cache-Control: no-cache` rule for the manifest itself (short-lived, fetched at boot only). `npm run build:bundle` becomes a pre-deploy checklist item; it is the single source of truth for asset hashes.

### Shell-only by construction

All asset-cache code lives in `src/bootstrap/*`, which is the Capacitor `webDir`. Regular browsers visiting `https://app-roadtripmap-prod.azurewebsites.net/` directly never load any of this code. No `RoadTrip.isNativePlatform()` gate is needed — the file location *is* the gate. The manifest endpoint and tag rewrites have no effect on browser users; their only artifact in `wwwroot/` is the static `asset-manifest.json` file, which is fetched only by the bootstrap shell.

### Eviction & versioning policy

- Diff-based: on manifest fetch, compare each cached entry's `sha256` against the manifest. Mismatch → mark for refresh (next pre-fetch overwrites). URL absent from manifest → delete from IDB (orphan, removed in a deploy).
- Write-through on background revalidate mirrors `cachedFetch.js` semantics.
- No LRU, no TTL — manifest version is the only invalidation signal. The full asset surface is ~350 KB, well below any IDB quota concern.
- Manifest fetch failure is transparent: cache stays as-is; lazy-on-visit fills gaps.

### Boot ordering

The verified [src/bootstrap/loader.js](../../src/bootstrap/loader.js) sequence is:

1. Set `platform-ios` class on `<body>` before first paint.
2. Wrap `FetchAndSwap.fetchAndSwap` so `_ensureIosCss` runs after every swap.
3. Validate `TripStorage` is loaded.
4. Install `Intercept` delegated handlers.
5. Read `TripStorage.getDefaultTrip()`, `pushState`, then `fetchAndSwap(bootUrl)`.
6. Remove the bootstrap-progress shim after first swap completes.

The eager pre-fetch trigger fires after step 6 as a fire-and-forget `void AssetCache.precacheFromManifest()`. It does not block render. Failure is swallowed.

## Existing Patterns

This design follows existing patterns in the bootstrap shell rather than introducing new conventions:

- **IIFE module shape from [cachedFetch.js](../../src/bootstrap/cachedFetch.js).** `assetCache.js` mirrors its structure: IIFE that assigns to `globalThis.AssetCache`, internal helpers prefixed with `_`, `_internals` exposure for tests, idempotent install pattern.
- **IDB connection management from [cachedFetch.js](../../src/bootstrap/cachedFetch.js).** The same `_getDb()` accessor pattern with shared connection caching is reused. Extending `RoadTripPageCache` with a third object store (rather than creating a new database) avoids parallel connection management and enables atomic version bumps.
- **Background-revalidate semantics from [cachedFetch.js](../../src/bootstrap/cachedFetch.js).** 200 → write through, 304 → keep stale, network/non-OK → keep stale, errors swallowed. The asset cache's pre-fetch worker uses identical semantics.
- **Integration choke point from [fetchAndSwap.js](../../src/bootstrap/fetchAndSwap.js).** `_swapFromHtml` already strips scripts before the head innerHTML swap and dispatches lifecycle events afterward. The new `rewriteAssetTags` hook slots in immediately before the innerHTML swap, mirroring how `_recreateScripts` wraps script handling.
- **Wrapper pattern from [loader.js](../../src/bootstrap/loader.js).** `loader.js` already wraps `FetchAndSwap.fetchAndSwap` to call `_ensureIosCss` after every swap. The eager pre-fetch trigger uses the same wrapper-and-fire-after pattern, slotting in after the first swap completes.
- **Bundle pipeline from [scripts/build-bundle.js](../../scripts/build-bundle.js).** The script already enumerates `wwwroot/{js,css}/*`, computes `sha256` + `size`, and runs `node --check` against bundled output. The new `asset-manifest.json` emission reuses the same enumeration and hashing — no parallel pipeline.
- **Test conventions from [tests/js/setup.js](../../tests/js/setup.js).** Vitest + JSDOM + `fake-indexeddb/auto` (line 5 of `setup.js`). New tests follow the `tests/js/<feature>.test.js` naming convention used by ~30 existing test files.

No new patterns are introduced. Every component above has a precedent in the existing codebase that this design extends rather than replaces.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Manifest emitter

**Goal:** Emit `asset-manifest.json` from the existing build pipeline so downstream phases have a manifest to consume.

**Components:**
- [scripts/build-bundle.js](../../scripts/build-bundle.js) — extended to also write `src/RoadTripMap/wwwroot/asset-manifest.json` containing every `wwwroot/css/*`, `wwwroot/js/*`, and `wwwroot/ios.css` entry with `{ url, size, sha256 }` and the same `version` field used by the existing bundle manifest. Existing `bundle/*` output is unchanged.
- `src/RoadTripMap/wwwroot/asset-manifest.json` — generated artifact, checked into git like the existing bundle outputs.
- [CLAUDE.md](../../CLAUDE.md) — Commands section updated to note that `npm run build:bundle` now also emits `asset-manifest.json`; Key Files section references the new artifact.

**Dependencies:** None.

**Done when:** Running `npm run build:bundle` produces a syntactically valid `asset-manifest.json` whose `files` array contains every file under `wwwroot/css/`, `wwwroot/js/`, and `ios.css` with correct `size` (bytes) and `sha256` (hex string). Existing bundle output is unchanged. CLAUDE.md is updated. (Infrastructure phase — verified operationally; no test ACs.)
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: AssetCache module

**Goal:** Land the `AssetCache` module with IDB persistence and a working `precacheFromManifest()`, populating IDB silently. No rendering changes yet.

**Components:**
- `src/bootstrap/assetCache.js` (new) — IIFE exposing `globalThis.AssetCache` with `precacheFromManifest`, `getCachedText`, `getCachedBlobUrl`, `_internals`. IDB store creation handles `RoadTripPageCache` upgrade from version 1 → 2, adding the `assets` store.
- [src/bootstrap/index.html](../../src/bootstrap/index.html) — script load order updated to include `assetCache.js` after `cachedFetch.js` and before `fetchAndSwap.js`.
- [tests/js/assetCache.test.js](../../tests/js/assetCache.test.js) (new) — vitest + JSDOM + `fake-indexeddb`. Covers IDB lifecycle, version 1→2 upgrade preserving existing `pages`/`api` stores, manifest diff (missing/stale/orphaned), pre-fetch worker (parallelism, error swallow), idempotency on repeat `precacheFromManifest()` calls.

**Dependencies:** Phase 1 (a manifest exists to consume; tests can use a mocked manifest).

**Done when:** Phase 1's `asset-manifest.json` is successfully fetched and consumed; assets are written to IDB; orphaned URLs are deleted on a manifest version bump; manifest fetch failure is swallowed; tests pass.

**Covers:** `offline-asset-precache.AC1.2`, `offline-asset-precache.AC1.3`, `offline-asset-precache.AC1.4`, `offline-asset-precache.AC4.5`.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Render-time rewrite

**Goal:** Wire the asset cache into the document-swap path so cached assets are served from IDB at render time.

**Components:**
- `src/bootstrap/assetCache.js` — adds `rewriteAssetTags(parsedDoc)` which walks the parsed head and rewrites cached `<link>` → `<style>` and cached `<script src>` → blob URL.
- [src/bootstrap/fetchAndSwap.js](../../src/bootstrap/fetchAndSwap.js) — `_swapFromHtml` calls `await AssetCache.rewriteAssetTags(parsed)` before `document.head.innerHTML = parsed.head.innerHTML`.
- [src/bootstrap/loader.js](../../src/bootstrap/loader.js) — `_ensureIosCss` upgraded to inject a `<style data-ios-css>` from cached `/ios.css` bytes when available; falls back to the existing `<link data-ios-css href="/ios.css">` when the cache misses.
- [tests/js/fetchAndSwap.test.js](../../tests/js/fetchAndSwap.test.js) (extend) — cache hit → `<style>` for CSS / blob URL for JS; cache miss → tag untouched; non-`/css/` `/js/` `/ios.css` URLs untouched.
- [tests/js/bootstrap-loader.test.js](../../tests/js/bootstrap-loader.test.js) (extend) — `_ensureIosCss` uses cached bytes when available, falls back otherwise.

**Dependencies:** Phase 2 (`AssetCache` module exists and IDB is populated).

**Done when:** With pre-populated IDB, swapping to a page renders styled and JS executes regardless of `globalThis.fetch` state; uncached pages retain pass-through behavior; non-asset URLs (CDN scripts) are untouched; tests pass.

**Covers:** `offline-asset-precache.AC2.1`, `offline-asset-precache.AC2.2`, `offline-asset-precache.AC2.3`, `offline-asset-precache.AC2.4`, `offline-asset-precache.AC2.5`, `offline-asset-precache.AC4.3`, `offline-asset-precache.AC4.4`.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Pre-fetch triggers and end-to-end AC

**Goal:** Trigger the pre-cache automatically (eager and lazy) and pin the locked DoD acceptance test with an integration test.

**Components:**
- [src/bootstrap/loader.js](../../src/bootstrap/loader.js) — after the first-swap completes (existing step 6), fires `void AssetCache.precacheFromManifest()` (fire-and-forget).
- [src/bootstrap/cachedFetch.js](../../src/bootstrap/cachedFetch.js) — success path extended: when a fresh `/page` is fetched online (200, write-through), parse the HTML for `/css/*`, `/js/*`, `/ios.css` references and queue any not in the asset cache via a new `AssetCache.lazyPrecacheFromHtml(html)` helper (same fire-and-forget shape as the existing background revalidate).
- `src/bootstrap/assetCache.js` — adds `lazyPrecacheFromHtml(html)` helper that extracts asset URLs and schedules pre-fetch.
- [tests/js/assetCache.test.js](../../tests/js/assetCache.test.js) (extend) — eager-trigger fire-and-forget after first swap; manifest-fail does not block first paint; lazy pre-fetch fills cache as a side effect of a `cachedFetch` success.
- [tests/js/bootstrap-loader.test.js](../../tests/js/bootstrap-loader.test.js) (extend) — eager trigger wiring; manifest 500 swallowed.
- `tests/js/assetCache-integration.test.js` (new) — end-to-end AC: seed `RoadTripPageCache` with cached HTML + assets for a previously-visited page, simulate offline + cold launch, navigate, assert CSS applied (cached `<style>` present in head) and JS executed (blob URL injected and script ran).

**Dependencies:** Phase 3 (rewrite hook exists and works on a populated cache).

**Done when:** Eager pre-fetch fires after first swap; lazy pre-fetch populates the asset cache when an HTML page is fetched online; the integration test passes the locked DoD acceptance scenario; manifest-fetch-fail does not block first-paint.

**Covers:** `offline-asset-precache.AC1.1`, `offline-asset-precache.AC3.1`, `offline-asset-precache.AC3.2`, `offline-asset-precache.AC4.5`, `offline-asset-precache.AC5.1`.
<!-- END_PHASE_4 -->

## Additional Considerations

**Blob URL lifecycle.** Each `<script src>` rewrite mints a blob URL via `URL.createObjectURL(blob)` from cached bytes. Blob URLs persist until either the document unloads or `URL.revokeObjectURL()` is called explicitly. Because the document never unloads in this SPA-style shell, accumulated blob URLs would leak memory. Implementation tracks pending URLs in a short-lived `Set` and revokes them on the next swap or via `script.onload` / `script.onerror` callbacks. This is implementation detail; flagged here so it is not missed.

**Manifest-fail-on-first-boot.** First launch online with a successful page fetch but a failed manifest fetch (App Service hiccup, transient 500) means no assets are eagerly pre-cached. The lazy-on-visit pre-fetch (Phase 4) is the safety net: any page the user actually navigates to gets its asset references queued for pre-fetch as a side effect. Pages the user has not visited in this online session remain unprotected — but the locked AC scopes only to "previously-visited" pages, so this is acceptable.

**Phase 5 paused architectural redesign coupling.** CLAUDE.md memory (`project_road_trip_phase5_paused`) notes Phase 5 of Road Trip is paused due to a bootstrap-render mismatch (DOM mismatch + already-fired DOMContentLoaded). This design adds a NEW module (`assetCache.js`) and a NEW hook in `_swapFromHtml`; it does not touch the document-swap mechanics or the DOMContentLoaded handling. The two efforts can proceed independently. This design is sequenced first because it is a prereq for the offline-uploads feature.

**Regular browsers.** No code path in this design is reachable from a regular browser visiting the App Service origin directly. The `asset-manifest.json` artifact in `wwwroot/` is harmless (a static JSON file); the rewrite logic and IDB store live entirely in `src/bootstrap/*`, which is loaded only by the Capacitor shell. AC4.2 verifies this invariant.

**Future browser flip.** Activating the asset cache for regular browsers would require: (1) loading `cachedFetch.js`, `assetCache.js`, `fetchAndSwap.js`, and `loader.js` from a non-bootstrap entry point that runs on the App Service origin, and (2) a registration mechanism on every `wwwroot/*.html` page. This is explicitly out of scope here, but the choice to keep the rewrite logic in `assetCache.js` (rather than embedded in `_swapFromHtml`) keeps that future flip a wiring change rather than a refactor.
