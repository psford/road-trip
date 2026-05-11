# iOS Shell Polish — Photos-Aesthetic Native Feel

## Summary

The iOS shell polish adds visual and interactive depth to the existing Capacitor app without touching the fundamental architecture: one `wwwroot` source tree serves both the browser and the iOS shell, with all iOS-specific behavior expressed as interpretation of that shared source.

The work is organized in three composable layers. First, universal design tokens (type scale, semantic colors, motion, radius) land in `styles.css` and apply to every runtime — browser users on a dark-mode OS get dark mode for free. Second, `.platform-ios`-scoped rules in `ios.css` add the iOS chrome: translucent nav bars, large-title headers, system-blue accent, and the immersive Photos-style full-screen viewer. Third, `nativeBridge.js` (the `Native.*` wrapper) provides a single call site for Haptics, StatusBar, Share, and Dialog — dynamic-importing the `@capacitor/*` packages only on iOS, so the native SDKs never reach the web bundle. Implementation follows Approach B sequencing: post.html and trips.html first (the pages Patrick actually uses on a trip), then index and create, then cross-page motion and skeletons. Each phase ships passing tests before the next begins.

## Definition of Done

The Capacitor iOS shell looks and behaves like a native iOS app on Patrick's iPhone, applying the **Apple Photos** visual language (type, color, translucent materials, motion) across all four pages — `index.html`, `create.html`, `post.html`, `trips.html` — plus the view route, in both **light and dark** themes via `prefers-color-scheme`.

**Native iOS interactions** are wired through the Capacitor plugins **Haptics**, **Status Bar**, **Share**, and **Dialog**: tactile feedback on key actions, per-screen status-bar style, native share sheet for trip links, and native confirmation dialogs replacing browser `confirm()`.

**Architectural constraint (non-negotiable):** all iOS polish is expressed as *interpretation* of the shared `wwwroot` source. Allowed mechanisms:
- `.platform-ios`-scoped CSS in `src/RoadTripMap/wwwroot/ios.css` or `@media` blocks
- `prefers-color-scheme` media queries for dark mode
- `RoadTrip.isNativePlatform()` runtime branches in shared JS for Capacitor plugin calls
- New `wwwroot/js/*` modules with shared/iOS behavior gated at runtime

Forbidden: parallel template tree, iOS-only HTML files, forked wwwroot, build-time page variants. The web/browser experience must be unchanged.

**Existing functionality** (offline shell, resilient uploads, MapLibre map, trips list, version-protocol middleware) must be preserved and continue to pass current tests.

**Acceptance:** Patrick reaches for the iOS app instead of the website on the upcoming trip (verified subjectively on his iPhone after `npx cap sync ios` and a local build).

**Out of scope:** information-architecture restructure, native UIKit/SwiftUI or custom Capacitor plugin development, MapLibre→MapKit migration, backend or API changes, photos-first redesign, Memories-style auto-slideshow.

## Acceptance Criteria

### ios-shell-polish.AC1: Token foundation applied universally
- **ios-shell-polish.AC1.1 Success:** `wwwroot/css/styles.css` `:root` block exposes type-scale, semantic-color, material, motion, and radius tokens; both browser and iOS shell render text using the new type scale.
- **ios-shell-polish.AC1.2 Success:** Existing CSS using legacy tokens (`--color-primary`, `--color-bg`, `--space-*`) continues to render unchanged.
- **ios-shell-polish.AC1.3 Failure:** No selector outside `.platform-ios` references iOS-only tokens.

### ios-shell-polish.AC2: Dark mode
- **ios-shell-polish.AC2.1 Success:** With `prefers-color-scheme: dark` set at the OS level, all four pages render with dark color tokens in both browser and iOS shell.
- **ios-shell-polish.AC2.2 Success:** Switching the OS theme while the app is open updates the rendered theme on the next paint.
- **ios-shell-polish.AC2.3 Edge:** The immersive photo viewer (`.fullscreen-overlay`) is dark regardless of system theme.

