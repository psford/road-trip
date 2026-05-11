# iOS Shell Polish — Phase 2: post.html — uploader and map polish

**Goal:** Apply the Photos visual language to the trip workhorse: nav-bar header, upload affordance, preview-as-sheet, restyled carousel and toasts. Wire haptics on key interactions, native iOS share sheet, and a native confirm dialog on per-photo delete.

**Architecture:** All visual changes layer on top of the Phase 1 token foundation. iOS-only chrome (sticky translucent nav bar, safe-area-aware header, Photos-style carousel polish) is scoped under `.platform-ios` in `ios.css`. The browser sees the universal token + dark-mode upgrades only. Native plugin calls all flow through the Phase 1 `Native.*` wrapper — no `@capacitor/*` imports from these page modules. Commit-success and commit-failure haptics fire from the single source of truth in `uploadQueue.js` (the state-machine event emitters) so the haptic is exactly one buzz per upload outcome.

**Tech Stack:** vanilla JS (existing `wwwroot/js/*` modules — `postUI.js`, `uploadQueue.js`, `photoCarousel.js`), CSS custom properties from Phase 1, `Native.*` from Phase 1.

**Scope:** Phase 2 of 6 from `docs/design-plans/2026-05-09-ios-shell-polish.md`.

**Codebase verified:** 2026-05-10. See discrepancies below.

**Discrepancies from design:**
- **Subtitle slot already exists** in `post.html:23` as `<p id="tripDescription">` (currently styled `display: none` in mobile, `display: block` on desktop). The design's "add a subtitle slot in the header for trip context" is satisfied by **restyling and revealing** the existing element on iOS, not by adding new markup.
- **Per-photo delete confirm currently happens in `postUI.js:1144`** (`window.confirm('Delete this photo?')`), not in `photoCarousel.js`. The design says "Add `Native.dialogConfirm()` before the existing per-photo delete action" — the replacement is in `postUI.js:onDeleteFromCarousel`, not `photoCarousel.js`.
- **Single source of truth for upload haptics:** the design says "`uploadQueue.js` — emit `Native.haptic('medium')` on commit success" AND `postUI.js`/`postService.js` — call haptic on success/failure. Implementation chooses **`uploadQueue.js` only** (the state-machine event emitter at line 667 / 709) so the haptic fires exactly once per outcome regardless of how many subscribers listen to `upload:committed` / `upload:failed`.
- **`photoCarousel.test.js` does not exist** — the design says "extend coverage" but there's no file to extend. Phase 2 creates this test file from scratch.
- **post.html has no inline `<script>` blocks** — every script is `<script src=...>`. No IIFE wrapping concern in this phase.

**Recommended skills for executor (activate before starting):**
- `ed3d-house-style:writing-good-tests`
- `ed3d-house-style:coding-effectively`
- `ed3d-house-style:defense-in-depth` (every Native.* call site must guard against `globalThis.Native` being undefined for graceful web-side behavior)
- `ed3d-plan-and-execute:verification-before-completion`

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ios-shell-polish.AC4: post.html — visual, chrome, interactions
- **ios-shell-polish.AC4.1 Success:** `.page-header` renders as a translucent sticky nav bar on iOS with safe-area inset preserved.
- **ios-shell-polish.AC4.2 Success:** Add-Photo, Cancel, and Post-Photo controls fire `Native.haptic('light')` on tap.
- **ios-shell-polish.AC4.3 Success:** Upload commit success fires `Native.haptic('medium')`; upload failure fires `Native.haptic('error')`.
- **ios-shell-polish.AC4.4 Success:** Per-photo share uses `Native.share()`.
- **ios-shell-polish.AC4.5 Success:** Per-photo delete shows `Native.dialogConfirm()` and only deletes on confirm.
- **ios-shell-polish.AC4.6 Failure:** Cancelling the delete confirm leaves the photo intact.

