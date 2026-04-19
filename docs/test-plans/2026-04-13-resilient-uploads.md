# Resilient Uploads — Human Test Plan (Phase 5: Capacitor Bootstrap + iOS CSS)

**Scope:** Phase 5 Tasks 10–11 device-smoke matrix. Phases 1–4 ACs are automation-verified in CI (xUnit + Vitest + Playwright) and are not re-exercised here. Phases 6–7 have their own plans (`phase-6-device-matrix.md`, `phase-7-tester-feedback.md`).

**Operator:** Mac session (Patrick) with physical iPhone(s).

**Where to record results:** `docs/implementation-plans/2026-04-13-resilient-uploads/phase-5-device-smoke.md` — one markdown section per AC row below, with screenshots/video dropped into `docs/implementation-plans/2026-04-13-resilient-uploads/phase-5-screenshots/` and referenced from the matrix. Patrick + Mac-session sign-off line at the bottom of `phase-5-device-smoke.md` marks completion.

**Automated backstop (already green, do not re-run as part of this plan):**
- `npx vitest run tests/js/bootstrap-loader.test.js` (13/13 passed, verified 2026-04-18) covers AC9.1–AC9.5 in jsdom. The device matrix is the real-WebKit overlay because jsdom cannot prove cache/IDB/URLProtocol parity with iOS or rule out a flash-of-unstyled-content on a real screen.

---

## 0. Pre-flight (run on WSL / Mac before touching the device)

| # | Action | Expected | Fail mitigation |
|---|---|---|---|
| 0.1 | `curl -I https://app-roadtripmap-prod.azurewebsites.net/bundle/manifest.json` | `HTTP/2 200`; `content-type: application/json`; `x-server-version` and `x-client-min-version` headers present; CORS headers include `access-control-allow-origin: capacitor://localhost` (or an explicit allow for Capacitor). | If 404, run `npm run build:bundle` and redeploy. If CORS missing, check `IosAppOrigin` policy. |
| 0.2 | `curl -s https://app-roadtripmap-prod.azurewebsites.net/bundle/manifest.json \| jq '.version, .client_min_version, (.files \| keys)'` | JSON parses; `version` and `client_min_version` are semver X.Y.Z; keys are exactly `["app.css","app.js","ios.css"]`. | If a key is missing, rebuild bundle. If shape wrong, bootstrap loader will hard-fail on device. |
| 0.3 | `curl -I https://app-roadtripmap-prod.azurewebsites.net/bundle/app.js` and same for `app.css`, `ios.css` | All three return 200 with non-empty `content-length`. | If any 404, the loader will throw `Failed to fetch <name>: 404` and trigger `renderFallback`. Rebuild/redeploy. |
| 0.4 | Confirm TestFlight build from Task 10 has "Ready to Test" status in App Store Connect. | Status green; latest build number matches what Mac session archived. | Wait for Apple processing (can take 10–60 min) before proceeding. Do not sideload. |
| 0.5 | On iPhone, confirm TestFlight app is installed and the internal-tester invite accepted. | "Road Trip" visible in TestFlight, Install button present. | Re-issue invite from App Store Connect if missing. |
| 0.6 | Note current server `version` from 0.2 — call this `V_SERVER_BASELINE`. | Written down. | Needed for AC9.3 and AC9.5 comparison. |
| 0.7 | `npx vitest run tests/js/bootstrap-loader.test.js` on WSL | 13/13 pass. | If red, stop — do not blame the device for a pre-existing loader bug. |

---

## 1. Device Matrix (physical iPhones)

Per `phase_05.md` Task 11, the matrix targets Patrick's iPhone. Phase 5 does not require a multi-device sweep (Phase 6 covers the multi-iOS-version matrix). Record one pass per AC row on at minimum:

| Slot | Device | iOS version | Role |
|------|--------|-------------|------|
| D1 | Patrick's daily-driver iPhone | current iOS major | **Required** — all 7 ACs |
| D2 (optional) | Spare iPhone or older iOS | one major behind | AC10.1 flash check (older hardware is the worst case for unstyled-content flashes) |

If D2 is unavailable, note it in the matrix and proceed with D1 only; Phase 6 will widen the sweep.

---

## 2. AC-by-AC Verification

### AC9.1 — First launch, online → bootstrap fetches, caches, injects