### ios-shell-polish.AC3: Native plugin wiring
- **ios-shell-polish.AC3.1 Success:** On iOS, `Native.haptic('light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error')` calls the corresponding `@capacitor/haptics` API.
- **ios-shell-polish.AC3.2 Success:** On web, every `Native.*` method is callable without throwing; haptics is a no-op, share falls through to `navigator.share()` or copy-to-clipboard, dialogConfirm falls through to `window.confirm()`, statusBar is a no-op.
- **ios-shell-polish.AC3.3 Success:** `Native.share({ title, url })` opens the native iOS share sheet.
- **ios-shell-polish.AC3.4 Success:** `Native.dialogConfirm({ title, message })` shows a native iOS alert and resolves to `{ value: boolean }`.
- **ios-shell-polish.AC3.5 Success:** `Native.statusBar('light' | 'dark')` switches text color and is restored on the close path even when the trigger throws.
- **ios-shell-polish.AC3.6 Failure:** Calling `Native.install()` twice does not double-wrap or stack effects.

### ios-shell-polish.AC4: post.html — visual, chrome, interactions
- **ios-shell-polish.AC4.1 Success:** `.page-header` renders as a translucent sticky nav bar on iOS with safe-area inset preserved.
- **ios-shell-polish.AC4.2 Success:** Add-Photo, Cancel, and Post-Photo controls fire `Native.haptic('light')` on tap.
- **ios-shell-polish.AC4.3 Success:** Upload commit success fires `Native.haptic('medium')`; upload failure fires `Native.haptic('error')`.
- **ios-shell-polish.AC4.4 Success:** Per-photo share uses `Native.share()`.
- **ios-shell-polish.AC4.5 Success:** Per-photo delete shows `Native.dialogConfirm()` and only deletes on confirm.
- **ios-shell-polish.AC4.6 Failure:** Cancelling the delete confirm leaves the photo intact.

### ios-shell-polish.AC5: trips.html — view route and immersive viewer
- **ios-shell-polish.AC5.1 Success:** `.map-header` renders as a translucent material with a large title that collapses to nav-title size on scroll.
- **ios-shell-polish.AC5.2 Success:** Tapping a carousel thumbnail opens `.fullscreen-overlay` with a true-black backdrop, light status bar, and auto-hiding chrome on tap.
- **ios-shell-polish.AC5.3 Success:** Swipe-down on the open viewer dismisses with translate+fade.
- **ios-shell-polish.AC5.4 Success:** Status bar restores to dark on every viewer-close path.
- **ios-shell-polish.AC5.5 Failure:** A thrown error inside the viewer does not leave the status bar inverted.

### ios-shell-polish.AC6: index.html and create.html — entry-page polish
- **ios-shell-polish.AC6.1 Success:** index.html renders the hero with large-title typography and the trip cards with Photos-tile feel.
- **ios-shell-polish.AC6.2 Success:** create.html renders the same nav-bar header pattern as post.html and iOS-styled form inputs.
- **ios-shell-polish.AC6.3 Success:** Trip-create success fires `Native.haptic('success')`; failure fires `Native.haptic('error')`.
- **ios-shell-polish.AC6.4 Success:** New tap targets (`.nav a`, `.my-trip-card`) meet the 44×44 minimum on iOS.

### ios-shell-polish.AC7: Cross-page motion and skeletons
- **ios-shell-polish.AC7.1 Success:** Cross-page navigation in the iOS shell shows an animate-out, swap, animate-in transition.
- **ios-shell-polish.AC7.2 Success:** With `prefers-reduced-motion: reduce`, transitions are bypassed; swap is instant.
- **ios-shell-polish.AC7.3 Success:** Initial fetch of the photo carousel and trip list shows skeleton placeholders that vanish when real content arrives.
- **ios-shell-polish.AC7.4 Failure:** Rapid back-to-back navigations do not stack or visually corrupt the transition.

