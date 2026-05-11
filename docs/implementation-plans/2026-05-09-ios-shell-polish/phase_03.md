# iOS Shell Polish — Phase 3: trips.html — view route and immersive Photos viewer

**Goal:** Deliver the native moment. Translucent map header with a large title. Immersive Photos viewer for `.fullscreen-overlay`: true-black backdrop, light status bar on open, dark status bar restored on every dismiss path (try/finally), auto-hiding chrome on tap, and swipe-down to dismiss with translate+fade. Wire the per-photo share through `Native.share` and an optional haptic on photo-popup tap.

**Architecture:** Markup change is minimal — adding a `data-large-title` slot inside `.map-header` for the iOS large-title treatment. CSS adds the translucent material under `.platform-ios .map-header` and the immersive viewer treatment under `.platform-ios .fullscreen-overlay`. JS work concentrates in `photoCarousel.js` (the viewer's open/close lifecycle) and `mapUI.js` (Native.share + optional haptic). The status-bar coordination contract — `loader.js` cold-start sets `'dark'`; only the viewer flips to `'light'` and restores on every close path inside `try/finally` — is non-negotiable for AC5.4 / AC5.5.

**Tech Stack:** vanilla JS (`mapUI.js`, `photoCarousel.js`), CSS custom properties, `Native.statusBar` / `Native.share` / `Native.haptic` from Phase 1, browser Pointer Events API for swipe-to-dismiss.

**Scope:** Phase 3 of 6 from `docs/design-plans/2026-05-09-ios-shell-polish.md`.

**Codebase verified:** 2026-05-10. See discrepancies below.

**Discrepancies from design — read carefully:**
- **Fullscreen overlay is JS-rendered, not in `trips.html` markup.** It's created on demand by `photoCarousel.showFullscreen()` (lines 281–374) and appended to `document.body`. CSS rules apply via the `.fullscreen-overlay` selector regardless of injection source.
- **`.fullscreen-overlay` background is hardcoded `rgba(0,0,0,0.9)`** in `styles.css:1224-1248` — already dark regardless of `prefers-color-scheme`. AC2.3 ("immersive viewer is dark regardless of system theme") is satisfied by current code; Phase 3 only needs to keep this property.
- **There are FOUR existing dismiss paths** in `photoCarousel.showFullscreen()`: background tap (lines 357–362), Escape key (lines 365–370), edit-location button (lines 322–327, removes overlay then runs callback), delete button (lines 337–342, removes overlay then runs callback). Phase 3 must wrap **every one** in try/finally with `Native.statusBar('dark')` restore so AC5.5 cannot regress.
- **Tap-to-toggle-chrome conflicts with the existing background-tap-to-close behavior.** AC5.2 says "auto-hiding chrome on tap" (= tap toggles chrome visibility, like iOS Photos). The existing background-tap-to-close (lines 357–362) is the wrong behavior for AC5.2. Phase 3 changes universal viewer behavior to: tap-on-overlay toggles chrome; close requires explicit close button (added to chrome), Escape key, or swipe-down (iOS only). This is a **behavior change** — flag in commit message and Patrick's verification log.
- **`.map-header` is `position: fixed`, not `sticky`.** The "translucent material" AC5.1 still applies; `position: fixed` works the same way for this purpose. Don't change positioning to `sticky` without verifying nothing breaks layout.
- **The "collapsing large title that collapses to nav-title size on scroll"** (AC5.1) requires a scrollable surface. trips.html's body is `.map-page` which has no obvious vertical scroll target (the map pans, the carousel scrolls horizontally; nothing in the page produces a vertical scroll position to drive a collapse). **Decision (binding for Phase 3):** AC5.1 is satisfied by **visual presence of the large title + translucent material**. The "collapses on scroll" clause is interpreted as **conditional behavior that activates on any future scrollable surface**, NOT a behavior Phase 3 must produce on a non-scrollable page. Implementation: ship the static large title with CSS that *would* collapse if the body ever scrolled (using `position: sticky` on `.map-header` and a scroll-position-driven CSS transition driven by a CSS scroll-linked custom property if practical, OR a one-line `window.addEventListener('scroll', ...)` in `mapUI.js` that toggles a `.map-header.is-collapsed` class). On trips.html as it exists today, the scroll never fires, so the collapse never triggers — visually equivalent to a static large title. If Patrick wants a *triggered* collapse (e.g., on map-zoom, on carousel-thumbnail-tap, on any other event that signals "user is engaging with content"), file as a Phase 6 follow-up bug per the Phase 6 Task 4 process — there's no clean substitute trigger for now without changing trips.html's interaction model. Task 2's CSS includes the dormant-scroll-listener foundation so the upgrade is a one-liner JS change later if needed.
- **`mapUI.init(viewToken)` is called directly from a `<script>` IIFE in `trips.html:36-41`, not via `RoadTrip.onPageLoad('view', ...)`.** Refactoring this into onPageLoad is out of scope for Phase 3 — the design doesn't require it, and changing the init wiring carries layout-test risk. Phase 3 calls `Native.*` from inside the existing flow.
- **`photoCarousel.js` does NOT use the IIFE + `_installed` pattern** (it's a plain object literal). The Phase 1 idempotency contract ("anything invoked by `RoadTrip.onPageLoad` must be idempotent") doesn't apply here because photoCarousel isn't invoked from onPageLoad. Phase 3 adds new event listeners inside `showFullscreen()` — every listener it adds must be paired with a removal in the dismiss path so a re-open doesn't stack listeners. The investigator confirmed the current Escape-key listener removal pattern (line 354) is correct; replicate that pattern for new listeners.
- **`tests/js/photoCarousel.test.js` will exist** when Phase 3 starts (Phase 2 creates it). Phase 3 extends it.

**Recommended skills for executor (activate before starting):**
- `ed3d-house-style:writing-good-tests` (status-bar restore-on-error coverage especially)
- `ed3d-house-style:defense-in-depth` (try/finally is the AC5.5 contract)
- `ed3d-plan-and-execute:test-driven-development` (write the status-bar-restore-on-throw test before the implementation — it's the easiest test to forget)
- `ed3d-plan-and-execute:verification-before-completion`

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ios-shell-polish.AC5: trips.html — view route and immersive viewer
- **ios-shell-polish.AC5.1 Success:** `.map-header` renders as a translucent material with a large title that collapses to nav-title size on scroll.
- **ios-shell-polish.AC5.2 Success:** Tapping a carousel thumbnail opens `.fullscreen-overlay` with a true-black backdrop, light status bar, and auto-hiding chrome on tap.
- **ios-shell-polish.AC5.3 Success:** Swipe-down on the open viewer dismisses with translate+fade.
- **ios-shell-polish.AC5.4 Success:** Status bar restores to dark on every viewer-close path.
- **ios-shell-polish.AC5.5 Failure:** A thrown error inside the viewer does not leave the status bar inverted.

### ios-shell-polish.AC3: Native plugin wiring (AC3.5 — completing Phase 1's partial coverage)
- **ios-shell-polish.AC3.5 Success:** `Native.statusBar('light' | 'dark')` switches text color and is restored on the close path even when the trigger throws.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add `data-large-title` slot to `.map-header` in `trips.html`

**Type:** Functionality (markup).

**Verifies:** ios-shell-polish.AC5.1 (large-title visual presence).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/trips.html` — `.map-header` block at lines 14–17.

**Implementation:**

The current header is:
```html
<div class="map-header">
    <a class="map-back" href="/">←</a>
    <span id="tripName"></span>
</div>
```

Update to add the large-title slot. The existing `#tripName` stays as the small inline title (visible always); the new `<h1 data-large-title>` shows the same text in large form. JS-side: the existing init flow that populates `#tripName.textContent` must also populate `[data-large-title].textContent`. Find that population point in `mapUI.js` (search `tripName` to find it) and mirror the assignment.

```html
<div class="map-header">
    <a class="map-back" href="/">←</a>
    <span id="tripName"></span>
    <h1 data-large-title id="tripNameLarge"></h1>
</div>
```

**JS-side update** (`mapUI.js`): wherever `document.getElementById('tripName').textContent = trip.name` (or equivalent) lives, add a sibling line: `const large = document.getElementById('tripNameLarge'); if (large) large.textContent = trip.name;`. Defensive guard so an older version of the page (no slot) doesn't throw.

**Verification:**

Run: `npm test`
Expected: full suite passes (no test asserts on the exact header markup shape).

Manual visual check (executor): open `/trips/{viewToken}` in a browser. The header shows the trip name twice — once as the small inline title (existing), once as a new large title (new). Task 2 styles them so only one is visible at a time depending on scroll/viewport state.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/trips.html src/RoadTripMap/wwwroot/js/mapUI.js
git commit -m "feat(trips.html): add data-large-title slot in .map-header

Markup landing pad for Phase 3's iOS large-title treatment. mapUI now
populates both the small inline #tripName and the new #tripNameLarge.
Visual styling (which one shows when) lands in Task 2."
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Restyle `.map-header`, `.map-control`, `.view-carousel-container`, `.carousel-item`, `.carousel-action-btn` in `styles.css` and `ios.css`

**Type:** Functionality (visual; minor behavior change for tap-to-toggle-chrome — behavior change is in Task 4).

**Verifies:** ios-shell-polish.AC5.1 (translucent material on `.map-header`), ios-shell-polish.AC9.3 (browser sees universal polish only).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/css/styles.css` — token swap for the listed selectors:
  - `.map-header` lines 869–884
  - `.map-control` lines 906–930
  - `.view-carousel-container` lines 1103–1118
  - `.carousel-item` lines 1160–1174
  - `.carousel-action-btn` lines 1200–1221
- Modify: `src/RoadTripMap/wwwroot/ios.css` — append a `/* Phase 3: trips.html chrome */` section.

**Implementation — universal token swap (`styles.css`):**

Same pattern as Phase 2 Task 1: replace hardcoded color literals with semantic tokens (`--color-surface`, `--color-text`, `--color-separator`), font sizes with type-scale tokens (`--font-size-headline`, `--font-size-body`), border-radius with radius tokens (`--radius-md` for buttons, `--radius-lg` for sheets, `--radius-full` for circular controls), transitions with motion tokens. **Don't change layout dimensions or positioning** — token-only swap.

Add a `[data-large-title]` rule (in `styles.css`, near `.map-header`):

```css
[data-large-title] {
  font-size: var(--font-size-large-title);
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.02em;
  margin: 0;
  padding: var(--space-sm) var(--space-md) 0;
  color: var(--color-text);
  display: none; /* hidden by default; .platform-ios shows it */
}
```

The default `display: none` means browsers see only the existing `#tripName` (no visual change). Task 2's iOS rules below show `[data-large-title]` and hide `#tripName`.

**Implementation — iOS chrome (`ios.css`, append):**

```css
/* Phase 3: trips.html — translucent map header + large title */
.platform-ios .map-header {
  background-color: var(--material-bg-light);
  backdrop-filter: var(--material-blur-regular);
  -webkit-backdrop-filter: var(--material-blur-regular);
  border-bottom: 0.5px solid var(--color-separator);
}

@media (prefers-color-scheme: dark) {
  .platform-ios .map-header {
    background-color: var(--material-bg-dark);
  }
}

.platform-ios .map-header .map-back {
  color: var(--color-accent);
  font-size: var(--font-size-title-2);
}

.platform-ios .map-header #tripName {
  /* On iOS, large title takes over; small inline title still shows
     because there's no scrollable surface yet to drive the collapse.
     Keeps the header visually balanced between back-button and title. */
  font-size: var(--font-size-headline);
  font-weight: var(--font-weight-semibold);
}

.platform-ios .map-header [data-large-title] {
  display: block;
  /* Dormant collapse foundation: when .map-header gets .is-collapsed (no
     trigger fires today on trips.html — see Phase 3 Discrepancies note on
     AC5.1), the large title hides and the small inline title fills the
     nav-bar role. A future trigger (carousel interaction, map-zoom, page
     scroll if added) can toggle .is-collapsed in mapUI without further
     CSS changes. */
  transition: opacity var(--motion-duration-fast) var(--motion-ease-standard),
              max-height var(--motion-duration-fast) var(--motion-ease-standard);
  max-height: 100px;
  overflow: hidden;
}

.platform-ios .map-header.is-collapsed [data-large-title] {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
}

/* Phase 3: trips.html — view-route carousel & action button polish */
.platform-ios .view-carousel-container {
  background-color: var(--material-bg-dark);
  backdrop-filter: var(--material-blur-regular);
  -webkit-backdrop-filter: var(--material-blur-regular);
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--space-sm));
}

.platform-ios .carousel-item {
  border-radius: var(--radius-md);
  transition: transform var(--motion-duration-instant) var(--motion-ease-standard);
}
.platform-ios .carousel-item:active {
  transform: scale(0.96);
}

.platform-ios .carousel-action-btn {
  background-color: rgba(0, 0, 0, 0.55);
  backdrop-filter: var(--material-blur-thin);
  -webkit-backdrop-filter: var(--material-blur-thin);
  color: #ffffff;
  border-radius: var(--radius-full);
}

/* Phase 3: trips.html — immersive Photos viewer */
.platform-ios .fullscreen-overlay {
  background: #000000; /* true-black, not the universal 90% rgba */
}

.platform-ios .fullscreen-overlay .fullscreen-actions,
.platform-ios .fullscreen-overlay .fullscreen-close {
  transition: opacity var(--motion-duration-fast) var(--motion-ease-standard);
}

.platform-ios .fullscreen-overlay.chrome-hidden .fullscreen-actions,
.platform-ios .fullscreen-overlay.chrome-hidden .fullscreen-close {
  opacity: 0;
  pointer-events: none;
}

.platform-ios .fullscreen-overlay.is-dismissing {
  transition: opacity var(--motion-duration-normal) var(--motion-ease-decelerate),
              transform var(--motion-duration-normal) var(--motion-ease-decelerate);
  opacity: 0;
}

.platform-ios .fullscreen-overlay .fullscreen-close {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + var(--space-md));
  left: var(--space-md);
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: var(--material-blur-thin);
  -webkit-backdrop-filter: var(--material-blur-thin);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-title-3);
  cursor: pointer;
  border: none;
}

.platform-ios .fullscreen-overlay .fullscreen-actions {
  position: absolute;
  bottom: calc(env(safe-area-inset-bottom, 0px) + var(--space-md));
  right: var(--space-md);
}
```

Notes:
- `.fullscreen-overlay` background: `#000000` solid (not the existing `rgba(0,0,0,0.9)`) for a more immersive feel on iOS.
- `.chrome-hidden` is the class added by Task 4 to hide chrome on tap.
- `.is-dismissing` is the class added by Task 5 to animate the swipe-down dismiss.
- `.fullscreen-close` is a NEW element — Task 4 adds it to the JS-rendered overlay so users have an explicit close path now that tap-on-overlay no longer dismisses.
- The existing 44×44 tap-target rule in `ios.css:25-39` already covers `.platform-ios .carousel-action-btn`. The new `.fullscreen-close` (32px sized, see above) is below the 44×44 minimum. Update Task 6's selector list to add `.platform-ios .fullscreen-close` so the touch target meets the rule (CSS will set `min-height: 44px; min-width: 44px;` and the visual disc stays 32px via padding).

**Verification:**

Run: `npm test`
Expected: full suite passes.

Manual visual check (executor on iOS simulator after `npx cap sync ios`): map header is translucent, large trip name visible. Tapping carousel thumbnail opens immersive viewer with true-black background and visible close button.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/css/styles.css src/RoadTripMap/wwwroot/ios.css
git commit -m "feat(trips-css): translucent map header, immersive viewer chrome on iOS

styles.css: token swap for .map-header, .map-control, .view-carousel-container,
.carousel-item, .carousel-action-btn, plus a [data-large-title] rule
(hidden by default, shown under .platform-ios).

ios.css adds a Phase 3 section:
- Translucent .map-header with backdrop-filter + safe-area treatment
- Solid-black .platform-ios .fullscreen-overlay (was 90% rgba)
- .chrome-hidden / .is-dismissing classes for Task 4 / Task 5 JS hooks
- Explicit .fullscreen-close button styling (Task 4 creates the element)"
```
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

---

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->
<!-- START_TASK_3 -->
### Task 3: Replace `navigator.share` with `Native.share` in `mapUI.sharePhoto` and add optional haptic on photo-popup tap

**Type:** Functionality.

**Verifies:** Supports AC3.3 (call-site coverage), supports the design's optional haptic note.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/mapUI.js` — `sharePhoto` at lines 188–195, photo-popup tap handler at lines 108–112.

**Implementation:**

`sharePhoto` swap (mirrors Phase 2 Task 5 in photoCarousel):

```javascript
async sharePhoto(url, title) {
    const safeTitle = title || 'Photo';
    const fullUrl = url.startsWith('http') ? url : (RoadTrip.appOrigin() + url);
    if (globalThis.Native && typeof globalThis.Native.share === 'function') {
        await globalThis.Native.share({ title: safeTitle, url: fullUrl });
        return;
    }
    if (typeof navigator.share === 'function') {
        await navigator.share({ title: safeTitle, url: fullUrl });
    }
    // No silent fallback — if neither Native nor navigator.share exists, the
    // calling button shouldn't have been rendered (createSaveButton checks).
}
```

Note: the URL-construction line uses `RoadTrip.appOrigin()` per CLAUDE.md's "RoadTrip.appOrigin() is the only sanctioned way to assemble shareable URLs" rule. Verify this is already the pattern in `sharePhoto`; if the existing code uses `window.location.origin` here, that's a pre-existing leak and Task 3 should fix it as part of the swap (small, in-scope cleanup that the design's Native.share work touches anyway).

**Photo-popup tap haptic** (`mapUI.js:108-112`, the image click handler attached on popup open):

```javascript
img.addEventListener('click', (e) => {
    e.stopPropagation();
    if (globalThis.Native && typeof globalThis.Native.haptic === 'function') {
        void globalThis.Native.haptic('light');
    }
    PhotoCarousel.showFullscreen(photo);
});
```

The `dataset.listenerAttached` guard at line ~108 (per investigator) means this handler is wired exactly once per popup open — no idempotency concern.

**Tests** (extend `tests/js/mapUI.test.js` if exists, or create it):

- `it('sharePhoto delegates to Native.share when available')` — stub Native.share, call sharePhoto, assert called with `{ title, url }`.
- `it('sharePhoto falls back to navigator.share when Native is unavailable')` — leave Native undefined, stub navigator.share, assert called.
- `it('sharePhoto uses RoadTrip.appOrigin() to build the shareable URL')` — stub RoadTrip.appOrigin to return a known string, assert the URL passed to Native.share starts with that string.
- `it('photo-popup image tap fires Native.haptic("light")')` — render a popup, simulate click on the image, assert Native.haptic called.
- `it('photo-popup image tap does not throw when Native is unavailable')` — same with Native undefined; assert no throw and PhotoCarousel.showFullscreen still called.

**Verification:**

Run: `npm test`
Expected: full suite passes including new mapUI tests.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/js/mapUI.js tests/js/mapUI.test.js
git commit -m "feat(mapUI): Native.share + photo-popup haptic via Native wrapper

sharePhoto now delegates to Native.share (iOS share sheet) with web
navigator.share fallback retained behind the Native.* boundary. URL
assembled via RoadTrip.appOrigin() per the canonical shareable-URL rule.

Photo-popup image tap now fires Native.haptic('light') before opening
the fullscreen viewer. Defensive guard for missing Native (test envs)."
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Status-bar flip + tap-to-toggle-chrome in `photoCarousel.showFullscreen`

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC5.2 (true-black backdrop, light status bar, auto-hiding chrome on tap), ios-shell-polish.AC5.4 (status bar restores on every close path), ios-shell-polish.AC5.5 (try/finally guarantees restore even on throw), ios-shell-polish.AC3.5.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/photoCarousel.js` — `showFullscreen` at lines 281–374.

**Implementation:**

This task makes three coordinated changes to `showFullscreen`:

1. **Status-bar flip on open** (after the overlay is appended to body):
   ```javascript
   if (globalThis.Native && typeof globalThis.Native.statusBar === 'function') {
       void globalThis.Native.statusBar('light');
   }
   ```

2. **Try/finally restore in `closeOverlay`** — wrap the existing close logic so a throw cannot leave the status bar inverted:
   ```javascript
   function closeOverlay() {
       try {
           if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
           document.removeEventListener('keydown', handleEscape);
           // ... any other cleanup that exists today ...
       } finally {
           if (globalThis.Native && typeof globalThis.Native.statusBar === 'function') {
               void globalThis.Native.statusBar('dark');
           }
       }
   }
   ```

3. **All four dismiss paths must use `closeOverlay()`** so the try/finally is the single guarantee. Audit:
   - Background-tap (lines 357–362): currently calls `closeOverlay()` directly. **CHANGE:** in the same listener, do NOT close on tap; instead toggle the `chrome-hidden` class on the overlay. Move "close" to a new `.fullscreen-close` button (added below).
   - Escape key (lines 365–370): calls `closeOverlay()`. **KEEP.**
   - Edit-location button (lines 322–327): currently does `overlay.parentNode.removeChild(overlay)` then `config.onEditLocation(photo)`. **CHANGE:** call `closeOverlay()` instead of inlining the removal — ensures the try/finally restore runs.
   - Delete button (lines 337–342): currently does `overlay.parentNode.removeChild(overlay)` then `config.onDelete(photo)`. **CHANGE:** call `closeOverlay()` instead of inlining the removal.
   - **NEW close button** (`.fullscreen-close`): add a button to the overlay chrome (the `.fullscreen-actions` container or as a sibling). Click handler calls `closeOverlay()`.

4. **Tap-to-toggle-chrome:** rebind the existing background tap. Instead of close, toggle:
   ```javascript
   overlay.addEventListener('click', (e) => {
       // Only respond to taps on the overlay or image (not on chrome buttons)
       if (e.target === overlay || e.target.tagName === 'IMG') {
           overlay.classList.toggle('chrome-hidden');
       }
   });
   ```

5. **Add the explicit close button to the chrome:**
   ```javascript
   const closeBtn = document.createElement('button');
   closeBtn.className = 'fullscreen-close';
   closeBtn.setAttribute('aria-label', 'Close');
   closeBtn.textContent = '×';
   closeBtn.addEventListener('click', () => closeOverlay());
   overlay.appendChild(closeBtn);
   ```

**Important — exception safety contract for AC5.5:**

The try/finally in `closeOverlay` MUST cover every line that could throw (e.g., `overlay.parentNode.removeChild` could in theory throw if DOM state is unexpected). The status-bar restore in `finally` runs regardless of the try-block outcome. Test for this explicitly (Task 7).

**Edge case:** if `closeOverlay()` is called twice (e.g., user clicks close button while a swipe-dismiss animation is mid-flight from Task 5), the second call's `overlay.parentNode` will be `null`. Guard with `if (overlay.parentNode) overlay.parentNode.removeChild(overlay);` so re-entry is a no-op for the DOM and the second statusBar('dark') is harmless.

**Verification:**

Tests in Task 7 cover all paths. Manual on-iOS verification during Phase 6 sign-off.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/js/photoCarousel.js
git commit -m "feat(carousel): immersive viewer status-bar + tap-to-toggle chrome

showFullscreen now:
- Calls Native.statusBar('light') on open (iOS only; web no-op)
- Adds explicit .fullscreen-close button to chrome (since tap-on-overlay
  no longer dismisses)
- Tap on overlay/image toggles .chrome-hidden class (auto-hiding chrome,
  AC5.2)
- All four close paths route through closeOverlay() which wraps cleanup
  + Native.statusBar('dark') restore in try/finally (AC5.4, AC5.5)
- Re-entry guarded so the second close call is harmless

BEHAVIOR CHANGE: previously, tapping the overlay backdrop dismissed
the viewer. Now it toggles chrome visibility. Dismiss requires explicit
close button, Escape key, or (Task 5, iOS only) swipe-down."
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Swipe-to-dismiss for the immersive viewer (iOS only)

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC5.3.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/photoCarousel.js` — append a swipe-handler attachment inside `showFullscreen` (after the explicit close button is wired in Task 4).

**Implementation:**

Use Pointer Events (unified mouse/touch on iOS Safari). Track vertical translation, on release: if dragged > 100px or velocity > 0.5 px/ms, dismiss with an animated translate+fade; else snap back. Only attach on iOS (browser users get nothing, which is fine — the other dismiss paths cover them).

```javascript
// Inside showFullscreen, after closeBtn is appended.
// Skip on web — swipe-dismiss is an iOS-shell affordance.
if (globalThis.RoadTrip && globalThis.RoadTrip.isNativePlatform && globalThis.RoadTrip.isNativePlatform()) {
    let startY = null;
    let startTime = 0;
    let dragging = false;

    const onDown = (e) => {
        // Only start a drag if the touch starts on the overlay or image,
        // not on chrome buttons (close/save/edit/delete).
        const t = e.target;
        if (!(t === overlay || t.tagName === 'IMG')) return;
        startY = e.clientY;
        startTime = e.timeStamp;
        dragging = true;
        overlay.style.transition = 'none';
    };

    const onMove = (e) => {
        if (!dragging) return;
        const dy = Math.max(0, e.clientY - startY);
        overlay.style.transform = 'translateY(' + dy + 'px)';
        overlay.style.opacity = String(Math.max(0, 1 - dy / 600));
    };

    const onUp = (e) => {
        if (!dragging) return;
        dragging = false;
        const dy = Math.max(0, e.clientY - startY);
        const dt = Math.max(1, e.timeStamp - startTime);
        const velocity = dy / dt; // px per ms

        overlay.style.transition = '';

        if (dy > 100 || velocity > 0.5) {
            // Animate the rest of the dismiss.
            overlay.classList.add('is-dismissing');
            overlay.style.transform = 'translateY(100vh)';
            overlay.style.opacity = '0';
            // closeOverlay handles status-bar restore + DOM removal in try/finally.
            // Use the transition-end event so the user sees the animation complete
            // before the overlay disappears.
            const onEnd = () => {
                overlay.removeEventListener('transitionend', onEnd);
                closeOverlay();
            };
            overlay.addEventListener('transitionend', onEnd);
            // Safety net: if transitionend doesn't fire (browser quirk), still close.
            setTimeout(() => {
                if (overlay.parentNode) closeOverlay();
            }, 400);
        } else {
            // Snap back.
            overlay.style.transform = '';
            overlay.style.opacity = '';
        }
    };

    overlay.addEventListener('pointerdown', onDown);
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointercancel', onUp);
}
```

Notes:
- Pointer Events fire on touch on iOS Safari since iOS 13. No `touchstart` polyfill needed.
- The `transitionend` listener is removed from the overlay before `closeOverlay()` runs. The overlay element is then removed from DOM (or already gone if a re-entry happened); either way no orphan listener.
- `closeOverlay()` runs the try/finally restore (Task 4). So swipe-dismiss naturally inherits AC5.4's guarantee.

**Verification:**

Tests in Task 7. On-iOS verification in Phase 6.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/js/photoCarousel.js
git commit -m "feat(carousel): swipe-down to dismiss the immersive viewer (iOS only)

Pointer Events (iOS Safari unified touch/mouse): track vertical drag,
on release dismiss if >100px or >0.5 px/ms; otherwise snap back.
Dismiss animates translate+fade then routes through closeOverlay()
so the Task 4 try/finally status-bar restore covers this path too.

Web users keep close-button + Escape; swipe is an iOS-only affordance."
```
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

---

<!-- START_SUBCOMPONENT_C (tasks 6) -->
<!-- START_TASK_6 -->
### Task 6: Add `.platform-ios .fullscreen-close` to the 44×44 tap-target rule in `ios.css`

**Type:** Functionality.

**Verifies:** Supports AC5.2 (the new close button is large enough to tap reliably; the 44×44 rule is the project's HIG floor).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/ios.css` — the consolidated 44×44 selector list at lines 25–39.

**Implementation:**

Append `.platform-ios .fullscreen-close` to the comma-separated selector list:

```css
.platform-ios .upload-panel__retry,
.platform-ios .upload-panel__pin-drop,
.platform-ios .upload-panel__discard,
.platform-ios .upload-panel__toggle,
.platform-ios .resume-banner button,
.platform-ios .photo-carousel__control,
.platform-ios .carousel-action-btn,
.platform-ios .photo-popup-delete,
.platform-ios .copy-button,
.platform-ios .map-back,
.platform-ios .poi-action-btn,
.platform-ios .fullscreen-close,
.platform-ios button {
  min-height: 44px;
  min-width: 44px;
}
```

The `.platform-ios button` blanket rule already covers `.fullscreen-close` (it's a `<button>` per Task 4). Adding it explicitly is belt-and-suspenders documentation; CLAUDE.md's gotcha note ("Buttons added to wwwroot after the ios-shell-hardening plan are NOT automatically covered") suggests the explicit selector is the convention.

**Verification:**

Manual visual on iOS simulator: the close button's tap area (44×44) is large; the visual circle (32px) sits centered.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/ios.css
git commit -m "fix(ios.css): add .fullscreen-close to the 44x44 tap-target list

Per CLAUDE.md gotcha: the consolidated tap-target rule lists explicit
selectors curated from HIG audit. New buttons aren't auto-covered;
list .fullscreen-close (Task 4 added the element) so its hit area
meets the iOS HIG 44pt minimum even though the visual disc is 32px."
```
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_C -->

---

<!-- START_SUBCOMPONENT_D (tasks 7) -->
<!-- START_TASK_7 -->
### Task 7: Extend `tests/js/photoCarousel.test.js` with status-bar + viewer lifecycle coverage

**Type:** Functionality (test).

**Verifies:** ios-shell-polish.AC5.4, ios-shell-polish.AC5.5, ios-shell-polish.AC3.5.

**Files:**
- Modify: `tests/js/photoCarousel.test.js` (created in Phase 2 Task 5; extend with the new describe block).

**Test patterns:**

Mock `globalThis.Native = { statusBar: vi.fn().mockResolvedValue(undefined) }` per test. Reset the spy between tests. Render a minimal carousel and call `PhotoCarousel.showFullscreen(photo)` then exercise dismiss paths.

**Tests to add:**

1. **`describe('Immersive viewer — status bar')`**
   - `it('Native.statusBar("light") fires on viewer open')` — call `showFullscreen(photo)`, assert called with `'light'`.
   - `it('Native.statusBar("dark") fires on close-button dismiss')` — open viewer, click `.fullscreen-close`, assert called with `'dark'` after open's `'light'`.
   - `it('Native.statusBar("dark") fires on Escape-key dismiss')` — open viewer, dispatch keydown Escape, assert restored.
   - `it('Native.statusBar("dark") fires on edit-location button dismiss')` — open viewer with an `onEditLocation` callback, click edit-location button, assert restored AND callback called.
   - `it('Native.statusBar("dark") fires on delete-button dismiss')` — same pattern with onDelete.
   - `it('Native.statusBar("dark") fires even if removeChild throws')` — stub `overlay.parentNode.removeChild` to throw; trigger close; assert `Native.statusBar('dark')` was still called (try/finally guarantee, AC5.5).
   - `it('multiple closeOverlay() calls do not crash')` — open viewer, call close-button-click then close-button-click again (re-entry), assert no throw and exactly one statusBar('dark') restore (or two, depending on chosen impl — assert "at least one" is fine).

2. **`describe('Immersive viewer — chrome auto-hide on tap')`**
   - `it('clicking the overlay backdrop toggles .chrome-hidden')` — open viewer, click on the overlay element (target === overlay), assert classList contains `chrome-hidden`. Click again, assert removed.
   - `it('clicking on the close button does NOT toggle chrome-hidden')` — open viewer, click `.fullscreen-close`, assert `chrome-hidden` is NOT toggled (the click handler distinguishes target).
   - `it('clicking on action buttons (save/delete/edit) does NOT toggle chrome-hidden')` — same pattern.

3. **`describe('Immersive viewer — Native absent')`**
   - `it('open does not throw when Native is undefined')` — leave `globalThis.Native = undefined`, call `showFullscreen`; assert no throw.
   - `it('close does not throw when Native is undefined')` — same; trigger close; assert no throw.

4. **`describe('Immersive viewer — swipe-to-dismiss')` — only when `RoadTrip.isNativePlatform()` returns true:**
   - `it('pointerdown + pointermove + pointerup with dy > 100 dismisses')` — stub `RoadTrip.isNativePlatform = () => true`, dispatch synthetic Pointer Events, assert `closeOverlay` runs (e.g., overlay parent becomes null).
   - `it('pointerup with dy < 100 snaps back (no dismiss)')` — same setup but small drag; assert overlay still present.
   - `it('pointerdown on a chrome button does not start a drag')` — start pointer on `.fullscreen-close`; move; up; assert overlay translation never changed.
   - `it('does not attach pointer listeners when not on iOS')` — stub `isNativePlatform = () => false`, dispatch Pointer Events, assert overlay unchanged.

**Verification:**

Run: `npm test -- tests/js/photoCarousel`
Expected: all new tests pass plus Phase 2's existing tests in this file.

**Commit:**

```bash
git add tests/js/photoCarousel.test.js
git commit -m "test(carousel): cover viewer status-bar restore, chrome toggle, swipe

New describe blocks for the immersive viewer:
- Status bar: 'light' on open; 'dark' on every close path; survives a
  thrown removeChild (AC5.5 try/finally proof); re-entry is harmless.
- Chrome auto-hide: backdrop tap toggles .chrome-hidden; chrome-button
  taps do NOT.
- Native absent: viewer open + close don't throw without nativeBridge.
- Swipe-to-dismiss (iOS only): >100px or >0.5 px/ms triggers close;
  smaller drag snaps back; chrome-button drags don't start the gesture."
```
<!-- END_TASK_7 -->
<!-- END_SUBCOMPONENT_D -->

---

<!-- START_SUBCOMPONENT_E (tasks 8-9) -->
<!-- START_TASK_8 -->
### Task 8: Build verification — regenerate asset-manifest and bundle

**Type:** Infrastructure verification.

**Step 1:** `npm run build:bundle` — expected: clean, `node --check` passes.

**Step 2:** Commit any regenerated artifacts:

```bash
git add src/RoadTripMap/wwwroot/asset-manifest.json src/RoadTripMap/wwwroot/bundle/
git diff --cached --stat
git commit -m "build: regenerate asset-manifest + bundle for Phase 3 changes"
```

(Skip if no diff.)
<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: Final verification — full JS + .NET tests

**Type:** Infrastructure verification.

**Verifies:** ios-shell-polish.AC8.1, ios-shell-polish.AC8.2.

**Step 1:** `npm test` — full suite passes.
**Step 2:** `dotnet test RoadTripMap.sln` — passes.
**Step 3:** Browser smoke-test: open `/trips/{viewToken}` for a seeded trip in a desktop browser. Header shows the trip name (small inline). Carousel scrolls. Tap a thumbnail → fullscreen viewer opens (90% rgba background — universal browser behavior, NOT the iOS true-black). Tap on overlay → chrome toggles. Click close (×) → viewer closes. Press Escape on a fresh open → viewer closes. Edit-location and delete buttons (if visible on the view route) → behave correctly. No console errors.

**Step 4:** Patrick's manual on-device check:

> "Phase 3 implementation complete. Patrick: please run `npx cap sync ios` locally and verify on device:
> - Map header is translucent with the large trip name visible.
> - Tapping a thumbnail opens the fullscreen viewer with a true-black background and a light status bar.
> - Tap-on-overlay toggles the close/save/edit/delete chrome.
> - Swipe-down dismisses the viewer; status bar returns to dark.
> - Pressing the close (×) button or Escape (external keyboard) dismisses; status bar returns to dark.
> - Tapping Share opens the iOS share sheet (validates Phase 3 + Phase 1 wiring together).
>
> KNOWN BEHAVIOR CHANGE: previously, tap-on-overlay dismissed the viewer. Now it toggles chrome. Dismiss requires the close button, Escape, or swipe-down (iOS).
>
> AC5.1 INTERPRETATION CONFIRMED IN PLAN: The 'collapses on scroll' clause is interpreted as conditional behavior wired to `.map-header.is-collapsed` (Task 2's dormant CSS foundation). trips.html has no scroll trigger today, so the large title is static. If you want a real collapse trigger (carousel interaction, map zoom level threshold, etc.), file as a Phase 6 Task 4 bug-fix item with the desired trigger and Claude can wire it in mapUI."
<!-- END_TASK_9 -->
<!-- END_SUBCOMPONENT_E -->

---

## Phase 3 done-when checklist

- [ ] Task 1: `data-large-title` slot added to `.map-header`; mapUI populates both small and large title slots.
- [ ] Task 2: Translucent `.map-header`, immersive `.fullscreen-overlay` chrome rules (incl. `.chrome-hidden`, `.is-dismissing`, `.fullscreen-close`) in `ios.css`.
- [ ] Task 3: `mapUI.sharePhoto` uses `Native.share`; photo-popup tap fires `Native.haptic('light')`.
- [ ] Task 4: `showFullscreen` flips status bar to `'light'` on open; close routes through try/finally `closeOverlay`; tap on overlay toggles `.chrome-hidden`; explicit close button added.
- [ ] Task 5: Swipe-down to dismiss wired (iOS only) via Pointer Events; closes via `closeOverlay` to inherit try/finally restore.
- [ ] Task 6: `.platform-ios .fullscreen-close` added to consolidated 44×44 tap-target list.
- [ ] Task 7: `photoCarousel.test.js` extended with status-bar / chrome-toggle / swipe / Native-absent coverage.
- [ ] Task 8: Asset manifest + bundle regenerated.
- [ ] Task 9: `npm test` + `dotnet test` pass; browser smoke-tested; Patrick on-device sign-off + decision on AC5.1 dynamic-collapse deferral.
