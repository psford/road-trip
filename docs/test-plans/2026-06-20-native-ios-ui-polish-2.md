# Human Test Plan — Native iOS UI Polish (Round 2)

Manual verification for the native SwiftUI iOS app under `ios-swift/RoadTrip/`.
Covers the device-only acceptance criteria from
`docs/implementation-plans/2026-06-20-native-ios-ui-polish-2/test-requirements.md`
(AC1.4, AC2.4 server half, AC2.5 live-link half, AC3.2/3.3/3.4 capture flow, AC4.1 bar layout)
plus end-to-end scenarios that span the automated pieces.

Automated coverage is green and is NOT re-listed here as manual work — see the
[Traceability](#traceability) table for the full automated/manual split. This document is the
human pass; the canonical device checklist it draws from is `docs/device-test-checklist.md`.

---

## Prerequisites

- **Hardware:** a physical iPhone (the simulator has no camera, cannot judge curve "feel"/bar
  layout/safe-area, and cannot reach a live backend for the server-DELETE and share-link checks).
- **Signing:** Apple ID for team `GP2M7H6R3U` added in Xcode → Settings → Accounts; trust the dev
  cert on-device under Settings → General → VPN & Device Management. (See
  `docs/device-test-checklist.md` §Prerequisites for the full signing gotchas.)
- **Backend:** point the build at a reachable backend — the Azure dev slot (Release-TestFlight
  config via the `DEVSLOT` flag) or a local backend reachable from the device. A live backend is
  required for AC2.4 (server delete) and AC2.5 (share link).
- **An owned trip with a secret token** (e.g. import Dad's "Ford 2026 xcountry" via its *secret*
  token, or create a new trip and upload one photo). Owned trips are what gate the Share control
  and exercise the server-DELETE path. SampleData trips (Pacific Coast Highway, Yellowstone Loop,
  Weekend Getaway) are local-only and have no token.
- **Automated suites passing first.** Run the unit suite and confirm green before the device pass:
  - `RoadTripTests` (144 discovered; 141 pass — the 3 known failures are
    `testCreateTripFlow`, `testImportTripFlow`, `testImportInvalidTokenShowsError`, which fail
    ONLY because they need a live backend and are unrelated to this feature).
  - Command (iPhone 17 simulator is the installed one; iPhone 15 in older plans is NOT installed):
    `xcodebuild test -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17'`
    (or the XcodeBuildMCP `test_sim` tool with the project defaults already configured).

---

## Phase 1: Route curve + toggle (AC1.4, with AC1.2/AC1.3/AC1.6 appearance confirmations)

Open a trip with **clustered or irregularly spaced** photo points (a trip with several pins close
together and a couple far apart exposes overshoot/looping best — e.g. Dad's 120-photo trip, or
Pacific Coast Highway).

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open the trip; let the map settle | A single route line connects the photo pins in order |
| 2 | Inspect the line shape between clustered pins (AC1.4) | The line is a smooth, playful **curve** through the points — NOT straight segments; it does NOT loop back on itself or overshoot past a pin |
| 3 | Inspect the line style (AC1.2) | The line is **dashed/dotted** with **rounded** dash caps (whimsical style), not a solid line |
| 4 | Tap the route toggle control (`route-toggle`, the curve-icon button in the map overlay) | The route line **disappears**; the control's label reads "Show route" |
| 5 | Tap the toggle again | The route line **reappears**; label reads "Hide route" |
| 6 | With the route hidden, force-quit the app and relaunch; reopen the same trip (AC1.3 persistence) | The route stays **hidden** — the choice persisted across launch (backed by `@AppStorage("showRoute")`) |
| 7 | Confirm map content around the route (AC1.6) | Apple Maps points of interest (labelled businesses/landmarks) remain **visible**; there is no POI show/hide toggle anywhere on the screen |

---

## Phase 2: Soft archive — server delete + live share link (AC2.4 server half, AC2.5 live-link half)

These steps require a **live backend** and an **owned trip with a secret token**. The local +
Keychain effects of permanent delete, the confirmation dialog, and archive/restore visibility are
already automated — this phase verifies only the server round-trip and the live share link.

| Step | Action | Expected |
|------|--------|----------|
| 1 | On My Trips, copy/open the owned trip's **share view link** (toolbar → Share → "Share view link") in a browser (a device without the app, ideally) | The read-only web page resolves and shows the trip name + pins, no auth required |
| 2 | Back in the app, swipe the owned trip's row left → **Archive** | The trip leaves My Trips and appears under **Archived** |
| 3 | While archived, reload the share link from step 1 in the browser (AC2.5) | The link **still resolves** — archiving did NOT delete the server trip or its tokens |
| 4 | In Archived, swipe the trip → **Restore**; return to My Trips | The trip is back in My Trips **intact** (name, photo count, pins all preserved) |
| 5 | Archive the trip again; open Archived; swipe → **Delete permanently** → confirm **Delete permanently** in the dialog (AC2.4 server half) | The trip disappears from Archived and from My Trips |
| 6 | Reload the share link from step 1 in the browser after the permanent delete | The link **no longer resolves** (server record gone). Confirm the trip is also absent locally |

> Caution: step 5 is destructive against the live backend. Use a throwaway/owned test trip, not
> Dad's real trip, unless you intend to remove it server-side.

---

## Phase 3: Camera capture end-to-end (AC3.2, AC3.3, AC3.4, with AC3.1/AC3.5 on device)

Camera capture cannot run on the simulator. The data-based staging core (transcode to JPEG, queue
as `.staged`, honor an override coordinate, signal "no coordinate") is automated in
`PhotoCaptureCoordinatorTests`; this phase verifies the live capture + CoreLocation flow.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open a trip; tap the **+ / Add Photo** control | A menu offers **Take Photo** and **Choose from Library** (AC3.1) |
| 2 | With **Location allowed**, tap **Take Photo**, shoot a photo, accept it (AC3.2/AC3.3) | The photo stages, uploads through the normal pipeline, and a pin appears at **your current location** (device coordinate tagged) |
| 3 | Open the new pin's popup | The photo shows as a JPEG (HEIC captures are transcoded); caption/date area is present |
| 4 | Deny Location (Settings → Privacy → Location, set the app to "Never") or capture where there's **no fix**, then tap **Take Photo** and shoot (AC3.4) | The **pin-drop sheet** appears so you can set the location manually; the app does **not** crash and the capture is **not lost** |
| 5 | In the pin-drop sheet, drop/drag a pin and confirm | The captured photo stages/uploads at the chosen spot; a pin appears |
| 6 | Tap **Choose from Library**, pick an existing photo (AC3.5) | The library photo still stages and uploads as before (regression intact) |

---

## Phase 4: Floating top bar layout + safe area (AC4.1, with AC4.2/AC4.3 confirmations)

The bar's controls (back, no-delete, Add Photo, Share gate) are automated under AC4.2/AC4.3; the
visual layout/translucency/safe-area is device-only.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open any trip detail screen | There is **ONE** floating inset bar over the map (not stacked/duplicate bars) |
| 2 | Inspect the bar contents left-to-right (AC4.1) | **Back** control (left), then the **trip name left-justified**, then **Share** + **+** on the right |
| 3 | Inspect the bar styling | Side margins look right; corners are rounded; `.regularMaterial` translucency stays **legible** over varied map content (light water, dark terrain) |
| 4 | Check safe-area behavior | The bar **clears the notch / Dynamic Island** and is not clipped at the top; the home indicator does not collide with it |
| 5 | Check for collisions | The bar does **not** overlap the Phase 1 `route-toggle` overlay or the map's own controls (compass/scale) |
| 6 | Confirm the Share gate (AC4.2) | On an **owned** trip, **Share** is present; on a **SampleData** trip (no token), Share is **absent** |
| 7 | Tap **Back** (AC4.2) | Returns to **My Trips** |
| 8 | Scan the detail screen (AC4.3) | There is **no Delete or Archive** control on the detail screen — deletion lives only in the Archived view |

---

## End-to-End: Owned-trip lifecycle (capture → share → archive → restore → delete)

**Purpose:** validate that the round-2 features compose correctly on one real trip, spanning
camera (AC3), the floating bar (AC4), soft archive (AC2), and the route line (AC1).

Steps:
1. Import or create an **owned** trip (has a secret token); open it.
2. Confirm the floating bar (AC4.1) renders correctly with Share present (owned trip).
3. **Take Photo** with Location allowed → pin lands at your location (AC3.2/AC3.3); the route line
   re-curves to include the new pin and reads as a smooth dashed curve (AC1.1/AC1.2/AC1.4).
4. Toggle the route off, then on (AC1.3); leave it on.
5. Open the **share view link** in a browser → it resolves with the new photo (AC2.5 precondition).
6. Back → swipe the trip row → **Archive**; confirm it leaves My Trips and the share link **still
   resolves** while archived (AC2.5).
7. Open **Archived** → swipe → **Restore** → confirm it returns to My Trips intact.
8. Archive again → **Delete permanently** → confirm; the share link **stops resolving** (AC2.4
   server half) and the trip is gone locally.

Expected: every transition behaves as above with no crash, no half-state pin, and no orphaned
server record after the permanent delete.

---

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC1.4 — curve smooth/playful, no loop/overshoot | Visual-feel judgment of a rendered `MapPolyline`; XCUITest cannot inspect rendered geometry | Phase 1, steps 1–3 |
| AC1.2 (appearance) — dashed line, rounded caps | Dash pattern/cap is a visual property of the rendered map | Phase 1, step 3 |
| AC1.3 (hardware persistence) — toggle survives relaunch | Full relaunch persistence confirmed on hardware (property-level automated; relaunch device-verified) | Phase 1, step 6 |
| AC1.6 (visibility) — Apple Maps POIs remain visible | POI visibility on a rendered map is visual; absence-of-toggle is source-checked, visibility is human | Phase 1, step 7 |
| AC2.4 (server half) — permanent delete removes server record | Real `DELETE /api/trips/{secretToken}` needs a live backend | Phase 2, steps 5–6 |
| AC2.5 (live-link half) — shared link works while archived | Confirming a live share link resolves needs the backend + Keychain view token | Phase 2, steps 1, 3 |
| AC3.2/AC3.3 (capture + fix) — camera stages/uploads tagged at device coordinate | Simulator has no camera; real GPS fix needed | Phase 3, steps 2–3 |
| AC3.4 (denied/no-fix) — pin-drop shown, capture preserved, no crash | Requires CoreLocation auth state + real camera | Phase 3, steps 4–5 |
| AC4.1 — single floating inset bar layout/safe-area | Layout, margins, `.regularMaterial`, notch/Dynamic Island behavior are visual | Phase 4, steps 1–5 |

---

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 curved line (≥2 photos) | `RouteCurveTests.testEndpointsPreserved`, `testDensification*`, `testCubicHermiteBasisInterpolatesControlPoints`, `testPhantomEndpointsMakeCurveAtEnds` | E2E step 3 (visual confirm) |
| AC1.2 dashed, rounded caps | `RoadTripUITests.testRouteToggleShowsAndHides` (presence) | Phase 1, step 3 (appearance) |
| AC1.3 toggle hides/shows; persists | `RoadTripUITests.testRouteToggleShowsAndHides` | Phase 1, step 6 (relaunch persistence) |
| AC1.4 curve smooth/no overshoot | (proxy: `RouteCurveTests.testPointsWithinBoundingBox`, `testCentripetalCatmullRomTangentFormula`) | Phase 1, steps 1–2 |
| AC1.5 <3-pt passthrough, no NaN, <2 draws nothing | `RouteCurveTests.testPassthroughWith{0,1,2}Points`, `testNoNaN*`; `RoadTripUITests.testEmptyTripShowsEmptyState` | — (fully automated) |
| AC1.6 no POI toggle; POIs visible | Source check: no `pointOfInterestFilter`/`poi-toggle` in `TripDetailView.swift`; `route-toggle` is the only overlay | Phase 1, step 7 (visibility) |
| AC2.1 swipe-left Archive | `RoadTripUITests.testArchiveAndRestoreFlow` | E2E step 6 |
| AC2.2 archived gone from My Trips | `StorageTests.testActiveFilterReturnsOnlyUnarchivedTrips`; `RoadTripUITests.testArchiveAndRestoreFlow` | — (fully automated) |
| AC2.3 Archived lists; Restore returns | `ArchiveTests.testRestoreArchivedTripFlipsFilters`; `RoadTripUITests.testArchiveAndRestoreFlow` | E2E step 7 |
| AC2.4 permanent delete (local + Keychain) | `ArchiveTests.testDeleteLocallyRemovesTripPhotosAndTokens`; `RoadTripUITests.testPermanentDeleteRequiresConfirmation` | Phase 2, steps 5–6 (server half) |
| AC2.5 archive keeps server/tokens; restores intact | `StorageTests.testArchiveRoundTripPreservesOtherFields` | Phase 2, steps 1, 3 (live link) |
| AC2.6 permanent delete needs confirm; cancel keeps | `RoadTripUITests.testPermanentDeleteRequiresConfirmation` | — (fully automated) |
| AC3.1 + offers Take Photo + Library | `RoadTripUITests.testAddPhotoMenuOffersCameraAndLibrary` | Phase 3, step 1 |
| AC3.2 captured photo staged/transcoded/queued | `PhotoCaptureCoordinatorTests.testStageHEICTranscodesToJPEGAndStoresEXIF` | Phase 3, steps 2–3 |
| AC3.3 staged photo tagged with coordinate | `PhotoCaptureCoordinatorTests.testOverrideCoordinateWinsOverEXIF` | Phase 3, step 2 |
| AC3.4 no fix → pin-drop; capture not lost | `PhotoCaptureCoordinatorTests.testStageJPEGWithoutGPSHasNilCoordinates` | Phase 3, steps 4–5 |
| AC3.5 library path still stages | `RoadTripUITests.testSampleDataTripHidesShareButton`, `testAddPhotoMenuOffersCameraAndLibrary`; `PhotoCaptureCoordinatorTests` (shared core) | Phase 3, step 6 |
| AC4.1 single floating bar layout/safe-area | (controls automated under AC4.2/4.3) | Phase 4, steps 1–5 |
| AC4.2 Back → My Trips; Share gate | `RoadTripUITests.testTripDetailHasNoDeleteAndBackWorks`, `testSampleDataTripHidesShareButton` | Phase 4, steps 6–7 |
| AC4.3 no Delete/Archive on detail; Add Photo label kept | `RoadTripUITests.testTripDetailHasNoDeleteAndBackWorks`, `testSampleDataTripHidesShareButton` | Phase 4, step 8 |
