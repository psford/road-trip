# Phase 5 Smoke Results

**Branch:** `ios-offline-shell`
**Date:** 2026-04-20

## AC4.4 / AC4.5 — uploadTransport.js + mapCache.js unchanged

**Status:** ✅ PASS

Verification command:

```bash
git diff develop -- \
  src/RoadTripMap/wwwroot/js/uploadTransport.js \
  src/RoadTripMap/wwwroot/js/mapCache.js
```

Output: empty. Neither file was touched by the iOS Offline Shell work. The
existing Phase 6 swap-seam contract for `uploadTransport.js` (`_uploadTransportImpl`
rename) and the map-cache ownership of `/api/(poi|park-boundaries)` (enforced by
the `cachedFetch` bypass classifier) are preserved.

## AC4.1 / AC4.2 / AC4.3 — upload queue offline behavior

**Status:** ⏳ DEFERRED — requires iOS Simulator + Safari Web Inspector.

These ACs cannot be exercised by jsdom unit tests because they depend on the
trip-page UI (uploadQueue + optimisticPins), the native iOS shell's IndexedDB
persistence across app lifecycle, and real network state toggling. Phase 5 ships
the loader-integration prerequisite; Phase 7's on-device matrix is the
authoritative verification point.

### Smoke matrix (run on iOS Simulator before Phase 7 sign-off)

Setup:

```bash
npm run prepare:ios-shell      # sync tripStorage.js shell copy
npx cap sync ios
open ios/App/App.xcodeproj
# In Xcode: Cmd+R to launch on iPhone simulator.
# Open Safari → Develop → Simulator → [App page] to attach Web Inspector.
```

| AC | Scenario | Expected |
|----|----------|----------|
| AC4.1 | With network on, open a trip page, add a photo (queue an upload). Disable Wi-Fi. Force-quit app. Re-launch. | Trip page renders from cache. Re-enable network. UploadQueue re-initializes from IDB; the pending upload completes. Pin promotes from optimistic to committed. |
| AC4.2 | Network off. On a trip page, add a photo. | Optimistic pin appears on the map immediately. |
| AC4.3 | Re-enable network after AC4.2. | Optimistic pin promotes to committed (style change per optimisticPins.js). |

Record PASS/FAIL per row after running in the Simulator. If any row fails, note
the scenario details and surface to Patrick — most likely a document-swap /
upload-flow integration issue that needs fixing before Phase 7 sign-off.

## Automated test coverage (Phase 5 deliverable)

- `tests/js/bootstrap-loader.test.js` — 13 tests covering AC2.1/AC2.2 (boot
  routing), AC3.6 (fallback UI with retry/back), ios.css re-injection after
  every swap, `platform-ios` class set before first paint,
  `bootstrap-progress` shim removed after successful boot, Intercept install
  idempotency.
- All Phase 1–4 test files remain green: `cachedFetch` (33), `tripStorage`
  (44), `fetchAndSwap` (17), `intercept` (40), `create-flow` (2).

Full suite: 373 passing / 8 pre-existing `versionProtocol.test.js` failures
(hardcoded `/workspaces/road-trip/...` devcontainer path, unrelated to this
phase and present on develop before Phase 0).
