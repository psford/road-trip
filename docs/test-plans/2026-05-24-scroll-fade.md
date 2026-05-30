# Scroll-fade Pattern — Human Test Plan

**Branch:** `scroll-fade` (HEAD `9ab5324` at plan write time)
**Implementation plan:** [`docs/implementation-plans/2026-05-24-scroll-fade/`](../implementation-plans/2026-05-24-scroll-fade/)
**Design plan:** [`docs/design-plans/2026-05-24-scroll-fade.md`](../design-plans/2026-05-24-scroll-fade.md)

## Coverage summary

- **Automated AC count:** 23 covered / 23 in-scope (excludes AC3.x deferred, AC5.4 manual on-device, AC4.7 / AC7.3 / AC7.4 PR-review gates)
- **Vitest:** 38 files / 719 tests passing (includes new `pinnedStack.test.js` and `scrollFadeSourceInvariants.test.js`)
- **Playwright layout:** 18/18 passing on mobile-webkit

## Prerequisites

- Local checkout on branch `scroll-fade`
- `dotnet run --project src/RoadTripMap` running locally on port 5100 (or any reachable App Service deploy)
- macOS with Chrome, Safari, Firefox installed
- Xcode + iOS Simulator (iPhone 15 / 16 / Pro form factor with Dynamic Island)
- A real iPhone for the final AC5.4 gate
- `npm test` and `npm run test:layout` both green locally — this is AC4.7's reviewer gate

---

## Phase 1: Mac browser smoke — Chrome, Safari, Firefox

For each browser, run all rows. Use any existing trip's secret token.

| # | Action | Expected |
|---|--------|----------|
| 1.1 | Navigate to `http://localhost:5100/post/{any-token}` | Page loads; header reads "Trip name…" then resolves; pinned header at viewport top with "Add Photo" beneath |
| 1.2 | Scroll the photo list (wheel / two-finger) | Content scrolls; pinned header + Add Photo button stay locked at top; content fades to transparent before crossing under the header |
| 1.3 | After scrolling 800+ px, click "Add Photo" | File picker opens (button stayed reachable — AC4.2 smoke) |
| 1.4 | Console: `getComputedStyle(document.body).overflow` | `'hidden'` (AC1.3) |
| 1.5 | Console: `document.documentElement.style.getPropertyValue('--pinned-stack-height')` | `Npx` with positive integer (AC4.3) |
| 1.6 | Console: `getComputedStyle(document.querySelector('.scroll-content')).maskImage \|\| getComputedStyle(document.querySelector('.scroll-content')).webkitMaskImage` | `linear-gradient(...)` string containing the px value from 1.5 (AC1.4 / AC4.5) |
| 1.7 | Toggle macOS Dark Mode without reloading, then reload | Pinned header background flips to `rgb(0, 0, 0)`; fade still works; mask transition appears identical (AC2.1 / AC2.3) |
| 1.8 | Switch back to Light Mode, reload | Header background returns to `rgb(250, 249, 247)` (AC2.2) |
| 1.9 | Navigate to `http://localhost:5100/create` | Pinned header + form; no Add Photo button in pinned area (AC1.2); same fade behavior |
| 1.10 | Console on `/create`: `getComputedStyle(document.body).overflow` | `'hidden'` (AC1.3) |
| 1.11 | Repeat 1.1–1.10 in Chrome, Safari, Firefox | Identical across engines |

## Phase 2: Mobile WebKit visual checks (not automated)

Playwright `mobile-webkit` covers the 18 assertions. The items below benefit from human eyes.

| # | Action | Expected |
|---|--------|----------|
| 2.1 | Chrome DevTools → Device Toolbar → "iPhone 14 Pro" → load `/post/{token}` | Pinned header at viewport top; 8px fade feather smooth, no hard edge or content peek above the band |
| 2.2 | While scrolled mid-list, drag the responsive viewport handle | Pinned-stack height re-computes within ~1 frame; mask anchor + scroll-content padding follow (AC1.5 visual gut-check) |
| 2.3 | In console set `document.getElementById('tripName').textContent` to a 100-char string | Header wraps; var updates; mask/padding follow; no visible content jumps |

## Phase 3: iOS Simulator — pinned chrome below status bar

