# Test Requirements — offline-asset-precache

Maps every acceptance criterion from `docs/design-plans/2026-04-26-offline-asset-precache.md` to its automated coverage and (where automation is insufficient) to a human-verifiable procedure.

Generated: 2026-04-27. Re-generate if ACs are added or implementation phases are renumbered.

## Summary

- **Total ACs:** 15
  - AC1 (Manifest produced and consumed): 4
  - AC2 (Render-time tag rewrite): 5
  - AC3 (Offline rendering — DoD): 2
  - AC4 (Invariants preserved): 5 (AC4.1–AC4.5)
  - AC5 (Lazy fallback): 1
- **Fully automated (sufficient):** 12 — AC1.1, AC1.2, AC1.3, AC1.4, AC2.1, AC2.3, AC2.4, AC2.5, AC3.1, AC4.2, AC4.3, AC4.5
- **Partially automated + human verification recommended:** 2 — AC3.2, AC4.4
- **Static check + human verification:** 1 — AC4.1
- **Mechanism automated, full AC end-to-end requires real device:** 1 — AC2.2

## AC1: Manifest produced and consumed

### offline-asset-precache.AC1.1
- **AC text:** `npm run build:bundle` produces a syntactically valid `src/RoadTripMap/wwwroot/asset-manifest.json` containing one entry per file under `wwwroot/css/*.css`, `wwwroot/js/*.js`, and `wwwroot/ios.css`, each with a non-zero `size` (number, bytes) and a 64-character hex `sha256`.
- **Coverage:** Automated
- **Test type:** Static (filesystem check against the checked-in artifact)
- **Test file:** `tests/js/assetCache-integration.test.js`
- **Phase task:** Phase 4 Task 6
- **Test description:** Five `describe('AC1.1: ...')` test cases read the checked-in `src/RoadTripMap/wwwroot/asset-manifest.json` from disk, assert it parses as JSON with `version` (string) and `files` (array), assert every entry has a leading-slash `url`, positive `size`, and 64-char hex `sha256`, and cross-reference the manifest's `url` set against `fs.readdirSync` of `wwwroot/css/`, `wwwroot/js/`, plus a literal `/ios.css` lookup. Phase 1 Task 1 emits the manifest operationally; Phase 4 Task 6 pins it as a test.
- **Sufficient?** Yes — the test reads the actual artifact that ships in the repo, so any drift between disk contents and manifest contents is caught.

### offline-asset-precache.AC1.2
- **AC text:** `AssetCache.precacheFromManifest()` fetches `/asset-manifest.json`, downloads every listed asset whose cached `sha256` differs from the manifest, and writes them to the `assets` IDB store with `{ url, bytes, contentType, sha256, etag, lastModified, cachedAt }` populated.
- **Coverage:** Automated
- **Test type:** Unit / integration (vitest + JSDOM + `fake-indexeddb`)
- **Test file:** `tests/js/assetCache.test.js`
- **Phase task:** Phase 2 Task 6
- **Test description:** The `describe('AssetCache.precacheFromManifest() — happy path (AC1.2)')` block stubs `globalThis.fetch` for `/asset-manifest.json` plus per-asset paths, calls `await AssetCache.precacheFromManifest()`, then asserts `_getAsset(url)` returns records with the expected `sha256`, decoded text bytes, and `cachedAt` near `Date.now()`. Sibling cases verify sha-match → no overwrite and sha-differ → refresh.
- **Sufficient?** Yes — the test exercises the full fetch + diff + IDB-write pipeline against `fake-indexeddb`, the same library used by the production-shaped store.

### offline-asset-precache.AC1.3
- **AC text:** When the manifest version changes and a previously-cached URL is no longer present in the manifest, that URL is deleted from the `assets` IDB store on the next `precacheFromManifest()` call.
- **Coverage:** Automated
- **Test type:** Unit / integration (vitest + JSDOM + `fake-indexeddb`)
- **Test file:** `tests/js/assetCache.test.js`
- **Phase task:** Phase 2 Task 6
- **Test description:** The `describe('AssetCache.precacheFromManifest() — orphan deletion (AC1.3)')` block pre-populates `/js/old.js` in IDB, stubs the manifest to omit that URL, calls `precacheFromManifest()`, and asserts `_getAsset('/js/old.js') === null`. A paired case asserts that URLs still listed in the manifest with matching sha are NOT deleted.
- **Sufficient?** Yes — directly verifies the orphan-deletion code path.

