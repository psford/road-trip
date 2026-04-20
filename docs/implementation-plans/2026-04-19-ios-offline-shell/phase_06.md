# iOS Offline Shell — Phase 6: Test plan reframing + supersede note

**Goal:** Update the human test plan to reflect the new architecture; mark the old `phase_05.md` superseded with a forward link. Doc-only deliverables.

**Architecture:** Two surgical doc edits. (1) Rewrite `docs/test-plans/2026-04-13-resilient-uploads.md` so the matrix tests `ios-offline-shell.AC1.*–AC4.*` against the document-swap loader (instead of the deprecated bundle-injection AC9.*/AC10.*). (2) Insert a header blockquote at the top of `docs/implementation-plans/2026-04-13-resilient-uploads/phase_05.md` marking the iOS bootstrap-loader Tasks 10–11 superseded; preserve the rest of the historical record intact.

**Tech Stack:** Markdown.

**Scope:** Phase 6 of 8.

**Codebase verified:** 2026-04-19.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ios-offline-shell.AC5: AC9/AC10 reframed; phase_05 superseded
- **ios-offline-shell.AC5.1 Success:** `docs/test-plans/2026-04-13-resilient-uploads.md` rewritten so old AC9.1–9.5 + AC10.1–10.2 map to `ios-offline-shell.AC1.*–AC4.*` under the new architecture.
- **ios-offline-shell.AC5.2 Success:** `docs/implementation-plans/2026-04-13-resilient-uploads/phase_05.md` has a header note marking it superseded by this design, with a brief explanation.

(AC5.3 — all AC1.*–AC4.* PASS in on-device matrix execution — is verified in Phase 7.)

---

## AC mapping (old → new)

| Old AC | New AC | Notes |
|---|---|---|
| AC9.1 (first online → fetch/cache/inject) | AC1.1, AC3.1 | First online launch caches the page; cached subsequent launches render quickly |
| AC9.2 (offline → cached bundle) | AC3.2, AC3.5 | Offline cache hit |
| AC9.3 (new manifest version → refetch) | AC3.3 | Background revalidate updates IDB on 200 |
| AC9.4 (offline + no cache → fallback) | AC3.6 | Offline + cache miss → fallback.html |
| AC9.5 (`client_min_version` alert) | (deprecated) | The forced-reload mechanism is removed under cache-first + deferred update; design accepts staler cache for one nav cycle in exchange for no UI disruption |
| AC10.1 (`platform-ios` before paint) | (visual invariant) | Verified in matrix as a no-flash check on AC1.1 |
| AC10.2 (iOS CSS redeploy round-trip) | AC3.1, AC3.3 | iOS CSS changes pick up on next online cache refresh |

---

## Codebase findings

- ✓ Old test plan: 322 lines. Structure preserved (header → preflight → device matrix → per-AC → end-to-end → sign-off). Content swapped for new architecture.
- ✓ Old phase_05.md: 759 lines. Lines 1-11 are header / mid-phase resume warning — supersede note inserts above this without disturbing the body.
- ✓ House style for test plans: Markdown H1 + metadata block + Prerequisites + per-phase tables + AC coverage markers + sign-off block.

**External dependency findings:** N/A.

**Skills to activate at execution:** `ed3d-house-style:writing-for-a-technical-audience`.

---

<!-- START_TASK_1 -->
### Task 1: Add supersede header note to old `phase_05.md`

**Verifies:** `ios-offline-shell.AC5.2`.

**Files:**
- Modify: `docs/implementation-plans/2026-04-13-resilient-uploads/phase_05.md` — insert a header note at the very top (above the existing first heading).

**Implementation:**

Insert this block at the top of the file, ABOVE the existing first heading:

