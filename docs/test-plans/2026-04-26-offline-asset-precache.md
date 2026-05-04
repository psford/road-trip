# Human Test Plan: Offline Asset Pre-Cache

Branch: `offline-asset-precache` (HEAD `d096593` at plan generation time)
Design plan: [docs/design-plans/2026-04-26-offline-asset-precache.md](../design-plans/2026-04-26-offline-asset-precache.md)
Implementation plan: [docs/implementation-plans/2026-04-26-offline-asset-precache/](../implementation-plans/2026-04-26-offline-asset-precache/)

Automated coverage status: **PASS** (15 of 15 ACs covered by automated tests; full suite 607/607 across 32 test files in ~30s).

This plan covers the manual on-device verification required before sign-off, plus per-AC traceability between automated and manual coverage.

---

## Prerequisites

- Build the iOS shell from the `offline-asset-precache` branch (HEAD `d096593`) via Xcode and install on a real iPhone, or use a TestFlight build of the same branch.
- Apple device with `Settings > Airplane Mode` accessible.
- USB cable + Mac with Safari `Developer` menu enabled (for Web Inspector attach).
- A trip with at least one POI in view and at least one photo (so AC4.4 map-data sanity has something to render).
- Locally: `npm test` passing (`607/607`) on `d096593`.
- Locally: `dotnet test RoadTripMap.sln` passing on `d096593`.
- Locally: `git diff origin/develop -- src/RoadTripMap/Program.cs` returns empty output (AC4.1 by-construction check).

---

## Phase 1: Online warm-up (populate caches on a real device)

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Force-quit the app from the iOS app switcher; re-launch fresh on Wi-Fi or LTE | App opens to home; saved-trip list (if any) renders |
| 1.2 | Navigate to home `/` and dwell ~5 seconds | No console errors in attached Safari Web Inspector |
| 1.3 | Open a trip post page `/post/<token>` and dwell ~5 seconds | Page renders fully styled; photo carousel scrolls and snaps; if a map is present, POIs and any park boundaries render |
| 1.4 | Open a view page `/trips/view/<view-token>` for the same trip and dwell ~5 seconds | Page renders fully styled; map renders with same POIs |
| 1.5 | In Safari Web Inspector → Storage → IndexedDB, expand `RoadTripPageCache` | Three object stores visible: `pages`, `api`, `assets`. `assets` contains records for `/css/*.css`, `/js/*.js`, and `/ios.css` (verifies AC1.2 + AC4.5 fired on this device) |
| 1.6 | In the same Inspector pane, expand `RoadTripMapCache` | Separate database exists with `map-data` records populated (verifies AC4.4 — map cache is not co-mingled with asset cache) |

---

## Phase 2: Offline relaunch (golden path — DoD)

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Force-quit the app (swipe up from app switcher) | App is fully terminated |
| 2.2 | `Settings > Airplane Mode` ON | All radios off; Wi-Fi disconnected |
| 2.3 | Re-launch the app | Home renders fully styled (no FOUC, no unstyled-DOM flash); saved-trip list shown from `TripStorage` |
| 2.4 | Tap into the previously-visited post page | Page renders fully styled (verifies AC3.1 — cached CSS as `<style>` applied); photo carousel scrolls/snaps (verifies AC3.2 — `photoCarousel.js` initialized from cached blob URL); broken-image placeholders are acceptable for thumbnails (documented scope boundary) |
| 2.5 | Confirm `RoadTrip.onPageLoad` callbacks fire (e.g., page-specific module init, layout hooks) by interacting with the page | Tap interactions and dynamic UI behave as in online mode; no JavaScript errors in Safari Web Inspector console |
| 2.6 | Tap into the previously-visited view page | Page renders fully styled; same checks as 2.4–2.5 |
| 2.7 | Navigate back, then forward, then back again across cached pages | All transitions work; no unstyled flashes; `<style data-ios-css>` (or `<link data-ios-css>` if cache miss) persists across swaps and is never duplicated (verifies AC2.3 idempotency on a real device) |

---