### ios-shell-polish.AC8: Existing functionality preserved
- **ios-shell-polish.AC8.1 Success:** `npm test` (vitest, ~149 existing tests plus new ones) passes.
- **ios-shell-polish.AC8.2 Success:** `dotnet test RoadTripMap.sln` passes.
- **ios-shell-polish.AC8.3 Success:** Resilient upload flow, offline shell page-cache, asset pre-cache, MapLibre map, and trips list all behave unchanged when polish is disabled (e.g., in browser).
- **ios-shell-polish.AC8.4 Success:** `version-protocol` and `LogSanitizer` invariants are unchanged.

### ios-shell-polish.AC9: Single-source architectural constraint
- **ios-shell-polish.AC9.1 Success:** No new HTML files in `wwwroot/`. No `ios/` template tree. The four templates remain the single rendered source.
- **ios-shell-polish.AC9.2 Success:** No `@capacitor/*` package import appears in the web bundle (`wwwroot/bundle/app.js`). All native calls go through `Native.*` with dynamic import inside the iOS branch.
- **ios-shell-polish.AC9.3 Success:** Browser users see the universal token + dark-mode upgrades only; no `.platform-ios`-scoped chrome bleeds into the browser.

### ios-shell-polish.AC10: Subjective sign-off
- **ios-shell-polish.AC10.1 Success:** Patrick runs the app on his iPhone in light and dark, online and offline, both flows (post-a-photo and view-someone-else's-trip) and signs off in the verification log.
- **ios-shell-polish.AC10.2 Success:** Patrick reaches for the iOS app instead of the website on the upcoming trip.

## Glossary

- **Capacitor shell**: The iOS native app wrapper generated by Capacitor. It hosts a `WKWebView` that loads pages from a local `webDir` entry point (`src/bootstrap/`) rather than a remote URL, enabling native plugin access alongside web code.
- **document-swap**: The mechanism used by the iOS shell's bootstrap layer to navigate between pages. Instead of full browser navigations, `fetchAndSwap.js` fetches the target page's HTML, parses it with `DOMParser`, and surgically replaces the current `head`/`body` content in-place, preserving the Capacitor runtime context across navigations.
- **`.platform-ios`**: A CSS class set on `<body>` by `loader.js` before first paint when running in the iOS shell. All iOS-only visual rules in `ios.css` are scoped under this class, so they never apply in a regular browser.
- **`RoadTrip.onPageLoad`**: The lifecycle registration API for page modules. Handlers subscribe to the `app:page-load` event (dispatched by the shell after every document swap, or synthesized from `DOMContentLoaded` in a regular browser) and are filtered by `document.body.dataset.page`. Required for any code that should run on page entry — using raw `DOMContentLoaded` is forbidden.
- **`RoadTrip.isNativePlatform()`**: Runtime check that returns `true` when the page is running inside the Capacitor iOS shell. Used to gate Capacitor plugin calls so those code paths are unreachable in a regular browser.
- **`Native.*`** (the new wrapper): The `globalThis.Native` object exposed by `nativeBridge.js`. A thin IIFE module wrapping all four Capacitor plugin packages (Haptics, StatusBar, Share, Dialog) behind a single interface. On iOS, methods delegate to the plugin via dynamic import. On web, every method has a safe fallback — `haptic` is a no-op, `share` falls through to `navigator.share()`, `dialogConfirm` falls through to `window.confirm()`, `statusBar` is a no-op.
- **`prefers-color-scheme`**: A CSS media query that reads the operating-system light/dark preference. Used in `styles.css` to override color tokens for dark mode. Because it's not `.platform-ios`-scoped, browser users on a dark-mode OS also get dark mode.
- **`backdrop-filter`**: A CSS property that applies a blur (or other filter) to the content behind an element. Used for the translucent nav-bar and header materials that give the app its iOS Photos feel. Can be GPU-expensive on older hardware.
- **large-title**: An iOS navigation pattern where the page title renders large at the top of the scroll view and collapses to a smaller inline nav-bar title as the user scrolls down. Used on trips.html's map header.
- **immersive viewer**: The full-screen photo overlay (`.fullscreen-overlay`) triggered by tapping a carousel thumbnail. In the iOS shell it renders with a true-black backdrop, flips the status bar to light text, and supports swipe-to-dismiss with a translate+fade animation.
- **`.fullscreen-overlay`**: The CSS class on the element that implements the immersive photo viewer. Dark-only regardless of system theme — explicitly called out in AC2.3 as an edge case.
- **IIFE module**: Immediately Invoked Function Expression — the pattern used for every `wwwroot/js/*` module. Required because the iOS shell re-executes inline scripts on every document swap; IIFE wrapping prevents duplicate `const`/`let` declarations from crashing the page on second visit.
- **`_executedScriptSrcs` dedup**: A module-scoped `Set` in `fetchAndSwap.js` that tracks which external script `src` URLs have already been injected into the page. On subsequent swaps, scripts already in the set are skipped so they don't execute twice.
- **safe-area inset**: CSS environment variables (`env(safe-area-inset-*)`) that account for the iPhone's notch, Dynamic Island, and home indicator. The `.page-header` and other edge-to-edge elements use these to avoid content sitting under hardware UI.
- **`_installed` idempotency flag**: A boolean property on the `globalThis` export of each IIFE module (e.g., `Native._installed`, `RoadTrip._installed`) that prevents the module from re-running its setup if `install()` is called more than once — necessary because `RoadTrip.onPageLoad` handlers re-fire on every swap.
- **system blue**: Apple's canonical interactive-element color, `#0A84FF` in dark mode / `#007AFF` in light mode. Applied via `--color-accent` override under `.platform-ios` in `ios.css` to match native iOS controls.
- **asset pre-cache**: The offline asset warming strategy in `assetCache.js`. After the first successful page swap, the shell reads `/asset-manifest.json` and downloads every listed CSS/JS file into the `assets` object store of `RoadTripPageCache` IndexedDB. At render time, cached assets are substituted inline (CSS → `<style>`, JS → blob URL) so pages render without network round-trips.
- **view route**: The read-only trip-viewing flow accessed via `/trips/{viewToken}`. Distinct from the upload flow (`/post/{secretToken}`). trips.html serves both; the view route is the primary use case for trip-sharing and is the higher-priority polish target in Approach B sequencing.
- **resilient upload**: The multi-phase upload flow where the client requests SAS URLs from the server, PUTs blocks directly to Azure Blob Storage, then calls `commit`. Survives network interruptions; implemented across `uploadQueue.js`, `UploadService.cs`, and the `/request-upload` / `/commit` / `/abort` endpoints.
- **`LogSanitizer`**: A mandatory wrapper in `src/RoadTripMap/Security/LogSanitizer.cs` through which all server-side log calls touching secret tokens, SAS URLs, blob paths, or GPS coordinates must pass. Prevents sensitive data from appearing in logs; compliance is enforced by captured-log assertions in the test suite.
- **version protocol**: The client/server handshake using `x-server-version` and `x-client-min-version` response headers. Lets the server signal to older clients that they need to reload. Implemented in `ServerVersion.cs` and version-header middleware in `Program.cs`.

## Architecture

The polish layers on top of the existing shared `wwwroot` source. Three composable layers, in order of specificity:

1. **Universal token layer** in `src/RoadTripMap/wwwroot/css/styles.css`. The existing `:root` block is extended with type, color, material, motion, and radius tokens. A `@media (prefers-color-scheme: dark)` block at the top of the same file overrides color tokens for dark mode. Browser users on a dark-mode OS get dark mode for free.
2. **iOS-only chrome layer** in `src/RoadTripMap/wwwroot/ios.css`. All rules scoped under `.platform-ios`. Adds large-title nav bars, translucent materials, system-blue accent override (`--color-accent: #0A84FF`), sheet patterns, and the immersive Photos viewer treatment. Existing safe-area, 44×44, system-font, and overscroll rules in this file remain.
3. **Native plugin layer** in a new `src/RoadTripMap/wwwroot/js/nativeBridge.js`. IIFE module exposing `globalThis.Native = { haptic, share, dialogConfirm, dialogAlert, statusBar, _installed, _isNative }`. Each method checks `RoadTrip.isNativePlatform()` once at install. On iOS, dynamic-imports the plugin and calls it. On web, degrades: `haptic` is no-op, `share` falls through to `navigator.share()` or copy-to-clipboard, `dialogConfirm` falls through to `window.confirm()`, `statusBar` is no-op. Page modules call `Native.*` from inside their already-idempotent `RoadTrip.onPageLoad` handlers.

**Plugin packages.** `npm install @capacitor/haptics @capacitor/status-bar @capacitor/share @capacitor/dialog`. All four are confirmed compatible with `@capacitor/core@^8.3.1`. Patrick runs `npx cap sync ios` after install.

**Info.plist.** Add `UIViewControllerBasedStatusBarAppearance: true` to `ios/App/App/Info.plist`. Required by `@capacitor/status-bar` for runtime style changes.

**Build pipeline.** No changes to `scripts/build-bundle.js` or `npm run prepare:ios-shell`. New CSS and JS files are picked up by existing globbing and emitted into `asset-manifest.json` automatically.

**Why dynamic import in `nativeBridge.js`.** The four plugin packages must not appear in the web bundle. Browser users never need them, and a top-level `import '@capacitor/haptics'` triggers warnings in non-Capacitor runtimes. Dynamic import inside the iOS branch keeps web clean.

**Status-bar coordination contract.** `loader.js` calls `Native.statusBar('dark')` (dark text on light backgrounds) on cold start. Each page's `onPageLoad` handler can override. Only the immersive photo viewer flips to `'light'`, and it must restore on dismiss. Wrapped in try/finally so a viewer error cannot leave the status bar inverted.

**Destructive-action contract.** Photo delete and trip delete gate behind `Native.dialogConfirm`. These actions don't exist in the UI today; the polish adds them. Backend `DELETE /api/trips/{secretToken}` already cascades trip → blobs → photos → row.

## Existing Patterns

This design follows established `wwwroot` and shell patterns. No divergence.

- **IIFE module with `globalThis.X` export, `_installed` idempotency flag.** `nativeBridge.js` follows the same shape as `roadTrip.js`, `offlineError.js`, `tripStorage.js`. Required because page lifecycle handlers re-fire on every document swap.
- **`.platform-ios`-scoped CSS in `ios.css`.** Existing rules already follow this pattern (safe-area, 44×44 tap targets, system font). New chrome and accent rules extend the same file.
- **`RoadTrip.onPageLoad(pageName, fn)` for page lifecycle.** Page modules using new tokens or plugin calls register through this API, never via raw `DOMContentLoaded`. Handlers are dispatched on `app:page-load`, gated by `document.body.dataset.page`.
- **`RoadTrip.isNativePlatform()` for runtime branching.** Used today only in `create.html` for navigation routing. The polish extends usage to every plugin call site, always inside an idempotent handler.
- **Inline `<script>` blocks in `wwwroot/*.html` must be IIFE-wrapped.** The shell's `_executedScriptSrcs` dedup re-runs inline scripts on every swap, so top-level `const`/`let` regresses the duplicate-const cascade. Any new inline polish script follows the existing IIFE pattern.
- **`RoadTrip.appOrigin()` for shareable URLs.** `Native.share` reads URLs assembled via `RoadTrip.appOrigin()` rather than `window.location.origin`, preventing `capacitor://localhost` leaks into shared links.

**New patterns introduced (justified).**

- **`prefers-color-scheme` media query in `styles.css`.** No dark-mode rules exist today (verified by grep). The query is universal, not `.platform-ios`-scoped, so browser users on dark-mode OSes get dark mode too. This is consistent with the project's "single source serves both runtimes" principle.
- **`Native.*` shared plugin wrapper.** No existing plugin abstraction. The wrapper exists so page modules don't import `@capacitor/*` packages directly, which would otherwise pollute the web bundle and entangle browser code with native-only types.

## Implementation Phases

Six phases. Approach B sequencing (per-page deep dives prioritized by trip-usage). Each functionality phase ends with passing tests for the acceptance criteria it claims to cover.

<!-- START_PHASE_1 -->
### Phase 1: Foundation — tokens, dark mode, plugins, native bridge

**Goal:** Land the design-token foundation, dark-mode support, all four Capacitor plugins, and the `Native.*` wrapper. After this phase the app looks the same on iOS but every subsequent phase has the building blocks it needs.

**Components:**
- `src/RoadTripMap/wwwroot/css/styles.css` — extend `:root` with type-scale, semantic-color, material, motion, and radius tokens. Add `@media (prefers-color-scheme: dark)` block overriding color tokens.
- `src/RoadTripMap/wwwroot/ios.css` — add iOS-only `--color-accent: #0A84FF` override under `.platform-ios`. Existing rules unchanged.
- `src/RoadTripMap/wwwroot/js/nativeBridge.js` — new IIFE module wrapping Haptics, StatusBar, Share, Dialog. Idempotent `install()`. Web fallbacks for every method. Loaded from `wwwroot/index.html`, `create.html`, `post.html`, `trips.html` via `<script defer>`.
- `src/RoadTripMap/wwwroot/index.html`, `create.html`, `post.html`, `trips.html` — add `<meta name="theme-color">` for both light and dark schemes.
- `src/bootstrap/loader.js` — call `Native.statusBar('dark')` on cold-start install (after `RoadTrip.isNativePlatform()` check).
- `package.json` — add `@capacitor/haptics`, `@capacitor/status-bar`, `@capacitor/share`, `@capacitor/dialog` dependencies.
- `ios/App/App/Info.plist` — `UIViewControllerBasedStatusBarAppearance: true`.
- `tests/js/nativeBridge.test.js` — new vitest file. Verifies `Native.*` methods are no-ops or fall back correctly when `RoadTrip.isNativePlatform()` returns `false`. Verifies idempotent `install()`.

**Dependencies:** None.

**Done when:**
- `npm install` succeeds with the four new dependencies.
- `npm test` passes including new `nativeBridge.test.js`.
- `npm run build:bundle` produces a clean bundle and updated `asset-manifest.json`.
- Patrick runs `npx cap sync ios`, builds in Xcode, and confirms the app launches and behaves identically to before the phase (no visual regression, no plugin errors in the Xcode console).
- Acceptance criteria covered: `ios-shell-polish.AC1.*`, `ios-shell-polish.AC2.*`, `ios-shell-polish.AC3.1`, `ios-shell-polish.AC3.2`, `ios-shell-polish.AC9.*`.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: post.html — uploader and map polish

**Goal:** Apply the Photos visual language to the trip workhorse: nav-bar header, upload affordance, preview-as-sheet, restyled carousel and toasts. Wire haptics and share.

**Components:**
- `src/RoadTripMap/wwwroot/post.html` — adjust markup minimally (`data-page="post"` is already present); add a subtitle slot in the header for trip context.
- `src/RoadTripMap/wwwroot/css/styles.css` and `ios.css` — restyle `.page-header`, `.add-photo-button`, `.preview-section`, `.post-button-group`, `.photo-list`, `#photoCarousel`, `.toast-container`. iOS-specific rules turn `.page-header` into a sticky translucent nav bar with the existing safe-area inset preserved.
- `src/RoadTripMap/wwwroot/js/postUI.js` and `postService.js` — call `Native.haptic('light')` on Add-Photo tap, `Native.haptic('medium')` on commit success, `Native.haptic('error')` on upload failure.
- `src/RoadTripMap/wwwroot/js/uploadQueue.js` — emit `Native.haptic('medium')` on commit success.
- `src/RoadTripMap/wwwroot/js/photoCarousel.js` — replace existing `navigator.share()` calls with `Native.share()`. Add `Native.dialogConfirm()` before the existing per-photo delete action.
- `src/RoadTripMap/wwwroot/ios.css` — extend the 44×44 selector list with any new tap targets introduced by the restyle.
- `tests/js/photoCarousel.test.js` (or sibling) — extend coverage for the share-and-confirm replacement.

**Dependencies:** Phase 1.

**Done when:**
- All `wwwroot` pages still render in browser identically except for the universal token + dark-mode upgrades from Phase 1.
- iOS shell renders post.html with the new chrome and tokens; haptics fire on the trigger list above; share opens the native iOS share sheet; per-photo delete shows a native confirm.
- `npm test` and `dotnet test RoadTripMap.sln` both pass.
- Acceptance criteria covered: `ios-shell-polish.AC4.*`, `ios-shell-polish.AC3.3`, `ios-shell-polish.AC3.4`.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: trips.html — view route and immersive Photos viewer

**Goal:** The native moment. Translucent map header with collapsing large title. Immersive Photos viewer for `.fullscreen-overlay` (true-black backdrop, auto-hiding chrome, swipe-to-dismiss, status-bar style flip).

**Components:**
- `src/RoadTripMap/wwwroot/trips.html` — minor markup adjustments to support the collapsing-title pattern (add a `data-large-title` slot in the header).
- `src/RoadTripMap/wwwroot/css/styles.css` and `ios.css` — restyle `.map-header`, `.map-control`, `.view-carousel-container`, `.carousel-item`, `.carousel-action-btn`. New rules in `ios.css` for the immersive viewer treatment of `.fullscreen-overlay`. The viewer is dark-only regardless of system theme.
- `src/RoadTripMap/wwwroot/js/mapUI.js` — replace `navigator.share()` with `Native.share()`. Optional: `Native.haptic('light')` on photo-popup taps.
- `src/RoadTripMap/wwwroot/js/photoCarousel.js` — on viewer open: call `Native.statusBar('light')`, attach swipe-to-dismiss handler, add chrome auto-hide. On viewer close (any path): call `Native.statusBar('dark')` inside a `try/finally`.
- `tests/js/photoCarousel.test.js` — extend coverage for status-bar flip on open/close, including the error-restore path.

**Dependencies:** Phase 1 (tokens + native bridge), Phase 2 (some shared selectors are already restyled).

**Done when:**
- iOS shell renders trips.html with the translucent header, collapsing title on scroll, and the immersive viewer behavior described above.
- Status-bar style restores correctly on every viewer-close path including thrown errors.
- `npm test` includes status-bar restore coverage and passes.
- Acceptance criteria covered: `ios-shell-polish.AC5.*`, `ios-shell-polish.AC3.5`.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: index.html and create.html — entry-page polish

**Goal:** Bring the entry pages up to the same token + chrome standard. Index uses the Photos-tile feel for trip cards. Create uses the same nav-bar header as post.html and iOS-styled form inputs.

**Components:**
- `src/RoadTripMap/wwwroot/index.html` — markup adjustments for hero typography (large title) and trip-card layout (Photos-grid feel).
- `src/RoadTripMap/wwwroot/create.html` — header markup matches post.html. Inputs get token-based styling.
- `src/RoadTripMap/wwwroot/css/styles.css` and `ios.css` — restyle `.hero`, `.button-hero`, `.my-trips-section`, `.my-trip-card`, `.page-header` (already touched in Phase 2 — verify create.html consumes correctly), form inputs.
- `src/RoadTripMap/wwwroot/ios.css` — extend the 44×44 selector list to cover `.nav a`, `.my-trip-card`, and any new tap targets.
- `src/RoadTripMap/wwwroot/js/` — wire `Native.haptic('success')` on trip-create success and `Native.haptic('error')` on trip-create failure inside the existing `create.html` inline script (still IIFE-wrapped).

**Dependencies:** Phase 1 and Phase 2.

**Done when:**
- iOS shell renders index.html and create.html with the new tokens and chrome; trip cards lift on press; trip-create success and failure both fire haptics.
- Browser still renders both pages with the universal upgrades only (no iOS-only chrome).
- `npm test` passes.
- Acceptance criteria covered: `ios-shell-polish.AC6.*`.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Cross-page motion and skeleton loaders

**Goal:** Polish the in-between. Page transitions on document swap (animate-out → fetch → swap → animate-in). Skeleton loaders for the photo carousel and trip list during fetch. Spring-feel timings via cubic-bezier approximations.

**Components:**
- `src/bootstrap/fetchAndSwap.js` — extend `_swapFromHtml` to animate the outgoing document out (translate + fade) before swap and the incoming in after swap. Skip animation when reduced-motion is preferred or when `Native` is unavailable. Idempotent under multi-swap conditions.
- `src/RoadTripMap/wwwroot/css/styles.css` — keyframes and CSS classes for page-in / page-out and skeleton shimmer. Reduced-motion `@media` block disables them.
- `src/RoadTripMap/wwwroot/js/photoCarousel.js`, `mapUI.js`, `postUI.js` — show skeleton elements during initial fetch; remove on first paint of real content.
- `tests/js/fetchAndSwap.test.js` — extend coverage for transition lifecycle (start, swap, end), reduced-motion bypass, and idempotency under rapid navigation.

**Dependencies:** Phases 1–4.

**Done when:**
- Page transitions visible in the iOS shell on cross-page navigation. Reduced-motion users see instant swap (existing behavior).
- Skeleton loaders show on first fetch of carousel and trip list; vanish when content arrives.
- `npm test` passes.
- Acceptance criteria covered: `ios-shell-polish.AC7.*`.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: On-device verification and bug fix

**Goal:** Patrick runs the app on his iPhone in both light and dark mode, online and offline, both flows (post-a-photo and view-someone-else's-trip), and signs off. Any bugs surfaced get fixed in this phase.

**Components:**
- No new components by default. Bug fixes land where the bugs live.
- `docs/design-plans/2026-05-09-ios-shell-polish.md` — append a verification log section at the bottom recording what Patrick tested and observed (date, device, iOS version, light/dark, online/offline, both flows).

**Dependencies:** Phases 1–5.

**Done when:**
- Patrick has run the app on his iPhone in all four mode-by-network combinations and exercised both flows.
- Patrick signs off in writing (the verification-log section in this design doc, or a commit message reference).
- All `npm test` and `dotnet test RoadTripMap.sln` suites still pass.
- Acceptance criteria covered: `ios-shell-polish.AC8.*`, `ios-shell-polish.AC10.*`.
<!-- END_PHASE_6 -->

## Additional Considerations

**Performance.** `backdrop-filter` can be expensive on older iPhones. Patrick has a new iPhone, so the risk is low for the immediate target. If a future device shows jank, fall back to opaque backgrounds under `.platform-ios.low-perf` (a class set by a one-time `requestIdleCallback` measurement in `loader.js`). Out of scope for the current week.

**Document-swap transition sequencing.** The transition pattern in Phase 5 (animate-out → fetch → swap → animate-in) interacts with `_executedScriptSrcs`, `clearPageLifecycleListeners`, and `app:page-load` dispatch. The transition must not change the existing event-ordering contract. If implementation reveals a sequencing problem, ship the no-transition version (Phases 1–4 are still complete) and defer transitions per the de-scope ladder.

**De-scope ladder.** If the week tightens, cut from the bottom up:
1. Phase 5 (motion + skeletons) — pages still feel native via type, material, chrome, and plugins.
2. Destructive-action `Dialog.confirm` UI — haptics, share, and status-bar plugins ship regardless.
3. Phase 4 entry-page nav-bar restyle — tokens still apply, structure stays minimal.
4. **Hard floor:** post.html and trips.html in light and dark with system-blue accent, immersive viewer, share sheet, and haptics on key actions. Below that floor, the DoD isn't met.

**GDPR (deferred).** Captured separately in project memory. The destructive-action confirms added in this design are friendly to right-to-erasure, but the load-bearing piece is the existing backend cascade in `DELETE /api/trips/{secretToken}`. Revisit before opening the app to anyone outside Patrick + dad.

**Acceptance criteria scoping.** The `ios-shell-polish.AC*` identifiers below are scoped per the design plan filename. Implementation phases above already reference them by ID.
