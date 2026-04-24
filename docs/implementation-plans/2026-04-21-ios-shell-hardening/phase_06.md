# iOS Shell Hardening — Phase 6: Safe-area comprehensive pass

**Goal:** Every fixed/sticky/top/bottom surface on every `wwwroot/*.html` page respects iOS safe-area insets on a notched iPhone and an iPhone with a home indicator. Regular-browser users see no change (rules scoped under `.platform-ios`).

**Architecture:** Two categories of change, both additive:

1. **Viewport meta** — add `viewport-fit=cover` to every `wwwroot/*.html` viewport tag. This is required before `env(safe-area-inset-*)` returns non-zero values on iOS.
2. **CSS rules** — add `.platform-ios`-scoped rules to `src/RoadTripMap/wwwroot/ios.css` for the 8 Phase 6 target selectors. Top-inset targets use `padding-top: env(safe-area-inset-top)` (additive to existing padding); bottom-inset targets use `padding-bottom: env(safe-area-inset-bottom)`; `.map-control` uses `bottom: calc(30px + env(safe-area-inset-bottom))` because its baseline offset is hardcoded, not padding-based; `.homescreen-modal-overlay` gets both top and bottom.

The iOS shell's `src/bootstrap/loader.js:62–70` already re-injects `<link data-ios-css>` after every swap (Phase 5 of the prior plan); Phase 6 adds rules to the file and the re-injection picks them up unchanged. `document.body.classList.add('platform-ios')` runs at `src/bootstrap/loader.js:5`, before first paint — confirmed active when Phase 6's rules evaluate.

**Tech Stack:** HTML + CSS only.

**Scope:** Phase 6 of 8 from `docs/design-plans/2026-04-21-ios-shell-hardening.md`.

**Codebase verified:** 2026-04-22 (branch `ios-offline-shell`).

**Branch:** `ios-offline-shell` (same as Phases 1–5).

**Dependencies:** Phase 2 (unrelated but clean ordering — the design lists Phase 2 as a soft prerequisite).

---

## Acceptance Criteria Coverage

### ios-shell-hardening.AC6: iOS safe-areas + HIG compliance (safe-area subgroup)

- **ios-shell-hardening.AC6.safeArea.1 Success:** Every `wwwroot/*.html` viewport meta contains `viewport-fit=cover`.
- **ios-shell-hardening.AC6.safeArea.2 Success:** On a notched iPhone, `.map-header`, `.page-header`, `.hero`, `.resume-banner` all clear the status bar visually.
- **ios-shell-hardening.AC6.safeArea.3 Success:** On iPhone with home indicator, `.toast-container`, `.view-carousel-container`, `.map-control` all clear the home indicator.
- **ios-shell-hardening.AC6.safeArea.4 Success:** `.homescreen-modal-overlay` padding accounts for both top and bottom safe-areas.

AC6.safeArea.2–4 are operational (visual) — on-device verification is captured in Phase 8's smoke checklist. Phase 6 unit tests verify the CSS rules and viewport metas exist (AC6.safeArea.1 directly; AC6.safeArea.2–4 by rule-presence assertion).

---

## Codebase baseline (verified 2026-04-22)

- **Viewport metas (all 4 wwwroot HTML files):** all currently set to `<meta name="viewport" content="width=device-width, initial-scale=1.0">` at line 5. None has `viewport-fit=cover`. The Capacitor shell's `src/bootstrap/index.html:5` DOES have it — only App-Service-served pages need updating.
- **`src/RoadTripMap/wwwroot/ios.css`:** 64 lines, universally scoped under `.platform-ios`. Currently contains 7 rule blocks: `.map-container / #map` safe-area padding (lines 13–22), HIG 44×44 tap-target minimums for specific upload/resume/carousel buttons (lines 24–32), font stack, rubber-band disable, tap-highlight disable, text-size inflation disable, and a `::before` glasses emoji for viewer-role trip cards.
- None of the 8 Phase 6 target selectors currently have rules in `ios.css`. All 8 are DOM-present on at least one page (verified via `styles.css` and HTML grep):
  - `.map-header` → `trips.html:13` (fixed header, `position: fixed; top: 0`).
  - `.page-header` → `create.html:12`, `post.html:16` (not fixed; has `padding: var(--space-xs) var(--space-sm)` in `styles.css:547–557`).
  - `.hero` → `index.html:12` (not fixed; `padding: var(--space-xl) var(--space-md) var(--space-lg)` in `styles.css:475–482`).
  - `.resume-banner` → injected by `src/RoadTripMap/wwwroot/js/resumeBanner.js:22` on post page (sticky, `top: 0` per `styles.css:1518–1526`).
  - `.toast-container` → `post.html:95` (fixed, `bottom: var(--space-md); right: var(--space-md)` per `styles.css:793–799`).
  - `.view-carousel-container` → `trips.html:23` (fixed, `bottom: 0; left: 0; right: 0`, `padding: var(--space-xs) 0` per `styles.css:1103–1114`).
  - `.map-control` → `trips.html:19,20` (fixed, `bottom: 30px; right: 10px` hardcoded per `styles.css:906–920`).
  - `.homescreen-modal-overlay` → JS-injected by `postUI.js` (fixed, `inset: 0`, `padding: var(--space-md)` per `styles.css:344–353`).
