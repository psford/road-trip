# Scroll-fade pattern Design

## Summary

This design introduces a "scroll-fade" layout pattern for `post.html` and `create.html`. Both pages are restructured from a single scrolling `body` into a two-layer viewport: a fixed `.pinned-stack` anchored to the top of the screen holds the page header and primary action button, while a `.scroll-content` container beneath it handles all scrolling. A CSS `mask-image` gradient causes content to become transparent as it approaches the bottom edge of the pinned header, so it appears to fade out rather than scroll visibly behind it. Because the masked area is fully transparent by the time it reaches the header's solid background, no blur or `backdrop-filter` is needed.

The design solves two existing bugs simultaneously: the "Add Photo" button becoming unreachable when the page is scrolled (`bugs/001`) and content visibly sliding behind the translucent sticky header (`bugs/002`). A small JavaScript module (`PinnedStack`) measures the pinned region's rendered height and publishes it as a CSS custom property (`--pinned-stack-height`), which both the fade gradient and the scroll container's top padding reference. This keeps the layout self-consistent as the header grows asynchronously when trip data loads. Dark mode and iOS notch handling are first-class concerns woven into the same change.

## Definition of Done

1. **post.html and create.html are restructured** to use the new layout: `body` stops scrolling (`overflow: hidden` scoped to `body[data-page="post"], body[data-page="create"]`); a fixed `.pinned-stack` holds the `.page-header` (and on post.html, `#addPhotoButton`); a `.scroll-content` div is the new scroll container with a CSS `mask-image` linear-gradient that fades content out before reaching the bottom edge of the pinned-stack.

2. **Dark mode is first-class.** The mask gradient and pinned-stack background both adapt to `prefers-color-scheme: dark`. The repo currently has no dark-mode support outside of iOS-specific tokens, so this design introduces the cross-platform dark-mode pattern for these two pages.

3. **`bugs/001` (Add Photo unreachable when scrolled) and `bugs/002` (content visibly scrolling behind translucent header) both close** as a side effect of this change. Their frontmatter moves to `status: closed`, with `fixed-by: PR #N` and `regression-test:` pointing at the new Layer 1 test assertions.

4. **Layer 1 (Playwright layout) tests are updated and extended:**
   - Existing assertions in `tests/playwright-layout/layout.spec.js` that scroll `window` are retargeted to scroll `.scroll-content`.
   - New assertion (a): `#addPhotoButton` is reachable (`document.elementFromPoint(centerX, centerY)` returns the button or a descendant) after scrolling the scroll container by 800px.
   - New assertion (b): `document.documentElement.style.getPropertyValue('--pinned-stack-height')` is set to a non-empty px value on page load.
   - New assertion (c): `getComputedStyle(.scroll-content).paddingTop` equals the value of `--pinned-stack-height`.

5. **iOS shell continues to work.** Both `.platform-ios .page-header` sticky CSS blocks in `ios.css` are dropped (the pinned-stack replaces sticky). `.platform-ios .pinned-stack` gets `padding-top: env(safe-area-inset-top, 0px)` for notch handling. `capacitor.config.js` `ios.contentInset: "always"` stays unchanged.

6. **resumeBanner / progressPanelContainer / errorMessage live inside `.scroll-content`** (at the top of the scrollable area), not the pinned-stack. Decision is deliberate — pinning them would make `--pinned-stack-height` vary widely (70px – 200px depending on banner state), which complicates the mask anchor and eats viewport. Users see banners at scroll-zero (the natural top); during active uploads users tend to be watching the progress, not scrolling away.

7. **Out of scope** for this design plan:
   - `index.html` (Patrick: home page should continue to scroll as it does today)
   - `trips.html` (different layout — full-viewport map with fixed `.map-header` at z-index 1000; needs its own design plan if at all)
   - `prefers-reduced-motion` handling (deferred — family-only audience; future polish)

## Acceptance Criteria

### scroll-fade.AC1: post.html and create.html use the pinned-stack + scroll-content layout

