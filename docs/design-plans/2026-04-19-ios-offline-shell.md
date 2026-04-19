# iOS Offline Shell Design

## Summary

The iOS Offline Shell redesign replaces the existing Capacitor loader, which injected a pre-built JavaScript bundle into a bare HTML shell, with an architecture where the iOS app fetches and renders the same server-generated HTML pages that ordinary browser users see. A thin JavaScript "loader" living at `capacitor://localhost` acts as an invisible router: on launch it picks the right starting page, fetches it from the App Service over HTTPS, parses the response, surgically swaps the document content into the WebView, and re-executes the page's scripts. All subsequent navigation taps are intercepted by a delegated click handler and routed through the same fetch-and-swap cycle rather than triggering a full WebView reload. Because the server pages are served unchanged, the iOS shell is largely invisible to server-side code and requires no new server routes.

Offline capability is added through an IndexedDB page cache (`RoadTripPageCache`) that stores fetched HTML and API responses keyed by URL. Every cache hit renders immediately while a background revalidation request runs in parallel; if the server returns updated content it is written to the cache but not applied to the live document until the user navigates, preventing mid-interaction DOM disruption. Existing modules that already manage their own offline state (`uploadQueue.js`, `optimisticPins.js`, `mapCache.js`, `uploadTransport.js`) are left entirely untouched. Service Workers were considered and rejected because they are unreliable in Capacitor 8 on iOS WKWebView, making the in-page `cachedFetch` wrapper the chosen alternative.

## Definition of Done

1. **Architecture redesign:** The iOS hybrid loader is replaced with a server-first, offline-first model. Every navigable page (`/post/{token}`, `/trips/view/{viewToken}`, the create-trip flow) is a server-rendered HTML page fetched from the App Service and document-swapped into the WebView — no JS-only injection of bundle assets into a stripped-down shell. All internal navigation is intercepted in JS (no cross-origin WebView nav).

2. **Saved-trips UX:** Use the existing localStorage `TripStorage` (introduced by `docs/design-plans/2026-03-31-my-trips-and-home-screen.md`), extended with a `lastOpenedAt` field and a `getDefaultTrip()` helper. First launch with 0 trips → bootstrap fetches `/` (the existing home page with its empty-hero state); subsequent launches with 1+ trips → bootstrap fetches the most-recently-opened trip URL directly. The home page (`/`) is reachable via standard navigation and lists all saved trips. View-only trips get a glasses indicator added to the existing `myTripsList` rendering.

3. **Aggressive offline-first cache:** New IDB store for cached HTML pages and `/api/*` JSON responses. Cache-first with background revalidate; updates from the background refresh are deferred until the next navigation (no silent mid-interaction DOM swap, to avoid clobbering user input or in-progress UI state). After a trip's pages and assets are visited once online, the trip is fully usable offline.

4. **Existing offline upload behavior preserved:** `uploadQueue.js`, `optimisticPins.js`, and `mapCache.js` continue to function unchanged inside the new shell. Pending uploads survive app kill via IDB and resume on next launch with connectivity. Posting offline shows an optimistic pin immediately. The `_uploadTransportImpl` swap seam is preserved (and explicitly documented as the migration path) so the future native background-URL-session work can land as a contained refactor without touching the shell.

5. **AC9.1–9.5 + AC10.1–10.2 reframed and re-met** under the new architecture. Old `phase_05.md` marked superseded.

### Out of scope (explicitly deferred)

- Native iOS background URL session for uploads. Current "resume on next launch via IDB" remains the upload-survival mechanism. The platform-adapter seam in `uploadTransport.js` is the planned migration point; this design must not regress that seam.
- LRU eviction of saved trips with server-side persistence (and the UI to retrieve evicted trips).
- Touch ID / Keychain protection of trip tokens (plaintext IDB acceptable for now, matching the existing "links are auth" trust model).
- Server-side "my trips" / "viewing" split — when added, it lives in the web pages, not the iOS shell.
- Trip creation while offline — blocked at the UI with "save link for later" guidance (server roundtrip needed to mint tokens; map data also unavailable offline pre-first-load).
- iOS-native UI restyling beyond what `wwwroot/ios.css` already enables. The loader must keep `ios.css` applied to every fetched page so future iOS-native styling is a CSS-only addition.

