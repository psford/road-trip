# iOS Shell Polish — Phase 1: Foundation

**Goal:** Land the design-token foundation, dark-mode support, all four Capacitor plugins, and the `Native.*` wrapper. After this phase the app looks the same on iOS but every subsequent phase has the building blocks it needs.

**Architecture:** Three composable layers — universal CSS tokens (extends existing `:root` in `styles.css`), iOS-only chrome overrides (under `.platform-ios` in `ios.css`), and a runtime `Native.*` IIFE wrapper (`nativeBridge.js`) that dynamic-imports the four Capacitor plugin packages only when `RoadTrip.isNativePlatform()` returns true. Web bundle stays clean of `@capacitor/*` imports.

**Tech Stack:** vanilla JS (IIFE modules with `globalThis.X ??= {}` + `_installed` idempotency flag), CSS custom properties, `@capacitor/haptics@^8.0.1`, `@capacitor/status-bar@^8.0.2`, `@capacitor/share@^8.0.1`, `@capacitor/dialog@^8.0.0` (all peer-compatible with `@capacitor/core@^8.3.1` already installed).

**Scope:** Phase 1 of 6 from `docs/design-plans/2026-05-09-ios-shell-polish.md`.

**Codebase verified:** 2026-05-10. See discrepancies-from-design notes below.

**Discrepancies from design:**
- **`ios/App/App/Info.plist` already contains `<key>UIViewControllerBasedStatusBarAppearance</key><true/>`** (lines 54–55). The design assumed this needed to be added. Verify only — no change needed.
- **Existing `<script>` tags in the four wwwroot HTML pages do NOT use `defer`** (e.g., `post.html:8-9` loads `roadTrip.js` and `offlineError.js` synchronously without `defer`). Per the project's "match existing patterns" rule and to preserve script execution order across the iOS shell's `_executedScriptSrcs` dedup, insert `<script src="js/nativeBridge.js"></script>` **without `defer`** to match the surrounding pattern. The design plan's "via `<script defer>`" wording is non-binding interpretation guidance; matching the existing tag pattern is the binding requirement.
- The asset manifest (`scripts/build-bundle.js:115-141`) auto-discovers every `wwwroot/js/*.js` and `wwwroot/css/*.css` file via `fs.readdirSync(...).sort()`. **No registration of `nativeBridge.js` in the build script is needed.**

**Recommended skills for executor (activate before starting):**
- `ed3d-house-style:writing-good-tests`
- `ed3d-plan-and-execute:test-driven-development`
- `ed3d-house-style:coding-effectively`
- `ed3d-plan-and-execute:verification-before-completion`

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ios-shell-polish.AC1: Token foundation applied universally
- **ios-shell-polish.AC1.1 Success:** `wwwroot/css/styles.css` `:root` block exposes type-scale, semantic-color, material, motion, and radius tokens; both browser and iOS shell render text using the new type scale.
- **ios-shell-polish.AC1.2 Success:** Existing CSS using legacy tokens (`--color-primary`, `--color-bg`, `--space-*`) continues to render unchanged.
- **ios-shell-polish.AC1.3 Failure:** No selector outside `.platform-ios` references iOS-only tokens.

### ios-shell-polish.AC2: Dark mode
- **ios-shell-polish.AC2.1 Success:** With `prefers-color-scheme: dark` set at the OS level, all four pages render with dark color tokens in both browser and iOS shell.
- **ios-shell-polish.AC2.2 Success:** Switching the OS theme while the app is open updates the rendered theme on the next paint.
- **ios-shell-polish.AC2.3 Edge:** The immersive photo viewer (`.fullscreen-overlay`) is dark regardless of system theme.

### ios-shell-polish.AC3: Native plugin wiring (partial — AC3.1, AC3.2 only)
- **ios-shell-polish.AC3.1 Success:** On iOS, `Native.haptic('light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error')` calls the corresponding `@capacitor/haptics` API.
- **ios-shell-polish.AC3.2 Success:** On web, every `Native.*` method is callable without throwing; haptics is a no-op, share falls through to `navigator.share()` or copy-to-clipboard, dialogConfirm falls through to `window.confirm()`, statusBar is a no-op.

### ios-shell-polish.AC9: Single-source architectural constraint
- **ios-shell-polish.AC9.1 Success:** No new HTML files in `wwwroot/`. No `ios/` template tree. The four templates remain the single rendered source.
- **ios-shell-polish.AC9.2 Success:** No `@capacitor/*` package import appears in the web bundle (`wwwroot/bundle/app.js`). All native calls go through `Native.*` with dynamic import inside the iOS branch.
- **ios-shell-polish.AC9.3 Success:** Browser users see the universal token + dark-mode upgrades only; no `.platform-ios`-scoped chrome bleeds into the browser.

**Note on AC3.3, AC3.4, AC3.5, AC3.6:** Phase 1 builds and unit-tests the `Native.share`, `Native.dialogConfirm`, `Native.statusBar` web fallbacks (covered by AC3.2). The integration acceptance — that `Native.share` actually opens the iOS share sheet (AC3.3), `Native.dialogConfirm` actually shows the iOS alert (AC3.4), `Native.statusBar` actually flips the status-bar (AC3.5), and `Native.install()` is idempotent (AC3.6) — is partially exercised in Phase 1 unit tests for AC3.6 (idempotency) and AC3.2 (web fallbacks); on-iOS validation of AC3.3, AC3.4, AC3.5 happens during Phase 6 sign-off after Phases 2–3 wire those calls into UI.

### ios-shell-polish.AC3.6 Failure: Calling `Native.install()` twice does not double-wrap or stack effects.

