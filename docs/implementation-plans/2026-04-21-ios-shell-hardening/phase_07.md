# iOS Shell Hardening — Phase 7: HIG cleanup

**Goal:** Close the remaining iOS HIG gaps: enforce 44×44 tap-target minimums on buttons flagged by the design-time audit, enable native-feeling momentum scrolling on `.upload-panel__body`, and set iOS keyboard attributes (`autocorrect`, `autocapitalize`) on form inputs to match each field's intent (caption sentences, trip names as titles, descriptions as sentences).

**Architecture:** Two files touched:
- `src/RoadTripMap/wwwroot/ios.css` — extend the existing Phase-6 consolidated tap-target rule at lines 24–32 with the new selectors; widen padding on `.upload-panel__retry` / `.upload-panel__pin-drop` / `.upload-panel__discard` so the visual button fills the 44×44 hit zone; add a new `.upload-panel__body` rule for `-webkit-overflow-scrolling: touch`.
- `src/RoadTripMap/wwwroot/post.html` — add `autocorrect="on" autocapitalize="sentences"` to `#captionInput`.
- `src/RoadTripMap/wwwroot/create.html` — add `autocapitalize="words"` to the trip-name input (`#tripName`) and `autocapitalize="sentences"` to the description textarea (`#tripDescription`).

All CSS remains scoped under `.platform-ios` so regular-browser users are unaffected. Dark mode is documented as explicitly out of scope (color-token restructure required; `styles.css` already uses CSS custom properties for palette but has no `prefers-color-scheme` variant).

**Tech Stack:** CSS + HTML only; static-assertion tests.

**Scope:** Phase 7 of 8 from `docs/design-plans/2026-04-21-ios-shell-hardening.md`.

**Codebase verified:** 2026-04-22 (branch `ios-offline-shell`).

**Branch:** `ios-offline-shell` (same as Phases 1–6).

**Dependencies:** Phase 6 (`viewport-fit=cover` on every page; existing Phase-6 additions to `ios.css` present).

---

## Acceptance Criteria Coverage

### ios-shell-hardening.AC6: iOS safe-areas + HIG compliance (HIG subgroup)

- **ios-shell-hardening.AC6.hig.1 Success:** `.copy-button`, `.carousel-action-btn`, `.photo-popup-delete`, `.upload-panel__toggle`, `.upload-panel__retry` / `pin-drop` / `discard`, `.map-back`, `.poi-action-btn` all have computed tap-target ≥44×44pt on iPhone.
- **ios-shell-hardening.AC6.hig.2 Success:** `.upload-panel__body` has `-webkit-overflow-scrolling: touch`.
- **ios-shell-hardening.AC6.hig.3 Success:** `#captionInput` has `autocorrect="on" autocapitalize="sentences"`.
- **ios-shell-hardening.AC6.hig.4 Success:** Trip-name input has `autocapitalize="words"`; description textarea has `autocapitalize="sentences"`.
- **ios-shell-hardening.AC6.hig.5 Edge:** Regular-browser users on non-iOS devices see no visible change — all rules scoped under `.platform-ios`.

---

## Codebase baseline (verified 2026-04-22)

- **Existing `ios.css:24–32` tap-target rule:**
  ```css
  .platform-ios .upload-panel__retry,
  .platform-ios .upload-panel__discard,
  .platform-ios .resume-banner button,
  .platform-ios .photo-carousel__control,
  .platform-ios button {
    min-height: 44px;
    min-width: 44px;
  }
  ```
  Covers `.upload-panel__retry` and `.upload-panel__discard` but NOT `.upload-panel__pin-drop`. Phase 7 must add `__pin-drop` and six additional selectors.
- **Per-selector baseline in `styles.css`:**
  - `.copy-button` (lines 216–221) — `padding: var(--space-xs) var(--space-sm);` no width/height. Effective ~16×24px. Sub-HIG.
  - `.carousel-action-btn` (lines 1200–1212) — `width: 28px; height: 28px; padding: 0;` Sub-HIG.
  - `.photo-popup-delete` (lines 1034–1049) — `width: 24px; height: 24px; padding: 0;` Sub-HIG.
  - `.upload-panel__toggle` (lines 1359–1371) — `width: 24px; height: 24px; padding: 0;` Sub-HIG.
  - `.upload-panel__retry, .upload-panel__pin-drop, .upload-panel__discard` (lines 1485–1497, one consolidated rule) — `padding: 4px 8px; font-size: 0.85rem;` Visual ~14×20px inside a 44×44 hit box (once min-sizes apply); Phase 7 widens padding.
  - `.map-back` (lines 887–898) — `font-size: 1.2rem;` no width/height/padding. Sub-HIG (~19×19px).
  - `.poi-action-btn` (lines 1068–1078) — `width: 100%; padding: 8px 12px;` Height ~29px. Sub-HIG on height.
  - `.upload-panel__body` (lines 1384–1390) — `max-height: 300px; overflow-y: auto;` already scrolls; Phase 7 adds `-webkit-overflow-scrolling: touch` for iOS momentum.
