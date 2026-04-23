# iOS Shell Hardening — Phase 8: On-device smoke + CLAUDE.md update

**Goal:** Create an on-device smoke checklist next to this implementation plan, run it on a real iPhone, and update the top-level `CLAUDE.md` with the new invariants, key files, gotchas, and freshness date so the project documentation reflects the post-hardening contract.

**Architecture:** Two deliverables. (1) A checklist document (`docs/implementation-plans/2026-04-21-ios-shell-hardening/smoke-checklist.md`) that enumerates every on-device validation Phases 1–7 deferred — console cleanliness across multi-page navigation, offline create + trip-page flows, share-link correctness in Safari, safe-area visual correctness on each page, HIG tap targets, caption/autocapitalize input behavior, and Issue #7 repro. (2) A surgical update to `CLAUDE.md` — four new Invariants, three new Key Files, a few Gotchas, and a freshness-date bump — with precise insertion anchors identified below.

**Tech Stack:** Markdown only.

**Scope:** Phase 8 of 8 from `docs/design-plans/2026-04-21-ios-shell-hardening.md`.

**Codebase verified:** 2026-04-22 (branch `ios-offline-shell`).

**Branch:** `ios-offline-shell` (same as Phases 1–7).

**Dependencies:** Phases 1–7 complete (all code + tests landed; `npm test` green).

---

## Acceptance Criteria Coverage

None directly. Phase 8 collectively validates every AC from Phases 1–7 against an on-device run and records the end state in `CLAUDE.md`. Specifically:

- The smoke checklist captures the on-device verification steps for AC1 (cascade-free navigation), AC2.event.1 + AC2.scope.* (lifecycle + page-scope behavior), AC3.3 (share-link https), AC4.3 (offline create copy), AC5.2 / AC5.3 (offline photo list and banner), AC6.safeArea.* (visual safe-areas), AC6.hig.* (tap targets + keyboard attrs + momentum scroll), and AC7.1 (Issue #7 repro).

---

## Codebase baseline (verified 2026-04-22)

Top-level `CLAUDE.md` section anchors (line numbers at time of writing):

- Line 3: `Last verified: 2026-04-20` — Phase 8 updates this.
- Line 30: `## Contracts`.
- Line 81: `## Invariants`.
- Line 99: `## Key Files`.
- Line 147: `## Gotchas`.

The file uses `- ...` bullet lists inside each section. Phase 8 appends new bullets at the end of each target section (before the next `##` heading) to avoid line-number churn on the existing bullets.

Current `## Invariants` section already contains an iOS-Offline-Shell bullet about the page cache — Phase 8 does NOT modify that bullet; it adds four new bullets after it.

Current `## Key Files` section already lists `src/bootstrap/fetchAndSwap.js`, `src/bootstrap/cachedFetch.js`, `src/bootstrap/loader.js`, `src/bootstrap/intercept.js`, `src/bootstrap/tripStorage.js`, `src/bootstrap/fallback.html`. Phase 8 adds three new entries for `listenerShim.js`, `roadTrip.js`, `offlineError.js`.

Current `## Gotchas` section covers the "inline scripts in wwwroot" situation in general terms but does NOT yet mention the Phase 3 script-src dedup details or the Phase 5 blob-image offline limitation. Phase 8 adds two new bullets.

---

## Tasks

<!-- START_TASK_1 -->
### Task 1: Create `smoke-checklist.md`

**Verifies:** Operational — provides the on-device validation artifact that Patrick runs through on an iPhone.

**Files:**
- Create: `docs/implementation-plans/2026-04-21-ios-shell-hardening/smoke-checklist.md`.

**Contents (verbatim):**

```markdown
# iOS Shell Hardening — On-device Smoke Checklist

Run on an iPhone 12 or newer with a notch and home indicator. Best to run with the Xcode device console attached so you can observe console output. Test both Wi-Fi and airplane-mode flows. The branch under test is `ios-offline-shell` after Phases 1–7 have landed.

## Signoff metadata

- Device: ___________
- iOS version: ___________
- App build: ___________
- Tester: ___________
- Date: ___________

## Section 1 — Cascade-free navigation (AC1, AC2.event, AC2.scope, AC7)

- [ ] Launch app, observe console is clean.
- [ ] Navigate home → post (any saved trip) → create → post → home → post (5+ navigations).
- [ ] After each swap, console shows no `SyntaxError: Can't create duplicate variable` and no warning about duplicate listeners firing.
- [ ] On the post page, `PostUI.init` runs exactly once per visit (verify by setting `console.log` in DevTools if needed, or by confirming upload form is in initial state on each arrival).
- [ ] `versionProtocol.js` init runs on every page (confirm via any existing `x-client-min-version` logging).
- [ ] (AC7.1) With device in airplane mode, try to navigate to a trip URL that has NEVER been visited before. `fetchAndSwap` fails cleanly — console shows the failure but NO cascade of follow-up errors.

## Section 2 — Share-trip link (AC3.3)

- [ ] Navigate to a post page (as owner). Tap "Copy" on the share-view link.
- [ ] Paste the copied text into Messages (or any other app on the same device) — it reads `https://app-roadtripmap-prod.azurewebsites.net/trips/{viewGuid}`. It MUST NOT start with `capacitor://`.
- [ ] Paste into Safari on a SECOND device — Safari opens the trip view-only page (no auth prompt; trip renders).
- [ ] On the post page, tap a photo's share action (the native iOS share sheet). The URL passed to the share sheet is the same `https://app-roadtripmap-prod.azurewebsites.net/...` form.

## Section 3 — Offline create (AC4.3)

- [ ] Go to the create page while online. Confirm form loads normally.
- [ ] Turn on airplane mode.
- [ ] Fill out a trip name + description. Submit.
- [ ] The form displays `"Can't create a trip while offline. Try again when you're back online."` in the error area. The button is re-enabled. No raw `"Load failed"` or other internal error string is visible.

## Section 4 — Offline trip-page photos (AC5.2, AC5.3, post-page toast)

- [ ] While online, visit a trip view link (`/trips/{viewGuid}`). Photos load and render.
- [ ] Exit the app. Turn on airplane mode. Relaunch the app. Re-visit the SAME trip view link.
- [ ] The photo LIST renders (thumbs may show broken-image placeholders — this is the documented Azure-blob limitation).
- [ ] Still offline, visit a NEW trip view link that has never been cached. An offline-friendly message is shown (not a blank screen).
- [ ] Open a post page (owner) while offline. If the previous session cached no photos, the offline-friendly toast reads `"Photos unavailable offline. Reconnect to see the latest."`.

## Section 5 — Safe-areas (AC6.safeArea)

- [ ] On every page (`/`, `/create`, `/post/{token}`, `/trips/{viewToken}`), visually confirm no element is clipped by the notch or the home indicator.
- [ ] `.map-header` (trips.html) sits beneath the notch with full visibility.
- [ ] `.page-header` on create and post does not overlap the notch.
- [ ] `.hero` on index does not overlap the notch.
- [ ] `.resume-banner` (post page, when a paused upload exists) does not overlap the notch.
- [ ] `.toast-container` (post page) floats above the home indicator.
- [ ] `.view-carousel-container` (trips page, when a photo is open) floats above the home indicator.
- [ ] `.map-control` (trips page) floats above the home indicator.
- [ ] `.homescreen-modal-overlay` (post page modals) has visible margin above the notch and above the home indicator.

## Section 6 — HIG tap targets + momentum scroll (AC6.hig.1, AC6.hig.2)

- [ ] On the post page, every small button (`.copy-button`, `.carousel-action-btn`, `.photo-popup-delete`, `.upload-panel__toggle`, `.upload-panel__retry`/`pin-drop`/`discard`) feels at-least-44×44pt to tap — no near-misses, no needing a stylus.
- [ ] On the trips page, `.map-back` and `.poi-action-btn` buttons feel similarly full-sized.
- [ ] `.upload-panel__body` (the list of in-flight uploads on the post page) scrolls with native iOS momentum/inertia when flicked (not sticky/stuck).

## Section 7 — Keyboard attributes (AC6.hig.3, AC6.hig.4)

- [ ] On post, tap the `#captionInput` field. The iOS keyboard shows with auto-capitalization enabled — the first letter of a new sentence auto-capitalizes. Typing a misspelled word offers autocorrect suggestions.
- [ ] On create, tap the `#tripName` field. Auto-capitalization is in "words" mode — each word's first letter auto-capitalizes (title-case feel).
- [ ] On create, tap the `#tripDescription` field. Auto-capitalization is in "sentences" mode — first letter of each sentence capitalizes.

## Section 8 — Regression and sign-off

- [ ] The regular-browser experience (open `https://app-roadtripmap-prod.azurewebsites.net/` in Safari on a non-notched device or iPad) is visually unchanged: no `.platform-ios` styles leaking, no padding differences, no missing elements.
- [ ] No outstanding error toasts or console warnings on any page.
- [ ] Patrick's signoff: ___________  Date: ___________

## Follow-up (if any AC failed)

If Section 1's AC7.1 repro still produces a cascade after Phase 3 landed, open a new issue (title: "iOS shell: post-failure cascade persists after script-src dedup (AC7.2)") with the console trace attached, then mark Phase 8 checkable regardless — AC7.2 explicitly does not block plan completion.

Any other AC failure: open an issue tagged `ios-offline-shell`, link from the design plan's Definition of Done, and do NOT sign off Section 8 until resolved.
```

**Verification:**
- `ls docs/implementation-plans/2026-04-21-ios-shell-hardening/smoke-checklist.md` → exists.
- Document is readable Markdown; every AC listed in Phases 1–7 is covered by at least one checkbox.

**Commit:** `docs(ios-shell-hardening): add on-device smoke checklist`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update `CLAUDE.md` — Invariants, Key Files, Gotchas, freshness date

**Verifies:** Operational — brings project documentation in sync with the hardened contract.

**Files:**
- Modify: `CLAUDE.md` — freshness date at line 3; append to `## Invariants` (currently starts at line 81); insert into `## Key Files` (currently starts at line 99); append to `## Gotchas` (currently starts at line 147).

**Change 1 — Freshness date (line 3):**

Current:
```
Last verified: 2026-04-20
```

Target:
```
Last verified: 2026-04-22
```

**Change 2 — Append to `## Invariants` section (before the next `##` heading, which is `## Key Files` at line 99). Add these four bullets as a contiguous block at the end of the Invariants list:**

```markdown
- Page scripts in `wwwroot/js/*` register lifecycle handlers via `RoadTrip.onPageLoad(pageName, fn)` — never raw `document.addEventListener('DOMContentLoaded', ...)`. The shell fires `app:page-load` on document `document` after every swap; in regular browsers `RoadTrip` synthesizes `app:page-load` once from the real `DOMContentLoaded`. Handlers are filtered by `document.body.dataset.page === pageName` (or `'*'` for cross-cutting concerns)
- Shell `_recreateScripts` (`src/bootstrap/fetchAndSwap.js`) tracks executed external-script `src` URLs in a module-scoped `Set` and skips re-injection on subsequent swaps; inline `<script>` blocks always re-execute, so wwwroot inline scripts MUST NOT declare top-level `const` / `let` (wrap in an IIFE). The `_executedScriptSrcs` set is exposed on `globalThis.FetchAndSwap` for test inspection
- `RoadTrip.appOrigin()` is the only sanctioned way to assemble shareable URLs in page scripts — returns the baked-in App Service hostname (`https://app-roadtripmap-prod.azurewebsites.net`) in the iOS shell, `window.location.origin` in a regular browser. `window.location.origin` MUST NOT be used for user-facing URL copy/share/display — it leaks `capacitor://localhost` out of the shell
- Every `wwwroot/*.html` page's `<body>` carries a `data-page` attribute (values: `home`, `create`, `post`, `view`). `RoadTrip.onPageLoad` reads it to scope handler dispatch without pathname-sniffing
```

**Change 3 — Insert three new Key Files entries into the `## Key Files` section. Insert them alongside the other `src/bootstrap/` entries (near the existing listings for `fetchAndSwap.js`, `cachedFetch.js`, `tripStorage.js`, `loader.js`, `intercept.js`, `fallback.html`) and the existing `wwwroot/js/*` entries:**

Add these three bullets (positioned for readability — group `wwwroot/js/` entries with other `wwwroot/js/` entries; place `listenerShim.js` next to the other `src/bootstrap/` entries):

```markdown
- `src/bootstrap/listenerShim.js` -- IIFE; exposes `globalThis.ListenerShim = { install, clearPageLifecycleListeners, _internals }`. Wraps `document.addEventListener` / `removeEventListener` to track `DOMContentLoaded` and `load` registrations on `document` only. `clearPageLifecycleListeners()` bulk-removes tracked handlers via the real (un-wrapped) `removeEventListener`, called by `_swapFromHtml` before dispatching `app:page-load` so stale lifecycle handlers don't accumulate across swaps. Auto-installs on load; `install()` is idempotent
- `src/RoadTripMap/wwwroot/js/roadTrip.js` -- IIFE; exposes `globalThis.RoadTrip = { appOrigin, isNativePlatform, onPageLoad, _installed, _firedOnce }`. Idempotent install via `globalThis.RoadTrip ??= {}`. `onPageLoad(pageName, fn)` subscribes to `app:page-load` and gates on `document.body.dataset.page === pageName` (or `'*'` wildcard). In regular browsers, installs a one-shot `DOMContentLoaded → dispatch('app:page-load')` bridge so one code path fires in both runtimes. Late registrations (after the event already dispatched in the realm) catch up via a microtask
- `src/RoadTripMap/wwwroot/js/offlineError.js` -- IIFE; exposes `globalThis.OfflineError = { isOfflineError, friendlyMessage }`. `isOfflineError(err)` returns true for `TypeError` (fetch network failure), `DOMException NetworkError`, or whenever `navigator.onLine === false`. `friendlyMessage(err, context)` returns a per-context copy string for `'create'`, `'photos'`, `'generic'`; non-offline errors fall through to `err.message || 'Something went wrong.'`
```

**Change 4 — Append to `## Gotchas` section. Add these two bullets at the end of the Gotchas list (before the `---` separator or next major section):**

```markdown
- The iOS Offline Shell caches the trip-photo LIST (JSON) through `CachedFetch.cachedFetch(url, { asJson: true })` after `api.js:getTripPhotos` lands the Phase 5 hardening. Individual photo image URLs (Azure Blob) are NOT cached — on an offline repeat-visit the cached list renders, but the `<img>` thumbnails fail network and show as broken-image placeholders. This is an accepted scope boundary (list visibility > image visibility offline)
- Script-src dedup in `_recreateScripts` (`src/bootstrap/fetchAndSwap.js`) skips re-injection for external scripts that have already executed in the realm. Inline `<script>` blocks always re-execute on every document swap. This means a new inline `<script>` that declares a top-level `const`/`let`/`function` in any `wwwroot/*.html` page WILL regress the duplicate-const cascade on the second visit. Existing inline blocks on `index.html` and `trips.html` are IIFE-wrapped as of Phase 3 of the ios-shell-hardening plan; any new inline block must follow the same pattern
- The 44×44 tap-target rule in `src/RoadTripMap/wwwroot/ios.css` covers a fixed list of selectors hand-curated from the Phase 7 HIG audit. Buttons added to `wwwroot` after the ios-shell-hardening plan are NOT automatically covered — add the new selector to the consolidated `.platform-ios ..., .platform-ios ..., ... { min-height: 44px; min-width: 44px; }` rule manually when introducing a new tap target
```

**Non-goals:**
- Do NOT touch the existing `iOS Offline Shell page cache` invariant (already correct).
- Do NOT restructure existing `## Contracts` or `## Key Decisions` sections.
- Do NOT remove the retained `bundle/` plumbing notes — they are the rollback lever per the prior plan's invariants.
- Do NOT edit `src/RoadTripMap/CLAUDE.md` (there is none; the root `CLAUDE.md` is the only file to touch).

**Verification:**
- `grep -n 'Last verified: 2026-04-22' CLAUDE.md` → exactly 1 match (line 3).
- `grep -n 'RoadTrip.onPageLoad' CLAUDE.md` → at least 2 matches (Invariants + Key Files).
- `grep -n 'listenerShim.js' CLAUDE.md` → at least 1 match (Key Files).
- `grep -n '_executedScriptSrcs' CLAUDE.md` → at least 1 match (Invariants + possibly Gotchas).
- `grep -n 'RoadTrip.appOrigin' CLAUDE.md` → at least 2 matches (Invariants + Key Files).
- `grep -n 'data-page' CLAUDE.md` → at least 1 match (Invariants).
- `grep -n 'photo LIST' CLAUDE.md` → 1 match (Gotchas).
- `npm test` — green (documentation changes don't affect tests, but the sanity run catches accidental JS file edits).

**Commit:** `docs(claude-md): document RoadTrip, OfflineError, ListenerShim, and post-hardening invariants`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Run the smoke checklist on iPhone; record the outcome

**Verifies:** Every AC from Phases 1–7 collectively, under real iOS WebKit.

**Files:**
- Modify: `docs/implementation-plans/2026-04-21-ios-shell-hardening/smoke-checklist.md` — fill in the signoff metadata block and check every checkbox as the test is performed.

**Procedure:**

1. Build the iOS app from the `ios-offline-shell` branch (`npx cap sync ios`; open Xcode; build + run on a physical iPhone with a notch).
2. Walk every section of the smoke checklist in order. For each unchecked box, perform the step, verify the expected behavior, and check the box.
3. If any step fails:
   - For AC7.1 specifically: the design explicitly allows failure here (AC7.2 fallback). Open a follow-up GitHub issue titled `iOS shell: post-failure cascade persists after script-src dedup (AC7.2)` with the console trace attached, then check AC7.1's box with a note `(AC7.2 fallback triggered — issue #NNN)`. Proceed with signoff.
   - For any other AC: stop the checklist. Open a GitHub issue tagged `ios-offline-shell`. Do NOT sign off Section 8. The plan is blocked until the regression is resolved — add whatever fix is needed to the plan (a new follow-up task on this branch, or a follow-up plan).
4. Once every checkbox on every section passes, complete the Section 8 signoff line with Patrick's name and today's date. Commit the marked-up checklist.

**Verification:**
- All checkboxes in `smoke-checklist.md` are checked (`[x]` on every line that had `[ ]`).
- Section 8 signoff is filled with name + date.

**Commit:** `docs(ios-shell-hardening): on-device smoke signoff YYYY-MM-DD`
<!-- END_TASK_3 -->

---

## Phase 8 done checklist

- [ ] `docs/implementation-plans/2026-04-21-ios-shell-hardening/smoke-checklist.md` exists and is populated.
- [ ] `CLAUDE.md` has the 4 new Invariants bullets, the 3 new Key Files entries, the 3 new Gotchas bullets, and the freshness date at `2026-04-22`.
- [ ] On-device smoke is signed off by Patrick; the marked-up checklist is committed.
- [ ] `npm test` green end-to-end.
- [ ] All 3 tasks committed on `ios-offline-shell`.
- [ ] Plan completion recorded. Merge to `develop` remains gated on the prior plan's Phase 7 sign-off (real-world phone testing + device-smoke matrix) — that gate is explicitly out of scope for this plan.