## Phase 3: Edge cases

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | (Manifest fetch failure on first launch) Delete the app and reinstall. Block `https://app-roadtripmap-prod.azurewebsites.net/asset-manifest.json` at the network level (Charles Proxy or similar) but leave page fetches working. Launch the app online. | App launches and renders; first-launch home and at least one tapped page render fully styled because the lazy fallback (AC5.1) fills the asset cache from the page revalidate path |
| 3.2 | (Asset content drift) Online: open the post page once. Then deploy a build that changes a `/css/*.css` or `/js/*.js` file (not realistic in a manual session — defer to deploy-time smoke). | Confirm subsequent navigation picks up the new asset bytes; the manifest's new sha256 triggers a re-fetch of the changed file and updates IDB |
| 3.3 | (Cache eviction simulation) In Safari Web Inspector, manually delete a single record from `assets` (e.g., delete `/css/styles.css`). Re-load the same page offline. | Page renders without that CSS file (cache miss path: AC2.4 — `<link>` survives, browser fetch fails offline). On next online navigation, the lazy + eager precache repopulates the missing entry |
| 3.4 | (Mixed-version assets) Online, navigate to a page. Then in Inspector, edit one `assets` record's `sha256` to a wrong value. Force-quit, re-launch online. | Eager precache (AC4.5) compares manifest sha256 to cached sha256, sees mismatch, re-downloads the file, and overwrites the bad record |
| 3.5 | (Capacitor → external URL still passes through) From a cached page, tap an external link (e.g., a maplibre attribution link, or any href to `https://...` outside the app origin) | Native browser opens; AC2.5 holds — external URLs are never rewritten |
| 3.6 | (Disable airplane mode mid-session) From Phase 2 step 2.7, turn airplane mode OFF | Navigations resume hitting the network; revalidate path fires on next cached-page tap; no regression in the online flow |

---

## End-to-End Scenarios

### Scenario A: Cold-install-then-offline (full DoD)

Purpose: validates AC3.1 + AC3.2 against the strictest user flow — the user has never visited a page before, gets one online visit, then loses connectivity.

Steps:
1. Delete the app entirely.
2. Reinstall from Xcode/TestFlight (clean IDB).
3. Launch online; navigate to home, then one post page; dwell 10 seconds on each.
4. Force-quit.
5. Airplane mode ON.
6. Re-launch.
7. Tap into the post page visited in step 3.
8. Verify: page renders fully styled, photo carousel works, no JavaScript console errors, `data-page="post"` on body, `<style>` (not `<link>`) for `/css/styles.css` in `document.head`, at least one `<script[data-asset-cache-origin]>` with `src="blob:..."` in the document.
9. Disable airplane mode; confirm subsequent navigation continues to work.

### Scenario B: mapCache.js + assetCache.js coexistence (AC4.4)

Purpose: confirms the two IndexedDB stores stay independent on a real device.

Steps:
1. Online: open a trip with visible POIs; pan/zoom the map a few times; confirm POI markers appear and persist on subsequent zooms.
2. Open Safari Web Inspector → Storage → IndexedDB.
3. Confirm `RoadTripMapCache` exists with populated `map-data` records.
4. Confirm `RoadTripPageCache` exists with populated `assets`, `pages`, `api` stores.
5. Force-quit; airplane mode ON; re-launch; navigate back to the same trip.
6. POI markers still render from cache — independent of asset cache state.

### Scenario C: AC4.1 deployed-header smoke

Purpose: confirms `Cache-Control: no-cache` survives the branch (by-construction; design does not modify `Program.cs`).

Steps:
1. After deploy of `offline-asset-precache` to App Service, run from any terminal:
   ```
   curl -I https://app-roadtripmap-prod.azurewebsites.net/js/roadTrip.js
   curl -I https://app-roadtripmap-prod.azurewebsites.net/css/styles.css
   ```
2. Confirm both responses include `Cache-Control: no-cache` in the headers.
3. If the header is missing, the static-files middleware has been disturbed by an unrelated change — investigate before proceeding.