### offline-asset-precache.AC1.4
- **AC text:** `precacheFromManifest()` resolves (does not reject) when the manifest fetch returns a non-2xx status, when the network throws, or when the manifest body is malformed JSON. The IDB store is unchanged in any of these cases.
- **Coverage:** Automated
- **Test type:** Unit (vitest + JSDOM + `fake-indexeddb`)
- **Test file:** `tests/js/assetCache.test.js`
- **Phase task:** Phase 2 Task 6
- **Test description:** The `describe('AssetCache.precacheFromManifest() — failure modes (AC1.4)')` block covers five distinct failure shapes: 404 manifest, network throw, malformed JSON body, `files` not-an-array, and individual asset 404 mid-batch. Each case asserts `await expect(precacheFromManifest()).resolves.toBeUndefined()` and that pre-populated IDB records remain unchanged.
- **Sufficient?** Yes — exhaustive over the failure modes named in the AC text.

## AC2: Render-time tag rewrite

### offline-asset-precache.AC2.1
- **AC text:** When the `assets` store contains `/css/styles.css`, `_swapFromHtml` rewrites the parsed `<link rel="stylesheet" href="/css/styles.css">` to `<style>...cached text...</style>` *before* the head innerHTML swap. After the swap, no `<link>` to `/css/styles.css` is present in `document.head`.
- **Coverage:** Automated
- **Test type:** Integration (vitest + JSDOM exercising `FetchAndSwap.fetchAndSwap`)
- **Test file:** `tests/js/fetchAndSwap.test.js`
- **Phase task:** Phase 3 Task 4 (with helper unit coverage in Phase 3 Task 2 / `tests/js/assetCache.test.js`)
- **Test description:** The `describe('Phase 3: rewriteAssetTags hook in _swapFromHtml')` block pre-populates `/css/styles.css` bytes via `_putAsset`, stubs `globalThis.fetch` with a page response that has `<link rel="stylesheet" href="/css/styles.css?v=4">`, calls `FetchAndSwap.fetchAndSwap('/post/abc')`, and asserts no `<link>` for `/css/styles.css` remains in `document.head` while a `<style>` containing the cached text is present.
- **Sufficient?** Yes — verifies both halves of the AC (link removed, style with cached bytes inserted) through the real swap code path.

### offline-asset-precache.AC2.2
- **AC text:** When the `assets` store contains `/js/foo.js`, `_swapFromHtml` rewrites the parsed `<script src="/js/foo.js">` to `<script src="blob:...">` whose blob bytes match the cached entry. The synchronous load order of the document's scripts is preserved.
- **Coverage:** Automated (mechanism) + Human verification (real-browser execution)
- **Test type:** Integration (mechanism) + on-device manual (execution)
- **Test file:** `tests/js/fetchAndSwap.test.js` (mechanism), `tests/js/assetCache-integration.test.js` (mechanism + bytes-correctness)
- **Phase task:** Phase 3 Task 4 (mechanism), Phase 4 Task 6 (bytes-correctness via Blob inspection)
- **Test description:** The integration test (`assetCache-integration.test.js`, Phase 4 Task 6) verifies the rewrite plumbing AND inspects the Blob argument passed to `URL.createObjectURL` to prove the blob's `type === 'application/javascript'` and `await blob.text()` matches the cached bytes byte-for-byte. The Phase 3 fetchAndSwap test asserts the rewritten `<script>` has `src` matching `/^blob:/` and `dataset.assetCacheOrigin === '/js/foo.js'`. JSDOM does NOT execute `<script src=blob:>` bytes, so the AC's "observable side effects" half (e.g., `RoadTrip.onPageLoad` registration firing, page-specific module init) is verified via human procedure.
- **Sufficient?** Indicative — the automated tests pin the bytes are correct and the rewrite plumbing is wired, but a real browser is needed to confirm `<script src=blob:...>` actually executes.
- **Human verification:** See "Human Verification Plan" below.