- **scroll-fade.AC1.1 Success:** `post.html` DOM contains exactly one `.pinned-stack` and one `.scroll-content` element, both as direct children of `<body>`. `.pinned-stack` contains `.page-header` and `#addPhotoButton`. `.scroll-content` contains every other content element previously inside `.container`.
- **scroll-fade.AC1.2 Success:** `create.html` matches the same shape minus `#addPhotoButton`.
- **scroll-fade.AC1.3 Success:** `getComputedStyle(document.body).overflow === 'hidden'` on both pages.
- **scroll-fade.AC1.4 Success:** `getComputedStyle(.scroll-content).maskImage` (or `webkitMaskImage`) is a non-empty `linear-gradient(...)` string referencing the pinned-stack-height anchor.
- **scroll-fade.AC1.5 Edge:** When `loadTripInfo` finishes and the header's rendered height changes by ≥1px, `--pinned-stack-height` on `document.documentElement` updates accordingly within one animation frame.
- **scroll-fade.AC1.6 Failure:** Loading `pinnedStack.js` on a page WITHOUT a `.pinned-stack` element does not throw and does not write `--pinned-stack-height` to `:root`.

### scroll-fade.AC2: Dark mode is first-class

- **scroll-fade.AC2.1 Success:** Under `@media (prefers-color-scheme: dark)`, `getComputedStyle(.pinned-stack).backgroundColor` equals the value of `--color-bg-dark` (a new token introduced by this design).
- **scroll-fade.AC2.2 Success:** Under `@media (prefers-color-scheme: light)` (or no media match), `.pinned-stack` background equals `--color-bg`.
- **scroll-fade.AC2.3 Success:** Mask gradient renders identically in both light and dark mode (the mask uses `transparent → black`, which is color-agnostic; only the underlying `.pinned-stack` background changes).
- **scroll-fade.AC2.4 Failure:** `light-dark()` CSS function is NOT used in this design (would break Safari < 17.5 / iOS < 17.5).

### scroll-fade.AC3: bugs/001 and bugs/002 close as side effects

- **scroll-fade.AC3.1 Success:** `bugs/001-add-photo-hidden-behind-sticky-header.md` frontmatter is `status: closed`, with `fixed-by:` referencing the implementing PR and `regression-test: tests/playwright-layout/layout.spec.js`.
- **scroll-fade.AC3.2 Success:** `bugs/002-content-scrolls-visibly-behind-sticky-header.md` matches the same shape.
- **scroll-fade.AC3.3 Failure:** If the regression-test file does not exist OR does not contain the named assertion guarding the bug class, the bug cannot be moved to `closed`.

### scroll-fade.AC4: Layer 1 tests cover the new behavior

- **scroll-fade.AC4.1 Success:** Every existing assertion in `tests/playwright-layout/layout.spec.js` that calls `window.scrollTo` is retargeted to `document.querySelector('.scroll-content').scrollTo(...)`.
- **scroll-fade.AC4.2 Success:** New test: after `document.querySelector('.scroll-content').scrollTo({top: 800})`, `document.elementFromPoint(buttonCenterX, buttonCenterY)` returns `#addPhotoButton` or a descendant of it.
- **scroll-fade.AC4.3 Success:** New test: `getComputedStyle(document.documentElement).getPropertyValue('--pinned-stack-height')` matches `/^\d+px$/`.
- **scroll-fade.AC4.4 Success:** New test: `getComputedStyle('.scroll-content').paddingTop` numerically equals the value of `--pinned-stack-height`.
- **scroll-fade.AC4.5 Success:** New test: `getComputedStyle('.scroll-content').maskImage` (or `webkitMaskImage`) string contains `var(--pinned-stack-height` OR the resolved px value of that var.
- **scroll-fade.AC4.6 Success:** New test: calling `PinnedStack.install()` twice results in only one `ResizeObserver` instance attached (verify `PinnedStack._ro` identity unchanged on second call).
- **scroll-fade.AC4.7 Failure:** Any of AC4.1–AC4.6 failing blocks the PR from landing on `develop`.