---

<!-- START_SUBCOMPONENT_A (tasks 1) -->
<!-- START_TASK_1 -->
### Task 1: Install four Capacitor plugin packages

**Type:** Infrastructure.

**Verifies:** None (setup task; supports AC3.1, AC3.2, AC3.3, AC3.4, AC3.5).

**Files:**
- Modify: `package.json` (top-level `dependencies` block)
- Modify: `package-lock.json` (regenerated by npm)

**Step 1: Install plugins (pinned at the versions verified to work with `@capacitor/core@^8.3.1`)**

```bash
npm install --save \
  @capacitor/haptics@^8.0.1 \
  @capacitor/status-bar@^8.0.2 \
  @capacitor/share@^8.0.1 \
  @capacitor/dialog@^8.0.0
```

**Step 2: Verify installation**

```bash
node -e "console.log(require('@capacitor/haptics/package.json').version)"
node -e "console.log(require('@capacitor/status-bar/package.json').version)"
node -e "console.log(require('@capacitor/share/package.json').version)"
node -e "console.log(require('@capacitor/dialog/package.json').version)"
```

Expected: each prints a version starting with `8.`.

**Step 3: Confirm no test regression**

```bash
npm test
```

Expected: all existing tests still pass (607 baseline, no new tests yet).

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(ios): install @capacitor/{haptics,status-bar,share,dialog}@^8

Add the four Capacitor plugins required by the iOS shell polish design.
Pinned to ^8 to match @capacitor/core@^8.3.1 already installed."
```

**Note for executor:** Do NOT run `npx cap sync ios` from this task. Patrick runs that locally per CLAUDE.md (Capacitor sync is in the "Patrick runs locally" column of the who-does-what table). Executor's responsibility ends at npm-installed deps + committed lockfile.
<!-- END_TASK_1 -->
<!-- END_SUBCOMPONENT_A -->

---

<!-- START_SUBCOMPONENT_B (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: Extend `:root` in `styles.css` with type-scale, semantic-color, material, motion, and radius tokens

**Type:** Functionality (visual + token contract).

**Verifies:** ios-shell-polish.AC1.1, ios-shell-polish.AC1.2.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/css/styles.css` (the existing `:root` block, lines 9–31)

**Implementation context:**

The existing `:root` block (verified at `styles.css:9-31`) currently defines:
- Color tokens: `--color-primary`, `--color-primary-hover`, `--color-primary-dark`, `--color-bg`, `--color-surface`, `--color-text`, `--color-text-light`, `--color-border`, `--color-error`, `--color-error-bg`, `--color-success`, `--color-success-bg`
- Spacing: `--space-xs` through `--space-xl`
- Layout: `--carousel-height`, `--radius`, `--shadow`
- Font: `--font-family`

**You must NOT remove or rename any existing token.** Existing CSS in `styles.css` and elsewhere references those variables (verified by grep — every legacy token has consumers). AC1.2 is the failure case for any rename or removal.

**What to add (in `:root`, append after existing declarations, before the closing `}`):**

1. **Type-scale tokens** following Apple HIG defaults (Photos uses these proportions). Use `rem` so accessibility text-size adjusts cascade:
   - `--font-size-large-title`: 2.125rem (34px)
   - `--font-size-title-1`: 1.75rem (28px)
   - `--font-size-title-2`: 1.375rem (22px)
   - `--font-size-title-3`: 1.25rem (20px)
   - `--font-size-headline`: 1.0625rem (17px) — semibold weight
   - `--font-size-body`: 1.0625rem (17px) — regular weight
   - `--font-size-callout`: 1rem (16px)
   - `--font-size-subhead`: 0.9375rem (15px)
   - `--font-size-footnote`: 0.8125rem (13px)
   - `--font-size-caption-1`: 0.75rem (12px)
   - `--font-size-caption-2`: 0.6875rem (11px)
   - `--line-height-tight`: 1.2
   - `--line-height-normal`: 1.4
   - `--line-height-relaxed`: 1.6 (matches the existing `html, body { line-height: 1.6 }` at line 37)
   - `--font-weight-regular`: 400
   - `--font-weight-medium`: 500
   - `--font-weight-semibold`: 600
   - `--font-weight-bold`: 700

2. **Semantic-color tokens** (in addition to the existing palette — these expose intent, the existing tokens stay as the actual values they hold today):
   - `--color-accent`: `var(--color-primary)` — neutral default, overridden under `.platform-ios` in Task 4 to `#007AFF`
   - `--color-accent-hover`: `var(--color-primary-hover)`
   - `--color-fill-secondary`: rgba(120, 120, 128, 0.08) — Apple HIG "secondary fill"
   - `--color-fill-tertiary`: rgba(120, 120, 128, 0.04)
   - `--color-separator`: `var(--color-border)` — alias used by chrome layer
   - `--color-text-secondary`: `var(--color-text-light)` — alias

3. **Material tokens** (for translucent nav bars in Phases 2–4):
   - `--material-blur-thin`: blur(20px)
   - `--material-blur-regular`: blur(30px)
   - `--material-blur-thick`: blur(40px)
   - `--material-bg-light`: rgba(255, 255, 255, 0.72)
   - `--material-bg-dark`: rgba(28, 28, 30, 0.72)

4. **Motion tokens** (cubic-bezier approximations of iOS spring curves):
   - `--motion-duration-instant`: 100ms
   - `--motion-duration-fast`: 200ms
   - `--motion-duration-normal`: 300ms
   - `--motion-duration-slow`: 450ms
   - `--motion-ease-standard`: cubic-bezier(0.4, 0.0, 0.2, 1)
   - `--motion-ease-decelerate`: cubic-bezier(0.0, 0.0, 0.2, 1)
   - `--motion-ease-accelerate`: cubic-bezier(0.4, 0.0, 1.0, 1)
   - `--motion-ease-spring`: cubic-bezier(0.5, 1.5, 0.5, 1) — overshoot feel for press releases