### offline-asset-precache.AC2.3
- **AC text:** When `loader.js`'s `_ensureIosCss` runs and the `assets` store contains `/ios.css`, a `<style data-ios-css>` is injected with cached bytes. When the cache misses, the existing `<link data-ios-css href="/ios.css">` fallback is injected.
- **Coverage:** Automated
- **Test type:** Integration (vitest + JSDOM exercising the loader)
- **Test file:** `tests/js/bootstrap-loader.test.js`
- **Phase task:** Phase 3 Task 6
- **Test description:** Three `it('AC2.3 ...')` cases inside the `'ios.css injection'` describe block: (1) cache hit → `<style data-ios-css>` present with cached text and no `<link data-ios-css>`; (2) cache miss → `<link data-ios-css href="/ios.css">` fallback present and no `<style data-ios-css>`; (3) two swaps with cache → exactly one `[data-ios-css]` element remains (no double-inject).
- **Sufficient?** Yes — both branches and idempotency are tested.

### offline-asset-precache.AC2.4
- **AC text:** When the `assets` store does not contain a referenced asset, the `<link>` or `<script src>` tag is left untouched and the browser performs its normal fetch (which succeeds online, fails offline).
- **Coverage:** Automated
- **Test type:** Unit + integration (vitest + JSDOM)
- **Test file:** `tests/js/assetCache.test.js`, `tests/js/fetchAndSwap.test.js`
- **Phase task:** Phase 3 Task 2 (helper unit), Phase 3 Task 4 (integration through `_swapFromHtml`)
- **Test description:** The `describe('AssetCache.rewriteAssetTags — cache miss (AC2.4)')` block (Phase 3 Task 2) exercises the helper directly with empty IDB. The `it('AC2.4: cache miss leaves <link> untouched')` and `it('AC2.4: cache miss leaves <script src> untouched')` cases in `fetchAndSwap.test.js` (Phase 3 Task 4) assert that after a `FetchAndSwap.fetchAndSwap` call against a page with un-cached asset references, the original `href`/`src` survives, no `<style>` is injected, and `dataset.assetCacheOrigin` is undefined.
- **Sufficient?** Yes — the AC's online-fetch / offline-fail half is browser default behavior; the test pins the rewrite-side invariant (the only thing the implementation controls).

### offline-asset-precache.AC2.5
- **AC text:** Asset URLs outside `/css/*`, `/js/*`, and `/ios.css` (e.g., `https://unpkg.com/maplibre-gl@...`, `/lib/exifr/full.umd.js`) are never rewritten, regardless of cache state.
- **Coverage:** Automated
- **Test type:** Unit + integration (vitest + JSDOM)
- **Test file:** `tests/js/assetCache.test.js`, `tests/js/fetchAndSwap.test.js`
- **Phase task:** Phase 3 Task 2 (allow-list unit), Phase 3 Task 4 (integration)
- **Test description:** The `describe('AssetCache._internals._isCacheableAssetUrl')` block enumerates accept/reject cases including `/lib/exifr/full.umd.js`, normalized CDN paths, and `/api/poi`. The `describe('AssetCache.rewriteAssetTags — non-allow-list passthrough (AC2.5)')` cases verify a parsed `<link>` to `https://unpkg.com/...` and a `<script>` to `/lib/exifr/full.umd.js` survive unchanged. The `it('AC2.5: external CDN URL is never rewritten')` and `it('AC2.5: /lib/exifr/full.umd.js is never rewritten')` cases in `fetchAndSwap.test.js` exercise the same invariant through a full `fetchAndSwap` call.
- **Sufficient?** Yes — both unit and integration layers cover the AC's named exemplars.

## AC3: Offline rendering (DoD acceptance test)

### offline-asset-precache.AC3.1
- **AC text:** Given the `RoadTripPageCache` `pages` and `assets` stores are populated for a given page from a prior online session, and `globalThis.fetch` rejects all requests, navigating to that page via `FetchAndSwap.fetchAndSwap` produces a document whose `<head>` contains the cached CSS as `<style>` and applied to the `<body>`.
- **Coverage:** Automated
- **Test type:** Integration (vitest + JSDOM + `fake-indexeddb`)
- **Test file:** `tests/js/assetCache-integration.test.js`
- **Phase task:** Phase 4 Task 6
- **Test description:** The `describe('AC3.1 + AC3.2: offline + cached page renders styled with cached JS')` block seeds `pages['/post/abc']` with cached HTML and `assets['/css/styles.css']` with bytes, stubs `globalThis.fetch` to reject with `TypeError('Failed to fetch')`, calls `FetchAndSwap.fetchAndSwap('/post/abc')`, and asserts the resulting `document.head` has no `<link>` for the cached URL and contains a `<style>` with the cached CSS text. The cached body content + `data-page` attribute carry through to `document.body`.
- **Sufficient?** Yes — exercises the locked DoD scenario end-to-end against the same JSDOM environment used by every other shell test.