- **Current form-control attributes (verbatim):**
  - `post.html` `#captionInput` (lines 53–54): `<input type="text" id="captionInput" class="caption-input" placeholder="Add a caption (optional)">`. No `autocorrect`, no `autocapitalize`, no `spellcheck`.
  - `create.html` `#tripName` (lines 27–34): `<input type="text" id="tripName" name="name" placeholder="e.g., Cross Country 2026" required autocomplete="off">`. No `autocorrect`/`autocapitalize`/`spellcheck` yet; has `autocomplete="off"`.
  - `create.html` `#tripDescription` (lines 39–43): `<textarea id="tripDescription" name="description" placeholder="..."></textarea>`. No `autocorrect`/`autocapitalize`/`spellcheck`.
- **Dark mode scope:** `styles.css:9–31` defines ~12 CSS custom properties for colors (`--color-primary`, `--color-text`, etc.) — infrastructure for dark mode is partial. No `@media (prefers-color-scheme: dark)` rules exist. `ios.css` uses hardcoded `rgba()` values. Design explicitly documents dark mode as out of scope; Phase 7 does NOT add any dark-mode rules.
- **Re-injection of `ios.css`:** `src/bootstrap/loader.js:7–18` monkey-patches `FetchAndSwap.fetchAndSwap` to call `_ensureIosCss()` after every swap. Phase 6 confirmed this. Phase 7 adds rules to `ios.css` and the re-injection picks them up; no wiring change.

---

## Tasks

<!-- START_TASK_1 -->
### Task 1: Extend the 44×44 tap-target rule in `ios.css`

**Verifies:** ios-shell-hardening.AC6.hig.1 (implementation; assertion in Task 4).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/ios.css:24–32` (the existing consolidated tap-target rule).

**Current code (lines 24–32):**
```css
.platform-ios .upload-panel__retry,
.platform-ios .upload-panel__discard,
.platform-ios .resume-banner button,
.platform-ios .photo-carousel__control,
.platform-ios button {
  min-height: 44px;
  min-width: 44px;
}
```

**Target code (same position — extend selector list, keep the body unchanged):**
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
.platform-ios button {
  min-height: 44px;
  min-width: 44px;
}
```