- `styles.css` has responsive padding overrides at 480/768/1024px breakpoints for `.hero` and `.page-header`. Phase 6's additive `padding-top` does NOT collide with these — it just stacks atop whatever padding is in effect at the breakpoint.

---

## Tasks

<!-- START_TASK_1 -->
### Task 1: Add `viewport-fit=cover` to every `wwwroot/*.html` viewport meta

**Verifies:** ios-shell-hardening.AC6.safeArea.1 (implementation; assertion in Task 3).

**Files (4 files, one-line change each):**
- Modify: `src/RoadTripMap/wwwroot/index.html:5`
- Modify: `src/RoadTripMap/wwwroot/create.html:5`
- Modify: `src/RoadTripMap/wwwroot/post.html:5`
- Modify: `src/RoadTripMap/wwwroot/trips.html:5`

**Change (identical across all 4 files):**

Current:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```

Target:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

**Non-goals:**
- Do NOT change any other meta tag.
- Do NOT edit `src/bootstrap/index.html` (already has `viewport-fit=cover` per Capacitor webDir baseline).

**Verification:**
- `grep -l 'viewport-fit=cover' src/RoadTripMap/wwwroot/*.html` → 4 matches.
- `grep -L 'viewport-fit=cover' src/RoadTripMap/wwwroot/*.html` → 0 matches (file list excluding those with the match).

**Commit:** `chore(wwwroot): add viewport-fit=cover to every page for safe-area inset support`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add safe-area CSS rules to `src/RoadTripMap/wwwroot/ios.css`

**Verifies:** ios-shell-hardening.AC6.safeArea.2, ios-shell-hardening.AC6.safeArea.3, ios-shell-hardening.AC6.safeArea.4 (implementation; rule-presence assertion in Task 3).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/ios.css` — append a new section after the existing rules (after line 64).

**Change — append the following block verbatim (one blank line before for readability):**

```css

/*
 * Phase 6: safe-area insets for notched iPhones / home indicators.
 * All rules are scoped under .platform-ios so regular-browser users see no change.
 * env(safe-area-inset-*) returns 0 on non-notched devices; rules remain benign.
 */

/* Top-inset: elements pinned (or close) to the top of the viewport. */

.platform-ios .map-header {
    /* Fixed header at top: 0. Push content down by the status-bar height. */
    padding-top: env(safe-area-inset-top);
}

.platform-ios .page-header {
    /* Non-fixed header; additive to the existing padding in styles.css. */
    padding-top: calc(var(--space-xs) + env(safe-area-inset-top));
}

.platform-ios .hero {
    /* Non-fixed hero; additive to the existing padding in styles.css. */
    padding-top: calc(var(--space-xl) + env(safe-area-inset-top));
}

.platform-ios .resume-banner {
    /* Sticky at top: 0. Push banner body below the status bar. */
    padding-top: calc(var(--space-sm) + env(safe-area-inset-top));
}

/* Bottom-inset: elements pinned to the bottom of the viewport. */

.platform-ios .toast-container {
    /* Fixed, bottom: var(--space-md). Lift above the home indicator. */
    bottom: calc(var(--space-md) + env(safe-area-inset-bottom));
}

.platform-ios .view-carousel-container {
    /* Fixed, bottom: 0; existing padding top/bottom is var(--space-xs). Additive. */
    padding-bottom: calc(var(--space-xs) + env(safe-area-inset-bottom));
}

.platform-ios .map-control {
    /* Fixed at bottom: 30px (hardcoded). Lift above the home indicator. */
    bottom: calc(30px + env(safe-area-inset-bottom));
}

/* Both top and bottom: fullscreen modal overlays. */