### offline-asset-precache.AC3.2
- **AC text:** Under the same conditions, every cached `<script src>` reference resolves through a blob URL and the script's side effects (e.g., `RoadTrip.onPageLoad` registration, page-specific module init) are observable in the document.
- **Coverage:** Partially automated + human verification
- **Test type:** Integration (mechanism + bytes-correctness) + on-device manual (real script execution)
- **Test file:** `tests/js/assetCache-integration.test.js`
- **Phase task:** Phase 4 Task 6
- **Test description:** The same describe block as AC3.1 spies on `URL.createObjectURL` BEFORE the swap, locates the call whose Blob `type === 'application/javascript'`, asserts the Blob's `text()` is byte-identical to the cached `jsBytes`, and confirms the rewritten `<script>` carries `dataset.assetCacheOrigin === '/js/foo.js'` with `src` matching `/^blob:/`. As a parity check the test `eval`s the blob's text against `globalThis` to demonstrate the cached bytes ARE valid executable JS, but this `eval` is NOT a substitute for browser execution. JSDOM does not execute `<script src=blob:>` elements, so the "observable side effects" half of the AC is verified by human procedure on a real device.
- **Sufficient?** Indicative — the automated test proves the bytes are correct, the Blob type is correct, and the rewrite plumbing is wired. A real browser run is required to confirm the script's top-level statements actually execute and register their handlers in a navigation flow.
- **Human verification:** See "Human Verification Plan" below.

## AC4: Invariants preserved

### offline-asset-precache.AC4.1
- **AC text:** `Cache-Control: no-cache` continues to be set on `/js/*` and `/css/*` responses by `src/RoadTripMap/Program.cs` `OnPrepareResponse`. This design does not modify the static-files middleware configuration.
- **Coverage:** Static check (preserved by construction) + human verification
- **Test type:** Static (`git diff`) + manual response inspection
- **Test file:** N/A — no automated test added; preservation is by-construction (the design explicitly does not touch `Program.cs`)
- **Phase task:** Verified by branch-wide `git diff` at PR review time
- **Test description:** The design states "this design does not modify the static-files middleware configuration." Verifiable by running `git diff origin/develop -- src/RoadTripMap/Program.cs` at PR time and confirming the output is empty for that file across the entire offline-asset-precache branch. Combined with a manual `curl -I` against deployed `/js/roadTrip.js` and `/css/styles.css` to confirm `Cache-Control: no-cache` is present in the response headers.
- **Sufficient?** Yes for the by-construction half (the diff check is binary). The deployed-response check is done once at deploy verification time and is part of the existing deploy runbook, not a per-PR concern.
- **Human verification:** See "Human Verification Plan" below.

### offline-asset-precache.AC4.2
- **AC text:** A page loaded directly from `https://app-roadtripmap-prod.azurewebsites.net/` (i.e., not through the Capacitor shell) loads `assetCache.js` zero times and creates no IDB store named `assets`.
- **Coverage:** Automated
- **Test type:** Static (filesystem grep)
- **Test file:** `tests/js/assetCache-integration.test.js`
- **Phase task:** Phase 4 Task 6
- **Test description:** The `describe('AC4.2: regular browsers (non-shell) never load assetCache.js')` block iterates every `wwwroot/*.html` file and asserts `contents` does NOT match `/assetCache\.js/`. A paired case asserts that `src/bootstrap/index.html` (the Capacitor `webDir` entry) DOES reference `assetCache.js`, ensuring the file is loaded only inside the shell. Because regular browsers serve from `wwwroot/`, the absence of any reference there means the module's IDB code never executes for browser users — the `assets` store is never created on those origins.
- **Sufficient?** Yes — the static filesystem invariant directly proves the AC. If a future change accidentally adds `assetCache.js` to a `wwwroot/*.html`, this test fails immediately.