### scroll-fade.AC5: iOS shell continues to work

- **scroll-fade.AC5.1 Success:** `ios.css` no longer contains either of the previous `.platform-ios .page-header` sticky CSS blocks (search confirms both `position: sticky` and `position: -webkit-sticky` are absent within any `.platform-ios .page-header` rule).
- **scroll-fade.AC5.2 Success:** `ios.css` contains a `.platform-ios .pinned-stack` rule with `padding-top: env(safe-area-inset-top, 0px)`.
- **scroll-fade.AC5.3 Success:** `capacitor.config.js` `ios.contentInset` value is unchanged (`"always"`).
- **scroll-fade.AC5.4 Failure:** On real iOS device (manual verification), the pinned header sits below the status bar / Dynamic Island, with no overlap.

### scroll-fade.AC6: Banners live in `.scroll-content`, not the pinned-stack

- **scroll-fade.AC6.1 Success:** `document.getElementById('resumeBannerContainer').closest('.scroll-content')` returns the scroll-content element (and `.closest('.pinned-stack')` returns null).
- **scroll-fade.AC6.2 Success:** Same for `progressPanelContainer`.
- **scroll-fade.AC6.3 Success:** Same for the inline `#errorMessage` div on post.html.
- **scroll-fade.AC6.4 Failure:** If any of these are moved into `.pinned-stack`, the ResizeObserver-tracked `--pinned-stack-height` would vary by 70–200px depending on banner state, breaking the mask anchor's stability. Test: while the page is at scroll-zero, `--pinned-stack-height` should not change when a banner mounts or unmounts.

### scroll-fade.AC7: Out-of-scope pages remain untouched

- **scroll-fade.AC7.1 Success:** `index.html` HTML structure is unchanged (no `.pinned-stack` or `.scroll-content` added; `.container` retained; body scrolling unchanged).
- **scroll-fade.AC7.2 Success:** `trips.html` HTML structure is unchanged (`.map-header` at z-index 1000 retained; full-viewport map layout retained; no pinned-stack added).
- **scroll-fade.AC7.3 Success:** No `prefers-reduced-motion` media queries are added in this design (deferred polish).
- **scroll-fade.AC7.4 Failure:** Adding the pattern to `index.html` or `trips.html` in this PR is out of scope and should be rejected at review.

## Glossary