## Acceptance Criteria

### ios-offline-shell.AC1: Server pages render and behave inside the iOS shell
- **ios-offline-shell.AC1.1 Success:** First page (home or default trip) loads and renders in the iOS shell within 3s of launch when cached.
- **ios-offline-shell.AC1.2 Success:** Clicking an internal `<a href>` triggers fetch+swap; new page renders without full WebView reload.
- **ios-offline-shell.AC1.3 Success:** Scripts in the fetched page execute (e.g., `addPhotoButton` handler wires up; `MapUI.init` runs).
- **ios-offline-shell.AC1.4 Success:** Relative URLs in fetched HTML (`<a href="/">`, `<form action="/api/...">`, `fetch('/api/...')`) resolve to the App Service origin via injected `<base href>`.
- **ios-offline-shell.AC1.5 Failure:** Click on a link to an external origin is NOT intercepted; passes through to native handling.
- **ios-offline-shell.AC1.6 Edge:** Click with Cmd/Ctrl/Shift/Alt held, or middle-click, is NOT intercepted.

### ios-offline-shell.AC2: Saved-trips routing and home screen
- **ios-offline-shell.AC2.1 Success:** First launch with 0 saved trips → bootstrap fetches `/`; user sees home page's empty hero state.
- **ios-offline-shell.AC2.2 Success:** Launches with 1+ saved trips → bootstrap fetches the URL of the trip with greatest `lastOpenedAt` directly.
- **ios-offline-shell.AC2.3 Success:** `fetchAndSwap` of a saved trip URL calls `TripStorage.markOpened(url)`, updating `lastOpenedAt`.
- **ios-offline-shell.AC2.4 Success:** Home page's "My Trips" rendering shows view-only trips with a glasses indicator.
- **ios-offline-shell.AC2.5 Edge:** Legacy `TripStorage` entries without `lastOpenedAt` use `addedAt` as fallback for default-trip selection.
- **ios-offline-shell.AC2.6 Failure:** `TripStorage.getTrips()` continues to return entries in the existing shape; existing web `index.html` rendering does not break.

### ios-offline-shell.AC3: Aggressive offline-first cache
- **ios-offline-shell.AC3.1 Success:** First online visit to any page caches it in `RoadTripPageCache.pages` with `cachedAt`, `etag`, `lastModified`.
- **ios-offline-shell.AC3.2 Success:** Subsequent visit to a cached URL renders from cache immediately (cache-first).
- **ios-offline-shell.AC3.3 Success:** Online cache hit fires background revalidate with conditional headers; updates IDB on `200`, no-op on `304`.
- **ios-offline-shell.AC3.4 Success:** Background revalidate with new content does NOT swap live DOM; cached version stays until next navigation.
- **ios-offline-shell.AC3.5 Success:** Offline launch with a cached default trip → renders from cache; background revalidate fails silently.
- **ios-offline-shell.AC3.6 Failure:** Offline launch + cache miss → renders `fallback.html` with "page not cached yet" + retry/back.
- **ios-offline-shell.AC3.7 Edge:** URLs matching `^/api/(poi|park-boundaries)` are NOT touched by `cachedFetch`; `mapCache.js` continues to handle them.

### ios-offline-shell.AC4: Existing offline upload behavior preserved
- **ios-offline-shell.AC4.1 Success:** After fetch+swap to a trip page, `uploadQueue.js` re-init from IDB resumes any pending uploads.
- **ios-offline-shell.AC4.2 Success:** Posting offline shows optimistic pin on map immediately.
- **ios-offline-shell.AC4.3 Success:** When connectivity returns, queued upload completes; pin promotes from optimistic to committed.
- **ios-offline-shell.AC4.4 Failure:** `uploadTransport.js` is unchanged by this work (verified by `git diff` returning empty for that file). `_uploadTransportImpl` seam preserved.
- **ios-offline-shell.AC4.5 Failure:** `mapCache.js` is unchanged by this work (verified by `git diff` returning empty for that file).