**Rationale:**
- Adds `.upload-panel__pin-drop` (not present in the current `ios.css` 44pt rule — the three upload-panel action buttons share a consolidated rule in `styles.css:1485–1497`, but `ios.css`'s existing `min-*` rule covers only retry + discard; Phase 7 aligns the iOS rule with the styles.css grouping).
- Adds `.upload-panel__toggle`, `.carousel-action-btn`, `.photo-popup-delete`, `.copy-button`, `.map-back`, `.poi-action-btn` — the six selectors the HIG audit flagged as sub-44pt today.
- Keeps the consolidated-rule style (one rule, many selectors). Avoids duplicated declaration blocks.
- `.platform-ios button` stays as a catch-all backstop for any future button that doesn't get an explicit selector listed.

**Non-goals:**
- Do NOT change `min-height` / `min-width` values from `44px`.
- Do NOT add padding to this rule — padding adjustments for the three upload-panel buttons happen in Task 2 with a distinct rule so the two concerns (hit zone vs. visual size) stay separable.

**Verification:**
- `grep -c 'min-height: 44px' src/RoadTripMap/wwwroot/ios.css` → exactly 1 (the existing rule still has one).
- `grep -c '.platform-ios .upload-panel__pin-drop' src/RoadTripMap/wwwroot/ios.css` → 1 (added).
- `grep -c '.platform-ios .poi-action-btn' src/RoadTripMap/wwwroot/ios.css` → 1 (added).

**Commit:** `style(ios): extend 44pt tap-target rule to cover HIG-audit selectors`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Widen padding on `.upload-panel__retry` / `__pin-drop` / `__discard` so the visual button fills the 44×44 hit zone

**Verifies:** ios-shell-hardening.AC6.hig.1 (visual aspect — the 3 small upload-panel buttons now feel full-sized, not a tiny glyph centered in a large invisible box).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/ios.css` — append a new rule block after the existing tap-target rule (after Task 1's modification).

**Change — append the following block:**

```css

.platform-ios .upload-panel__retry,
.platform-ios .upload-panel__pin-drop,
.platform-ios .upload-panel__discard {
    /* Baseline in styles.css is `padding: 4px 8px`, which leaves the visible
       button ~14×20 inside a 44×44 hit zone (Task 1). Widen padding so the
       button's visual bounds match the tap zone on iOS. */
    padding: 12px 16px;
}
```

**Rationale:** on non-iOS the `padding: 4px 8px` default is fine; on iOS the min-width/min-height pushes the hit zone to 44×44 but the visible button stays at its baseline size, creating a "click-near-icon" confusion. Widening padding under `.platform-ios` scope closes that gap without breaking non-iOS layouts.

**Non-goals:**
- Do NOT adjust `min-width` / `min-height` here (Task 1 handles those).
- Do NOT change `font-size` or `border` — they come from `styles.css`'s consolidated rule.
- Do NOT touch non-iOS behavior.

**Verification:**
- `grep -n '.platform-ios .upload-panel__retry' src/RoadTripMap/wwwroot/ios.css` → at least 2 matches (one in Task 1 rule, one in this new rule).
- `grep -n 'padding: 12px 16px' src/RoadTripMap/wwwroot/ios.css` → 1 match.

**Commit:** `style(ios): widen padding on upload-panel action buttons so visual matches 44pt hit zone`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Add momentum scrolling to `.upload-panel__body` and iOS keyboard attributes to form controls

**Verifies:** ios-shell-hardening.AC6.hig.2, ios-shell-hardening.AC6.hig.3, ios-shell-hardening.AC6.hig.4 (implementation; assertion in Task 4).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/ios.css` — append a new rule block after Task 2's rule.
- Modify: `src/RoadTripMap/wwwroot/post.html` — update `#captionInput` at lines 53–54.
- Modify: `src/RoadTripMap/wwwroot/create.html` — update `#tripName` at lines 27–34 and `#tripDescription` at lines 39–43.

**Change 1 — `ios.css` (append):**

```css

.platform-ios .upload-panel__body {
    /* iOS momentum scrolling — makes the list feel native. Baseline in
       styles.css already has `overflow-y: auto` and `max-height: 300px`,
       so this property alone does the work. */
    -webkit-overflow-scrolling: touch;
}
```

**Change 2 — `post.html` `#captionInput` (lines 53–54):**

Current:
```html
<input type="text" id="captionInput" class="caption-input"
    placeholder="Add a caption (optional)">
```

Target:
```html
<input type="text" id="captionInput" class="caption-input"
    placeholder="Add a caption (optional)"
    autocorrect="on" autocapitalize="sentences">
```

**Change 3 — `create.html` `#tripName` (lines 27–34):**

Current:
```html
<input
    type="text"
    id="tripName"
    name="name"
    placeholder="e.g., Cross Country 2026"
    required
    autocomplete="off"
>
```

Target:
```html
<input
    type="text"
    id="tripName"
    name="name"
    placeholder="e.g., Cross Country 2026"
    required
    autocomplete="off"
    autocapitalize="words"
>
```

**Change 4 — `create.html` `#tripDescription` (lines 39–43):**

Current:
```html
<textarea
    id="tripDescription"
    name="description"
    placeholder="e.g., A summer road trip across the USA"
></textarea>
```

Target:
```html
<textarea
    id="tripDescription"
    name="description"
    placeholder="e.g., A summer road trip across the USA"
    autocapitalize="sentences"
></textarea>
```

**Rationale for attribute choices (all match the design's ACs exactly):**
- `#captionInput`: `autocorrect="on"` — captions are prose; let iOS autocorrect. `autocapitalize="sentences"` — capitalize the first letter of each sentence.
- `#tripName`: `autocapitalize="words"` — trip names read like titles (Cross Country 2026, Blue Ridge Parkway). Title-case helps.
- `#tripDescription`: `autocapitalize="sentences"` — descriptive prose.

**Non-goals:**
- Do NOT add `autocorrect` to `#tripName` or `#tripDescription` — the design only specifies `autocorrect` on `#captionInput`. Leaving the default is equivalent to `autocorrect="on"` in most iOS browsers, but the design intent is to be explicit only where the design says so.
- Do NOT add `spellcheck` — not in the ACs and not in the design.
- Do NOT alter any existing attribute (leave `autocomplete="off"` on `#tripName`, leave `required`, leave `placeholder`).

**Verification:**
- `grep -n 'autocapitalize="sentences"' src/RoadTripMap/wwwroot/post.html` → 1 match.
- `grep -n 'autocorrect="on"' src/RoadTripMap/wwwroot/post.html` → 1 match.
- `grep -n 'autocapitalize="words"' src/RoadTripMap/wwwroot/create.html` → 1 match.
- `grep -n 'autocapitalize="sentences"' src/RoadTripMap/wwwroot/create.html` → 1 match (the textarea).
- `grep -n '-webkit-overflow-scrolling' src/RoadTripMap/wwwroot/ios.css` → 1 match.

**Commit:** `fix(ios-hig): momentum scroll on upload-panel body; iOS keyboard attrs on caption, trip name, description`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Static assertions for HIG compliance

**Verifies:** ios-shell-hardening.AC6.hig.1, ios-shell-hardening.AC6.hig.2, ios-shell-hardening.AC6.hig.3, ios-shell-hardening.AC6.hig.4, ios-shell-hardening.AC6.hig.5.

**Files:**
- Create: `tests/js/ios-hig.test.js` (unit, static file-content assertions). Follows the Phase 6 `tests/js/ios-safe-area.test.js` pattern: `fs.readFileSync` + regex / substring assertions.

**Test harness notes:**
- No DOM, no eval, no jsdom dependencies — pure file inspection.
- Read `ios.css`, `post.html`, `create.html` once at the top of the file via `fs.readFileSync(path.resolve(__dirname, ...), 'utf8')`.

**Tests required:**

1. **AC6.hig.1 — tap-target 44×44 rule contains every required selector and `.platform-ios` scope.**
   - Read `ios.css`.
   - For each selector in `['.platform-ios .upload-panel__retry', '.platform-ios .upload-panel__pin-drop', '.platform-ios .upload-panel__discard', '.platform-ios .upload-panel__toggle', '.platform-ios .carousel-action-btn', '.platform-ios .photo-popup-delete', '.platform-ios .copy-button', '.platform-ios .map-back', '.platform-ios .poi-action-btn']`, assert the file contains that exact selector string.
   - Locate the 44×44 rule's declaration block (regex-match `min-height: 44px` and `min-width: 44px`) and assert both declarations are within one block.
   - Assert at least ONE additional padding-widening rule exists for `.platform-ios .upload-panel__retry`/`pin-drop`/`discard` (regex: the three selectors followed by `padding:` with a value ≥ 12px on each axis).

2. **AC6.hig.2 — momentum scrolling declared on `.platform-ios .upload-panel__body`.**
   - Read `ios.css`.
   - Assert the substring `-webkit-overflow-scrolling: touch` is present.
   - Assert it is within a rule block whose selector contains `.platform-ios .upload-panel__body` (use a regex that binds selector to the declaration).

3. **AC6.hig.3 — `#captionInput` has the correct iOS keyboard attributes.**
   - Read `post.html`.
   - Locate the `<input id="captionInput"` tag (regex).
   - Assert `autocorrect="on"` appears in the same tag.
   - Assert `autocapitalize="sentences"` appears in the same tag.

4. **AC6.hig.4 — trip name / description have the right `autocapitalize`.**
   - Read `create.html`.
   - Locate `<input ... id="tripName"` tag → assert `autocapitalize="words"` is inside.
   - Locate `<textarea ... id="tripDescription"` tag → assert `autocapitalize="sentences"` is inside.

5. **AC6.hig.5 — regular-browser invariance.**
   - Assert every selector added by Task 1, Task 2, and Task 3 is prefixed with `.platform-ios ` (regex scan of the new sections only: from the start of Task 1's rule through EOF, every `^\s*\.` line must begin with `.platform-ios`).

**Verification:**
- Run `npx vitest run tests/js/ios-hig.test.js` — all 5 tests green.
- Run `npm test` — full suite green.

**Commit:** `test(ios): static assertions for HIG tap-targets, momentum scroll, keyboard attrs`
<!-- END_TASK_4 -->

---

## Phase 7 done checklist

- [ ] `src/RoadTripMap/wwwroot/ios.css` consolidated 44×44 rule covers all 9 HIG-audit selectors + backstop `.platform-ios button`.
- [ ] `.upload-panel__retry` / `__pin-drop` / `__discard` have a widened padding rule (`12px 16px`) under `.platform-ios` scope.
- [ ] `.upload-panel__body` has `-webkit-overflow-scrolling: touch` under `.platform-ios` scope.
- [ ] `#captionInput` has `autocorrect="on" autocapitalize="sentences"`.
- [ ] `#tripName` has `autocapitalize="words"`.
- [ ] `#tripDescription` has `autocapitalize="sentences"`.
- [ ] `tests/js/ios-hig.test.js` asserts all the above.
- [ ] `npm test` green end-to-end.
- [ ] Dark mode explicitly deferred (no Phase 7 changes; follow-up plan tracked).
- [ ] All 4 tasks committed on `ios-offline-shell`.
- [ ] On-device verification (every listed button feels full-sized; caption capitalizes; upload-panel scroll feels native) recorded in Phase 8's smoke checklist.
