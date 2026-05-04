# Offline-Shell Asset Pre-Caching — Research Notes

Status: research only — not a design plan yet
Last verified: 2026-04-26

## Why this exists

The iOS Shell Hardening plan landed cascade safety, friendly offline copy, and `Cache-Control: no-cache` on `/js/*` + `/css/*` (PR #54) so deploys reach devices without an uninstall/reinstall cycle. That last bit fixed the deploy-velocity problem but introduced a new one: when a user navigates to a page *while offline*, CSS and JS files don't load. WKWebView's NSURLCache holds the bytes, but `Cache-Control: no-cache` requires conditional GET against the origin before serving them, and the request fails with no network. Patrick reproduced this on device 2026-04-26 — `/create` rendered as raw HTML with default browser styles after airplane mode was enabled.

The Section 3 (offline create) AC4.3 contract was still met — the friendly copy `"Can't create a trip while offline. Try again when you're back online."` rendered correctly. The styling gap is a separate UX concern, but it's also the same problem we'd hit blocking offline uploads (the planned next feature) since the upload UI depends on CSS, JS, and downstream API JS modules being present.

Patrick's framing: "We have local storage that the browser won't wipe. We can store ALL THE CSS WE WANT to fall back on when we don't have service." This research note captures the architectural options that follow from that framing, so a fresh session can run the design-plan flow without re-deriving it.

## Current architecture (what we have today)

- **HTML pages** are routed through [src/bootstrap/cachedFetch.js](../../src/bootstrap/cachedFetch.js) → IndexedDB store `RoadTripPageCache`. Cache-first with background revalidate (200 → write through, 304 → keep stale, network error → swallowed). Works well offline because the IDB layer is fully under our control and ignores HTTP semantics.
- **`/api/poi`** + **`/api/park-boundaries`** are bypassed by `CachedFetch` and routed through [`mapCache.js`](../../src/RoadTripMap/wwwroot/js/mapCache.js)'s separate IDB store `RoadTripMapCache`. Same idea, different store, owned by the map subsystem.
- **CSS, JS, fonts, images, MapLibre tiles, and any other static asset** are loaded by the browser via `<link>`, `<script>`, `<img>`, or MapLibre's internal fetcher — none of which go through `CachedFetch`. They go through WKWebView's NSURLCache (HTTP cache), which is what `Cache-Control: no-cache` governs.
- **Photo blob URLs** (Azure Blob, signed) are explicitly *not* cached — documented limitation in CLAUDE.md Gotchas, accepted scope boundary for the iOS Shell Hardening plan.

## The gap

The browser-level asset cache:
- Respects HTTP `Cache-Control` semantics (so `no-cache` blocks offline reuse).
- Can be evicted under memory pressure or storage pressure (not durable).
- Isn't introspectable from JS — we can't audit what's cached or pre-warm it from the shell.
- Doesn't survive an app uninstall (which is fine) but also can't be forcibly populated before going offline.

For a Capacitor app that's effectively native, this is the wrong primitive. We control the entire JS realm, we have unbounded IDB storage, and we know our own asset manifest at deploy time.

## Architecture options

### Option A — Service Worker

Standard web platform answer. A Service Worker registered at app boot intercepts every fetch (including `<link>` and `<script>` driven asset loads) and serves from a Cache Storage instance backed by the SW's own persistence layer.

**Pros**
- Truly transparent to page authors — `<link rel="stylesheet" href="/css/styles.css">` Just Works offline.
- Standard pattern, well-understood by other web devs.
- Cache Storage API is purpose-built for this.

**Cons**
- Service Worker registration in a Capacitor WebView running on `capacitor://localhost` is finicky. SW scope rules want HTTPS or `localhost`; `capacitor://localhost` is a custom scheme and historically has had quirks.
- The shell already uses heavy DOM-swap mechanics; layering an SW on top adds another moving part with its own lifecycle (install/activate/skipWaiting), debugging surface, and update semantics.
- Bypasses the existing `CachedFetch` / `RoadTripPageCache` plumbing rather than extending it.

### Option B — Boot-time pre-fetch + asset rewrite (extends what we have)

At shell boot ([src/bootstrap/loader.js](../../src/bootstrap/loader.js)):

1. Fetch a known asset manifest (e.g., a server-rendered `/api/asset-manifest` or a static `/manifest.json`) listing CSS/JS files + content hashes.
2. For each asset, route through the existing `CachedFetch` (or a new sibling store) — IDB-backed, cache-first + background revalidate.
3. After the swap into a wwwroot page, walk the document and rewrite `<link href>` / `<script src>` to `blob:` URLs minted from the IDB-cached bytes. Or: pre-inject a `<style>` tag from the cached CSS text and remove the `<link>`. Same for inline JS evaluation.

**Pros**
- Builds on patterns we already have — `CachedFetch` plus the `_swapFromHtml` mechanics from Phase 1–3.
- No SW registration dance; works anywhere the existing shell works.
- Asset manifest gives us atomic deploy semantics — either all assets for a deploy land or none, no torn states.

**Cons**
- Has to interact with the document-swap pipeline to rewrite asset references. Touches `_recreateScripts` (or its sibling) and adds a similar pre-render step for `<link>` tags.
- `blob:` URL approach has subtle gotchas (CSS `@import`, font-face, relative URL resolution within stylesheets — need a strategy for those).
- Asset manifest needs a build/publish step to enumerate `wwwroot/css/*` + `wwwroot/js/*` with content hashes. ASP.NET Core's static-files middleware doesn't ship this out of the box; we'd need a small build step or the existing `npm run build:bundle` script (which is currently dormant per CLAUDE.md's iOS Offline Shell key decision).