### ios-shell-polish.AC3: Native plugin wiring (AC3.3, AC3.4 — completing partial Phase 1 coverage)
- **ios-shell-polish.AC3.3 Success:** `Native.share({ title, url })` opens the native iOS share sheet.
- **ios-shell-polish.AC3.4 Success:** `Native.dialogConfirm({ title, message })` shows a native iOS alert and resolves to `{ value: boolean }`.

(Note: AC3.3 and AC3.4 web-side fallback behavior was unit-tested in Phase 1 via `nativeBridge.test.js`. Phase 2 adds the call-site coverage proving Phase 2 actually invokes those wrappers. The on-iOS validation that the share sheet and alert open natively is exercised during Phase 6 sign-off.)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Restyle `.page-header`, `.add-photo-button`, `.preview-section`, `.post-button-group`, `.photo-list`, `.toast-container` in `styles.css`

**Type:** Functionality (visual; no behavior change).

**Verifies:** ios-shell-polish.AC4.1 (universal token application — the iOS-specific sticky/translucent layer comes in Task 2), ios-shell-polish.AC9.3 (browser sees the upgrade as universal polish only).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/css/styles.css` — selectors at the line ranges captured by investigator (the executor should verify with `grep -n "^\.page-header" src/RoadTripMap/wwwroot/css/styles.css` etc. before editing; the investigator-reported ranges below are accurate as of 2026-05-10):
  - `.page-header` lines 547–619
  - `.add-photo-button` lines 627–639
  - `.preview-section` lines 642–720
  - `.post-button-group` lines 717–728
  - `.photo-list` lines 762–774
  - `.toast-container` lines 793–852

**Implementation guidance:**

This task is a **token swap, not a redesign**. The header layout, button positions, card structures, and toast behavior all stay the same. What changes:

1. **Replace hardcoded color literals with semantic tokens** wherever feasible. Examples (executor: search-and-replace by intent, not blindly):
   - Background literals like `#fff`, `white` → `var(--color-surface)`.
   - Body text literals like `#2d3436` → `var(--color-text)`.
   - Primary/accent button backgrounds tied to brand → `var(--color-primary)` (already done in legacy code) — leave these alone unless they reference an interactive control that should be system-blue on iOS, in which case use `var(--color-accent)` (browsers see brand teal, iOS sees `#007AFF` thanks to Phase 1 Task 4).
   - Border/separator literals → `var(--color-separator)`.
   - Subtle background fills (e.g., subdued button hovers, disabled states) → `var(--color-fill-secondary)` / `var(--color-fill-tertiary)`.
2. **Replace ad-hoc font sizes** in these selectors with the type-scale tokens from Phase 1 (`var(--font-size-headline)` for primary buttons, `var(--font-size-body)` for body copy, `var(--font-size-footnote)` for toast captions, etc.).
3. **Replace ad-hoc transition durations** like `transition: 0.2s ease` with `transition: var(--motion-duration-fast) var(--motion-ease-standard)`.
4. **Replace ad-hoc border-radius** values: card-like elements → `var(--radius-md)`, sheet/preview sections → `var(--radius-lg)`, full-circle controls → `var(--radius-full)`. Leave `var(--radius)` (legacy 8px) alone where it's already in use.
5. **Reveal the subtitle slot on all viewports** — the `#tripDescription` element at `post.html:23` is currently `display: none` on mobile. Update `.page-header p` selector(s) so the element is shown when populated. If the subtitle is empty, it should not introduce vertical space (use `:empty { display: none }` or set the JS-side population in postUI.js — but since this phase shouldn't change postUI's tripDescription code, prefer the `:empty` CSS approach).