```markdown
> ## ⚠️ SUPERSEDED — bootstrap-loader work
>
> The iOS bootstrap-loader work that was Tasks 10–11 of this phase has been **superseded** by [docs/design-plans/2026-04-19-ios-offline-shell.md](../../design-plans/2026-04-19-ios-offline-shell.md) and its implementation plan at [docs/implementation-plans/2026-04-19-ios-offline-shell/](../2026-04-19-ios-offline-shell/).
>
> **Why superseded:** The original architecture injected a pre-built JavaScript bundle into a bare-HTML shell (`src/bootstrap/index.html` + `loader.js`). On real iOS WKWebView this hit two architectural blockers:
>
> 1. Page scripts expected server-rendered DOM elements that didn't exist in the bare shell (the bundle's app.js called `document.getElementById('addPhotoButton')` etc., and got `null`).
> 2. Page-script `DOMContentLoaded` listeners attached AFTER the event had already fired in the shell, so they never received it and failed to initialize.
>
> See `memory: project_road_trip_phase5_paused.md` for context.
>
> **Status of this phase:**
> - **Tasks 1–9 + Task 12** (WSL-side bundle build, manifest format, CORS policy, automated tests, `npm run build:bundle`) remain valid. The `/bundle/*` server route stays live as a no-op for now (out of scope to remove).
> - **Tasks 10–11** (TestFlight build + on-device device-smoke matrix for AC9.* / AC10.*) are **NOT executed** under this plan. Their replacements live in the iOS Offline Shell plan: Phase 5 Task 6 (local smoke) + Phase 7 (on-device device-smoke matrix against the new `ios-offline-shell.AC1.*–AC4.*`).
>
> ---
```

The blockquote is visually distinct from the rest of the file. The original file content remains untouched below it (no body edits; the historical record is preserved as-is).

**Verification:**
- Visual review: open the file in a Markdown renderer (or just a text view), confirm the supersede note is at the top.
- `git diff docs/implementation-plans/2026-04-13-resilient-uploads/phase_05.md` shows ONLY added lines at the top, no edits below.

**Commit:** `docs(ios-offline-shell): mark resilient-uploads phase_05.md superseded`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Rewrite `docs/test-plans/2026-04-13-resilient-uploads.md` against the new architecture

**Verifies:** `ios-offline-shell.AC5.1`.

**Files:**
- Replace contents of: `docs/test-plans/2026-04-13-resilient-uploads.md` — full rewrite.

**Implementation:**

Full new file contents (executor adapts wording to match the project's existing test-plan house style; this is a complete deliverable, not a sketch):

```markdown
# Human Test Plan: iOS Offline Shell — device-smoke matrix

**Feature:** iOS Offline Shell (server-first hybrid loader replacing the bundle-injection architecture)
**Implementation plan:** [docs/implementation-plans/2026-04-19-ios-offline-shell/](../implementation-plans/2026-04-19-ios-offline-shell/)
**Design plan:** [docs/design-plans/2026-04-19-ios-offline-shell.md](../design-plans/2026-04-19-ios-offline-shell.md)
**Date:** 2026-04-13 (originally), reframed 2026-04-19
**Operator:** Patrick + Mac sessions for build/install steps.
**Recording location:** `docs/implementation-plans/2026-04-19-ios-offline-shell/phase-7-device-smoke.md` (screenshots/video + PASS/FAIL + sign-off)

> **Mapping from old AC9.*/AC10.*:**
>
> | Old AC | New AC | Notes |
> |---|---|---|
> | AC9.1 (first online → fetch/cache/inject) | ios-offline-shell.AC1.1, AC3.1 | First online launch caches the page |
> | AC9.2 (offline → cached) | ios-offline-shell.AC3.2, AC3.5 | Offline cache hit |
> | AC9.3 (new manifest version) | ios-offline-shell.AC3.3 | Background revalidate updates IDB on 200 |
> | AC9.4 (offline + no cache) | ios-offline-shell.AC3.6 | Offline + cache miss → fallback.html |
> | AC9.5 (`client_min_version` alert) | (deprecated) | Forced reload removed under cache-first + deferred update |
> | AC10.1 (`platform-ios` before paint) | (visual invariant) | Verified as a no-flash check on AC1.1 |
> | AC10.2 (iOS CSS redeploy round-trip) | ios-offline-shell.AC3.1, AC3.3 | iOS CSS changes pick up on next online cache refresh |

---

## Pre-flight checks (must pass before running the matrix)

| # | Check | Expected |
|---|---|---|
| 0.1 | `curl -I https://app-roadtripmap-prod.azurewebsites.net/` | `HTTP/2 200`, `content-type: text/html` |
| 0.2 | `curl -I https://app-roadtripmap-prod.azurewebsites.net/post/{any-known-token}` | `HTTP/2 200`, `content-type: text/html` |
| 0.3 | `curl -I -H "Origin: capacitor://localhost" https://app-roadtripmap-prod.azurewebsites.net/` | `access-control-allow-origin: capacitor://localhost` |
| 0.4 | `curl -I -H "Origin: capacitor://localhost" https://app-roadtripmap-prod.azurewebsites.net/api/trips/view/{any-known-view-token}` | Same CORS header present |
| 0.5 | TestFlight build is staged with the new bootstrap files | Verify in Xcode → Build Phases → Copy Bundle Resources includes `src/bootstrap/{cachedFetch,tripStorage,fetchAndSwap,intercept,loader}.js`, `index.html`, `fallback.html` |
| 0.6 | `npm test` locally | All vitest suites green |
| 0.7 | `git diff develop -- src/RoadTripMap/wwwroot/js/uploadTransport.js src/RoadTripMap/wwwroot/js/mapCache.js` | empty (AC4.4 / AC4.5) |
| 0.8 | `diff src/RoadTripMap/wwwroot/js/tripStorage.js src/bootstrap/tripStorage.js` | empty (shell copy in sync) |

---

## Device matrix