### ios-offline-shell.AC5: AC9/AC10 reframed; phase_05 superseded
- **ios-offline-shell.AC5.1 Success:** `docs/test-plans/2026-04-13-resilient-uploads.md` rewritten so old AC9.1–9.5 + AC10.1–10.2 map to `ios-offline-shell.AC1.*–AC4.*` under the new architecture.
- **ios-offline-shell.AC5.2 Success:** `docs/implementation-plans/2026-04-13-resilient-uploads/phase_05.md` has a header note marking it superseded by this design, with a brief explanation.
- **ios-offline-shell.AC5.3 Success:** All AC1.*–AC4.* PASS in on-device matrix execution on Patrick's iPhone.

## Glossary

- **Capacitor**: A cross-platform runtime from Ionic that wraps a web app in a native iOS (or Android) shell. It provides a `WKWebView` that loads a local HTML entry point, plus a bridge for calling native APIs from JavaScript. This project uses Capacitor 8 with Swift Package Manager.
- **WKWebView**: Apple's modern iOS/macOS web rendering engine, used by Capacitor as the container for the web content. Has known limitations with Service Workers that influenced this design.
- **`capacitor://localhost`**: The synthetic origin from which the Capacitor shell's local files are served inside WKWebView. Because it differs from the App Service origin, CORS and `<base href>` handling are central concerns.
- **App Service**: The Azure App Service instance (`app-roadtripmap-prod.azurewebsites.net`) hosting the ASP.NET Core web app. The iOS shell fetches all page HTML from this origin.
- **IndexedDB / IDB**: A browser-native key-value database available inside WKWebView. Used here (via the new `RoadTripPageCache` database) to persist cached HTML pages and API responses across app launches.
- **`RoadTripPageCache`**: The new IDB database introduced by this design. Contains two object stores: `pages` (HTML responses keyed by URL) and `api` (JSON responses keyed by URL).
- **document-swap**: The technique at the heart of `fetchAndSwap` — rather than navigating the WebView to a new URL (which would reload the shell), fetched HTML is parsed in memory and the live document's `<head>` and `<body>` content is replaced in place.
- **fetch+swap**: Shorthand for the full cycle: `cachedFetch` retrieves HTML (from cache or network), `DOMParser` parses it, `<base href>` is injected, the document is swapped, and `<script>` tags are recreated so they execute. Equivalent to what Turbo Drive calls a "visit."
- **cache-first revalidate**: The caching strategy used by `cachedFetch`: return a cached response immediately (fast render), then fire a conditional network request in the background. If the server returns new content (`200`), update IDB; if unchanged (`304`), do nothing. The live document is never updated by the background request.
- **`cachedFetch`**: The new in-page `fetch` wrapper module (`src/bootstrap/cachedFetch.js`) implementing cache-first revalidate semantics backed by `RoadTripPageCache` IDB. Replaces the role of a Service Worker.
- **`fetchAndSwap`**: The new module (`src/bootstrap/fetchAndSwap.js`) that orchestrates the full page-load cycle: call `cachedFetch`, parse the response with `DOMParser`, inject `<base href>`, swap document content, recreate scripts, and fire synthetic lifecycle events.
- **`<base href>`**: An HTML element injected into every fetched page by the loader. Setting it to `https://app-roadtripmap-prod.azurewebsites.net/` causes all relative URLs in the fetched page (links, form actions, `fetch()` calls) to resolve against the App Service origin rather than `capacitor://localhost`.
- **`DOMParser`**: A browser API used to parse a fetched HTML string into a DOM tree in memory without rendering it or executing its scripts. The loader uses it to safely inspect and modify the fetched page before swapping it into the live document.
- **Synthetic `DOMContentLoaded` / `load` events**: After a document-swap, the browser does not fire these lifecycle events naturally (no real navigation occurred). The loader dispatches them manually so that page scripts that listen for these events initialize correctly.
- **`TripStorage`**: The existing localStorage module (`src/RoadTripMap/wwwroot/js/tripStorage.js`) that tracks trips the user has saved on the device. This design extends it with `lastOpenedAt` (timestamp of most recent visit) and `getDefaultTrip()` (selects the trip to open on launch).
- **`mapCache.js`**: The existing IndexedDB cache module that stores map-specific data (POI markers, park boundaries). It owns the `^/api/(poi|park-boundaries)` URL namespace; `cachedFetch` explicitly bypasses those URLs so the two caches do not conflict.
- **`uploadQueue.js`**: The existing client-side upload state machine that manages the resilient upload flow (request SAS, PUT blocks to Azure, commit). It re-initializes from IDB on every page load, which makes it safe under document-swap without modification.
- **`optimisticPins.js`**: The existing module that immediately renders a map pin for a photo that is queued for upload but not yet committed, giving the user instant visual feedback while the upload proceeds in the background.
- **`_uploadTransportImpl` seam**: A deliberate two-name rename in `uploadTransport.js` (`const _uploadTransportImpl = ...; const UploadTransport = _uploadTransportImpl`). The internal name is the planned Phase 6 swap point where a native iOS background URL session adapter will replace the web `fetch`-based implementation. This design must not modify that file or collapse the rename.
- **`ios.css`**: A stylesheet in `wwwroot/` that applies iOS-specific visual tweaks. The loader injects it into the `<head>` of every fetched page so that future iOS styling work requires only CSS changes, not shell changes.
- **IIFE (Immediately Invoked Function Expression)**: The module pattern used for `loader.js` — the entire loader is wrapped in a self-executing function to avoid polluting the global scope of fetched pages.
- **`popstate`**: A browser event fired when the user taps the back button (or `history.back()` is called). The intercept module listens for it to replay the previous URL through `fetchAndSwap`, keeping back-navigation within the shell rather than exiting to the WebView's native history.
- **Hotwire/Turbo pattern**: The architectural precedent this design explicitly follows — a thin JavaScript layer intercepts link clicks and form submissions, fetches server-rendered HTML, and swaps page content without a full reload. Turbo Drive (part of Hotwire, used in Rails apps) pioneered this pattern; this design reimplements the same idea for a Capacitor WebView context.
- **`fallback.html`**: The existing static offline-error page shown when the app is offline and has no cached content for the requested URL. Reused unchanged by the new loader.
- **`fake-indexeddb`**: A Node.js package used in unit tests (vitest) that provides an in-memory implementation of the IndexedDB API, allowing `cachedFetch` to be tested without a real browser.
- **`DOMContentLoaded` already-fired race**: The bug that motivated this redesign. In the old architecture, the loader injected script tags after `DOMContentLoaded` had already fired in the shell, so page scripts listening for that event never received it and failed to initialize.
- **Conditional headers (`ETag` / `Last-Modified`)**: HTTP headers used during background revalidation. The client sends the cached `ETag` value in an `If-None-Match` header; if the server content is unchanged it returns `304 Not Modified` (no body), saving bandwidth. A `200` response means the content changed and the cache should be updated.
- **`data-no-shell="true"`**: An opt-out attribute that page authors can add to a link or form to signal the intercept layer to let that navigation pass through to the native WebView (e.g., for external resources or flows that must trigger a real navigation).