**Do NOT:**
- Change any selector name (would break JS hooks).
- Change any layout dimension that affects the existing test snapshots (none exist for these selectors today, but: if a future visual snapshot is added it should be against the new design, not the old).
- Touch `.fullscreen-overlay` (Phase 3 owns the immersive viewer).
- Touch `.carousel-strip`, `.carousel-item`, `.carousel-action-btn` (Phase 3 restyles those — the design reads "post.html" but the carousel selectors are shared with trips.html and Phase 3 owns them per the design's Components list).

**Verification:**

Run: `npm test`
Expected: 607+ baseline (plus Phase 1 nativeBridge tests) all pass. No visual snapshots exist for these selectors.

Manual visual check (executor): start the .NET app (`dotnet run --project src/RoadTripMap`), navigate to `/post/{some-token}` in a desktop browser, light + dark mode. The header, upload button, preview, post button group, photo list, and toasts should look refreshed (consistent type, consistent spacing, dark-mode legible) but not broken. Brand color (teal) for primary CTAs should still appear in the browser.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/css/styles.css
git commit -m "feat(post-css): apply universal tokens to post.html selectors

Token swap (no layout changes) for .page-header, .add-photo-button,
.preview-section, .post-button-group, .photo-list, .toast-container:
hardcoded literals replaced with semantic-color, type-scale, motion,
and radius tokens from Phase 1. Subtitle slot revealed on all viewports
(was mobile-hidden) so the iOS sticky-nav-bar treatment in Task 2 has
a slot to show trip context."
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add `.platform-ios` overrides for `.page-header` and post.html chrome in `ios.css`

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC4.1 (translucent sticky nav bar with safe-area inset), ios-shell-polish.AC9.3.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/ios.css` — append a new `/* Phase 2: post.html chrome */` section at the end.

**Implementation:**

The browser version of `.page-header` (Task 1) is the universal Photos-tinted look. iOS layers on top: sticky positioning, translucent material with `backdrop-filter`, safe-area-aware top padding, and explicit chrome height that matches iOS large-title nav-bar conventions.

Add this block (verbatim — these values come from Apple HIG nav-bar sizing):

```css
/* Phase 2: post.html chrome (also applies to create.html when Phase 4 lands) */
.platform-ios .page-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background-color: var(--material-bg-light);
  backdrop-filter: var(--material-blur-regular);
  -webkit-backdrop-filter: var(--material-blur-regular);
  border-bottom: 0.5px solid var(--color-separator);
  padding-top: calc(env(safe-area-inset-top, 0px) + var(--space-sm));
  padding-bottom: var(--space-sm);
}

@media (prefers-color-scheme: dark) {
  .platform-ios .page-header {
    background-color: var(--material-bg-dark);
    border-bottom-color: var(--color-separator);
  }
}

.platform-ios .page-header h1 {
  font-size: var(--font-size-title-1);
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.01em;
}

.platform-ios .page-header p {
  font-size: var(--font-size-subhead);
  color: var(--color-text-secondary);
}

.platform-ios .page-header .nav a {
  color: var(--color-accent);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-regular);
  text-decoration: none;
}
```

Notes:
- `position: sticky` + `top: 0` is the documented iOS nav-bar pattern. The header stays pinned as content scrolls beneath it.
- `backdrop-filter: blur(...)` is the translucency. `-webkit-backdrop-filter` is required for iOS Safari (the WebKit prefix has not been removed from iOS Safari as of iOS 18). Both must be present.
- `padding-top: calc(env(safe-area-inset-top, 0px) + var(--space-sm))` keeps the title text below the iPhone notch / Dynamic Island. The fallback `0px` covers older iOS versions and non-iPhone surfaces.
- `border-bottom: 0.5px solid` matches the iOS hairline (1px in CSS becomes 2 device pixels on retina; 0.5px renders as 1 device pixel, matching native).
- `--color-accent` for the back-link is the system-blue from Phase 1 Task 4 (`#007AFF` light, `#0A84FF` dark).

**Other post.html chrome on iOS** (append in the same section):