| Slot | Required | Device | iOS | Network conditions |
|---|---|---|---|---|
| D1 | Required | Patrick's iPhone | latest stable | Wi-Fi + cellular + airplane mode |
| D2 | Optional | Older iPhone (if available) | iOS 17+ | Wi-Fi + airplane mode |

---

## AC1: Server pages render and behave inside the iOS shell

### AC1.1 — First page loads within 3s of launch when cached

**Preconditions:**
- App installed via TestFlight, opened once with network on (populates `RoadTripPageCache` for `/` or the default trip).
- Force-quit the app.

**Steps:**
1. Start a stopwatch (or screen-record for frame analysis).
2. Cold-launch Road Trip.
3. Stop when the home page (or default trip page) is fully rendered.

**Pass:** ≤ 3 seconds. Visually no unstyled flash (preserves the `platform-ios`-before-paint invariant; the original AC10.1 lives here).

### AC1.2 — Internal `<a href>` click → fetch+swap, no full WebView reload

**Steps:**
1. From a saved trip, tap the "Back" link.
2. In Web Inspector → Network: a fetch happens to `/`. NO top-level page load (no entry in the URL bar history change).

**Pass:** Fetch fires, document content updates, no WebView reload.

### AC1.3 — Scripts in fetched page execute

**Steps:**
1. From the home page, tap a saved trip.
2. On the trip page, in Web Inspector → Console: confirm `MapUI.init` ran (the map renders) and `addPhotoButton` is wired (tap "+" → file picker opens).

**Pass:** Map renders, photo picker opens.

### AC1.4 — Relative URLs resolve to App Service via injected `<base href>`

**Steps:**
1. On the home page after first fetch, in Web Inspector → Console:
   - `document.head.querySelector('base[href]').href` → `https://app-roadtripmap-prod.azurewebsites.net/`.
   - `document.querySelector('a[href]').href` → fully-qualified URL pointing at App Service.

**Pass:** Base href present; relative URLs resolve.

### AC1.5 — External link NOT intercepted

**Steps:**
1. From the home page, tap the GitHub footer link.
2. iOS prompts to open in Safari (or opens directly).

**Pass:** Native iOS link handling triggered.

### AC1.6 — Modifier-key / middle-click NOT intercepted

iOS doesn't expose modifier keys via touch. Verify on iOS Simulator with attached hardware keyboard, OR mark as "covered by automated tests in `tests/js/intercept.test.js`" — the jsdom suite asserts `metaKey/ctrlKey/shiftKey/altKey` and `button !== 0` short-circuit the intercept.

---

## AC2: Saved-trips routing and home screen

### AC2.1 — First launch with 0 saved trips → home page

**Preconditions:** Delete app from device (clears localStorage + IDB). Re-install from TestFlight.

**Steps:** Launch app. Confirm home page renders with empty hero state.

**Pass:** Home page shown (with "no saved trips" empty state).

### AC2.2 — Launches with 1+ saved trips → most-recently-opened directly

**Preconditions:** 2+ trips saved (open `/post/A` then `/post/B`).

**Steps:** Force-quit. Launch.

**Pass:** Trip B's page loads directly (NOT the home page).

### AC2.4 — View-only trip card has glasses indicator

**Preconditions:** A view-only trip is saved. Until view-only trip saving is supported in the UI, hand-craft via Web Inspector → Storage → Local Storage: `roadtripmap_trips` key, add `{name: 'V', postUrl: '/trips/{token}', viewUrl: '/trips/{token}', savedAt: '2026-04-19T...'}` (the `getRoleForUrl` returns `'viewer'` for `/trips/...`).

**Steps:** Navigate to home page.

**Pass:** Affected trip card has 👓 prefix.

---

## AC3: Aggressive offline-first cache

### AC3.1 — First online visit caches with cachedAt, etag, lastModified

**Steps:**
1. Delete app, re-install, launch with Wi-Fi on.
2. Navigate to a trip page.
3. Web Inspector → Storage → Databases → `RoadTripPageCache` → `pages` → confirm a record exists for the page URL with `html`, `etag`, `lastModified`, `cachedAt` fields.

**Pass:** Record present with all four fields.

### AC3.2 — Subsequent visit renders from cache immediately

**Steps:**
1. After AC3.1 (cache populated), force-quit.
2. Cold-launch with cellular off (Wi-Fi off too) — actually WAIT, just launch normally.
3. Web Inspector → Network: NO request for the page (only the background revalidate ETag-conditional request).

**Pass:** Page renders before any network fetch settles.

### AC3.3 — Online cache hit fires background revalidate, updates IDB on 200

**Steps:**
1. With cache populated, tap an internal link to revisit a cached page.
2. Network tab: see a fetch with `If-None-Match: <etag>` header.
3. If server returns 200 (modify the page server-side and redeploy first): IDB record's `html` and `etag` update.
4. If 304: IDB unchanged.