| # | Action | Expected |
|---|--------|----------|
| 3.1 | `node scripts/dev-ios-on.js && dotnet run --project src/RoadTripMap --urls "http://0.0.0.0:5100"` in one terminal, `npx cap sync ios` in another, then Xcode Run on an iPhone 15/16 Pro simulator | App boots through offline shell; loader routes to a trip post page |
| 3.2 | Observe pinned header on the post page | Header sits below Dynamic Island / status bar (env(safe-area-inset-top) inset above header); no overlap |
| 3.3 | Scroll the photo list | Content fades into the frosted pinned region (`.platform-ios .pinned-stack` → `--material-bg-light` + backdrop-filter, not solid `--color-bg`); Add Photo button reachable |
| 3.4 | Simulator menu Features → Toggle Appearance | Pinned header switches to dark frosted material (`rgba(28,28,30,0.72)`); fade still smooth |
| 3.5 | Repeat on non-notch simulator (iPhone SE 3rd gen) | `env(safe-area-inset-top)` falls back to 0px; header at viewport top |
| 3.6 | Safari Web Inspector attached to Simulator: `getComputedStyle(document.body).overflow` on `/post/...` | `'hidden'` (AC1.3 holds in WKWebView) |
| 3.7 | In inspector run `window.scrollTo(0, 800)` then check `document.querySelector('.scroll-content').scrollTop` | `window.scrollTo` is a no-op (body has overflow:hidden) — confirms the CLAUDE.md gotcha |

## Phase 4: iOS real device — AC5.4 final gate