```css
.platform-ios .add-photo-button {
  background-color: var(--color-accent);
  color: #ffffff;
  border-radius: var(--radius-md);
  font-size: var(--font-size-headline);
  font-weight: var(--font-weight-semibold);
  transition: transform var(--motion-duration-instant) var(--motion-ease-standard);
}
.platform-ios .add-photo-button:active {
  transform: scale(0.97);
}

.platform-ios .preview-section {
  border-radius: var(--radius-lg);
  background-color: var(--color-surface);
}

.platform-ios .post-button-group .button-primary,
.platform-ios .post-button-group .button-secondary {
  border-radius: var(--radius-md);
  font-size: var(--font-size-headline);
  font-weight: var(--font-weight-semibold);
}

.platform-ios .toast-container {
  bottom: calc(env(safe-area-inset-bottom, 0px) + var(--space-md));
}
```

Notes:
- The `:active { transform: scale(0.97) }` is the iOS-style press-in feedback. Standard for iOS "card" controls.
- Toast container respects bottom safe-area so notifications don't sit under the home indicator.

**Verification:**

Run: `npm test`
Expected: full suite passes.

Manual visual check on iOS shell (after Patrick's `npx cap sync ios` + Xcode build): post.html nav bar is translucent, blurred, sticks to the top during scroll, leaves the iPhone notch area visible. Back link is system-blue. Add-Photo button has the Apple Photos-tile feel (rounded, system-blue, presses inward on tap). Toast notifications float above the home indicator.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/ios.css
git commit -m "feat(ios.css): translucent sticky nav bar + chrome polish for post.html

.platform-ios .page-header becomes a sticky translucent material with
safe-area-aware top padding, hairline border, and system-blue back link.
Add-Photo / preview / post-button-group / toast-container get iOS-style
radii, type, and safe-area treatment. All scoped under .platform-ios so
browser users keep the universal Phase 1 polish only."
```
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

---

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->
<!-- START_TASK_3 -->
### Task 3: Wire `Native.haptic('light')` into Add-Photo, Cancel, Post-Photo button handlers in `postUI.js`

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC4.2.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js` — handlers at lines 31, 46, 50 (executor: verify with `grep -n "addPhotoButton\|cancelButton\|postButton" src/RoadTripMap/wwwroot/js/postUI.js` before editing).

**Implementation:**

At each of the three click handlers, fire-and-forget a `Native.haptic('light')` call before the handler does its existing work. The call must be defensive — `globalThis.Native` may be undefined in a test environment that doesn't load nativeBridge.js, and on web Native.haptic is a documented no-op (Phase 1) but the wrapper itself needs to exist.

Pattern (apply at all three sites):

```javascript
// Before existing body of each handler:
if (globalThis.Native && typeof globalThis.Native.haptic === 'function') {
    void globalThis.Native.haptic('light');
}
// existing handler body (e.g., document.getElementById('fileInput').click())
```

The `void` discards the returned promise; we don't `await` because:
- The user-facing action (file picker open, preview hide, post confirm) should not be delayed by haptic feedback.
- An iOS plugin failure is non-fatal; the existing handler must still run.

**Tests** (extend `tests/js/postUI-upload.test.js` — verify it exists with `ls tests/js/postUI-upload.test.js`; if it doesn't, the executor creates `tests/js/postUI.test.js`):

Add inside the existing describe block(s) for postUI:
- `it('Add-Photo button click fires Native.haptic("light")')` — set up `globalThis.Native = { haptic: vi.fn() }`, render the button, click it, assert `Native.haptic` was called with `'light'`.
- `it('Cancel button click fires Native.haptic("light")')` — same pattern.
- `it('Post-Photo button click fires Native.haptic("light")')` — same pattern.
- `it('Native.haptic absence does not break button handlers')` — leave `globalThis.Native = undefined`, click each button, assert no throw and the existing handler logic still runs (e.g., `fileInput.click()` was triggered).

**Verification:**

Run: `npm test -- tests/js/postUI`
Expected: existing postUI tests still pass, new tests pass.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/js/postUI.js tests/js/postUI-upload.test.js
git commit -m "feat(postUI): Native.haptic('light') on Add-Photo/Cancel/Post-Photo tap

Defensive call shape (Native may be undefined in unit tests). Fire-and-
forget — never delay or fail user actions on a haptic plugin error."
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Wire `Native.haptic('medium')` and `Native.haptic('error')` into `uploadQueue.js` state-machine emitters

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC4.3.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/uploadQueue.js` — `_markCommitted` (function declaration at line 650, dispatches `upload:committed` at line 668), `_markFailed` (function declaration at line 693, dispatches `upload:failed` at line 710). Executor: verify with `grep -n "_markCommitted\|_markFailed\|upload:committed\|upload:failed" src/RoadTripMap/wwwroot/js/uploadQueue.js` before editing.

**Implementation:**

In `_markCommitted`, immediately after the `document.dispatchEvent(new CustomEvent('upload:committed', ...))` call, fire-and-forget a `Native.haptic('medium')`. Use the same defensive shape from Task 3.

In `_markFailed`, immediately after the `document.dispatchEvent(new CustomEvent('upload:failed', ...))` call, fire-and-forget a `Native.haptic('error')`.

**Pre-edit verification step (DO THIS FIRST):** the grep above will likely show **three** `upload:failed` dispatch sites — `_markFailed` at line 710 (terminal failure) plus two earlier sites (around lines 161 and 227) that fire during pre-`_markFailed` flows (e.g., SAS-request validation failure, pre-retry block-upload failure). The "single source of truth" intent of this task is that the haptic fires once per terminal failure. The executor MUST verify whether the earlier two `upload:failed` dispatches always feed into `_markFailed` (in which case `_markFailed` is the only haptic site needed) OR whether they can fire as standalone terminal failures (in which case all three need haptics). Read each of the three call sites and trace the call graph. If the earlier sites are non-terminal (always followed by retry → eventual `_markFailed`), continue with the plan as written. If any earlier site is terminal, add a `Native.haptic('error')` there too (matching the same defensive shape) and document the additional sites in the commit message.

Pattern:

```javascript
// In _markCommitted, after the existing dispatchEvent('upload:committed'):
if (globalThis.Native && typeof globalThis.Native.haptic === 'function') {
    void globalThis.Native.haptic('medium');
}

// In _markFailed, after the existing dispatchEvent('upload:failed'):
if (globalThis.Native && typeof globalThis.Native.haptic === 'function') {
    void globalThis.Native.haptic('error');
}
```

**Why here and not in postUI:**
- `_markCommitted` and `_markFailed` are the single state-machine transitions that mark an upload as committed or failed. Listeners (postUI, telemetry, future modules) react after these transitions; they should not also buzz.
- One buzz per outcome regardless of how many subscribers are listening.

**Tests** (extend `tests/js/uploadQueue.test.js`):

- `it('emits Native.haptic("medium") when an upload commits successfully')` — set `globalThis.Native = { haptic: vi.fn() }`, run the state machine through a full success path (existing test fixtures already do this), assert `Native.haptic` was called with `'medium'` exactly once after success.
- `it('emits Native.haptic("error") when an upload fails permanently')` — drive the queue through a non-recoverable failure path (existing tests have this), assert `Native.haptic('error')` called exactly once.
- `it('Native.haptic absence does not interfere with the state machine')` — leave `globalThis.Native` undefined, run a success and a failure flow, assert both transitions complete normally and no error is thrown.

**Verification:**

Run: `npm test -- tests/js/uploadQueue`
Expected: 895-line file's existing coverage holds; new tests pass.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/js/uploadQueue.js tests/js/uploadQueue.test.js
git commit -m "feat(uploadQueue): haptic feedback on commit success / permanent failure

State-machine-emitter pattern: one buzz per outcome. _markCommitted fires
Native.haptic('medium'), _markFailed fires Native.haptic('error'), each
right after the corresponding 'upload:committed' / 'upload:failed' event
dispatch. Defensive call shape — Native absence is a no-op."
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Replace `navigator.share()` with `Native.share()` in `photoCarousel.js`

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC4.4, ios-shell-polish.AC3.3 (call-site coverage for the iOS share-sheet wrapper).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/photoCarousel.js` — `handleSave` function at lines 130–149 (executor: verify with `grep -n "navigator.share\|handleSave" src/RoadTripMap/wwwroot/js/photoCarousel.js`).

**Implementation:**

Currently `handleSave` checks `if (typeof navigator.share === 'function')` and calls `navigator.share({ title, url })` directly. Replace the share call with `Native.share()`:

```javascript
async handleSave(photo) {
    const url = photo.originalUrl;
    const title = photo.placeName || 'Photo';
    if (globalThis.Native && typeof globalThis.Native.share === 'function') {
        await globalThis.Native.share({ title, url });
        return;
    }
    // Fall through to existing download-only path when Native is unavailable
    // (e.g., a unit test that didn't load nativeBridge.js)
    // ... existing download fallback at lines 140-148 ...
}
```

The Phase 1 `Native.share` already encapsulates:
- iOS path: `Share.share(payload)` opens the native share sheet (AC3.3).
- Web path: `navigator.share()` if available, else copy URL to clipboard.
- Cancel handling: AbortError silently resolved.

So this task is a straight delegation. The existing fallback (download the original file) only runs when `Native` itself is missing (test environments that don't load nativeBridge.js).

**Important:** Per CLAUDE.md, `RoadTrip.appOrigin()` must be used for any user-facing URL assembly. Verify `photo.originalUrl` is constructed via `RoadTrip.appOrigin()` upstream in the carousel data flow — if it isn't, this task discovers a pre-existing leak (`window.location.origin` would surface `capacitor://localhost` in shared URLs). If you find such a leak in the carousel data flow, **stop and surface to user** — fixing it is a scope-question (likely belongs in a small follow-up commit, not Phase 2).

**Tests** (create new `tests/js/photoCarousel.test.js` — investigator confirmed this file does not exist):

Set up minimal carousel fixtures (one photo with `originalUrl`, `placeName`). Stub `globalThis.Native = { share: vi.fn().mockResolvedValue(undefined) }`. Tests:

- `it('handleSave delegates to Native.share with title and url')` — call `handleSave(photo)`, assert `Native.share` called with `{ title: photo.placeName, url: photo.originalUrl }`.
- `it('handleSave with photo lacking placeName uses "Photo" as title')` — same payload check with title === `'Photo'`.
- `it('handleSave falls back to download when Native is unavailable')` — leave `Native` undefined, assert the download path is taken (e.g., a stubbed link-creation spy is called).
- `it('handleSave does not throw if Native.share rejects')` — set `Native.share = vi.fn().mockRejectedValue(new Error('cancelled'))`, call `handleSave`, assert no throw.

**Verification:**

Run: `npm test -- tests/js/photoCarousel`
Expected: new test file passes.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/js/photoCarousel.js tests/js/photoCarousel.test.js
git commit -m "feat(carousel): delegate per-photo share to Native.share()

photoCarousel.handleSave now calls Native.share, which on iOS opens the
native share sheet (UIActivityViewController) and on web falls through to
navigator.share or clipboard. Existing download-only fallback retained
for environments without Native (unit tests).

New test file tests/js/photoCarousel.test.js covers the share path
(no prior coverage existed)."
```
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

---

<!-- START_SUBCOMPONENT_C (tasks 6) -->
<!-- START_TASK_6 -->
### Task 6: Replace `window.confirm` with `Native.dialogConfirm` in `postUI.js:onDeleteFromCarousel`

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC4.5, ios-shell-polish.AC4.6 (cancel keeps photo intact), ios-shell-polish.AC3.4 (call-site coverage for the iOS dialogConfirm wrapper).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js` — `onDeleteFromCarousel` at lines 1143–1152 (executor: verify with `grep -n "onDeleteFromCarousel\|Delete this photo" src/RoadTripMap/wwwroot/js/postUI.js`).

**Implementation:**

Current:
```javascript
async onDeleteFromCarousel(photo) {
    if (!confirm('Delete this photo?')) return;
    try {
        await PostService.deletePhoto(this.secretToken, photo.id);
        this.showToast('Photo deleted', 'success');
        await this.refreshPhotoList();
    } catch (err) {
        this.showToast('Failed to delete photo', 'error');
    }
}
```

Replace the `confirm(...)` call with `Native.dialogConfirm()`. Phase 1's wrapper:
- On iOS: shows the native iOS alert via `Dialog.confirm()` (AC3.4).
- On web: falls through to `window.confirm(message)`.
- Returns `Promise<{ value: boolean }>`.

New shape:

```javascript
async onDeleteFromCarousel(photo) {
    if (!globalThis.Native || typeof globalThis.Native.dialogConfirm !== 'function') {
        // Native wrapper missing (e.g., test env that didn't load nativeBridge);
        // fall back to window.confirm so the safety check is preserved.
        if (!window.confirm('Delete this photo?')) return;
    } else {
        const result = await globalThis.Native.dialogConfirm({
            title: 'Delete photo?',
            message: 'This cannot be undone.',
            okButtonTitle: 'Delete',
            cancelButtonTitle: 'Cancel',
        });
        if (!result || result.value !== true) return;
    }
    try {
        await PostService.deletePhoto(this.secretToken, photo.id);
        this.showToast('Photo deleted', 'success');
        await this.refreshPhotoList();
    } catch (err) {
        this.showToast('Failed to delete photo', 'error');
    }
}
```

Notes:
- The native dialog uses a more deliberate copy ("Delete photo?" / "This cannot be undone." / "Delete" / "Cancel") to match Apple HIG destructive-action conventions.
- The check `result && result.value === true` is intentionally strict — anything other than an explicit confirm (cancel, dismiss, reject) leaves the photo intact (AC4.6).
- The `else` branch (Native unavailable) is for unit-test environments only; in production both web and iOS go through the `Native.dialogConfirm` wrapper, which itself falls through to `window.confirm` on web. The redundancy is intentional defense-in-depth.

**Tests** (extend `tests/js/postUI-upload.test.js` or create `tests/js/postUI-delete.test.js`):

- `it('onDeleteFromCarousel calls Native.dialogConfirm and deletes on confirm')` — stub `globalThis.Native = { dialogConfirm: vi.fn().mockResolvedValue({ value: true }) }`, stub `PostService.deletePhoto = vi.fn().mockResolvedValue(undefined)`; call `onDeleteFromCarousel(photo)`; assert dialogConfirm called with the documented payload, deletePhoto called.
- `it('onDeleteFromCarousel does not delete when user cancels')` — stub dialogConfirm to resolve `{ value: false }`; assert deletePhoto NOT called, no toast.
- `it('onDeleteFromCarousel does not delete when dialog returns null/undefined')` — stub dialogConfirm to resolve `null`; assert deletePhoto NOT called.
- `it('onDeleteFromCarousel falls back to window.confirm when Native is unavailable')` — leave `Native` undefined, stub `window.confirm = vi.fn(() => true)`, stub deletePhoto; assert confirm called and deletePhoto called.
- `it('onDeleteFromCarousel shows error toast when delete API fails')` — stub dialogConfirm true, stub deletePhoto to reject, assert error toast shown.

**Verification:**

Run: `npm test -- tests/js/postUI`
Expected: existing postUI suite passes plus new delete tests.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/js/postUI.js tests/js/postUI-upload.test.js
git commit -m "feat(postUI): native confirm dialog before per-photo delete

onDeleteFromCarousel now calls Native.dialogConfirm with HIG-style copy
(title 'Delete photo?', destructive button 'Delete'). On iOS this surfaces
the native UIAlertController; on web it falls through to window.confirm
via the Native wrapper. Cancel/dismiss leaves the photo intact (AC4.6).

window.confirm fallback retained as defense-in-depth for test environments
that don't load nativeBridge.js."
```
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_C -->

---

<!-- START_SUBCOMPONENT_D (tasks 7-8) -->
<!-- START_TASK_7 -->
### Task 7: Build verification — regenerate asset-manifest and bundle

**Type:** Infrastructure verification.

**Verifies:** None directly (supports AC9.2 by ensuring the iOS shell asset pre-cache picks up the modified files).

**Files:**
- Possibly modify: `src/RoadTripMap/wwwroot/asset-manifest.json` (regenerated)
- Possibly modify: `src/RoadTripMap/wwwroot/bundle/*` (regenerated)

**Step 1:** `npm run build:bundle`
Expected: clean run, `node --check` succeeds.

**Step 2:** Commit any regenerated artifacts:

```bash
git add src/RoadTripMap/wwwroot/asset-manifest.json src/RoadTripMap/wwwroot/bundle/
git diff --cached --stat
git commit -m "build: regenerate asset-manifest + bundle for Phase 2 source changes"
```

If `git diff --cached --stat` shows no changes (because file-content sha256s of the touched JS files happened to be identical, which is unlikely after Phase 2's edits), skip the commit.
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Final verification — full JS test suite + .NET test suite

**Type:** Infrastructure verification.

**Verifies:** ios-shell-polish.AC8.1, ios-shell-polish.AC8.2, ios-shell-polish.AC8.3 (browser behavior unchanged when polish is disabled — universal-only browser path).

**Step 1:** `npm test` — expected: full suite passes.

**Step 2:** `dotnet test RoadTripMap.sln` — expected: passes (no .NET changes in Phase 2; this is the AC8.2 gate).

**Step 3:** Manual browser check (executor): start the .NET app (`dotnet run --project src/RoadTripMap`), open `/post/{token}` for a real or seeded trip in a desktop browser. Verify in DevTools console: no errors, no missing-asset 404s. Click Add-Photo, Cancel, Post-Photo — handlers run normally (no haptic in browser, but no error either). Open per-photo delete — `window.confirm` dialog appears (browser path), confirm/cancel both behave correctly.

**Step 4:** Patrick's manual on-device check (out of executor scope) — record the ask in the final task report:

> "Phase 2 implementation complete. Patrick: please run `npx cap sync ios` locally and verify on device: post.html nav-bar is translucent + sticky; Add-Photo / Cancel / Post buttons buzz on tap; uploading a photo buzzes again on commit; tapping Share opens the iOS share sheet; tapping per-photo delete opens the iOS native confirm dialog and Cancel keeps the photo."

No commit required for this task.
<!-- END_TASK_8 -->
<!-- END_SUBCOMPONENT_D -->

---

## Phase 2 done-when checklist

- [ ] Task 1: Universal token swap applied to post.html selectors in styles.css.
- [ ] Task 2: `.platform-ios .page-header` and post.html chrome polished in ios.css (sticky, translucent, safe-area-aware).
- [ ] Task 3: Native.haptic('light') wired into Add-Photo, Cancel, Post-Photo handlers.
- [ ] Task 4: Native.haptic('medium') and Native.haptic('error') wired into uploadQueue.js state-machine emitters.
- [ ] Task 5: Native.share() replaces navigator.share in photoCarousel.js; new test file created.
- [ ] Task 6: Native.dialogConfirm() replaces window.confirm in postUI.js per-photo delete; cancel keeps photo intact.
- [ ] Task 7: Asset manifest + bundle regenerated and committed if changed.
- [ ] Task 8: `npm test` + `dotnet test` both pass; browser smoke-tested.
- [ ] **Patrick:** `npx cap sync ios` + on-device validation of haptics, share sheet, and confirm dialog.