**Preconditions:**
- Delete Road Trip app from iPhone (Home screen → long-press → Remove App → Delete App). This ensures zero IDB cache.
- Wi-Fi or cellular on; airplane mode OFF.
- Mac's Safari available for Web Inspector, iPhone plugged in via USB and "Trust This Computer" acknowledged.
- Safari → Preferences → Advanced → "Show Develop menu" enabled. Safari → Develop → [iPhone name] should list the Road Trip WebView once the app launches.

**Steps:**
1. Install Road Trip from TestFlight; tap Open to launch.
2. Immediately open Safari Web Inspector targeting the Road Trip WebView.
3. In Inspector → Network tab, observe requests.
4. In Inspector → Storage tab, expand Databases → `RoadTripBundle` → `files` → key `bundle`.
5. Leave app open; note the trip-entry / home screen renders normally.

**Expected:**
- Network tab shows exactly these requests from the Capacitor WebView (order may vary for the 3 files):
  - `GET https://app-roadtripmap-prod.azurewebsites.net/bundle/manifest.json` → 200
  - `GET https://app-roadtripmap-prod.azurewebsites.net/bundle/app.js` → 200
  - `GET https://app-roadtripmap-prod.azurewebsites.net/bundle/app.css` → 200
  - `GET https://app-roadtripmap-prod.azurewebsites.net/bundle/ios.css` → 200
- No other requests to `/bundle/*` and no requests to `fallback.html`.
- Storage tab `RoadTripBundle.files.bundle` contains `{ version: "<V_SERVER_BASELINE>", files: { "app.js": "...", "app.css": "...", "ios.css": "..." }, client_min_version: "..." }` — the three `files` entries are non-empty strings.
- App UI renders (trip list / empty state, whatever the default route is).
- No JavaScript console errors in Inspector.

**Pass criteria:** All four requests fired exactly once, IDB populated, app UI rendered, zero console errors.
**Fail:** Any of the four fetches missing, or the IDB `bundle` key absent or empty, or a request to `fallback.html` appears.

**Record:** Network waterfall screenshot + IDB Storage tab screenshot + app screenshot.

---

### AC9.2 — Subsequent launch, airplane mode → cached bundle, no file fetches

**Preconditions:**
- AC9.1 just passed (cache is populated).
- Force-quit the Road Trip app (swipe up from bottom, swipe Road Trip card up).
- Enable Airplane Mode (Control Center → airplane icon). Confirm Wi-Fi also off.

**Steps:**
1. Cold-launch Road Trip.
2. Open Safari Web Inspector → Network tab. (Note: Web Inspector still works over USB even with iPhone in airplane mode.)
3. Observe network activity for 30 seconds after launch.