### Option C — Hybrid

- Keep the SW idea on the shelf for a future "real PWA" iteration.
- Ship Option B now: extend `CachedFetch` to handle assets, generate a manifest at build time, rewrite asset tags in `_swapFromHtml`.
- Separately, leave `Cache-Control: no-cache` in place on the App Service side as a belt-and-suspenders against stale tiers.

This is probably the right path. SW is the eventually-correct answer; pre-fetch + rewrite is the right answer *given the shell architecture we already have*.

## Forward-looking dependencies

Anything that needs to work offline in the future has to ride this same plumbing:

- **Offline uploads** (Patrick mentioned). Needs `/post/{token}` + all its JS dependencies cached, plus a write-through queue (already partially planned in resilient-uploads Phase 5/6).
- **Offline trip view** (`/trips/{viewToken}`). Needs MapLibre + map style + tiles. Tile pre-fetch is its own can of worms — current architecture only caches HTML and `/api/poi` + `/api/park-boundaries`; tiles go to MapTiler over HTTPS without our involvement. Tile pre-fetch needs a strategy decision (which zooms? which area?).
- **Offline editing** of saved trips. Same shape as offline uploads but for edit flows.

## Constraints / non-goals for the upcoming design plan

The design plan that comes out of this should:

- Stay scoped to **wwwroot static assets** (CSS, JS in `/js/*`, possibly fonts in `/css/*` references). MapTiler tile pre-fetch is *not* in scope — that's a separate plan.
- Preserve the **deploy-reaches-device** invariant (`Cache-Control: no-cache` was added for this reason; whatever asset-pre-cache mechanism we use must trigger a refresh on each deploy, not pin to whatever was cached at install time).
- **Not break regular browsers** — the App Service serves the same wwwroot to anyone visiting `https://app-roadtripmap-prod.azurewebsites.net/` directly. Asset pre-caching should be a shell-side enhancement that's invisible to non-shell clients.
- Photo blob caching stays out of scope (existing Gotcha is preserved).

## Open questions for the design plan

1. **Manifest source.** Generate at build/deploy via ASP.NET Core middleware? Static `/manifest.json` checked in? Use the dormant `scripts/build-bundle.js` infrastructure as the source of truth for `wwwroot/{js,css}/*`?
2. **Asset rewrite strategy.** Inline `<style>` tags vs. `blob:` URLs vs. data URIs? `blob:` URLs play poorly with `@import` and relative URL resolution inside CSS; `<style>` inline avoids that but breaks browser-level CSS de-duplication if the same CSS is inlined repeatedly across swaps.
3. **Cache eviction.** When does an asset get removed from IDB? Deploy version mismatch? LRU? Never (just write-through forever)?
4. **Boot ordering.** Today, [loader.js:39](../../src/bootstrap/loader.js#L39) reads `TripStorage.getDefaultTrip()` and immediately swaps. Asset pre-cache adds a step that's I/O-bound before first paint. How long is acceptable? What's the loading-state UX while pre-fetch runs (or do we boot-then-precache in parallel and accept that the very first cold launch on a new install has unstyled content for a beat)?
5. **Versioning vs. stale-while-revalidate.** Should each asset be content-hashed in the manifest (so old versions can stay cached harmlessly) or do we wipe-and-rewrite the whole asset cache on every deploy?
6. **Shell module assets.** `src/bootstrap/*.js` are shipped via the Capacitor `webDir` and bundled into the app, so they're always present offline (no fetch). Does this design touch them at all, or strictly the wwwroot-served assets?
7. **Fallback when the manifest itself fails to load.** First boot, no manifest cached, network down at install moment. What does the user see?

## Suggested next step

Start a design plan session via the `ed3d-plan-and-execute` skill family. The right entry point is `start-design-plan` — it orchestrates context gathering, clarifying questions, brainstorming alternatives, and writing the validated design to `docs/design-plans/`. Pass this research note as context.

Reference patterns to read during the session:
- [src/bootstrap/cachedFetch.js](../../src/bootstrap/cachedFetch.js) — the IDB cache-first + revalidate pattern to extend.
- [src/bootstrap/fetchAndSwap.js](../../src/bootstrap/fetchAndSwap.js) — the `_recreateScripts` script-injection point where asset rewrite would happen.
- [src/bootstrap/loader.js](../../src/bootstrap/loader.js) — the boot orchestration where pre-fetch would run.
- [scripts/build-bundle.js](../../scripts/build-bundle.js) — dormant manifest-generation infrastructure that could be revived.
- [src/RoadTripMap/Program.cs](../../src/RoadTripMap/Program.cs) — `OnPrepareResponse` block where current `Cache-Control: no-cache` is set; new server-side pieces (manifest endpoint?) would land here.