### offline-asset-precache.AC4.3
- **AC text:** The `RoadTripPageCache` `pages` and `api` object stores retain identical semantics after the version 1 → 2 upgrade. Existing `cachedFetch.js` reads and writes against these stores succeed unchanged.
- **Coverage:** Automated
- **Test type:** Unit + integration (vitest + JSDOM + `fake-indexeddb`)
- **Test file:** `tests/js/cachedFetch.test.js`, `tests/js/fetchAndSwap.test.js`
- **Phase task:** Phase 2 Task 2 (upgrade-preserves-stores tests), Phase 3 Task 4 (`it('AC4.3: pages and api stores still work after rewriteAssetTags integration')`)
- **Test description:** The Phase 2 `describe('RoadTripPageCache version 1 → 2 upgrade (assets store)')` block asserts the upgraded DB has all three object stores (`pages`, `api`, `assets`) and that `DB_VERSION === 2`. The full pre-existing `cachedFetch.test.js` suite continues to pass (regression guard for the read/write semantics). The Phase 3 integration test confirms `CachedFetch._internals._getRecord('pages', '/post/abc')` returns a populated record after a full `fetchAndSwap` call with the rewrite hook installed.
- **Sufficient?** Yes — the existing test suite is the spec for `pages` / `api` semantics, and it passes unchanged after the upgrade.

### offline-asset-precache.AC4.4
- **AC text:** `src/RoadTripMap/wwwroot/js/mapCache.js` continues to own `/api/poi` and `/api/park-boundaries` caching against its own `RoadTripMapCache` IDB. The asset cache never touches those paths or that database.
- **Coverage:** Automated (defensive) + human verification (full integration)
- **Test type:** Unit (vitest + JSDOM + `fake-indexeddb`) + on-device sanity
- **Test file:** `tests/js/assetCache.test.js`
- **Phase task:** Phase 3 Task 2
- **Test description:** The `describe('AC4.4 invariant: asset cache does not touch RoadTripMapCache')` block asserts `AssetCache._internals.DB_NAME === 'RoadTripPageCache'` (literal constant check) and that after `_putAsset(...)` the `roadtripmap-cache` database is empty / unchanged. The Phase 3 `_isCacheableAssetUrl` test rejects `/api/poi`. Together these prove that the asset cache cannot write to the wrong DB and cannot accept the wrong URL into its allow-list. JSDOM-level coverage is exhaustive against the implementation as written, but a real-device sanity check that `mapCache.js` continues to populate POIs on a live map is recommended at PR-merge time.
- **Sufficient?** Indicative for the JS-implementation half; full end-to-end interplay between `mapCache.js` and `assetCache.js` on a real device is part of human verification.
- **Human verification:** See "Human Verification Plan" below.

### offline-asset-precache.AC4.5
- **AC text:** When `precacheFromManifest()` is invoked on bootstrap, it does not block the first paint: the eager pre-fetch fires after the first swap completes (i.e., the user-visible render proceeds without awaiting the manifest fetch).
- **Coverage:** Automated (both halves)
- **Test type:** Unit (module-level non-blocking) + integration (loader wiring)
- **Test file:** `tests/js/assetCache.test.js` (module half), `tests/js/bootstrap-loader.test.js` (wiring half)
- **Phase task:** Phase 2 Task 6 (module half), Phase 4 Task 5 (wiring half)
- **Test description:** Two distinct halves:
  - **Module half (Phase 2 Task 6):** The `describe('AssetCache.precacheFromManifest() — non-blocking semantics (AC4.5 module half)')` block asserts `precacheFromManifest()` returns a Promise (has `.then`) and that `void precacheFromManifest()` does not throw synchronously even when fetch throws asynchronously. Confirms the function is fire-and-forget-friendly at the API surface.
  - **Wiring half (Phase 4 Task 5):** The `describe('Phase 4 eager pre-fetch trigger')` block in `bootstrap-loader.test.js` includes `it('AC4.5: precacheFromManifest does not block first paint')`, which stubs `precacheFromManifest` to return a never-resolving Promise, runs the loader, and asserts `document.body.textContent` contains the rendered page after `runLoader()` settles. A sibling case `it('manifest-fail does NOT throw or break the loader')` rejects the precache Promise and asserts the loader still resolves and renders.