**Expected:**
- App UI renders within ~2 seconds using cached bundle.
- Network tab shows the `GET .../bundle/manifest.json` request failing (typically "Failed" / "The network connection was lost" — the loader's 8-second `AbortSignal.timeout` or the `fetch` promise rejecting).
- **Zero** requests to `/bundle/app.js`, `/bundle/app.css`, `/bundle/ios.css` — the loader took the cached-offline branch (`AC9.2` code path in `src/bootstrap/loader.js` lines 184–187).
- `fallback.html` NOT fetched.
- No `alert()` dialog.
- UI is functional (can navigate map if a trip is loaded, caveat that network-backed features like MapTiler tiles and `/api/*` will fail — that's expected and outside Phase 5 scope).

**Pass criteria:** Cached app renders, only the manifest request fires (and fails), no file fetches, no fallback.
**Fail:** Fallback screen appears, OR any file fetch is attempted, OR UI never renders.

**Record:** Network tab screenshot showing failed manifest + absence of file fetches; app screenshot.

---

### AC9.3 — Subsequent launch, online, new manifest version → refetch, replace cache

**Preconditions:**
- AC9.2 just passed (cache populated with `V_SERVER_BASELINE`).
- Disable Airplane Mode; Wi-Fi back on.
- On WSL: bump `version` in `src/RoadTripMap/wwwroot/bundle/manifest.json` (e.g., `1.0.0` → `1.0.1`). Do NOT change `client_min_version` (that's AC9.5). Deploy via the normal deploy workflow (`gh workflow run deploy.yml -f confirm_deploy=deploy` or whatever step the runbook specifies). Wait for deploy to finish.
- Re-run pre-flight 0.2 and confirm `manifest.json` returns the new version. Call this `V_SERVER_NEW`.

**Steps:**
1. Force-quit Road Trip on iPhone.
2. Cold-launch.
3. Open Web Inspector → Network tab and Storage tab.

**Expected:**
- Network: all 4 fetches fire (manifest + 3 files), identical to AC9.1.
- Storage: `RoadTripBundle.files.bundle.version` now equals `V_SERVER_NEW` (not `V_SERVER_BASELINE`).
- `bundle.files["app.js"]`, `bundle.files["app.css"]`, `bundle.files["ios.css"]` reflect the new build (content length differs from AC9.1 if the bundle actually changed — eyeball the first 200 chars).
- No `alert()`.
- App UI renders.

**Pass criteria:** All 4 fetches occur, IDB cache version is `V_SERVER_NEW`, no alert.
**Fail:** Only manifest fetched (stale cache not refreshed), OR alert fires (means AC9.5 triggered by accident — `client_min_version` must not have changed).

**Record:** Network waterfall + Storage tab showing updated version + app screenshot.

**Cleanup:** Revert `manifest.json` to baseline OR leave at `V_SERVER_NEW` for subsequent tests (either is fine as long as the next AC's preconditions are met).

---

### AC9.4 — First launch, airplane mode → `fallback.html`

**Preconditions:**
- Delete Road Trip app completely (Home screen long-press → Delete App). This wipes IDB.
- Enable Airplane Mode BEFORE re-installing.
- Re-install Road Trip from TestFlight. (TestFlight download requires network, so: connect to Wi-Fi only long enough to download, then immediately re-enable Airplane Mode before tapping Open. Alternative: install first, then delete the IDB database via Safari Web Inspector Storage tab, then airplane-mode + cold-launch.)

**Steps:**
1. With Airplane Mode ON and no cached bundle, launch Road Trip.
2. Observe the screen.
3. Open Safari Web Inspector → Network tab.

**Expected:**
- The in-shell `fallback.html` renders. Per `src/bootstrap/fallback.html`, this should be a minimal offline message (e.g. "You're offline" / similar copy — inspect the file to know the exact wording).
- Network: `.../bundle/manifest.json` attempted and failed; `fallback.html` fetched from the Capacitor webDir (local to app, no network needed) — it appears as a `file://` or `capacitor://` scheme request, not an outbound fetch.
- NO requests to `app.js`, `app.css`, `ios.css`.
- No `alert()` dialog.
- No blank white screen, no stuck spinner, no JS console exception visible.

**Pass criteria:** fallback.html content visible on screen; no crash; no file fetches.
**Fail:** Blank screen, infinite spinner, JS exception on console, OR any `/bundle/app.*` or `/bundle/*.css` fetch is attempted.

**Record:** Screenshot of fallback screen + network tab screenshot.

---

### AC9.5 — `client_min_version > cached.version` → alert + refetch

**Preconditions:**
- IDB cache has a bundle from an earlier AC (ideally the one from AC9.3, `V_SERVER_NEW`). If unsure, run AC9.1 first to re-populate.
- Note the cached `version` — call it `V_CACHED`.
- On WSL: edit `src/RoadTripMap/wwwroot/bundle/manifest.json` so that:
  - `version` stays the same as `V_CACHED` (important — we're testing the `client_min_version` branch specifically, not AC9.3). If you just ran AC9.3 and bumped version, you can either:
    - Option A: Manually edit deployed manifest to keep `version == V_CACHED` and bump `client_min_version` above `V_CACHED` (e.g., if `V_CACHED = 1.0.1`, set `client_min_version = 2.0.0`).
    - Option B: Re-run AC9.1 to re-cache, then do Option A.
  - `client_min_version` is strictly greater than `V_CACHED` per semver (e.g. `V_CACHED = 1.0.1` → `client_min_version = 2.0.0`).
- Deploy and confirm via `curl` that `manifest.json` now shows `version == V_CACHED` AND `client_min_version > V_CACHED`.
- Airplane Mode OFF.

**Steps:**
1. Force-quit Road Trip.
2. Cold-launch.
3. Observe the screen during launch.
4. Acknowledge the alert.
5. Open Web Inspector → Storage tab.

**Expected:**
- A native iOS alert appears with exact text: **`Site updated — reloading`** (em-dash between "updated" and "reloading"; matches `alert('Site updated — reloading')` in `src/bootstrap/loader.js` line 216).
- Alert appears exactly **once**.
- After tap OK / dismiss: all 4 fetches occur (manifest + 3 files).
- Storage: `RoadTripBundle.files.bundle.client_min_version` updated to the new value; `version` still matches manifest's `version`.
- App UI renders the fresh bundle.

**Pass criteria:** Alert text exact; alert fires exactly once; 4 fetches after dismissal; IDB `client_min_version` updated.
**Fail:** No alert (means `compareSemver` logic broke or cache was stale), OR alert fires multiple times, OR wrong text, OR no re-fetch after dismissal.

**Record:** Video clip (or rapid-fire screenshots) capturing the alert + Storage tab screenshot post-dismissal.

**Cleanup:** Revert manifest `client_min_version` to a value `<= V_CACHED` before moving on.

---

### AC10.1 — `platform-ios` class applied to body before first paint (visual: no unstyled flash)

**Preconditions:**
- Cache populated (run AC9.1 first if fresh).
- Wi-Fi on.

**Steps:**
1. Set up screen recording: either (a) iPhone Control Center → Screen Recording tile, or (b) QuickTime Player → File → New Movie Recording → select iPhone as source → record.
2. Force-quit Road Trip.
3. Start recording.
4. Cold-launch Road Trip.
5. Stop recording once the UI is fully interactive.
6. Review the recording frame-by-frame (QuickTime: left/right arrow keys step frames; Photos app on iOS: scrub slowly).
7. Also: inspect live via Safari Web Inspector → Elements → `<body>` element the instant the WebView is visible.

**Expected:**
- In the recording: no frame shows text/buttons in default Helvetica/Times-Roman, default blue-underline links, or missing padding around the map — i.e., no "unstyled" frame between the loader disappearing and the styled UI appearing.
- `<body class="platform-ios">` visible in Elements panel from the first observable frame.
- All `ios.css` scoped rules (see AC10.2) apply: buttons ≥ 44pt tap target, safe-area padding on the map, system font (San Francisco), no tap-highlight flash when buttons are pressed.

**Pass criteria:** Zero frames of unstyled content in the recording; `platform-ios` class present on `<body>` in Elements panel.
**Fail:** Any visible flash of Helvetica-default text, OR missing safe-area padding, OR body class missing.

**Why manual:** jsdom cannot prove "before paint" on real WebKit; Capacitor simulator timing also differs from real hardware. The unit test (`bootstrap-loader.test.js` line 302) verifies the class is set by the time `inject()` completes but can't measure paint timing.

**Record:** Screen recording uploaded to `phase-5-screenshots/ac10-1-launch.mov` (or .mp4); frame-by-frame analysis note; Elements-panel screenshot showing `class="platform-ios"`.

---

### AC10.2 — iOS-specific CSS rules (safe-area, 44pt tap targets, system font, no rubber-band)

**Preconditions:**
- AC9.1 cache in place.
- Read `src/RoadTripMap/wwwroot/ios.css` to know the exact rules (summary: safe-area insets on `#map`/`.map-container`; 44×44 min on buttons + upload-panel controls; `-apple-system` font stack; `overscroll-behavior: none` on body; transparent tap highlight; `-webkit-text-size-adjust: 100%`).

**Steps (all on D1 iPhone):**

**10.2.a — Safe-area insets**
- On a device with a notch/Dynamic Island (any iPhone X and newer): open a trip that shows the map.
- Rotate landscape. Rotate portrait. Observe the map edges.

  Expected: Map does not visually overlap the notch, home indicator, or side rounded corners — there's visible breathing room at the top (notch area) and bottom (home indicator), regardless of orientation. Devices without a notch should look unchanged vs. the web version.

**10.2.b — Tap target minimums**
- Find an upload panel retry button OR the resume banner (trigger by starting an upload, letting it fail via airplane-mode toggle, then hitting retry).
- Use Safari Web Inspector → Elements → hover over the button. The element inspector shows computed box ≥ 44×44 CSS pixels.
- Alternatively: try to tap the button with the edge of your thumb — it should be easy to hit without precision.

  Expected: `min-height: 44px` and `min-width: 44px` show in the Computed Styles panel for `button`, `.upload-panel__retry`, `.upload-panel__discard`, `.resume-banner button`, `.photo-carousel__control`.

**10.2.c — System font**
- Web Inspector → Elements → `<body>` → Computed → `font-family`: expect `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif`.
- Visually: text should look like native iOS text (San Francisco), not Helvetica Neue or Times.

  Expected: Font family matches; text has SF characteristics (rounded terminals on `a`, distinctive `6`/`9`).

**10.2.d — No rubber-band scroll on body**
- With the map showing, swipe vertically on a non-map region (e.g., the header or empty area around the map). Swipe up hard as if to scroll.

  Expected: Body does NOT bounce. Contrast: swipe on the map itself — the map still pans (overscroll-behavior only targets body, not the map). Before the `ios.css` change, swiping empty space would cause the whole page to scroll-bounce.

**10.2.e — Redeploy round-trip (`ios.css` change picked up on next launch)**
- On WSL: edit `src/RoadTripMap/wwwroot/ios.css`; change `min-height: 44px` on the button selector to `min-height: 60px` (visually obvious, temporarily).
- Run `npm run build:bundle`.
- Deploy (`gh workflow run deploy.yml -f confirm_deploy=deploy` or per runbook).
- Confirm via `curl https://app-roadtripmap-prod.azurewebsites.net/bundle/ios.css | grep min-height` returns the new value, and `manifest.json` version has bumped (build script auto-bumps via sha256 change).
- On iPhone: force-quit Road Trip, cold-launch.
- Observe the button that previously was 44px tall — it should now be visibly taller (60px).
- Revert `ios.css`, rebuild, redeploy, relaunch — buttons return to 44px.

  Expected: Change is visible after relaunch (proves the bundle refresh path actually applies new CSS). Revert is also visible.

**Pass criteria:** All five sub-checks pass.
**Fail:** Any one of safe-area / tap-target / font / no-rubber-band / redeploy-round-trip fails.

**Why manual:** Requires real device rendering + real Azure deploy cycle. The cache-bust mechanism is unit-tested as AC9.3.

**Record:** Screenshots for 10.2.a (landscape + portrait with notch visible), Computed-styles panel screenshot for 10.2.b and 10.2.c, a short video of 10.2.d swipe, before/after screenshots for 10.2.e.

---

## 3. End-to-End Scenario: Fresh-install → offline → update cycle

Exercises AC9.1, 9.2, 9.3, 10.1, 10.2 in sequence as a realistic user session.

**Purpose:** Validate the user-observable arc from TestFlight install through the first offline launch to a silent bundle update.

**Steps:**
1. Delete Road Trip. Install from TestFlight. (AC9.1 preconditions.)
2. Launch on Wi-Fi. Confirm UI renders. (AC9.1 core.)
3. Force-quit. Enable Airplane Mode. Re-launch. Confirm UI still renders from cache. (AC9.2.)
4. Disable Airplane Mode. On WSL, deploy a minor manifest bump (`1.0.1 → 1.0.2`). Force-quit. Re-launch. Confirm new bundle loads silently (no alert). (AC9.3.)
5. Throughout: verify no unstyled flash (AC10.1) and iOS-specific styling holds (AC10.2.a–d).

**Expected:** User never sees an error screen; transitions are invisible except for the expected silent refresh; alert fires in zero of these five steps (AC9.5 is tested separately).

**Pass criteria:** All five steps complete without a crash, a white-flash, a fallback.html appearance, or an unexpected alert.

---

## 4. Traceability Matrix

| Acceptance Criterion | Automated Test | Manual Step |
|---|---|---|
| AC9.1 first-launch + online | `tests/js/bootstrap-loader.test.js:229–316` | §2 AC9.1 |
| AC9.2 subsequent + airplane | `tests/js/bootstrap-loader.test.js:319–367` | §2 AC9.2 |
| AC9.3 new manifest version | `tests/js/bootstrap-loader.test.js:371–446` | §2 AC9.3 |
| AC9.4 first + airplane → fallback | `tests/js/bootstrap-loader.test.js:450–486` | §2 AC9.4 |
| AC9.5 client_min_version higher → alert | `tests/js/bootstrap-loader.test.js:490–564` | §2 AC9.5 |
| AC10.1 platform-ios class before paint | Partial: `tests/js/bootstrap-loader.test.js:302` (class-set assertion in jsdom) | §2 AC10.1 (flash-free paint — real WebKit) |
| AC10.2 iOS CSS rules + redeploy pickup | Indirect: AC9.3 covers cache-bust | §2 AC10.2.a–e |

---

## 5. Sign-off (append to `phase-5-device-smoke.md`, not here)

Per `phase_05.md` Task 11: `phase-5-device-smoke.md` ends with a sign-off line of the form:

```
Signed off: Patrick <date>, Mac-session <date>. All 7 matrix entries PASS.
```

Phase 5 is done when:
- 7 AC rows in `phase-5-device-smoke.md` show PASS + a screenshot/video.
- Automated backstop (`npx vitest run tests/js/bootstrap-loader.test.js`) green.
- TestFlight build from Task 10 is the one exercised.
- Sign-off line present.

Any FAIL row blocks Phase 6 (native background uploads) until resolved.
