# iOS Offline Shell — known issues and follow-ups

**Date:** 2026-04-20 (end of on-device shakedown session)
**Branch:** `ios-offline-shell` (49 commits ahead of `develop`; pushed to `origin/ios-offline-shell`; **no PR yet**)
**Status:** not yet tested working software; do not merge

---

## Why this doc exists

The branch passed a thorough on-device shakedown on Patrick's iPhone and found six load-bearing bugs that the Simulator masked. Those are fixed and committed. This doc captures what's NOT obvious from the commit log:

- Latent architectural issues found during testing but deferred
- Verified vs. unverified acceptance criteria
- Real-world testing still required

Think of this as the "read before going back to this branch" note.

---

## Verified on device (Patrick's iPhone, airplane-mode testing included)

| AC | What was verified |
|---|---|
| AC1.2 | Internal `<a>` click → `fetchAndSwap` + `pushState`, no WebView reload |
| AC1.3 | Page scripts execute after swap (map renders, photo picker opens, `addPhotoButton` wires) |
| AC1.4 | Relative URLs in fetched HTML resolve to App Service via injected `<base href>` |
| AC1.5 | External link (GitHub footer) bypasses intercept, opens Safari |
| AC2.2 | Cold launch with saved default trip boots directly to that trip's `/post/{token}` |
| AC2.3 | `TripStorage.markOpened(url)` fires during `fetchAndSwap` — `lastOpenedAt` updates in localStorage |
| AC3.1 | First online visit caches `html` + `lastModified` + `cachedAt` in `RoadTripPageCache.pages` |
| AC3.2 | Subsequent visits render cache-first |
| AC3.5 | Airplane-mode launch with cached default trip renders from cache; navigation between cached pages works offline |
| AC4.1–4.3 | Photo upload flow end-to-end: queue on trip page, add photo (online), map pin commits |
| AC4.4 / 4.5 | `uploadTransport.js` and `mapCache.js` unchanged since `develop` (git diff empty) |

## Not verified on device

| AC | Why not | How to verify later |
|---|---|---|
| AC2.1 (0 trips → home) | App currently has saved trips; would need to delete `localStorage['roadtripmap_trips']` and relaunch | Clear localStorage in Web Inspector → relaunch → confirm home page renders, empty hero state |
| AC2.4 (glasses indicator for viewer trips) | No view-only trip was created; hand-crafting one requires editing localStorage | Inject a `{postUrl: '/trips/xyz', viewUrl: '/trips/xyz'}` entry, reload, visually confirm 👓 prefix on that card |
| AC3.3 (background revalidate 200 vs 304) | Requires server-side modification of a cached page + online relaunch to observe `If-None-Match` conditional request in Network tab | Modify a trip's HTML server-side, reload, inspect Network tab for conditional GET response |
| AC3.4 (background revalidate does NOT swap live DOM) | Implicit when AC3.3 tests pass; needs explicit observation | Same setup as AC3.3; observe that live page content stays on v1 while IDB record updates to v2 |
| AC3.6 (offline + cache miss → fallback.html) | **Verified mechanically** via Option A console test (fetch + innerHTML + button wiring) but **NOT via real cold-boot cache miss** | Run Option B: `await CachedFetch._internals._deleteRecord('pages', '/post/{trip-id}')` online → airplane mode → force-quit → relaunch. Should land on fallback with Retry + Back buttons |
| AC3.7 (`/api/poi` + `/api/park-boundaries` bypass) | `mapCache.js` continues to work on device (map renders) but the specific bypass behavior wasn't inspected | On a trip page with map, pan/zoom to trigger POI fetch, then check `RoadTripPageCache.api` store — should have NO `/api/poi*` or `/api/park-boundaries*` entries |

---

## Latent architectural issues found during testing

These are real, reproducible, and surface in the console on every multi-page navigation. The app **usually functions despite them** (first declarations win; most throwing listeners are caught by dispatch), but they're fragile and should be cleaned up.

### 1. Duplicate-`const` cascade on cross-page navigation

**Symptom.** Every `fetchAndSwap` between pages that share scripts produces a cascade of `SyntaxError: Can't create duplicate variable: 'FeatureFlags' | 'ExifUtil' | 'API' | 'MapCache' | 'TripStorage' | ...` in the console.

**Root cause.** `_swapFromHtml` removes old `<script>` elements from the DOM, but the **JS realm retains the `const` declarations** those scripts made. When the new page's copy of the same script is injected via `_recreateScripts`, the top-level `const` redeclaration throws. The original binding is untouched and still works — which is why the app keeps functioning — but every navigation emits ~15-20 errors.

**Impact.** Noise. No functional break today. Fragile: if a future script relies on re-declaration (e.g. wipes state between navigations), it'll silently skip that logic. Also makes log triage harder.