- **`mask-image` / CSS masking**: A CSS property that controls the visibility of an element's content using a gradient or image as an alpha channel. Content under a transparent part of the mask is not painted at all — distinct from opacity, which still composites the element. Used here to fade scroll content before it reaches the pinned header.
- **`linear-gradient` (as a mask)**: A CSS function producing a gradient from one color stop to another. When used as a `mask-image`, `transparent` means "hide this region" and `black` means "show fully." The 8px feather zone between stops produces the soft-fade transition.
- **`--pinned-stack-height` (CSS custom property)**: A CSS variable set on `:root` by `pinnedStack.js`. Both `padding-top` on `.scroll-content` and the `mask-image` gradient anchor point read from this variable, ensuring the scroll container's reserved space and the fade boundary stay in sync even as the header height changes asynchronously.
- **`ResizeObserver`**: A browser API that fires a callback whenever a watched element's layout size changes. Used here to update `--pinned-stack-height` when the trip name loads and expands the header. Replaces polling or `MutationObserver` for dimension tracking.
- **`100svh` (Small Viewport Height)**: A CSS unit representing the viewport height when the browser's dynamic UI (e.g., the iOS address bar) is fully expanded — the smallest the viewport will ever be. Used alongside `100vh` to prevent the body's locked height from miscalculating on iOS when the address bar collapses.
- **`position: fixed` vs `position: sticky`**: `fixed` removes an element from document flow and positions it relative to the viewport, regardless of scroll. `sticky` keeps an element in flow and pins it only when it would otherwise scroll out of view. The pinned-stack uses `fixed` because `sticky` stops working when its scroll ancestor has `overflow: hidden`.
- **`overflow: hidden` on `body`**: Prevents the browser from treating `body` as a scroll container. Required to make `.scroll-content` the sole scroll surface and to lock the viewport height for the two-layer layout.
- **`env(safe-area-inset-top, 0px)`**: A CSS environment variable populated by the browser with the height of the device's hardware notch or Dynamic Island. The fallback `0px` applies on non-notched devices. Applied to `.platform-ios .pinned-stack` so the pinned header does not overlap the system status bar.
- **`PinnedStack` module (IIFE)**: A small vanilla-JS module at `wwwroot/js/pinnedStack.js` that installs the `ResizeObserver`, writes `--pinned-stack-height`, and exposes an idempotent `install()` function. "IIFE" (Immediately Invoked Function Expression) is the module pattern used throughout this codebase — a self-executing function that assigns its exports to `globalThis` rather than using ES module `import`/`export`.
- **Idempotent install (`_installed` flag)**: A guard that makes a function safe to call multiple times with no additional side effects after the first call. Required because `RoadTrip.onPageLoad` re-fires on every iOS shell document swap.
- **`body[data-page="..."]` scoping**: CSS and JS rules targeted at a specific page by matching the `data-page` attribute on `<body>`. Keeps page-specific styles isolated without separate stylesheets.
- **Layer 1 tests (Playwright layout)**: The project's browser-automation test tier, run via `npm run test:layout`. Tests run in a real browser and assert layout and DOM state that can't be verified in jsdom unit tests (e.g., `getBoundingClientRect`, `getComputedStyle`, `elementFromPoint`).
- **`prefers-color-scheme: dark` media query**: A CSS media query that matches when the operating system is in dark mode. Used here to swap `.pinned-stack`'s background color and to confirm the design does not use the newer `light-dark()` function, which would break Safari below version 17.5.
- **`will-change: transform`**: A CSS hint to the browser to promote an element to its own GPU compositing layer before it is needed. Applied to `.pinned-stack` to mitigate a WebKit jitter bug (WebKit Bug #297779) on iOS 26 beta where fixed elements flicker on scroll-direction changes.
- **WKWebView**: Apple's browser engine used inside iOS apps built with Capacitor. It has some layout behaviors that differ from desktop Safari, notably unreliable `window.innerHeight` updates and `overflow: hidden` handling without explicit height. Several of the "Additional Considerations" platform gotchas are specific to WKWebView.
- **`capacitor.config.js` / `ios.contentInset: "always"`**: A Capacitor configuration option that instructs WKWebView to offset its initial scroll position so content starts below the status bar. This interacts with the safe-area padding on `.platform-ios .pinned-stack`; the design intentionally leaves this value unchanged.

## Architecture

The pattern restructures `post.html` and `create.html` into a two-layer viewport:

```html
<body data-page="{post|create}">
  <div class="pinned-stack">         <!-- position: fixed; inset: 0 0 auto 0; z-index: 1001 -->
    <div class="page-header">…</div>
    <button id="addPhotoButton">…</button>   <!-- post.html only -->
  </div>
  <main class="scroll-content">      <!-- position: absolute; inset: 0; overflow-y: auto -->
    <!-- errorMessage, resumeBannerContainer, progressPanelContainer,
         previewSection, photo list, share section -->
  </main>
</body>
```

`body` becomes a non-scrolling viewport sized container: `overflow: hidden; height: 100vh; height: 100svh; margin: 0;` scoped via `body[data-page="post"], body[data-page="create"]`. The `100svh` fallback handles iOS 15.4+ address-bar dynamic viewport changes (WKWebView doesn't reliably update `window.innerHeight` when the address bar collapses; `svh` is the smallest viewport sizing and survives).

`.container` is dropped on these two pages only. Other pages (`index.html`, `trips.html`) keep `.container` unchanged.

**Two-layer stack.** Layer 1 (back) is `.scroll-content` filling the viewport via `position: absolute; inset: 0`. Scrolling happens here. Layer 2 (front) is `.pinned-stack` floating above via `position: fixed` at z-index 1001 with a solid background.

**Fade mechanism.** `.scroll-content` has a top-edge `mask-image: linear-gradient(to bottom, transparent 0, transparent calc(var(--pinned-stack-height) - 8px), black var(--pinned-stack-height), black 100%)`. Content scrolling into the pinned-region's vertical range is fully transparent (literally not painted); below the pinned-region's bottom edge it's opaque. An 8px feather zone produces a soft transition at the boundary. Because the masked area is fully transparent, no `backdrop-filter` is needed on `.pinned-stack` — there is nothing to blur.

**Z-index map** (all unchanged except the new addition):

| Layer | Element | z-index | Purpose |
|---|---|---|---|
| Background | `.scroll-content` | auto (0) | Scrolling content |
| Pinned | `.pinned-stack` | 1001 | Header + primary action (new) |
| Map chrome | `.map-header`, `.map-control`, `.map-empty` (trips.html only) | 1000 | Unchanged |
| Carousel | `.view-carousel-container` (trips.html only) | 999 | Unchanged |
| Toasts | `.toast-container` | 1000 | Body-appended, position: fixed |
| Modals | `.homescreen-modal-overlay` | 2000 | Body-appended, position: fixed |
| Fullscreen | `.fullscreen-overlay` | 10000 | Body-appended, position: fixed |

All toast/modal overlays append to `body` with `position: fixed`, so they escape the new scroll container and continue to work unmodified.

**Height tracking.** A small `PinnedStack` JS module owns the `--pinned-stack-height` CSS custom property on `document.documentElement`. It measures `.pinned-stack` once synchronously before first paint (avoiding a layout flash), then attaches a `ResizeObserver` to update the variable on size changes — primarily the async trip-name load expanding the header by 20–40px. Both `.scroll-content`'s `padding-top` and its `mask-image` anchor reference the same variable, keeping the contract consistent. A literal `120px` fallback in the `var(...)` consumers covers the brief window before the first measurement lands.

**iOS shell adapts via CSS only, no JS changes.** Both `.platform-ios .page-header` sticky CSS blocks in `ios.css` are dropped — the new pinned-stack subsumes that role. `.platform-ios .pinned-stack` gets `padding-top: env(safe-area-inset-top, 0px)` for notch handling. `capacitor.config.js`'s `ios.contentInset: "always"` stays unchanged; it continues to shift the initial scroll position correctly under the pinned region.

## Existing Patterns

This design follows several established patterns from the codebase:

- **IIFE module exposed on `globalThis`.** The new `PinnedStack` module matches the shape of every other shared module in `wwwroot/js/`: `RoadTrip`, `Native`, `OfflineError`, `TripStorage`, plus the bootstrap modules `FetchAndSwap`, `Intercept`, `CachedFetch`, `AssetCache`, `ListenerShim`. All are IIFEs that assign `globalThis.<Name>`. The new module follows the same pattern at `wwwroot/js/pinnedStack.js`.

- **`RoadTrip.onPageLoad('*', fn)` for cross-cutting page-load setup.** This is the same registration channel used by `versionProtocol.js` for its global fetch wrapper. The `*` wildcard matches every page; the `install()` function short-circuits on pages without a `.pinned-stack` element so the registration is safe everywhere.

- **Idempotent install via `_installed` flag.** Required per the CLAUDE.md gotcha: anything invoked by `RoadTrip.onPageLoad` re-fires on every iOS shell document swap. `RoadTrip._installed`, `Native._installed`, `ListenerShim._installed`, and `versionProtocol`'s `_fetchWrapped` flag all show the same pattern. `PinnedStack._installed` plus a single owned `ResizeObserver` reference in `PinnedStack._ro` keep the install side-effect-free on re-invocation.

- **CSS custom properties named `--noun-descriptor`.** Examples already in `:root`: `--space-md`, `--color-primary`, `--motion-duration-fast`, `--radius-md`. The new `--pinned-stack-height` fits the same shape. The new dark-mode token `--color-bg-dark` also matches.

- **`body[data-page="..."]` scoping.** Every `wwwroot/*.html` already sets `<body data-page="...">` (`home`, `create`, `post`, `view`). `RoadTrip.onPageLoad` reads this attribute to scope page handlers. Page-specific CSS rules (`body[data-page="post"], body[data-page="create"]`) are the matching CSS scope mechanism. No existing rules collide.

- **`ResizeObserver` for dynamic-height tracking.** Industry-standard 2026 best practice. No CSS-only alternative meets the iOS 15+ browser floor (`calc-size()` is Chromium-only and unsupported in Safari). The project has no existing `ResizeObserver` usage, but using one here aligns with current web platform guidance and introduces the pattern for future reuse.

- **`@media (prefers-color-scheme: dark)` for dark mode.** The project's iOS-specific dark mode in `ios.css` already uses this exact pattern (multiple `@media (prefers-color-scheme: dark)` blocks updating `.platform-ios` rules). Reusing the same mechanism for cross-platform dark mode keeps the codebase consistent. The newer `light-dark()` CSS function is intentionally NOT used here — it requires Safari 17.5+ / iOS 17.5+, which doesn't meet the iOS 15+ browser floor.

No anti-patterns are introduced. The design does not use `light-dark()` (out of floor), does not use ES modules in `wwwroot/js/*` (codebase has zero existing ES modules), does not use `position: sticky` for the pinned region (sticky is unusable under `body { overflow: hidden }`), and does not add `backdrop-filter` to the pinned-stack (redundant given the mask).

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Build the scroll-fade pattern on post.html and create.html

**Goal:** Restructure both pages to use the pinned-stack + scroll-content + mask architecture, with full dark-mode support and updated regression tests. Closes bugs/001 and bugs/002.

**Components:**

- New file: `src/RoadTripMap/wwwroot/js/pinnedStack.js` — IIFE module exposing `globalThis.PinnedStack = { install, _installed, _ro }`. `install()` finds `.pinned-stack`, measures synchronously, attaches a `ResizeObserver` to track height changes, and writes `--pinned-stack-height` to `document.documentElement.style`. Registered via `RoadTrip.onPageLoad('*', () => PinnedStack.install())`. Idempotent.

- Modified: `src/RoadTripMap/wwwroot/css/styles.css` — adds `.pinned-stack` and `.scroll-content` rules; adds `body[data-page="post"], body[data-page="create"]` rule for `overflow: hidden; height: 100vh; height: 100svh`; adds `--color-bg-dark` token in `:root`; adds `@media (prefers-color-scheme: dark)` block setting `.pinned-stack` background to `var(--color-bg-dark)`.

- Modified: `src/RoadTripMap/wwwroot/post.html` — drops outer `.container`, wraps `.page-header` + `#addPhotoButton` in `<div class="pinned-stack">`, wraps remaining content in `<main class="scroll-content">`, adds `<script src="/js/pinnedStack.js" defer>` in `<head>`.

- Modified: `src/RoadTripMap/wwwroot/create.html` — same structural changes as post.html minus the `#addPhotoButton`.

- Modified: `src/RoadTripMap/wwwroot/ios.css` — removes both `.platform-ios .page-header` sticky CSS blocks (lines ~106–109 and ~161–203); adds `.platform-ios .pinned-stack { padding-top: env(safe-area-inset-top, 0px); }`.

- Modified: `tests/playwright-layout/layout.spec.js` — retargets existing assertions from `window.scrollTo` to `.scroll-content.scrollTo`; replaces sticky-after-scroll checks with always-fixed checks on `.pinned-stack`; adds 5 new assertions (see Done When).

- Modified: `bugs/001-add-photo-hidden-behind-sticky-header.md` and `bugs/002-content-scrolls-visibly-behind-sticky-header.md` — frontmatter `status` moves to `closed`, `fixed-by: PR #<n>` filled in, `regression-test: tests/playwright-layout/layout.spec.js` filled in.

- Modified: `CLAUDE.md` Gotchas section — adds a note that body does not scroll on `data-page="post"|"create"`; any new code calling `window.scrollTo` or reading `window.scrollY` must target `.scroll-content` instead.

**Dependencies:** None. Single-phase plan.

**Acceptance Criteria covered:** All of `scroll-fade.AC1` through `scroll-fade.AC7` (see Acceptance Criteria section).

**Done when:**

- `npm test` passes (existing vitest suite unaffected).
- `npm run test:layout` passes including all updated and new assertions:
  - `.pinned-stack.getBoundingClientRect().top === 0` after any `.scroll-content` scroll.
  - `#addPhotoButton` reachable via `document.elementFromPoint(centerX, centerY)` after a 800px scroll of `.scroll-content` on post.html.
  - `document.documentElement.style.getPropertyValue('--pinned-stack-height')` matches `/^\d+px$/`.
  - `getComputedStyle('.scroll-content').paddingTop` numerically equals `--pinned-stack-height`.
  - `getComputedStyle('.scroll-content').maskImage` (or `webkitMaskImage`) contains the `--pinned-stack-height` reference (or its resolved px value).
  - Calling `PinnedStack.install()` twice attaches only one ResizeObserver (verify `PinnedStack._ro` identity).
- bugs/001 and bugs/002 are `status: closed` with `fixed-by` and `regression-test` filled in.
- Manual on-device verification on iPhone (Patrick): post page sticky header pins below status bar, Add Photo button is reachable at any scroll position, content fades into the pinned region rather than scrolling visibly behind it.
<!-- END_PHASE_1 -->

## Additional Considerations

**Browser floor.** Safari 14.5+, iOS Safari 15+, Chromium 90+. `mask-image: linear-gradient(...)` works in all targeted browsers with the `-webkit-mask-image` prefix. `ResizeObserver` is supported (Safari 13.1+, iOS 13.4+, Chrome 64+). `100svh` is supported (Safari 15.4+, iOS 15.4+, Chrome 108+).

**Known platform gotchas mitigated by this design:**

- **WebKit Bug #153852** — iOS body `overflow: hidden` is unreliable without explicit height. The design sets both `height: 100vh` and `height: 100svh` to lock viewport sizing.
- **WebKit Bug #297779** (iOS 26 beta) — fixed elements can jitter on scroll-direction change. `will-change: transform` on `.pinned-stack` lifts it to its own compositing layer.
- **iOS 18+ WKWebView address-bar viewport mismatch** — `100svh` fallback handles dynamic-viewport sizing.

**Performance.** `mask-image: linear-gradient(...)` is GPU-composited on both Blink and WebKit. `will-change: mask-image` on `.scroll-content` hints the compositor in advance. Content underneath the mask still paints, but a single linear-gradient mask is negligible cost on modern hardware. The pattern has not been profiled on older devices (iPhone 12, iPad Air 2); if jank is observed there, `contain: paint` on `.scroll-content` is the next mitigation.

**Not testable in Layer 1.** Visual pixel-correctness of the mask gradient on real WKWebView, and `safe-area-inset-top` padding interaction with `contentInset: "always"` on a real notched device, both require Layer 2 (Maestro on Simulator) which is currently blocked by `bugs/004` (Maestro 2.6.0 incompatibility with iOS 26 simulators). When that unblocks, the Layer 2 picker-flow test added in the next round should also screenshot the post-page scroll-fade in light and dark modes for visual regression.

**Future extensibility.** The pattern is page-scoped via `body[data-page="..."]` and `.pinned-stack` element presence. Future pages adopt the pattern by adding the same DOM structure and loading `pinnedStack.js` — no module changes needed. The trips.html map page (out of scope here) could in principle adopt the pattern, but its full-viewport map and bottom-anchored carousel make this a separate design exercise.

**Implementation scoping.** Single phase, ~250 LOC total across CSS, HTML, JS, and tests. Well below the writing-plans 8-phase cap.