---

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC2.2 (real-browser script execution side effects) | JSDOM does not execute `<script src=blob:...>`; only a real browser engine can prove cached JS bytes actually run | Phase 2 steps 2.4–2.5 (interactions confirm `RoadTrip.onPageLoad` callbacks fired); Phase 2 step 2.7 (cross-page navigation confirms `_executedScriptSrcs` dedup works on real WebKit) |
| AC3.2 (real-browser side effects under offline DoD) | Same — JSDOM cannot execute the blob; integration test only proves bytes are correct | Scenario A step 8 |
| AC4.1 (Cache-Control: no-cache preserved on deployed responses) | Concerns server response headers from production App Service; can only be verified against a live deployment | Scenario C; also pre-PR check `git diff origin/develop -- src/RoadTripMap/Program.cs` returns empty |
| AC4.4 (mapCache.js + assetCache.js coexistence on a real device) | Unit tests pin the DB-name and allow-list invariants; full real-device interplay (POIs render online + offline, two DBs separate in real iOS WebKit IDB) closes the loop | Scenario B |

---

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 manifest well-formed | `tests/js/assetCache-integration.test.js` (5 tests in AC1.1 describe) | Phase 1 step 1.5 (visual confirm `assets` store populated) |
| AC1.2 precacheFromManifest happy path | `tests/js/assetCache.test.js` — AC1.2 describe | Phase 1 step 1.5 |
| AC1.3 orphan deletion | `tests/js/assetCache.test.js` — AC1.3 describe | Edge case 3.4 (manual sha mismatch repair) |
| AC1.4 failure modes | `tests/js/assetCache.test.js` — AC1.4 describe | Edge case 3.1 (manifest 404 / blocked) |
| AC2.1 link rewrite | `tests/js/fetchAndSwap.test.js` + `tests/js/assetCache.test.js` | Phase 2 step 2.4 + Scenario A step 8 |
| AC2.2 script src rewrite | `tests/js/fetchAndSwap.test.js` + `tests/js/assetCache-integration.test.js` | Phase 2 steps 2.4–2.7 + Scenario A step 8 |
| AC2.3 ios.css injection | `tests/js/bootstrap-loader.test.js` — 3 AC2.3 tests | Phase 2 step 2.7 (no double-inject on real device) |
| AC2.4 cache miss passthrough | `tests/js/assetCache.test.js` + `tests/js/fetchAndSwap.test.js` | Edge case 3.3 (manual eviction → offline graceful failure) |
| AC2.5 non-allow-list passthrough | `tests/js/assetCache.test.js` + `tests/js/fetchAndSwap.test.js` | Edge case 3.5 (external link tap) |
| AC3.1 offline cached-page rendering | `tests/js/assetCache-integration.test.js` — AC3.1+AC3.2 describe | Phase 2 step 2.4 + Scenario A step 8 |
| AC3.2 cached JS execution side effects | `tests/js/assetCache-integration.test.js` — AC3.1+AC3.2 describe | Phase 2 steps 2.4–2.5 + Scenario A step 8 |
| AC4.1 Cache-Control preserved | None (by-construction; static `git diff` check) | Scenario C + pre-PR `git diff` |
| AC4.2 wwwroot/*.html never references assetCache.js | `tests/js/assetCache-integration.test.js` — AC4.2 describe | None — static check is sufficient |
| AC4.3 v1→v2 DB upgrade | `tests/js/cachedFetch.test.js` — upgrade describe + AC4.3 migration test | Phase 1 step 1.5 (verify all three stores present after upgrade on first launch on a device that may have had a v1 DB) |
| AC4.4 mapCache.js separation | `tests/js/assetCache.test.js` — AC4.4 invariant | Scenario B |
| AC4.5 non-blocking eager precache | `tests/js/assetCache.test.js` + `tests/js/bootstrap-loader.test.js` | Phase 1 step 1.2 (no FOUC during home dwell) |
| AC5.1 lazy fallback | `tests/js/assetCache.test.js` + `tests/js/cachedFetch.test.js` + `tests/js/assetCache-integration.test.js` | Edge case 3.1 (blocked manifest still produces a styled offline page) |

---

## Known Deviations

- **AC5.1 lazy precache fires from the cache-hit-then-revalidate path only**, not the cache-miss path. Documented in commit `4061eb8`, an inline comment in `src/bootstrap/cachedFetch.js`, and pinned by a test (`Phase 4 deviation: lazyPrecacheFromHtml is NOT fired from cache-miss` in `tests/js/cachedFetch.test.js`). User-visible effect: on a true first launch with a manifest fetch failure, the asset cache fills on the SECOND visit to a given page (when the first visit's stale `pages` record is revalidated). The eager `precacheFromManifest()` path remains the primary populator.