5. **Radius tokens** (the existing `--radius: 8px` stays; these are additions, not replacements):
   - `--radius-sm`: 6px
   - `--radius-md`: 10px (matches Apple Photos card radius)
   - `--radius-lg`: 14px
   - `--radius-xl`: 20px (sheet corner radius)
   - `--radius-full`: 9999px (pill / circle)

**Verification:**

Run: `npm test`
Expected: all 607 baseline tests still pass. No tests yet exercise the new tokens; the verification here is "no regression."

Manual visual check (executor): open `src/RoadTripMap/wwwroot/index.html` in a desktop browser. Page should look identical to before — the new tokens are declared but unused outside their declarations.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/css/styles.css
git commit -m "feat(css): add type-scale, semantic-color, material, motion, radius tokens

Extends :root in styles.css with the universal design-token vocabulary the
iOS shell polish design references. Existing legacy tokens (--color-primary,
--color-bg, --space-*) are unchanged. New tokens are not yet consumed by any
selector; they're the foundation for Phases 2-5."
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Add `@media (prefers-color-scheme: dark)` block in `styles.css`

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC2.1, ios-shell-polish.AC2.2.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/css/styles.css` (insert a new block after the `:root` declaration completes, before the `html, body` rule at line ~33)

**Implementation context:**

Before this task, no `prefers-color-scheme` rule exists anywhere in the wwwroot CSS (verified by grep). The block you add overrides only the **color** tokens (not type, not motion, not radius) and is universal — it is **not** scoped under `.platform-ios`, so browser users on a dark-mode OS get dark mode for free (per design Architecture §1).

**What to add:**

Insert this block between the closing `}` of `:root` and the next selector (`html, body`):

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #000000;
    --color-surface: #1c1c1e;
    --color-text: #ffffff;
    --color-text-light: rgba(235, 235, 245, 0.6);
    --color-border: rgba(84, 84, 88, 0.65);
    --color-fill-secondary: rgba(118, 118, 128, 0.24);
    --color-fill-tertiary: rgba(118, 118, 128, 0.12);
    --color-error-bg: rgba(255, 69, 58, 0.15);
    --color-success-bg: rgba(48, 209, 88, 0.15);
    --color-error: #ff453a;
    --color-success: #30d158;
  }
}
```

Notes for the executor:
- Do **not** override `--color-primary`, `--color-primary-hover`, `--color-primary-dark` here — the brand teal stays the same in dark mode. Photos uses brand color unchanged across themes.
- Do **not** override `--color-accent` here — the dark-mode iOS shell will set its own `#0A84FF` value via the `.platform-ios` block in Task 4. Browsers in dark mode keep `--color-accent` aliased to `--color-primary` (the brand teal).
- The dark surface `#1c1c1e` is Apple's "secondary system background" in dark mode — pulled from Apple HIG so the look matches native iOS.

**Verification:**

Run: `npm test`
Expected: 607 baseline tests still pass.

Manual visual check (executor): in a Chromium-based desktop browser, open DevTools → Rendering → "Emulate CSS prefers-color-scheme: dark", then reload `src/RoadTripMap/wwwroot/index.html`. Background should flip to black, text to white. Toggle the emulation back to light; theme should flip on next paint (AC2.2 — the browser repaints on media query change without page reload).

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/css/styles.css
git commit -m "feat(css): add @media (prefers-color-scheme: dark) color-token override

Universal dark-mode support — browser users on dark-mode OSes also get the
dark palette. Overrides color tokens only; type, motion, radius are unchanged.
Brand color (--color-primary) is not overridden — stays teal in both themes."
```
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_B -->

---

<!-- START_SUBCOMPONENT_C (tasks 4) -->
<!-- START_TASK_4 -->
### Task 4: Add `.platform-ios` accent override in `ios.css`

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC1.3 (no iOS-only token bleeds outside `.platform-ios`), ios-shell-polish.AC9.3.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/ios.css` (append at the end of the file, after the existing safe-area / 44×44 / overscroll rules)

**Implementation context:**

Existing `ios.css` is 141 lines, every rule scoped under `.platform-ios`. The 44×44 tap-target consolidated rule is at lines 25–39 (don't touch — Phase 2 extends that selector list). The safe-area rules at lines 13–22 stay intact.

You're adding a single new rule that overrides `--color-accent` (Apple's system-blue) when the body has `.platform-ios` — and a paired dark-mode rule under nested media query for the dark variant of system blue.

**What to add (append to end of file):**

```css
/* iOS system-blue accent — light scheme */
.platform-ios {
  --color-accent: #007AFF;
  --color-accent-hover: #0066CC;
}

/* iOS system-blue accent — dark scheme */
@media (prefers-color-scheme: dark) {
  .platform-ios {
    --color-accent: #0A84FF;
    --color-accent-hover: #409CFF;
  }
}
```

Notes:
- These hex values come from Apple HIG Color (Light: System Blue `#007AFF`; Dark: System Blue `#0A84FF`).
- Override is scoped under `.platform-ios` so browsers never see system blue — they continue to use the brand teal (`--color-accent` aliased to `--color-primary` in styles.css `:root`).
- Hover variants approximated for hover-capable platforms; iOS itself doesn't use hover, but consistency with the light-scheme pattern is cheap.

**Verification:**

Run: `npm test`
Expected: 607 baseline still passes.