**Pass:** Conditional request sent; IDB updated only on 200.

### AC3.4 — Background revalidate does NOT swap live DOM

**Steps:**
1. After AC3.3 returns 200 with new content, observe the live page's content.

**Pass:** Live content unchanged. Forcing a fresh nav (back + forward) shows the new content from IDB.

### AC3.5 — Offline launch with cached default trip → renders from cache, revalidate fails silently

**Steps:**
1. With cache populated, airplane mode on, force-quit.
2. Cold-launch.
3. Network tab: background revalidate fails with a network error (no fetch entry, or a failed entry).

**Pass:** Page renders from cache; no error UI; no console.error.

### AC3.6 — Offline + cache miss → fallback.html with retry/back

**Steps:**
1. Airplane mode on. Tap an internal link to a page never cached.
2. Confirm `fallback.html` renders with "Page not cached yet" + Retry + Back buttons.
3. Tap Retry → location.reload triggers a re-fetch attempt.

**Pass:** Fallback shown with both buttons; Retry triggers reload.

### AC3.7 — `/api/poi` and `/api/park-boundaries` NOT touched by cachedFetch

**Steps:**
1. On a trip page, pan/zoom the map.
2. Web Inspector → Storage → Databases → `RoadTripPageCache` → `api` → confirm NO entries for `/api/poi*` or `/api/park-boundaries*`.
3. Confirm `mapCache`-owned IDB (`roadtripmap-cache`) DOES have entries for the same URLs (mapCache continues to handle them).

**Pass:** No bypass-list URLs in `RoadTripPageCache`; mapCache still functioning.

---

## AC4: Existing offline upload behavior preserved

### AC4.1 — Pending uploads resume after fetch+swap

**Steps:**
1. With network on, queue an upload (add a photo).
2. Disable network. Force-quit.
3. Re-launch (still offline) → trip page renders from cache; uploadQueue re-init from IDB.
4. Re-enable network → queued upload completes.

**Pass:** Upload completes after re-enable.

### AC4.2 — Optimistic pin shows immediately when posting offline

**Steps:**
1. Disable network on a trip page.
2. Add a photo.

**Pass:** Pin appears on the map immediately, with optimistic style.

### AC4.3 — Queued upload completes when connectivity returns

**Steps:** From AC4.2, re-enable network.

**Pass:** Optimistic pin updates to committed style.

### AC4.4 / AC4.5 — `uploadTransport.js` and `mapCache.js` unchanged

Verified during pre-flight 0.7 via `git diff` empty.

---

## End-to-end realistic scenario

1. Install Road Trip from TestFlight.
2. Launch — home page (empty).
3. Tap "Create new trip" — fill in name → submit. Trip page loads.
4. Add a photo (online). Pin appears.
5. Force-quit. Re-launch. App goes directly to that trip.
6. Tap "Back" → home page (lists 1 trip).
7. Web Inspector → confirm `RoadTripPageCache.pages` contains home + trip pages.
8. Force-quit. Airplane mode on. Re-launch. App loads the trip from cache.
9. Add another photo (offline). Optimistic pin appears.
10. Disable airplane mode. Pin promotes to committed.

---

## Sign-off

| Item | Status | Notes |
|---|---|---|
| Pre-flight 0.1–0.8 PASS | □ | |
| AC1.1–AC1.6 matrix PASS on D1 | □ | (AC1.6 → automated tests cover) |
| AC2.1, AC2.2, AC2.4 PASS on D1 | □ | |
| AC3.1–AC3.7 PASS on D1 | □ | |
| AC4.1–AC4.5 PASS on D1 | □ | (AC4.4, AC4.5 verified via git diff) |
| End-to-end realistic scenario PASS | □ | |
| Screenshots/video captured in `docs/implementation-plans/2026-04-19-ios-offline-shell/phase-7-device-smoke.md` | □ | |

Signed off: Patrick `<date>`. All matrix entries PASS.
```

Notes for executor:
- Adapt small wording details to match the project's existing test-plan style if any conventions diverge.
- Preserve the explicit `ios-offline-shell.AC{N}.{M}` identifiers throughout.
- The "Mapping from old AC9.*/AC10.*" table at the top is the heart of AC5.1 — do not remove it.
- AC9.5 deprecation is intentional — the design retired the `client_min_version`/forced-reload mechanism. Document it explicitly in the mapping table (don't silently drop it).

**Verification:**
- File parses as valid Markdown (open in a renderer).
- Every relative link resolves: design plan, implementation plan, sister docs.
- Spot-check that every old AC9.*/AC10.* identifier has a corresponding mapping entry.

**Commit:** `docs(ios-offline-shell): rewrite test plan against new architecture (AC9/10 → AC1-AC4)`
<!-- END_TASK_2 -->
