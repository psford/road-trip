# iOS Shell Polish — Phase 4: index.html and create.html — entry-page polish

**Goal:** Bring the entry pages up to the same token + chrome standard set in Phases 1–3. Index renders the hero with large-title typography and Photos-tile-feel trip cards. Create uses the same translucent nav-bar header pattern as post.html plus iOS-styled form inputs. Trip-create success and failure both fire haptics.

**Architecture:** Pure CSS for the visual polish (universal token swap in `styles.css`, iOS-only chrome in `ios.css` under `.platform-ios`). The `.page-header` styling on create.html inherits the Phase 2 work (post.html's nav-bar polish already targets `.page-header`, which is the same selector). Index-specific selectors (`.hero`, `.button-hero`, `.my-trips-section`, `.my-trip-card`) get token-applied, then iOS-only Photos-grid styling. Haptic wiring in create.html's inline submit handler — but **only after** that handler is wrapped in an IIFE + idempotent guard, because the current unwrapped script re-attaches its submit listener on every iOS-shell document swap (CLAUDE.md gotcha confirmed by investigator).

**Tech Stack:** vanilla JS (inline `<script>` in create.html — must IIFE-wrap), CSS custom properties from Phase 1, `Native.haptic` from Phase 1.

**Scope:** Phase 4 of 6 from `docs/design-plans/2026-05-09-ios-shell-polish.md`.

**Codebase verified:** 2026-05-10. See discrepancies below.

**Discrepancies from design — read carefully:**
- **`create.html`'s inline `<script>` block (lines 57–132) is NOT IIFE-wrapped.** This is a **pre-existing bug** that violates the CLAUDE.md invariant ("wwwroot inline scripts MUST NOT declare top-level `const`/`let`; must wrap in an IIFE"). Adding haptics before fixing this would cause haptics to stack — the listener re-attaches on every iOS-shell document swap, then both attached listeners fire on submit, etc. Phase 4 starts by fixing this. The fix is small but critical for AC6.3 to mean what it says ("trip-create success fires Native.haptic('success')" implies once per success, not N-times where N is the number of times the user has visited create.html in the same shell session).
- **The investigator notes the listener-attach problem is independent of the IIFE wrap.** Even with `(function(){...})();`, if the script re-runs on each swap, `addEventListener('submit', ...)` fires again and stacks. Fix requires **either** (a) a `window._createFormHandlerInstalled` guard flag inside the IIFE, or (b) targeting a unique `id` on each swap (form is recreated, new id each time). Approach (a) is simpler and matches the `_installed` pattern used elsewhere in the project.
- **`index.html` already has no `.page-header`** — the `.hero` block IS the entry visual. The design's "index.html renders the hero with large-title typography" is satisfied by restyling `.hero` itself; no new header markup needed.
- **`create.html` already has a `.page-header` element** matching post.html's structure. Phase 2's work on `.platform-ios .page-header` (translucent sticky nav, safe-area inset) automatically applies to create.html too. **No additional `.platform-ios .page-header` rules needed in this phase**; verify visually in Task 7.
- **The design says "wire `Native.haptic('success')` on trip-create success and `Native.haptic('error')` on trip-create failure inside the existing `create.html` inline script."** All trip-create logic is inline in create.html (no `createUI.js` module). Haptic insertion points: success after `await API.createTrip(...)` resolves and BEFORE the navigation branch (so it fires regardless of which navigation path runs); failure inside the `catch` block.
- **The trip-card rendering on `index.html` is in an inline IIFE** that's already correctly IIFE-wrapped (lines 36–54). No idempotency fix needed there.
- **`tests/js/create-flow.test.js` exists with 422 lines of coverage** for the trip-create happy path, offline path, and shell-vs-browser navigation branching. Phase 4 extends it with haptic-firing assertions and the IIFE-guard idempotency assertion.

**Recommended skills for executor (activate before starting):**
- `ed3d-house-style:writing-good-tests` (idempotency-on-re-eval test pattern, see roadTrip.test.js:186-215)
- `ed3d-house-style:coding-effectively` (IIFE guard pattern is one-liner, don't over-engineer)
- `ed3d-plan-and-execute:test-driven-development` (write the "submitting twice fires create once" test first — it's the proof that the guard works)
- `ed3d-plan-and-execute:verification-before-completion`

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ios-shell-polish.AC6: index.html and create.html — entry-page polish
- **ios-shell-polish.AC6.1 Success:** index.html renders the hero with large-title typography and the trip cards with Photos-tile feel.
- **ios-shell-polish.AC6.2 Success:** create.html renders the same nav-bar header pattern as post.html and iOS-styled form inputs.
- **ios-shell-polish.AC6.3 Success:** Trip-create success fires `Native.haptic('success')`; failure fires `Native.haptic('error')`.
- **ios-shell-polish.AC6.4 Success:** New tap targets (`.nav a`, `.my-trip-card`) meet the 44×44 minimum on iOS.

---

<!-- START_SUBCOMPONENT_A (tasks 1) -->
<!-- START_TASK_1 -->
### Task 1: Wrap `create.html` inline script in IIFE + add idempotency guard

**Type:** Functionality (correctness fix; precondition for the rest of Phase 4).

**Verifies:** None directly — supports AC6.3 by ensuring haptics fire exactly once per outcome.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/create.html` — inline `<script>` block at lines 57–132.

**Implementation:**

Wrap the existing handler in an IIFE with an install-once guard. Pattern (mirrors `_installed` pattern from `roadTrip.js`):

```html
<script>
    (function () {
        if (window._createFormHandlerInstalled) return;
        window._createFormHandlerInstalled = true;

        const form = document.getElementById('createTripForm');
        if (!form) return; // defensive — element should exist on the create page

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            // ... existing handler body unchanged ...
        });
    })();
</script>
```

Critical: **do not change the handler body in this task.** Task 1's only purpose is the wrapping + guard. Tasks 2–3 add the haptic calls inside the unchanged handler body. Atomic, reviewable, easy to revert.

**Verification:**

Run: `npm test -- tests/js/create-flow`
Expected: existing 422-line test suite still passes. The guard is invisible to single-evaluation tests because they only run the script once.

Add ONE new test to `tests/js/create-flow.test.js` to prove the guard works:

```javascript
it('re-evaluating the inline script does not double-attach the submit listener', async () => {
    // Setup: render create.html DOM, evaluate the inline script once.
    // Run the existing helper that loads the inline script (the test file
    // probably reads create.html and evals it; reuse that helper).
    // After first install: one submit listener attached.
    // Reset: do NOT clear globalThis (simulating an iOS shell re-swap).
    // Re-eval the inline script.
    // Submit the form once.
    // Assert: the inner handler body ran exactly once (e.g., API.createTrip
    // called exactly once).
});
```

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/create.html tests/js/create-flow.test.js
git commit -m "fix(create.html): IIFE-wrap inline script + idempotency guard

CLAUDE.md invariant: wwwroot inline scripts MUST be IIFE-wrapped, and
anything that registers DOM listeners must guard against re-execution
because the iOS shell re-runs inline scripts on every document swap.

create.html violated this invariant — submitting after a navigation
loop (e.g., create -> back -> create) would have attached the submit
handler twice, firing API.createTrip twice. Added the IIFE wrapper and
window._createFormHandlerInstalled guard in the same shape as the
_installed pattern in roadTrip.js / offlineError.js / tripStorage.js.

Pre-condition for Phase 4 haptic wiring (Tasks 2-3) — haptics must
fire exactly once per outcome, which requires the handler itself to
fire exactly once per submit."
```
<!-- END_TASK_1 -->
<!-- END_SUBCOMPONENT_A -->

---

<!-- START_SUBCOMPONENT_B (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: Wire `Native.haptic('success')` after trip-create resolves in `create.html`

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC6.3 (success path).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/create.html` — inside the (now-IIFE-wrapped) submit handler, immediately after `const result = await API.createTrip(...)` resolves and BEFORE any navigation branch.

**Implementation:**

Insert the haptic call right after the API resolves, so the buzz fires regardless of which navigation path runs:

```javascript
const result = await API.createTrip(name, description || null);

// AC6.3: success haptic fires before navigation, so the user feels confirmation
// even if the navigation branch is slow (network on shell-fetch, Safari on web).
if (globalThis.Native && typeof globalThis.Native.haptic === 'function') {
    void globalThis.Native.haptic('success');
}

// Save trip to localStorage for My Trips
TripStorage.saveTrip(name, result.postUrl, result.viewUrl || '');

// ... existing navigation branching (FetchAndSwap / window.location.href) ...
```

Defensive guard against missing `globalThis.Native` (test environments). Fire-and-forget.

**Tests** (extend `tests/js/create-flow.test.js`):

- `it('fires Native.haptic("success") after API.createTrip resolves')` — stub `globalThis.Native = { haptic: vi.fn() }`, stub API.createTrip to resolve `{ postUrl, viewUrl }`, submit form, assert `Native.haptic('success')` called exactly once.
- `it('does not throw when Native is undefined on success')` — leave Native unset, verify the success path completes without error.

**Verification:**

Run: `npm test -- tests/js/create-flow`
Expected: new tests pass, baseline 422 tests still pass.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/create.html tests/js/create-flow.test.js
git commit -m "feat(create): Native.haptic('success') on trip-create resolve

Buzz fires before navigation so the user feels confirmation immediately,
not gated on the (potentially slow) FetchAndSwap fetch. Defensive guard
for missing Native (test envs)."
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire `Native.haptic('error')` in the `create.html` catch block

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC6.3 (failure path).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/create.html` — inside the `catch (error)` block at the end of the submit handler.

**Implementation:**

Insert the haptic call as the FIRST line of the catch block, so the buzz fires before the error message renders:

```javascript
catch (error) {
    if (globalThis.Native && typeof globalThis.Native.haptic === 'function') {
        void globalThis.Native.haptic('error');
    }
    console.error('[create-flow] submit failed:', error);
    errorEl.textContent = OfflineError.friendlyMessage(error, 'create');
    errorEl.classList.remove('hidden');
    const btn = document.getElementById('createButton');
    btn.disabled = false;
    btn.textContent = 'Create Trip';
}
```

**Tests** (extend `tests/js/create-flow.test.js`):

- `it('fires Native.haptic("error") when API.createTrip rejects')` — stub Native.haptic, stub API.createTrip to reject with a non-offline error, submit form, assert `Native.haptic('error')` called.
- `it('fires Native.haptic("error") when API.createTrip rejects with offline error')` — same but reject with a `TypeError` (offline-shape error per `offlineError.js`); same assertion.
- `it('fires Native.haptic("error") when name is missing (validation error)')` — submit empty form (validation throws before API call); assert haptic('error') called.
- `it('does not throw when Native is undefined on failure')` — leave Native unset, trigger failure, verify catch block completes.

**Verification:**

Run: `npm test -- tests/js/create-flow`

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/create.html tests/js/create-flow.test.js
git commit -m "feat(create): Native.haptic('error') in trip-create catch block

Fires before the error banner renders. Covers all failure shapes:
network rejection, offline TypeError, client-side validation throw."
```
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_B -->

---

<!-- START_SUBCOMPONENT_C (tasks 4-5) -->
<!-- START_TASK_4 -->
### Task 4: Universal token swap for `.hero`, `.button-hero`, `.my-trips-section`, `.my-trip-card`, form inputs in `styles.css`

**Type:** Functionality (visual; no behavior change).

**Verifies:** ios-shell-polish.AC6.1 (universal hero typography upgrade visible in browsers too), ios-shell-polish.AC6.2 (form inputs token-styled).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/css/styles.css` — selectors at the line ranges from investigator (executor: verify with `grep -n "^\.hero\|^\.button-hero\|^\.my-trips-section\|^\.my-trip-card\|^input\[type" src/RoadTripMap/wwwroot/css/styles.css`):
  - `.hero` lines 475–516
  - `.button-hero` lines 495–516
  - `.my-trips-section` lines 297–303
  - `.my-trip-card` lines 311–341
  - `input[type="text"]` and `textarea` lines 86–109
  - `label` lines 79–84
  - `.nav` and `.nav a` lines 230–239

**Implementation:**

Token-swap pattern from Phase 2 Task 1 / Phase 3 Task 2. Bullet rules:

1. **`.hero` h1:** apply `font-size: var(--font-size-large-title)` + `font-weight: var(--font-weight-bold)` + `letter-spacing: -0.02em`. The hero is the entry visual; large-title makes it visually dominant.
2. **`.hero` p (subtitle):** `font-size: var(--font-size-body)` + `color: var(--color-text-secondary)`.
3. **`.button-hero`:** `border-radius: var(--radius-md)`, `font-size: var(--font-size-headline)`, `font-weight: var(--font-weight-semibold)`, `transition: transform var(--motion-duration-instant) var(--motion-ease-standard)`. Add `:active { transform: scale(0.97); }` for press-in feedback (universal — feels right in browsers too).
4. **`.my-trip-card`:** `border-radius: var(--radius-md)`, `transition: transform var(--motion-duration-instant) var(--motion-ease-standard)`, `:active { transform: scale(0.99); }`. Replace any hardcoded shadow with `box-shadow: var(--shadow)` if the legacy `--shadow` is currently inline.
5. **`.my-trip-name` (inside the card):** `font-size: var(--font-size-headline)`, `font-weight: var(--font-weight-semibold)`.
6. **Form inputs (`input[type="text"]`, `textarea`):** `border-radius: var(--radius-md)`, `font-size: var(--font-size-body)`, `transition: border-color var(--motion-duration-fast) var(--motion-ease-standard)`. Don't change padding (would shift layout — verified visually too risky for the universal browser path).
7. **`label`:** `font-size: var(--font-size-subhead)`, `font-weight: var(--font-weight-medium)`, `color: var(--color-text-secondary)`.
8. **`.nav a`:** `border-radius: var(--radius-md)` for the back-link (the existing padding becomes a tappable pill shape).

**Do NOT:**
- Touch `.page-header` directly (Phase 2 owns it).
- Change `.hero`'s gradient background — leave the existing brand-tinted hero panel intact in browsers; iOS Task 5 overrides it.
- Add `.my-trip-card` thumbnails (the design says "Photos-tile feel" — captured by the iOS-only rule in Task 5; the universal version stays a clean list-style card).

**Verification:**

Run: `npm test`
Expected: 607+ baseline tests pass.

Manual visual check (executor): open index.html and create.html in a desktop browser (light + dark). The hero title looks more dominant; trip cards have the new radii; form inputs have more rounded corners; nothing layout-broken.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/css/styles.css
git commit -m "feat(entry-css): token swap for index/create selectors

Universal Phase 1 tokens applied to .hero, .button-hero, .my-trips-section,
.my-trip-card, form inputs, .nav a. Layout dimensions unchanged. Light +
dark themes both improve. iOS-specific Photos-tile feel comes in Task 5."
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: iOS-only chrome polish for index.html / create.html in `ios.css`

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC6.1 (Photos-tile feel for trip cards on iOS), ios-shell-polish.AC6.2 (iOS-styled form inputs), ios-shell-polish.AC9.3 (browser stays universal-only).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/ios.css` — append a `/* Phase 4: index.html + create.html chrome */` section.

**Implementation:**

```css
/* Phase 4: index.html — hero + trip cards Photos feel */
.platform-ios .hero {
  padding-top: calc(env(safe-area-inset-top, 0px) + var(--space-xl));
  background: transparent; /* drop the brand gradient — iOS hero is content-first */
}

.platform-ios .hero h1 {
  font-size: var(--font-size-large-title);
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.02em;
  color: var(--color-text);
}

.platform-ios .hero p {
  color: var(--color-text-secondary);
}

.platform-ios .button-hero {
  background-color: var(--color-accent);
  color: #ffffff;
  border-radius: var(--radius-md);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.platform-ios .my-trips-section h2 {
  font-size: var(--font-size-title-2);
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.01em;
}

.platform-ios .my-trip-card {
  background-color: var(--color-surface);
  border-radius: var(--radius-md);
  border: none;
  padding: var(--space-md);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

.platform-ios .my-trip-card:active {
  transform: scale(0.98);
  background-color: var(--color-fill-secondary);
}

/* Phase 4: create.html — iOS-styled form inputs */
.platform-ios input[type="text"],
.platform-ios textarea {
  background-color: var(--color-fill-secondary);
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  padding: var(--space-sm) var(--space-md);
  color: var(--color-text);
}

.platform-ios input[type="text"]:focus,
.platform-ios textarea:focus {
  background-color: var(--color-surface);
  outline: 2px solid var(--color-accent);
  outline-offset: 0;
}

.platform-ios label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-footnote);
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
```

Notes:
- `.hero` background goes transparent on iOS (drops the universal gradient). The Photos-app entry feel is "content on the system background" — no decorative panel.
- Hero respects safe-area-inset-top so the title doesn't sit under the notch on the home screen.
- `.my-trip-card` becomes a borderless tile with subtle shadow + press-in feedback. The Photos-app trip-tile aesthetic.
- Form inputs become the iOS "frosted fill" pattern: tinted background fill, no border, system-blue focus outline. Labels use uppercase footnote style (Apple HIG section-header pattern).

**Verification:**

Run: `npm test`
Expected: passes.

Manual visual on iOS simulator: index hero feels native (large bold title, brand-teal button); trip cards lift on press; create form inputs are filled and rounded with system-blue focus.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/ios.css
git commit -m "feat(ios.css): Photos-tile feel for index/create entry pages

.platform-ios overrides:
- .hero: transparent background, large-title h1, safe-area top inset
- .my-trip-card: borderless tile, press-in scale + fill change
- form inputs: frosted fill, no border, system-blue focus outline
- labels: uppercase footnote style (Apple HIG section-header)

create.html .page-header is automatically picked up by Phase 2's
.platform-ios .page-header rule (same selector — no duplication)."
```
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_C -->

---

<!-- START_SUBCOMPONENT_D (tasks 6) -->
<!-- START_TASK_6 -->
### Task 6: Extend the 44×44 tap-target list in `ios.css` with `.nav a`, `.my-trip-card`, `.button-hero`

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC6.4.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/ios.css` — the consolidated tap-target rule at lines 25–39 (or wherever Phase 3 Task 6 left it).

**Implementation:**

Append the three new selectors to the comma-separated list:

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
.platform-ios .nav a,
.platform-ios .my-trip-card,
.platform-ios .button-hero,
.platform-ios button {
  min-height: 44px;
  min-width: 44px;
}
```

Notes:
- The blanket `.platform-ios button` rule already covers `.button-hero` if it's a `<button>` — but the investigator confirmed it's an `<a class="button-hero" href="/create">` link, so the explicit selector is required.
- `.my-trip-card` is rendered as `<a class="my-trip-card">` (per investigator), same situation — needs explicit selector.
- `.nav a` covers all back-links across post.html, create.html, trips.html.

**Verification:**

Manual visual on iOS simulator: tap-targets feel deliberately large; no near-misses.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/ios.css
git commit -m "feat(ios.css): extend 44x44 tap-target list with .nav a, .my-trip-card, .button-hero

Per CLAUDE.md gotcha — new tap targets aren't auto-covered by the
consolidated rule, must be added explicitly."
```
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_D -->

---

<!-- START_SUBCOMPONENT_E (tasks 7-8) -->
<!-- START_TASK_7 -->
### Task 7: Build verification — regenerate asset-manifest and bundle

**Type:** Infrastructure verification.

**Step 1:** `npm run build:bundle` — clean run.

**Step 2:** Commit any regenerated artifacts.

```bash
git add src/RoadTripMap/wwwroot/asset-manifest.json src/RoadTripMap/wwwroot/bundle/
git diff --cached --stat
git commit -m "build: regenerate asset-manifest + bundle for Phase 4"
```

(Skip if no diff.)
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Final verification — full test suite + browser smoke + .NET test

**Type:** Infrastructure verification.

**Verifies:** ios-shell-polish.AC8.1, ios-shell-polish.AC8.2.

**Step 1:** `npm test` — full suite passes (~640+ tests after Phases 1–4 add coverage).
**Step 2:** `dotnet test RoadTripMap.sln` — passes.
**Step 3:** Browser smoke-test (executor): `dotnet run --project src/RoadTripMap`, open `/`, then `/create`, in light + dark.
- Index `/`: hero looks dominant; trip-card "My Trips" section (if you have trips in localStorage from prior testing) renders with new radii.
- Click "Create a Trip" → reaches `/create`.
- Create form: new input styling, labels are uppercase + small, focus outline appears (universal — system-blue on iOS, brand-teal in browser since `--color-accent` is brand-aliased outside `.platform-ios`).
- Submit empty form → validation error renders with friendly copy. (Browser: no haptic; iOS: error haptic on Patrick's device.)
- Submit a valid trip → succeeds and navigates to `/post/{token}`.

**Step 4:** Patrick's manual on-device check:

> "Phase 4 implementation complete. Patrick: please run `npx cap sync ios` locally and verify on device:
> - index.html hero feels native (large title, no brand gradient panel).
> - 'My Trips' cards lift on press.
> - Tapping 'Create a Trip' navigates to create.html (still inside the shell — no kick to Safari).
> - create.html header is the same translucent sticky nav as post.html.
> - Form inputs have the iOS frosted-fill look; focus outline is system-blue.
> - Submitting a valid trip buzzes (success haptic) before navigating.
> - Submitting an invalid trip (empty name) buzzes (error haptic) and shows the validation message.
> - Visiting create.html, navigating away, returning to create.html, and submitting fires the success haptic exactly ONCE per submit (Task 1's idempotency guard). If you feel a double-buzz, the guard regressed."
<!-- END_TASK_8 -->
<!-- END_SUBCOMPONENT_E -->

---

## Phase 4 done-when checklist

- [ ] Task 1: create.html inline script IIFE-wrapped + `_createFormHandlerInstalled` guard; idempotency test passes.
- [ ] Task 2: `Native.haptic('success')` fires after `API.createTrip` resolves; tests pass.
- [ ] Task 3: `Native.haptic('error')` fires in catch block (network, offline, validation); tests pass.
- [ ] Task 4: Token swap applied to `.hero`, `.button-hero`, `.my-trips-section`, `.my-trip-card`, form inputs, `.nav a` in `styles.css`.
- [ ] Task 5: iOS-only Photos-feel chrome for index/create in `ios.css`.
- [ ] Task 6: 44×44 tap-target list extended with `.nav a`, `.my-trip-card`, `.button-hero`.
- [ ] Task 7: Asset manifest + bundle regenerated.
- [ ] Task 8: `npm test` + `dotnet test` pass; browser smoke-tested; Patrick on-device sign-off (haptic-once-per-submit verified).