Manual visual check (executor): grep to confirm no rule outside `.platform-ios` references `--color-accent` other than the alias declaration in `styles.css :root`:

```bash
grep -rn "var(--color-accent" src/RoadTripMap/wwwroot/css/ src/RoadTripMap/wwwroot/ios.css
```
Expected: zero hits in `wwwroot/css/styles.css` (no consumer yet — Phases 2–4 add them under `.platform-ios` selectors). The `--color-accent` declaration in `:root` is fine.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/ios.css
git commit -m "feat(ios.css): add system-blue --color-accent override under .platform-ios

#007AFF in light scheme, #0A84FF in dark scheme — the iOS shell uses Apple's
canonical interactive color. Browsers continue to render with brand teal."
```
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_C -->

---

<!-- START_SUBCOMPONENT_D (tasks 5-7) -->
<!-- START_TASK_5 -->
### Task 5: Write failing tests for `nativeBridge.js`

**Type:** Functionality (TDD red phase).

**Verifies:** ios-shell-polish.AC3.1, ios-shell-polish.AC3.2, ios-shell-polish.AC3.6.

**Files:**
- Create: `tests/js/nativeBridge.test.js` (new file)

**Implementation context:**

This is a TDD step — tests are written first to define the contract, then run to confirm they fail with the expected "module does not exist" error. Task 6 implements `nativeBridge.js` to make them pass.

**Test patterns to follow** (reference: `tests/js/roadTrip.test.js`, `tests/js/cachedFetch.test.js`):
- The setup file at `tests/js/setup.js` reads each `wwwroot/js/*.js` file as a string and evals it into globalThis. Since `nativeBridge.js` does not exist yet, the setup file will need to be updated in Task 6 to include it. The test file can read the source itself for re-eval idempotency tests (see roadTrip.test.js:186-215 for the canonical pattern).
- Each test resets `globalThis.Native` with `delete globalThis.Native` before re-eval where appropriate.
- Use `vi.fn()` for spies and `vi.spyOn()` for stubbing `navigator.share`, `window.confirm`, `globalThis.RoadTrip.isNativePlatform`.
- For dynamic-import simulation in tests, override the `_internals.import` seam (see Task 6) with `vi.fn().mockResolvedValue({ Haptics: ..., ImpactStyle: ..., NotificationType: ... })`.

**Tests to write** (describe blocks → cases):

1. **`describe('Native module exports')`**
   - `it('exposes globalThis.Native with the documented method surface')` — assert `Native.haptic`, `Native.share`, `Native.dialogConfirm`, `Native.dialogAlert`, `Native.statusBar`, `Native.install` are all functions; `Native._installed` and `Native._isNative` are defined (booleans). [AC3.2 surface check.]

2. **`describe('Native.install idempotency')`**
   - `it('re-evaluating the module does not re-run install side effects')` — install once, capture state (e.g., `Native._installed === true`), re-eval the source, dispatch any relevant event, assert install side effects did not stack. Pattern: same shape as `roadTrip.test.js:186-215`. [AC3.6.]

3. **`describe('Web fallbacks (RoadTrip.isNativePlatform === false)')`** — stub `RoadTrip.isNativePlatform` to return `false` for all tests in this block:
   - `it('Native.haptic is a no-op and resolves')` — call each of the six labels (`'light'`, `'medium'`, `'heavy'`, `'success'`, `'warning'`, `'error'`) with `await Native.haptic(label)`; each resolves to `undefined` without throwing. [AC3.2.]
   - `it('Native.haptic with unknown label resolves silently')` — `await Native.haptic('bogus')` resolves without throwing.
   - `it('Native.share with navigator.share available calls navigator.share')` — stub `navigator.share = vi.fn().mockResolvedValue(undefined)`; call `await Native.share({ title, url })`; assert `navigator.share` called with the same payload. [AC3.2.]
   - `it('Native.share without navigator.share falls through to clipboard')` — set `navigator.share = undefined`, stub `navigator.clipboard.writeText = vi.fn().mockResolvedValue(undefined)`; call `await Native.share({ title: 't', url: 'https://example.com' })`; assert `clipboard.writeText` called with the URL. [AC3.2.]
   - `it('Native.share when navigator.share rejects with AbortError resolves silently')` — user-cancel UX should not propagate as an error.
   - `it('Native.dialogConfirm falls through to window.confirm and returns { value: boolean }')` — stub `window.confirm = vi.fn().mockReturnValue(true)`; assert result is `{ value: true }`; repeat with `false`. [AC3.2.]
   - `it('Native.dialogAlert falls through to window.alert and resolves void')` — stub `window.alert = vi.fn()`; assert called and result is `undefined`. [AC3.2.]
   - `it('Native.statusBar is a no-op on web')` — `await Native.statusBar('light')` resolves; `await Native.statusBar('dark')` resolves; neither throws. [AC3.2.]

4. **`describe('Native bridge — iOS path (RoadTrip.isNativePlatform === true)')`** — stub `RoadTrip.isNativePlatform` to return `true`; override `_internals.import` to resolve with stub plugins:
   - `it('Native.haptic("light") calls Haptics.impact with ImpactStyle.Light')` — assert the mocked `Haptics.impact` was called with `{ style: 'LIGHT' }` (or the stub's `ImpactStyle.Light` constant). [AC3.1.]
   - Repeat for `medium` → `ImpactStyle.Medium`, `heavy` → `ImpactStyle.Heavy`. [AC3.1.]
   - `it('Native.haptic("success") calls Haptics.notification with NotificationType.Success')` — assert called with `{ type: 'SUCCESS' }`. [AC3.1.]
   - Repeat for `warning` and `error`. [AC3.1.]
   - `it('Native.share calls Share.share')` — assert mocked `Share.share` called with the payload.
   - `it('Native.dialogConfirm calls Dialog.confirm and returns { value: boolean }')` — assert mocked Dialog.confirm called; result is `{ value: <boolean> }`.
   - `it('Native.statusBar("dark") calls StatusBar.setStyle with Style.Light')` — note inversion: in the StatusBar plugin API, `Style.Light` means light status-bar text on dark backgrounds; `Style.Dark` means dark status-bar text on light backgrounds. The wrapper accepts the *intent* labels `'light'` and `'dark'` (the design plan's vocabulary, where `'dark'` means the chrome itself is dark text on a light bg). The wrapper translates: `'dark'` → `Style.Light` (dark text), `'light'` → `Style.Dark` (light text). Verify this translation exactly.

5. **`describe('Plugin import failure resilience')`** — set `_internals.import = vi.fn().mockRejectedValue(new Error('Module not found'))`; stub `isNativePlatform` true:
   - `it('Native.haptic resolves silently if dynamic import rejects')` — must not throw; failed haptics are best-effort.
   - `it('Native.share falls back to web path if dynamic import rejects')` — should fall through to `navigator.share` / clipboard.

**Step 1: Create the test file**

Write `tests/js/nativeBridge.test.js` with the test scaffolding for all the above. The test file will read `src/RoadTripMap/wwwroot/js/nativeBridge.js` itself (since setup.js doesn't yet load it) for the idempotency re-eval test. Use `fs.readFileSync` and `vm` patterns matching the existing test files.

**Step 2: Run tests and verify they fail**

```bash
npm test -- tests/js/nativeBridge.test.js
```

Expected: tests fail because `src/RoadTripMap/wwwroot/js/nativeBridge.js` does not exist yet. The failure should be a clear "ENOENT" or "Native is not defined" — that's correct red-phase signal.

**Step 3: Commit the failing tests**

```bash
git add tests/js/nativeBridge.test.js
git commit -m "test(native-bridge): add failing tests for Native.* wrapper

TDD red phase. Defines the contract:
- Method surface (haptic, share, dialogConfirm, dialogAlert, statusBar)
- Web fallbacks (haptic no-op, share via navigator.share/clipboard,
  dialog via window.confirm/alert, statusBar no-op)
- iOS path (dynamic-imports @capacitor/* and delegates)
- Idempotent install
- Status-bar style label inversion (intent 'dark'/'light' → plugin Style)
- Import-failure resilience"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Implement `nativeBridge.js` to pass the tests

**Type:** Functionality (TDD green phase).

**Verifies:** ios-shell-polish.AC3.1, ios-shell-polish.AC3.2, ios-shell-polish.AC3.6, ios-shell-polish.AC9.2.

**Files:**
- Create: `src/RoadTripMap/wwwroot/js/nativeBridge.js` (new IIFE module)
- Modify: `tests/js/setup.js` (add `nativeBridge.js` to the load order so other tests can rely on `globalThis.Native` being present in their realm)

**Implementation pattern** (verified against `roadTrip.js`, `offlineError.js`, `tripStorage.js`):

```javascript
globalThis.Native ??= {};

(function () {
    const N = globalThis.Native;
    if (N._installed) return;
    N._installed = true;

    // Internal seam for tests to override the dynamic import.
    N._internals = N._internals || { import: (spec) => import(spec) };

    N._isNative = !!(globalThis.RoadTrip && globalThis.RoadTrip.isNativePlatform && globalThis.RoadTrip.isNativePlatform());

    // ... method implementations (haptic, share, dialogConfirm, dialogAlert, statusBar) ...
})();
```

**Method shapes** (all return Promises so callers can `await` uniformly):

1. **`N.haptic(label)`** — `label` is one of `'light'|'medium'|'heavy'|'success'|'warning'|'error'`.
   - On web (`!N._isNative`): return `Promise.resolve()`.
   - On iOS: dynamic-import `@capacitor/haptics`, look up the right method/enum from this map:
     ```javascript
     const map = {
       light:   ['impact',       'Light'],
       medium:  ['impact',       'Medium'],
       heavy:   ['impact',       'Heavy'],
       success: ['notification', 'Success'],
       warning: ['notification', 'Warning'],
       error:   ['notification', 'Error'],
     };
     ```
     Call `Haptics.impact({ style: ImpactStyle[styleName] })` or `Haptics.notification({ type: NotificationType[styleName] })`.
   - Wrap the dynamic import in `try/catch` — if it rejects (module not installed), resolve silently.
   - Unknown labels resolve silently.

2. **`N.share({ title, url, text, dialogTitle })`** — payload mirrors `@capacitor/share` `ShareOptions`.
   - On iOS: dynamic-import `@capacitor/share`, call `Share.share(payload)`. On rejection, fall through to web path (so a missing/broken plugin doesn't deny the user a share).
   - On web: if `navigator.share` exists, `await navigator.share(payload)`. If `navigator.share` rejects with `AbortError` (user cancel), resolve silently. If `navigator.share` is undefined and `payload.url` is set, call `await navigator.clipboard.writeText(payload.url)` as a copy-to-clipboard fallback. Otherwise resolve silently.

3. **`N.dialogConfirm({ title, message, okButtonTitle, cancelButtonTitle })`** — returns `Promise<{ value: boolean }>`.
   - On iOS: dynamic-import `@capacitor/dialog`, call `Dialog.confirm(payload)`, return its result (already `{ value: boolean }`).
   - On web: return `{ value: window.confirm(message) }`. If `message` is missing, fall back to `title`.

4. **`N.dialogAlert({ title, message, buttonTitle })`** — returns `Promise<void>`.
   - On iOS: `Dialog.alert(payload)`.
   - On web: `window.alert(message || title)`.

5. **`N.statusBar(intent)`** — `intent` is `'light'` or `'dark'` (the *chrome* intent: `'dark'` = dark text on light bg, `'light'` = light text on dark bg).
   - On web: `Promise.resolve()` no-op.
   - On iOS: dynamic-import `@capacitor/status-bar`. Translate intent → plugin `Style`:
     - `'dark'` (dark text) → `Style.Light` (the plugin enum's "Light style" means dark text on light bg)
     - `'light'` (light text) → `Style.Dark` (the plugin enum's "Dark style" means light text on dark bg)
   - Call `StatusBar.setStyle({ style: Style[styleName] })`.
   - On rejection, swallow (status-bar errors are non-fatal).

6. **`N.install()`** — explicit no-op exposed for symmetry with the IIFE `_installed` check; calling it after the auto-install is a no-op (assert in tests via re-eval pattern). Implementation: simply ensure `N._installed = true` (already true after IIFE).

**Step 1: Write `src/RoadTripMap/wwwroot/js/nativeBridge.js`** matching the pattern above. Keep total file size ~120 lines. Match the IIFE shape of `roadTrip.js` exactly. No comments beyond the one-liner explaining the status-bar label inversion (the only non-obvious WHY in the file).

**Step 2: Update `tests/js/setup.js`** to load `nativeBridge.js` after `roadTrip.js` (so `RoadTrip.isNativePlatform` is available when nativeBridge inspects it). Find the load-order block in setup.js (around lines 28–60 per investigator findings) and insert `nativeBridge` immediately after `roadTrip`.

**Step 3: Run tests**

```bash
npm test -- tests/js/nativeBridge.test.js
```

Expected: every test in `nativeBridge.test.js` passes. If any fail, fix the implementation — never weaken the test.

**Step 4: Run full suite**

```bash
npm test
```

Expected: 607 baseline + new `nativeBridge.test.js` count = total passing.

**Step 5: Commit**

```bash
git add src/RoadTripMap/wwwroot/js/nativeBridge.js tests/js/setup.js
git commit -m "feat(native-bridge): implement Native.* wrapper module

IIFE module exposing globalThis.Native with haptic/share/dialogConfirm/
dialogAlert/statusBar. Dynamic-imports @capacitor/* plugins on iOS only;
on web, every method has a safe fallback.

- haptic: no-op on web, Haptics.impact/notification on iOS
- share: navigator.share or clipboard on web, Share.share on iOS
- dialogConfirm: window.confirm on web, Dialog.confirm on iOS
- dialogAlert: window.alert on web, Dialog.alert on iOS
- statusBar: no-op on web, StatusBar.setStyle on iOS (with intent-to-Style
  label inversion: 'dark' chrome intent maps to Style.Light plugin enum)

Idempotent install via _installed flag (matches roadTrip.js pattern).
Test seam: _internals.import for dynamic-import stubbing in vitest."
```
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Wire `<script src="js/nativeBridge.js">` into all four wwwroot HTML pages and add dual-tag `<meta name="theme-color">`

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC9.1 (no new HTML files), ios-shell-polish.AC9.2 (web bundle stays clean — wiring is a script tag, not an import), ios-shell-polish.AC2.1, ios-shell-polish.AC2.2 (theme-color meta supports dark mode in browsers).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/index.html`
- Modify: `src/RoadTripMap/wwwroot/create.html`
- Modify: `src/RoadTripMap/wwwroot/post.html`
- Modify: `src/RoadTripMap/wwwroot/trips.html`

**Implementation context** (verified at investigation time):

| File | Existing script order in `<head>` | Insert nativeBridge after |
|---|---|---|
| `index.html:7` | `roadTrip.js` | line 7 → insert at line 8 |
| `create.html:7-8` | `roadTrip.js`, `offlineError.js` | line 8 → insert at line 9 |
| `post.html:8-9` | `roadTrip.js`, `offlineError.js` | line 9 → insert at line 10 |
| `trips.html:7` | `roadTrip.js` | line 7 → insert at line 8 |

**Match the existing tag pattern.** None of the existing scripts use `defer`, and they use root-absolute paths (`/js/...`). New tag form:

```html
<script src="/js/nativeBridge.js"></script>
```

Place immediately after the last existing `<script src="/js/roadTrip|offlineError....js"></script>` line in `<head>`.

**Theme-color dual-tag** (per MDN: `<meta name="theme-color">` with `media` attribute is the W3C-supported pattern — confirmed for all modern browsers + iOS Safari):

Insert these two lines into each page's `<head>` (placement: immediately after the existing `<meta name="viewport">` line — find it with grep before editing). Light surface uses `#faf9f7` to match the existing `--color-bg`; dark surface uses `#000000` to match the dark-mode `--color-bg` from Task 3:

```html
<meta name="theme-color" content="#faf9f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
```

**Step 1: Edit each of the four files** — insert the `<script>` tag and the two `<meta>` tags. Verify line-by-line with `git diff` after each file.

**Step 2: Smoke-test in a desktop browser**

Open each of the four pages directly (or run `dotnet run --project src/RoadTripMap` and visit `http://localhost:5100/`, `http://localhost:5100/create`, etc.). DevTools console should be clean (no 404 for `js/nativeBridge.js`, no parse errors). The page should look identical to before (we haven't changed any visual rules yet).

**Step 3: Run tests**

```bash
npm test
```

Expected: full suite passes. The `bootstrap-loader.test.js` and other shell tests should not have regressed because they don't assert on the presence-or-absence of script tags in the wwwroot pages.

**Step 4: Commit**

```bash
git add src/RoadTripMap/wwwroot/index.html src/RoadTripMap/wwwroot/create.html src/RoadTripMap/wwwroot/post.html src/RoadTripMap/wwwroot/trips.html
git commit -m "feat(html): load nativeBridge.js + dual theme-color meta on all four pages

- <script src=\"/js/nativeBridge.js\"></script> after roadTrip/offlineError
  on each of index/create/post/trips. No defer, root-absolute path
  (matches the surrounding /js/... pattern).
- <meta name=\"theme-color\"> dual-tag with media=prefers-color-scheme so
  browser chrome (Android tab color, iOS Safari status-bar tint) tracks
  the OS theme."
```
<!-- END_TASK_7 -->
<!-- END_SUBCOMPONENT_D -->

---

<!-- START_SUBCOMPONENT_E (tasks 8) -->
<!-- START_TASK_8 -->
### Task 8: Cold-start status-bar in `src/bootstrap/loader.js`

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC3.5 (web fallback path; iOS exercise during Phase 6 sign-off).

**Files:**
- Modify: `src/bootstrap/loader.js` (cold-start install block, lines 2–62 per investigator)
- Modify: `tests/js/bootstrap-loader.test.js` (add coverage for the new statusBar call gating on `RoadTrip.isNativePlatform`)

**Implementation context:**

`loader.js` is the iOS shell's bootstrap orchestration module. The cold-start install block sets `platform-ios` on `<body>` (line 5), wraps `FetchAndSwap.fetchAndSwap` to re-inject ios.css after every swap, installs `Intercept`, then boots into the default trip URL.

The new behavior: after the `platform-ios` class is set and before the boot routing kicks off, call `Native.statusBar('dark')` so the iOS status bar uses dark text on the (light) app surface as the cold-start default. Wrap in a defensive guard so a failure in `Native` (e.g., not loaded yet, throws) does not break the bootstrap.

**Where to insert:** Read the file to find the exact line range. The new call belongs after the `document.body.classList.add('platform-ios')` line, inside the same try block. The shape:

```javascript
// After: document.body.classList.add('platform-ios');
try {
    if (globalThis.Native && typeof globalThis.Native.statusBar === 'function') {
        // Fire-and-forget; do not block bootstrap on plugin readiness
        void globalThis.Native.statusBar('dark');
    }
} catch (e) {
    // Status-bar style is cosmetic; never break bootstrap on a plugin error
}
```

Reasoning for `globalThis.Native &&` guard:
- `nativeBridge.js` ships as part of the `wwwroot` source. The bootstrap loader (`src/bootstrap/loader.js`) runs *before* the swapped-in document's scripts execute. On cold start, `globalThis.Native` will not exist yet — the guard prevents a `TypeError`.
- After the first document swap completes and `nativeBridge.js` has been executed, subsequent `loader.js` re-runs (if any) will find `globalThis.Native` populated.
- This is acceptable: cold-start `statusBar('dark')` is a "best-effort initial state" — every subsequent page-level call from `RoadTrip.onPageLoad` handlers (Phases 2–4) gets a real chance to hit the plugin.

Alternative considered and rejected: defer `statusBar('dark')` until after the first document swap by hooking into `_swapFromHtml`. Rejected because it adds a coupling between loader and shell internals that isn't necessary — the cold-start call is a "setup once, ignore failures" call.

**Test update** (`tests/js/bootstrap-loader.test.js`):

Add cases inside the existing describe blocks:
- `it('calls Native.statusBar("dark") on cold start when Native is available')` — set up `globalThis.Native = { statusBar: vi.fn().mockResolvedValue(undefined) }`, run loader bootstrap, assert `Native.statusBar` called with `'dark'`.
- `it('does not throw on cold start when Native is undefined')` — leave `globalThis.Native` undefined, run loader bootstrap, assert it completes without throwing.
- `it('swallows errors from Native.statusBar to avoid breaking bootstrap')` — set up `globalThis.Native = { statusBar: vi.fn().mockRejectedValue(new Error('plugin failure')) }`, run bootstrap, assert it completes without throwing.

**Step 1: Read `src/bootstrap/loader.js`** with the Read tool to locate the cold-start block (currently lines 1–67 per investigator).

**Step 2: Insert the guarded `Native.statusBar('dark')` call** after the `platform-ios` body-class line.

**Step 3: Add the three test cases** to `tests/js/bootstrap-loader.test.js`.

**Step 4: Run tests**

```bash
npm test
```

Expected: full suite passes including new bootstrap-loader cases.

**Step 5: Commit**

```bash
git add src/bootstrap/loader.js tests/js/bootstrap-loader.test.js
git commit -m "feat(bootstrap): cold-start Native.statusBar('dark') in loader.js

Sets the initial iOS status-bar style to dark text on light bg (the app's
default surface) before the first document swap. Guarded with a defensive
check on globalThis.Native — bootstrap precedes nativeBridge.js execution
on cold start, so the call may be a no-op the very first time. Per-page
overrides via RoadTrip.onPageLoad handlers (Phases 2-4) take over after
the first swap. Errors from the plugin are swallowed; status-bar style
never blocks bootstrap."
```
<!-- END_TASK_8 -->
<!-- END_SUBCOMPONENT_E -->

---

<!-- START_SUBCOMPONENT_F (tasks 9-10) -->
<!-- START_TASK_9 -->
### Task 9: Verify `npm run build:bundle` regenerates `asset-manifest.json` with `nativeBridge.js`

**Type:** Infrastructure verification.

**Verifies:** None directly (supports AC9.2 by confirming the asset pre-cache will distribute `nativeBridge.js` to iOS shell users without manual registration).

**Files:**
- Verify: `src/RoadTripMap/wwwroot/asset-manifest.json` (regenerated artifact)
- Possibly modify: `src/RoadTripMap/wwwroot/asset-manifest.json` (if the build regenerates it with new content, commit the diff)
- Possibly modify: `src/RoadTripMap/wwwroot/bundle/*` (regenerated; commit if changed)

**Implementation context:**

Per CLAUDE.md, both `asset-manifest.json` and the `bundle/` directory are generated artifacts that are checked into the repo (so prod App Service serves them without a JS build step). After adding `nativeBridge.js` to `wwwroot/js/`, the asset manifest must be regenerated and committed.

**Step 1: Run the build**

```bash
npm run build:bundle
```

Expected output: the script reports success and runs `node --check` on the concatenated bundle without errors. (If `node --check` fails, the most likely cause is that `nativeBridge.js`'s top-level structure isn't IIFE-wrapped correctly — see CLAUDE.md gotchas about duplicate-const cascades from `build-bundle.js`.)

**Step 2: Verify asset-manifest.json includes nativeBridge.js**

```bash
grep -c "nativeBridge" src/RoadTripMap/wwwroot/asset-manifest.json
```
Expected: at least 1 hit.

**Step 3: Verify bundle/app.js contains the IIFE source**

```bash
grep -c "globalThis.Native" src/RoadTripMap/wwwroot/bundle/app.js
```
Expected: at least 1 hit.

**Step 4: Commit the regenerated artifacts**

```bash
git add src/RoadTripMap/wwwroot/asset-manifest.json src/RoadTripMap/wwwroot/bundle/
git commit -m "build: regenerate asset-manifest.json + bundle for nativeBridge.js

Auto-discovered by scripts/build-bundle.js. The iOS shell's asset pre-cache
will pick up nativeBridge.js automatically on the next /asset-manifest.json
fetch."
```

If `git status` shows no changes to these files after running `build:bundle`, the manifest was already up-to-date because the executor previously ran the build — that's fine, skip the commit step for unchanged files.
<!-- END_TASK_9 -->

<!-- START_TASK_10 -->
### Task 10: Final verification — tests + .NET build

**Type:** Infrastructure verification.

**Verifies:** ios-shell-polish.AC8.1 (`npm test` passes), ios-shell-polish.AC8.2 (`dotnet test` passes).

**Files:** None modified.

**Step 1: Run JS test suite**

```bash
npm test
```

Expected: all tests pass. Baseline was 607 tests across 32 files; new file `nativeBridge.test.js` adds ~25 tests (exact count depends on the executor's test breakdown). Final: ~30+ test files, ~630+ tests, 0 failures.

**Step 2: Run .NET test suite**

```bash
dotnet test RoadTripMap.sln
```

Expected: all tests pass. Phase 1 made no .NET changes, so this should be a no-op verification but is required by AC8.2.

**Step 3: Confirm Info.plist key (verification only — no changes)**

```bash
grep -A1 "UIViewControllerBasedStatusBarAppearance" ios/App/App/Info.plist
```

Expected output includes `<true/>` on the line after the key. (Investigator confirmed this was already present.) If the value is `<false/>` or missing, change it to `<true/>` and commit.

**Step 4: No commit** (verification-only task). If the Info.plist needed a fix, commit:

```bash
git add ios/App/App/Info.plist
git commit -m "chore(ios): set UIViewControllerBasedStatusBarAppearance=true in Info.plist

Required by @capacitor/status-bar for runtime style changes."
```

**Step 5: Patrick's manual sync (out of executor's scope)**

Per CLAUDE.md, `npx cap sync ios` and Xcode build are Patrick-only operations. Do **NOT** run them from this task. Instead, output a final note for Patrick:

> "Phase 1 implementation complete. Patrick: please run `npx cap sync ios` locally and confirm in Xcode that the app launches and behaves identically to before this phase (no visual regression, no plugin errors in the Xcode console). Phase 1 is done when you confirm."
<!-- END_TASK_10 -->
<!-- END_SUBCOMPONENT_F -->

---

## Phase 1 done-when checklist

- [ ] Task 1: Four `@capacitor/*` plugins installed at `^8.x`, lockfile committed.
- [ ] Task 2: `:root` extended with type/color-semantic/material/motion/radius tokens; legacy tokens unchanged.
- [ ] Task 3: `@media (prefers-color-scheme: dark)` block in `styles.css` overrides color tokens only.
- [ ] Task 4: `.platform-ios { --color-accent: #007AFF }` (light) and `#0A84FF` (dark) in `ios.css`.
- [ ] Task 5: Failing tests for `nativeBridge.js` committed (TDD red).
- [ ] Task 6: `nativeBridge.js` implemented + setup.js updated; all `nativeBridge.test.js` cases pass.
- [ ] Task 7: `<script src="js/nativeBridge.js">` and dual `<meta name="theme-color">` on all four wwwroot pages.
- [ ] Task 8: `loader.js` cold-start calls `Native.statusBar('dark')` with defensive guard; bootstrap-loader tests cover the three cases.
- [ ] Task 9: `npm run build:bundle` produces clean bundle + asset-manifest with `nativeBridge.js`.
- [ ] Task 10: `npm test` passes (baseline + new); `dotnet test` passes; Info.plist key verified.
- [ ] **Patrick:** `npx cap sync ios` + Xcode build + visual no-regression check.