| # | Action | Expected |
|---|--------|----------|
| 4.1 | After `npx cap sync ios` + Xcode build to your real iPhone, open the app and navigate to a post page | **AC5.4:** Pinned header sits cleanly below status bar / Dynamic Island; trip name legible; Add Photo at expected y |
| 4.2 | Scroll the photo list vigorously up and down | No fixed-element jitter (`will-change: transform` mitigates WebKit Bug #297779); fade smooth on real WKWebView |
| 4.3 | Toggle iOS Dark Mode in Control Center | Frosted material flips; chrome stays readable |
| 4.4 | Background and re-foreground | Header position remains correct (no shift from `contentInset: 'automatic'` re-evaluation) |

## Phase 5: Regression spot-check — out-of-scope pages

| # | Action | Expected |
|---|--------|----------|
| 5.1 | Navigate to `http://localhost:5100/` | Body scrolls normally; no `.pinned-stack`; layout indistinguishable from pre-PR |
| 5.2 | Console: `document.querySelectorAll('.pinned-stack, .scroll-content').length` | `0` (AC7.1) |
| 5.3 | Navigate to `http://localhost:5100/trips/{any-view-token}` | Map page full-viewport; `.map-header` at top (z-index 1000); map carousel at bottom |
| 5.4 | Console on trips page: same query as 5.2 | `0` (AC7.2) |
| 5.5 | PR diff in GitHub: `wwwroot/*.html` changes | Limited to `post.html` and `create.html` (AC7.4 reviewer gate) |

## Phase 6: PR-diff inspection (AC4.7 + AC7.3)

| # | Action | Expected |
|---|--------|----------|
| 6.1 | Confirm `npm test` and `npm run test:layout` both green locally | All green; AC4.7 process gate (CI doesn't run JS / layout tests per CLAUDE.md) |
| 6.2 | In the PR diff, search added lines for `@media (prefers-reduced-motion)` | Zero new blocks added (AC7.3). Baseline blocks at `styles.css:1475` and in `ios.css` are pre-existing |
| 6.3 | Confirm `wwwroot/*.html` changes limited to `post.html` + `create.html` | AC7.4 satisfied |

## End-to-end: Banner regression (manual confirmation of AC6.4)

Automated already, but a live eyeball check catches things automation misses (visible jump, mask anchor shift).

1. Open `http://localhost:5100/post/{any-token}`
2. Console: `const before = document.documentElement.style.getPropertyValue('--pinned-stack-height'); console.log('before', before);`
3. Inject a banner:
   ```js
   const banner = document.createElement('div');
   banner.id = 'fakeBanner';
   banner.style.cssText = 'height:160px; background:red; margin:10px;';
   document.getElementById('resumeBannerContainer').appendChild(banner);
   ```
4. Wait one second, then `console.log('after', document.documentElement.style.getPropertyValue('--pinned-stack-height'));`
5. **Expected:** `before === after`; mask anchor unchanged; red banner fades into the pinned region on scroll like any other content
6. Cleanup: `document.getElementById('fakeBanner').remove();`

## End-to-end: First-paint contract

Verify the `var(--pinned-stack-height, 120px)` fallback works before `PinnedStack.install()` lands.

1. DevTools Network → throttle to "Slow 3G"
2. Reload `/post/{token}`
3. During the window before `pinnedStack.js` loads: mask + padding-top should still render reasonably (literal `120px` fallback) — no zero-height collapse or content scrolling fully revealed behind the header
4. Once the script loads and writes the precise value, layout should refine without a visible jump

## Human verification required (summary)

| Criterion | Why manual | Step |
|-----------|------------|------|
| AC5.4 | Real iOS device — safe-area inset only resolves on real notch/Dynamic Island hardware | Phase 4 |
| AC7.3 | Static regex can't distinguish "added in this PR" from baseline `prefers-reduced-motion` block | Phase 6.2 |
| AC7.4 | Generalized "no pattern expansion"; AC7.1/7.2 grep catches literal class adds but not arbitrary structural copies | Phase 6.3 |
| AC4.7 | Process gate; CI does not run JS / layout tests | Phase 6.1 |
| Visual fade quality | 8px feather smoothness is subjective | Phase 1.2, 3.3, 4.2 |

## Traceability matrix

| AC | Automated test | Manual step |
|----|----------------|-------------|
| AC1.1 | `layout.spec.js` (pinned-stack-top, fileInput recreate) | 1.1, 3.2 |
| AC1.2 | `layout.spec.js` (create-page pinned-stack-top + body-overflow) | 1.9 |
| AC1.3 | `layout.spec.js` (body overflow hidden post + create) | 1.4, 1.10, 3.6 |
| AC1.4 | `layout.spec.js` (mask-image gradient test) | 1.6 |
| AC1.5 | `layout.spec.js` (height-resize) + `pinnedStack.test.js` (px-value write) | 2.3 |
| AC1.6 | `pinnedStack.test.js` (missing-element guard) | covered |
| AC2.1 | `layout.spec.js` (dark `--color-bg`) | 1.7, 3.4 |
| AC2.2 | `layout.spec.js` (light `--color-bg`) | 1.8 |
| AC2.3 | Transitively via AC1.4 | 1.7 (visual identity) |
| AC2.4 | `scrollFadeSourceInvariants.test.js` (light-dark grep × 2) | covered |
| AC3.1–3.3 | DEFERRED (bugs/ dir doesn't exist) | n/a |
| AC4.1 | `layout.spec.js` (pinned-stack-stays-fixed-after-scroll) | 1.2 |
| AC4.2 | `layout.spec.js` (button-reachable-after-800px) | 1.3 |
| AC4.3 | `layout.spec.js` (var matches `/^\d+px$/`) | 1.5 |
| AC4.4 | `layout.spec.js` (padding-top equals var) | covered |
| AC4.5 | `layout.spec.js` (mask references var) | 1.6 |
| AC4.6 | `pinnedStack.test.js` (RO identity + re-eval idempotency) | covered |
| AC4.7 | PR-review gate | 6.1 |
| AC5.1 | `scrollFadeSourceInvariants.test.js` (no sticky in `.platform-ios .page-header`) | covered |
| AC5.2 | `scrollFadeSourceInvariants.test.js` (env safe-area-inset-top) | 3.2, 4.1 |
| AC5.3 | `scrollFadeSourceInvariants.test.js` (contentInset 'automatic') | covered |
| AC5.4 | None (manual gate) | 4.1 |
| AC6.1–6.3 | `layout.spec.js` (banner placement iteration) | covered |
| AC6.4 | `layout.spec.js` (banner-mount-doesn't-change-var) | "Banner regression" E2E above |
| AC7.1 | `scrollFadeSourceInvariants.test.js` (index.html grep) | 5.1, 5.2 |
| AC7.2 | `scrollFadeSourceInvariants.test.js` (trips.html grep) | 5.3, 5.4 |
| AC7.3 | PR-review (diff inspection) | 6.2 |
| AC7.4 | PR-review (file-list inspection) | 5.5, 6.3 |