- **Sufficient?** Yes — the loader proceeds to render even when the precache Promise is permanently pending, which is a stronger condition than the AC requires.

## AC5: Lazy fallback

### offline-asset-precache.AC5.1
- **AC text:** When the manifest fetch fails on first launch online but a page fetch succeeds via `cachedFetch`, the lazy pre-fetch path extracts that page's `/css/*`, `/js/*`, `/ios.css` references and writes their bytes into the `assets` IDB store as a side effect of the successful navigation. After this path runs, AC3.1 and AC3.2 hold for that page on a subsequent offline visit.
- **Coverage:** Automated (mechanism + wiring + end-to-end)
- **Test type:** Unit (URL extraction + sha computation) + integration (lazy trigger + IDB side effect)
- **Test file:** `tests/js/assetCache.test.js`, `tests/js/cachedFetch.test.js`, `tests/js/assetCache-integration.test.js`
- **Phase task:** Phase 4 Task 2 (mechanism), Phase 4 Task 5 (lazy trigger wiring), Phase 4 Task 6 (end-to-end)
- **Test description:** Three tiers:
  - **Mechanism (Phase 4 Task 2):** `describe('AssetCache._internals._extractAssetUrlsFromHtml')` and `describe('AssetCache.lazyPrecacheFromHtml')` blocks cover URL extraction, allow-list filtering, dedup, IDB-skip semantics, sha256 computation, and best-effort error swallowing.
  - **Wiring (Phase 4 Task 5):** `describe('Phase 4 lazy pre-fetch trigger')` in `cachedFetch.test.js` asserts `lazyPrecacheFromHtml` is called after a successful HTML write-through, NOT called for `asJson` responses, and that its rejection does not propagate to the `cachedFetch` caller.
  - **End-to-end (Phase 4 Task 6):** `describe('AC5.1: lazy fallback fills the asset cache from a fresh HTML page')` calls `CachedFetch.cachedFetch('/post/abc')` with mocked fetch responses for both the page and its referenced assets, then polls IDB until the asset records appear (condition-based wait, no fixed sleep).
- **Sufficient?** Yes — the three-tier coverage proves both the wiring and the IDB side effect. The "AC3.1 + AC3.2 hold on subsequent visit" half of the AC is implied: those ACs are independently verified, and AC5.1's test proves the cache is populated by the lazy path.

## Human Verification Plan

For ACs that cannot be fully verified by automated tests, the following procedures should be run on a real iPhone (TestFlight build or Xcode-deployed shell) before merging the offline-asset-precache branch into `main`.

### offline-asset-precache.AC2.2 + AC3.2 (combined: real-browser script execution)

- **Why automation is insufficient:** JSDOM does not execute `<script src>` elements at all (confirmed in Phase 3 codebase verification: the appendChild-stub in `tests/js/fetchAndSwap.test.js` synchronously fires `onload` without running the script body). Automated tests can verify the cached bytes match expectations and the rewrite plumbing is correct, but cannot prove the browser actually executes a `<script src=blob:...>` element. The AC's "observable side effects" requirement (e.g., `RoadTrip.onPageLoad` callbacks firing, photoCarousel initializing) needs a real browser engine.
- **Manual procedure:**
  1. Build the iOS shell in Xcode and install on a real iPhone (or use TestFlight build of the `offline-asset-precache` branch).
  2. Launch the app while online. Navigate to at least three distinct page types: home (`/`), a trip post page (`/post/<token>`), and a view page (`/trips/view/<view-token>`). Wait ~5 seconds on each so the lazy + eager pre-fetch can populate IDB.
  3. Force-quit the app completely (swipe up from app switcher).
  4. Enable airplane mode (Settings → Airplane Mode ON).
  5. Re-launch the app. Confirm the home page renders fully styled (no unstyled-DOM flash) and shows the saved trip list (read from `TripStorage`).
  6. Tap into a previously-visited trip post page. Verify:
     - Page renders fully styled (CSS `<style>` injection working — AC3.1).
     - Photo carousel scrolls / snaps correctly (`photoCarousel.js` initialized — AC3.2 side effect).
     - Map view (if present) shows the page-specific layout (page-init JS executed).
     - No `RoadTrip.onPageLoad` errors in the Safari Web Inspector console attached over USB.
  7. Tap into a previously-visited view page. Same checks.
  8. Disable airplane mode. Confirm subsequent online navigation behaves identically (no regression).