## Architecture

A tiny shell at `capacitor://localhost` (`src/bootstrap/index.html` + `loader.js`) routes the WebView between server-rendered pages fetched from the App Service (`https://app-roadtripmap-prod.azurewebsites.net`). Server pages render unchanged from how they render in a regular browser; the loader is invisible to them.

| Component | Path | Role |
|---|---|---|
| Shell HTML | `src/bootstrap/index.html` | Minimal scaffold; loads `loader.js` with `defer` |
| Loader | `src/bootstrap/loader.js` | Boot routing, `fetchAndSwap` engine, click/form intercept, `cachedFetch` wrapper, `ios.css` continuity |
| Offline fallback | `src/bootstrap/fallback.html` | Shown when offline + cache miss; existing file reused |
| `TripStorage` | `src/RoadTripMap/wwwroot/js/tripStorage.js` | Existing module — extended with `lastOpenedAt` and `getDefaultTrip()` |
| Page cache | `RoadTripPageCache` IDB at `capacitor://localhost` | New — two object stores (`pages`, `api`) keyed by URL |
| Existing JS modules | `wwwroot/js/{uploadQueue, optimisticPins, mapCache, uploadTransport, storageAdapter}.js` | Unchanged — verified safe under document-swap |

**Boot flow:**
1. Loader IIFE runs (deferred until DOM parsed) → reads `TripStorage` from localStorage.
2. Picks target URL: `/` if 0 trips, else trip with greatest `lastOpenedAt`.
3. Calls `fetchAndSwap(url)` → cache-first via `cachedFetch`; if cache miss + offline, render `fallback.html`.
4. Document-swap: `DOMParser` parses HTML; `<base href>` injected; `<head>` and `<body>` content swapped; `<script>` tags re-created via `document.createElement('script')` (cloned scripts don't execute in WKWebView); synthetic `DOMContentLoaded` then `load` events fire.
5. Delegated `click` and `submit` listeners attached at `document` level intercept all internal navigation; external origins, modifier keys, and `data-no-shell="true"` opt-outs bypass.

**Caching contract:** Cache-first returns immediately. Background revalidation runs on every cache hit and updates IDB on `200`, no-ops on `304`. **The live document is never swapped mid-session by background revalidation** (per DoD #3); fresh content lands on next navigation.

**Boundaries:**
- `cachedFetch` does NOT touch URLs owned by `mapCache.js` (currently `^/api/(poi|park-boundaries)`); those fall through to network and `mapCache` handles them.
- The loader does NOT touch `uploadTransport.js` or its `_uploadTransportImpl` swap seam (Phase 6 future native-background-upload migration point).

## Existing Patterns

This design follows multiple existing patterns from the codebase rather than introducing new ones:

- **`TripStorage` (localStorage)** at `src/RoadTripMap/wwwroot/js/tripStorage.js` with the API surface from `docs/design-plans/2026-03-31-my-trips-and-home-screen.md`. This design adds two fields/helpers in a backward-compatible way; existing callers continue to work.
- **The home page (`/` → `index.html`)** already renders saved trips with `#myTripsSection` / `#myTripsList` and an empty-hero state. Used as the iOS shell's launch destination when 0 trips are saved.
- **Page-reload-safe modules** — codebase investigation confirmed `uploadQueue.js`, `storageAdapter.js`, `optimisticPins.js`, `mapCache.js`, `uploadTransport.js` all re-init from IDB on page load with no `beforeunload` flush. Document-swap = page reload, so no changes needed in those modules.
- **CORS `IosAppOrigin` policy** in `src/RoadTripMap/Program.cs:101–118` already allows `capacitor://localhost`, applied globally before `UseStaticFiles`. No CORS changes needed for `/post/*`, `/trips/*`, `/api/*`.
- **Pages use relative URLs throughout** (verified in `post.html`, `trips.html`, `create.html`, `index.html`), so a single injected `<base href="https://app-roadtripmap-prod.azurewebsites.net/">` makes URL resolution Just Work.
- **Platform-adapter seam** (`uploadTransport.js`'s `_uploadTransportImpl` rename) is the documented Phase 6 swap point for native background URL session work. This design preserves the seam unchanged.

**One new pattern introduced:** `cachedFetch` — an in-page `fetch` wrapper backed by IDB with cache-first + background revalidate semantics. Service Workers were considered and rejected because Capacitor 8 + iOS WKWebView don't reliably support them.

**Existing patterns explicitly NOT touched:**
- The `/bundle/*` manifest mechanism (was the consumer of the old loader; iOS shell no longer reads it). The route remains live for now to avoid coordinating a deploy + Mac-side update; future cleanup can remove it.
- Existing `tests/js/bootstrap-loader.test.js` is rewritten against the new loader contract (Phase 5 deliverable).

## Implementation Phases

<!-- START_PHASE_0 -->
### Phase 0: Prerequisites — clean up prior WIP stash

**Goal:** Bring the working tree to a clean, committed state by reconciling the existing `stash@{0}` from the abandoned phase_05 work, so subsequent phases start from a known baseline.

**Background:** As of design-doc commit, develop has a stash entry: *"WIP Phase 5 paused (deeper): signing+photo perm+SPM cache+storyboard+defer fix on bootstrap/index.html"*. It contains:
- `ios/App/App/Info.plist` — adds `NSPhotoLibraryUsageDescription` (KEEP — still needed for the upload feature)
- `ios/App/App.xcodeproj/project.pbxproj` — adds `DEVELOPMENT_TEAM = GP2M7H6R3U` in Debug + Release (KEEP — needed for any iOS build, including Phase 3's on-device spike)
- `ios/App/App/Base.lproj/Main.storyboard` — Xcode 26 auto-migration (KEEP — Xcode will re-migrate on every open if reverted)
- `src/bootstrap/index.html` — adds `defer` to the loader.js `<script>` tag (DROP — Phase 5 rewrites both `index.html` and `loader.js` end-to-end; this partial fix becomes redundant)
- Untracked `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/` — contains `Package.resolved` (lockfile, KEEP and commit) and `configuration/` (cache, gitignore)

**Components:**
- Pop `stash@{0}` on develop
- Discard the `src/bootstrap/index.html` defer change (e.g., `git checkout -- src/bootstrap/index.html`)
- Add `.gitignore` entries: `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/configuration/` and `ios/App/App.xcodeproj/xcuserdata/`
- Stage and commit the remaining changes as a single atomic commit on develop with a message describing them as completed Task 10 prerequisites (signing team, photo permission, Xcode 26 storyboard migration, SPM lockfile, gitignore for SPM caches)

**Dependencies:** None (first phase).

**ACs covered:** None (housekeeping; verification is operational, not behavioral).

**Done when:**
- `git stash list` no longer contains the WIP entry
- `grep DEVELOPMENT_TEAM ios/App/App.xcodeproj/project.pbxproj` returns `GP2M7H6R3U` in both Debug and Release configs
- `grep NSPhotoLibraryUsageDescription ios/App/App/Info.plist` shows the photo-permission entry
- `src/bootstrap/index.html` is unchanged from the develop tip prior to Phase 0 (defer change discarded)
- `git status -s` shows a clean working tree
- The Phase 0 commit is on develop
<!-- END_PHASE_0 -->

<!-- START_PHASE_1 -->
### Phase 1: Page-cache IDB layer + `cachedFetch` wrapper

**Goal:** A standalone `cachedFetch(url, options)` utility backed by a new IDB database, with cache-first + background revalidate semantics and explicit `mapCache.js`-bypass logic.

**Components:**
- New IDB database `RoadTripPageCache` (v1) with two object stores: `pages` keyed by URL (value: `{html, etag, lastModified, cachedAt}`) and `api` keyed by URL (value: `{body, contentType, etag, lastModified, cachedAt}`)
- New module `src/bootstrap/cachedFetch.js` exporting `cachedFetch(url, {asJson, signal}) → {response, source: 'network' | 'cache'}`
- Bypass-list constant: regex pattern matching `^/api/(poi|park-boundaries)` (and any other `mapCache`-owned URLs). Caller must consult before invoking `cachedFetch` for `/api/*` routes.

**Dependencies:** Phase 0 (clean working tree).

**ACs covered:** `ios-offline-shell.AC3.1`, `AC3.2`, `AC3.3`, `AC3.5`, `AC3.7`.

**Done when:** Unit tests (vitest + fake-indexeddb) verify cache-hit, cache-miss + network-ok writes through, cache-miss + network-fail rejects, background revalidation updates IDB on `200` and no-ops on `304`, bypass-list URLs are not touched. `npm test` passes.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: `TripStorage` extension

**Goal:** Backward-compatible extension to existing `TripStorage` adding default-trip selection.

**Components:**
- Extend `src/RoadTripMap/wwwroot/js/tripStorage.js` with `markOpened(url)` (updates `lastOpenedAt: Date.now()` for the matching record) and `getDefaultTrip()` (returns record with greatest `lastOpenedAt`, falling back to `addedAt` for legacy records, or `null` if no trips).
- Glasses-indicator field: extension also sets `role: 'viewer' | 'owner'` derived from URL (`/post/*` → owner, `/trips/view/*` → viewer). Existing `index.html` "My Trips" rendering reads this in Phase 5.

**Dependencies:** None (modifies existing module).

**ACs covered:** `ios-offline-shell.AC2.3`, `AC2.5`, `AC2.6`.

**Done when:** Unit tests verify `markOpened` updates the right record, `getDefaultTrip` selects most-recent or falls back, legacy entries without `lastOpenedAt` work via `addedAt`, existing `getTrips()` callers see no breaking change. `npm test` passes.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: `fetchAndSwap` engine

**Goal:** A single function that fetches a URL, parses the HTML, swaps the document content, recreates `<script>` tags so they execute, and fires synthetic lifecycle events. Includes a small spike on real iOS WebKit early in the phase to validate script re-execution before building the rest.

**Components:**
- New module `src/bootstrap/fetchAndSwap.js` exporting `fetchAndSwap(url, options) → Promise<void>`
- DOMParser + `<base href>` injection step (constant: App Service base URL)
- Script-recreation helper: walks parsed head/body, creates fresh `<script>` elements via `createElement`, copies `src`/`type`/`async`/`defer`/`textContent`, awaits external script `load`/`error` before continuing
- Synthetic event dispatch: `DOMContentLoaded` then `load` after scripts have executed
- After-swap hook: if URL matches a saved trip's `postUrl` or `viewUrl`, call `TripStorage.markOpened(url)` (Phase 2 dependency)

**Dependencies:** Phase 1 (`cachedFetch`), Phase 2 (`TripStorage.markOpened`).

**ACs covered:** `ios-offline-shell.AC1.1`, `AC1.3`, `AC1.4`, `AC2.3`, `AC3.4`.

**Done when:** Unit tests (jsdom) verify base-href injection, script recreation order, synthetic event dispatch. **On-device spike:** A test page with a known script (e.g., `<script>window.spikeRan = true</script>`) is fetched + swapped; verify in iOS Simulator's Web Inspector that `window.spikeRan === true`. Document the spike result in the implementation log.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Click + form intercept

**Goal:** Turbo-style delegated click and form-submit handlers that route internal navigation through `fetchAndSwap` while letting external URLs and special cases pass through.

**Components:**
- New module `src/bootstrap/intercept.js` exporting `installIntercept()` — installs a single `click` listener and a single `submit` listener on `document`
- Internal-vs-external classifier: same-origin to App Service base = internal; everything else passes through
- Exclusion rules: modifier keys (Cmd/Ctrl/Shift/Alt), middle-click (`event.button !== 0`), `<a target="_blank">`, `data-no-shell="true"` opt-out attribute, exotic `<form method>` values
- History integration: `history.pushState` on each successful internal nav; `popstate` listener replays via `fetchAndSwap` from cache
- Form serialization: GET forms → query string + URL; POST forms → body + content-type

**Dependencies:** Phase 3 (`fetchAndSwap`).

**ACs covered:** `ios-offline-shell.AC1.2`, `AC1.5`, `AC1.6`.

**Done when:** Unit tests verify classifier (internal/external/excluded), modifier-key exclusion, form serialization. Integration check (jsdom): clicking an internal `<a>` triggers `fetchAndSwap`; clicking an external `<a>` does not. `npm test` passes.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Loader integration + boot routing

**Goal:** Replace `src/bootstrap/loader.js` end-to-end with the new orchestrator that wires Phases 1–4 together. The new loader is the only entry point for the iOS shell.

**Components:**
- Rewritten `src/bootstrap/loader.js` (single IIFE, deferred from `index.html`)
- Boot routing: read `TripStorage.getDefaultTrip()` → if null, fetch `/`; else fetch the URL of the default trip; pass through `fetchAndSwap`
- Bootstrap-level error handling: top-level try/catch renders `fallback.html` with a "tap to retry" button on unrecoverable errors
- `ios.css` injection: ensure cached `ios.css` is added to `<head>` of every fetched page (read from page cache or refetched)
- Glasses-indicator wire-up: a small JS hook in `tripStorage.js` rendering path sets a `data-role="viewer"` attribute or equivalent on view-only entries; CSS rule in `ios.css` (or new tiny stylesheet) renders the glasses
- Rewritten `tests/js/bootstrap-loader.test.js` against the new loader contract (drop the old AC9.* harness, replace with the new ACs)

**Dependencies:** Phases 1, 2, 3, 4.

**ACs covered:** `ios-offline-shell.AC2.1`, `AC2.2`, `AC2.4`, `AC3.6`, `AC4.1`, `AC4.2`, `AC4.3`, `AC4.4`, `AC4.5`.

**Done when:** All unit tests pass. Bootstrap launches successfully on the iOS Simulator and renders the home page (`/`) when no trips are saved, and the most-recently-opened trip when 1+ are saved. No regression: `mapCache.js` and `uploadTransport.js` are unchanged (verified by `git diff`).
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Test plan reframing + supersede note

**Goal:** Update the human test plan to reflect the new architecture; mark the old `phase_05.md` superseded with a forward link.

**Components:**
- Rewritten `docs/test-plans/2026-04-13-resilient-uploads.md` — old AC9.1–9.5 + AC10.1–10.2 mapped to the new ACs (`ios-offline-shell.AC1.*` through `AC4.*`). Pre-flight steps adjusted (no more `/bundle/manifest.json` checks; instead, smoke-fetch `/` and a trip page).
- Header note added to `docs/implementation-plans/2026-04-13-resilient-uploads/phase_05.md` marking it superseded by `2026-04-19-ios-offline-shell.md`, with a brief explanation of why (DOM mismatch + DOMContentLoaded race in the original architecture).

**Dependencies:** Phase 5 (the new loader must exist for the test plan to describe).

**ACs covered:** `ios-offline-shell.AC5.1`, `AC5.2`.

**Done when:** Both docs reviewed by Patrick.
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: On-device verification

**Goal:** Execute the rewritten device-smoke matrix on Patrick's iPhone; sign off all reframed ACs.

**Components:**
- Run the rewritten `docs/test-plans/2026-04-13-resilient-uploads.md` matrix against a TestFlight build
- Capture screenshots/video into `docs/implementation-plans/2026-04-19-ios-offline-shell/phase-7-device-smoke.md` (or per-test-plan-spec equivalent)
- Sign-off line at the bottom

**Dependencies:** Phase 6 (test plan exists), TestFlight build available (Task 10 from prior phase_05 — signing config is already in stash@{0}).

**ACs covered:** `ios-offline-shell.AC5.3` (and revalidates AC1.*–AC4.* end-to-end on real WebKit).

**Done when:** All reframed AC matrix entries PASS on Patrick's iPhone. Sign-off line present.
<!-- END_PHASE_7 -->

## Additional Considerations

**Document-swap on iOS WebKit (Phase 3 risk):** Cloned `<script>` tags do not execute in WKWebView. The loader recreates them via `createElement('script')` and copies attributes + textContent. Phase 3 includes a small on-device spike *before* building the rest of the loader to validate this works on real iOS, not just in jsdom.

**Mid-session DOM swap deliberately avoided** (DoD #3): Background revalidation never updates the live document. Trade-off explicitly accepted: a friend's photo posted to a shared trip won't appear for the viewer until they navigate.

**iOS-specific CSS extensibility:** The loader injects `wwwroot/ios.css` into every fetched page (cached or fresh). Future iOS-native UI restyling lives entirely in `ios.css`; no shell changes required.

**Bundle mechanism deprecation:** The existing `/bundle/manifest.json` + `/bundle/*` route is no longer consumed by the iOS shell. Out of scope to remove server-side; the route remains live as a no-op. Future cleanup.

**Test surface gap:** jsdom + fake-indexeddb cannot validate document-swap on real WebKit, script re-execution, or `DOMContentLoaded` synthesis. Phase 3's on-device spike + Phase 7's full device matrix are the load-bearing verification.