**Fix direction.** Track executed script sources in a `Set` inside `_recreateScripts`; skip (don't inject) any script whose `src` has already executed in this realm. For inline scripts, hashing the `textContent` could gate re-execution. Alternatively: have wwwroot/js modules expose a `globalThis.X ??= {...}` idempotent-install pattern (invasive).

### 2. `DOMContentLoaded` listener accumulation across swaps

**Symptom.** After visiting a post page then navigating elsewhere, the console shows `TypeError: null is not an object (evaluating 'document.getElementById('addPhotoButton').addEventListener')` at `postUI.js:31`. The listener runs on an unrelated page and fails because the element it's looking for isn't there.

**Root cause.** Page scripts register `document.addEventListener('DOMContentLoaded', ...)` to run init code. Those listeners stay attached to the `document` object across swaps — `_swapFromHtml` never calls `removeEventListener`. `fetchAndSwap` dispatches a synthetic `DOMContentLoaded` at the end of every swap, so **every accumulated handler fires on every navigation**. Handlers from previously-visited pages try to wire up DOM elements that don't exist on the current page and throw.

**Impact.** Console noise + brittle. If any handler does more than wire listeners — e.g. writes to DOM — it'll corrupt the current page.

**Fix direction.** Before dispatching the synthetic `DOMContentLoaded` in `_swapFromHtml`, reset the listener list. Options: (a) replace `document` via `document.open()` + parse into a fresh doc (invasive); (b) track listeners ourselves with a shim that proxies `document.addEventListener` so we can clear them per swap; (c) require page scripts to use a global `RoadTrip.onReady(fn)` API we control (invasive, touches every page).

### 3. "Load failed" leaks into create.html error UI

**Symptom.** Submitting the create-trip form while offline shows a raw "Load failed" banner to the user.

**Root cause.** `create.html`'s submit catch block: `errorEl.textContent = error.message || 'Failed to create trip'`. Safari's `TypeError` from an offline fetch always has a `message` ("Load failed"), so the intended fallback copy after `||` never wins.

**Impact.** Unhelpful UX. Users don't know the app is offline-incompatible for trip creation.

**Fix direction.** Detect `navigator.onLine === false` or `error instanceof TypeError` in the catch and set a deliberate message: "Can't create a trip while offline. Try again when connected." One-line change in `create.html`.

### 4. Offline trip-page photos fetch surfaces unhelpful error

**Symptom.** On the trip page offline, the page loads from cache but a banner reads "Failed to load photos".

**Root cause.** `postUI.js` calls `API.getTripPhotos(token)` which uses raw `fetch()`, not `CachedFetch.cachedFetch`. Offline fetch fails; catch block shows the error banner. The **photo list JSON isn't cached anywhere** — only the HTML is.

**Impact.** Degrades gracefully (page still renders) but the user sees an error banner even though photos were visible 2 minutes ago.

**Fix direction.** Two options, pick one:
- Route `API.getTripPhotos` through `CachedFetch.cachedFetch(url, { asJson: true })` so the JSON response lands in `RoadTripPageCache.api`. Offline, cache-first serves the last-known list. Existing photo images are Azure Blob URLs — those aren't in our cache either, so they'd still break, but the photo list at least displays.
- Accept the current degradation and just replace the error banner with "Photos unavailable offline."

### 5. Duplicate-var cascade mystery (partial)

**Observation.** The cascade consistently appears after `FetchAndSwap.fetchAndSwap('/post/uncached-url')` fails offline, even though `_swapFromHtml` never ran. The sentinel test (`window._reloadSentinel` survived) ruled out a WKWebView reload. We did not isolate why scripts re-execute in this exact scenario.

**Impact.** Cosmetic (same symptom as issue #1), but the root cause isn't fully understood. May share a common cause with #1, or may be a second path.

**Fix direction.** Add instrumentation (`console.count('featureFlags-eval')` at the top of each module) to trace exactly when each module runs. Before doing that, implement the fix in #1 which would suppress both observable cascades.

---

## Outstanding work beyond the shell

### Real-world phone testing (pending)

This only proves working software if it survives real conditions. Patrick plans to walk around the city with the app, toggling airplane mode, to cover:

- Cellular dropouts (not just airplane-mode flips)
- Backgrounding / resuming mid-upload
- Switching between Wi-Fi and cellular mid-session
- Upload queue flush when connectivity returns after a real loss
- Low-battery / thermal behavior on long sessions
- Photos with real EXIF data from the device camera

### Phase 7 formal sign-off (not done)

The test plan at `docs/test-plans/2026-04-13-resilient-uploads.md` defines a device-smoke matrix. It has not been executed end-to-end in one session against a TestFlight build. The spontaneous on-device testing today **covered most AC rows but not all**, and evidence wasn't captured into `phase-7-device-smoke.md`.

### Not merging

The branch is at `origin/ios-offline-shell` (49 commits ahead of `develop`). No PR. Merge gated on: (a) real-world testing, (b) formal Phase 7 sign-off, (c) resolution — or at least explicit acceptance — of the latent issues above.

---

## Key commits to re-read if you come back cold

On-device bug fixes (in chronological order):

- `f9753e0` — `cachedFetch` resolves relative URLs against APP_BASE (otherwise hits Capacitor internal server, not App Service)
- `a1bcd74` — `pushState` resolves against `window.location.href`, not `document.baseURI` (avoids cross-origin SecurityError from the injected `<base href>`)
- `ce99e58` — `Intercept.installIntercept` moved BEFORE first swap in loader (closes a tap-race that kicked users to Safari on slow devices)
- `f696e9f` — loader `pushState(bootUrl)` before first swap so `window.location.pathname` matches the rendered content (prevents `postUI.js` seeing `/` and showing "Invalid trip URL")
- `cd1b5d7` — loader's `_renderFallback` fetches `/fallback.html` from the shell origin, not against the `<base href>`-resolved App Service origin
- `10d9253` — Back + Retry button handlers wired in `loader.js` instead of fallback.html's inline `<script>` (innerHTML insertion doesn't execute scripts)

All six are consequences of the same category: the boundary between `capacitor://localhost` (shell origin) and `https://app-roadtripmap-prod.azurewebsites.net` (App Service origin via `<base href>`). That boundary is the project's biggest hazard zone — any operation touching URLs needs explicit awareness of which origin it operates in.