- **When to run:** Before the offline-asset-precache → develop PR is merged, AND again before the develop → main PR is opened. Document the device model + iOS version + branch SHA in the PR description.
- **Optional follow-up:** A Playwright test against a Capacitor-built shell could automate steps 3-7. Out of scope for this branch but recommended as a separate ticket if the offline path is regressed in the future.

### offline-asset-precache.AC4.1 (Cache-Control: no-cache preserved)

- **Why automation is insufficient:** The AC concerns server response headers for production deployments. While the design preserves the behavior by construction (no `Program.cs` changes), the only way to verify the deployed app actually emits the header is to inspect a live response.
- **Manual procedure:**
  1. **Diff check (mandatory before PR merge):** Run `git diff origin/develop -- src/RoadTripMap/Program.cs` from the `offline-asset-precache` branch. The output MUST be empty. If non-empty, the change has accidentally regressed the AC; investigate.
  2. **Live header check (post-deploy):** After deploy to App Service, run:
     ```
     curl -I https://app-roadtripmap-prod.azurewebsites.net/js/roadTrip.js
     curl -I https://app-roadtripmap-prod.azurewebsites.net/css/styles.css
     ```
     Confirm both responses include `Cache-Control: no-cache` exactly as the existing prod behavior. If the header is missing, the static-files middleware has been disturbed by an unrelated change.
- **When to run:** Diff check at every PR review for the offline-asset-precache branch. Live header check is part of the standard post-deploy smoke (not a new step introduced by this branch).

### offline-asset-precache.AC4.4 (mapCache.js retains POI/park-boundaries ownership)

- **Why automation is insufficient:** The unit tests confirm the asset cache's allow-list cannot accept `/api/poi` and the asset cache's DB name is `RoadTripPageCache`, not `roadtripmap-cache`. These are necessary but not sufficient — a full sanity check that map data still loads and caches correctly on a real device closes the loop.
- **Manual procedure:**
  1. With the offline-asset-precache iOS shell installed and online:
     - Open a trip with POIs visible. Pan/zoom the map a few times. Confirm POI markers appear and persist on subsequent zooms (mapCache.js IDB hits).
     - Open the iOS device's Safari Web Inspector → Storage → IndexedDB. Confirm `RoadTripMapCache` exists with populated `map-data` records, and `RoadTripPageCache` exists with populated `assets`, `pages`, `api` stores. The two databases are separate.
  2. Force-quit, airplane mode, re-launch, navigate back to the same trip. Confirm POIs still render from cache (mapCache.js working offline) — independent of asset cache.
- **When to run:** Once per branch before the develop → main PR.

---

## Test File Summary

| Test file | New / modified | Phase | Primary ACs covered |
|-----------|---------------|-------|---------------------|
| `tests/js/cachedFetch.test.js` | Modified | 2, 4 | AC4.3 (DB upgrade preserves stores), AC5.1 (lazy trigger wiring) |
| `tests/js/assetCache.test.js` | New | 2, 3, 4 | AC1.2, AC1.3, AC1.4, AC2.4, AC2.5, AC4.4 (DB name), AC4.5 (module half), AC5.1 (mechanism) |
| `tests/js/fetchAndSwap.test.js` | Modified | 3 | AC2.1, AC2.2 (mechanism), AC2.4, AC2.5, AC4.3 |
| `tests/js/bootstrap-loader.test.js` | Modified | 3, 4 | AC2.3, AC4.5 (wiring half) |
| `tests/js/assetCache-integration.test.js` | New | 4 | AC1.1, AC3.1, AC3.2 (mechanism + bytes-correctness), AC4.2, AC5.1 (end-to-end) |

All test files run under `npm test` (vitest + JSDOM + `fake-indexeddb`). JS tests do not run in CI per `CLAUDE.md`; run locally before pushing any commit on the `offline-asset-precache` branch.