.platform-ios .homescreen-modal-overlay {
    /* inset: 0 fullscreen; pad the inner viewport to avoid notch + home indicator overlap. */
    padding-top: calc(var(--space-md) + env(safe-area-inset-top));
    padding-bottom: calc(var(--space-md) + env(safe-area-inset-bottom));
}
```

**Rationale for each rule:**
- `.map-header` → its base `padding` is `0 var(--space-lg)` (horizontal only, zero vertical). Adding `padding-top` is clean.
- `.page-header`, `.hero`, `.resume-banner`, `.view-carousel-container`, `.homescreen-modal-overlay` → their base padding is non-zero on the affected axis. We use `calc(baseline + env(...))` to add to the existing padding, not replace it.
- `.toast-container`, `.map-control` → their base offset is hardcoded via `bottom`. We use `calc(baseline + env(...))` on `bottom`, leaving padding unchanged.

**Non-goals:**
- Do NOT change any rule in `styles.css`.
- Do NOT change the existing `ios.css` rules.
- Do NOT scope any of these under a media query — `env(safe-area-inset-*)` returns 0 where insets don't apply (regular iPhone X-and-up have insets; older iPhones / iPads / desktop return 0).
- Do NOT remove the `.platform-ios` scope — these rules MUST NOT apply to regular-browser users.

**Verification:**
- `grep -c 'env(safe-area-inset-top)' src/RoadTripMap/wwwroot/ios.css` → at least 5 (four top-inset rules + one modal-overlay).
- `grep -c 'env(safe-area-inset-bottom)' src/RoadTripMap/wwwroot/ios.css` → at least 4 (three bottom-inset rules + one modal-overlay).
- Every new rule line begins with `.platform-ios` (grep the section; no unscoped selectors).
- Run `npm test` — full suite green (no test currently covers `ios.css` parsing; Task 3 adds coverage).

**Commit:** `style(ios): safe-area insets for fixed/sticky headers, toasts, carousel, modals, and map controls`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Static assertions for viewport metas and `ios.css` rule presence

**Verifies:** ios-shell-hardening.AC6.safeArea.1, ios-shell-hardening.AC6.safeArea.2 / .3 / .4 (rule-presence at unit level).

**Files:**
- Create: `tests/js/ios-safe-area.test.js` (unit, static file-content assertions).

**Rationale:** `env(safe-area-inset-*)` evaluates to 0 in jsdom and on non-notched devices, so visual correctness can only be verified on a real iPhone (Phase 8 smoke checklist). At the unit level we assert that the right files contain the right declarations — so a future refactor accidentally removing `viewport-fit=cover` or the safe-area rules fails CI before it reaches device testing.

**Test harness notes:**
- No DOM, no eval — just file-read assertions. Use `fs.readFileSync` and regex / substring checks.

**Tests required (one `describe` per AC):**

1. **AC6.safeArea.1 — every wwwroot HTML has `viewport-fit=cover`.**
   - For each of the 4 HTML filenames, `fs.readFileSync(<file>, 'utf8')` and assert the content contains `'viewport-fit=cover'`.
   - Also assert the content contains the full expected meta string `'<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">'` (exact match safeguards against accidental spacing or value drift).

2. **AC6.safeArea.2 — top-inset rules exist in `ios.css` with `.platform-ios` scope.**
   - Read `src/RoadTripMap/wwwroot/ios.css`.
   - For each selector in `['.platform-ios .map-header', '.platform-ios .page-header', '.platform-ios .hero', '.platform-ios .resume-banner']`, assert the file contains that selector string.
   - For each selector, assert the nearest following rule block (match by regex or a substring window) contains `padding-top:` and `env(safe-area-inset-top)`.

3. **AC6.safeArea.3 — bottom-inset rules exist in `ios.css` with `.platform-ios` scope.**
   - For each selector in `['.platform-ios .toast-container', '.platform-ios .view-carousel-container', '.platform-ios .map-control']`, assert the selector exists.
   - For `.toast-container` and `.map-control`, the matching rule uses `bottom:` with `env(safe-area-inset-bottom)`.
   - For `.view-carousel-container`, the matching rule uses `padding-bottom:` with `env(safe-area-inset-bottom)`.

4. **AC6.safeArea.4 — modal overlay has both top and bottom insets.**
   - Locate the rule starting with `.platform-ios .homescreen-modal-overlay`.
   - Within its block, assert both `padding-top:` + `env(safe-area-inset-top)` AND `padding-bottom:` + `env(safe-area-inset-bottom)` are declared.

5. **Regression — `.platform-ios` scope is never omitted in the new block.**
   - Assert that between the new block's section comment and the end of the file, every line beginning with `.` (a selector start) begins with `.platform-ios`. No unscoped selectors may leak through.

**Verification:**
- Run `npx vitest run tests/js/ios-safe-area.test.js` — all tests green.
- Run `npm test` — full suite green.

**Commit:** `test(ios): static assertions for viewport-fit=cover and .platform-ios safe-area rules`
<!-- END_TASK_3 -->

---

## Phase 6 done checklist

- [ ] All 4 `wwwroot/*.html` viewport metas include `viewport-fit=cover`.
- [ ] `src/RoadTripMap/wwwroot/ios.css` contains safe-area rules for `.map-header`, `.page-header`, `.hero`, `.resume-banner`, `.toast-container`, `.view-carousel-container`, `.map-control`, `.homescreen-modal-overlay`, all scoped under `.platform-ios`.
- [ ] `tests/js/ios-safe-area.test.js` asserts viewport metas and ios.css rule presence.
- [ ] `npm test` green end-to-end.
- [ ] On-device visual verification (no element clipped by notch or home indicator on a notched iPhone, across every page) recorded in Phase 8's smoke checklist.
- [ ] All 3 tasks committed on `ios-offline-shell`.
