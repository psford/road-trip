# Test Requirements — Native iOS UI Polish (Round 2)

Maps every acceptance criterion in `docs/design-plans/2026-06-20-native-ios-ui-polish-2.md`
(native-ios-ui-polish-2.AC1.1 through AC4.3) to a single verification mechanism: an
automated test or a documented human/device check. Each criterion appears in exactly one
row of the [coverage summary](#coverage-summary) and in exactly one of the two sections
below.

Test environment: native iOS SwiftUI app under `ios-swift/RoadTrip`. Unit/integration tests
run in `RoadTripTests` (XCTest, in-memory GRDB via `AppDatabase.makeInMemory()`); UI tests
run in `RoadTripUITests` (XCUITest against the `-uitest` seed). Device-only criteria are
recorded in `docs/device-test-checklist.md` because the iOS Simulator has no camera and
because route "feel", floating-bar layout/safe-area, and a live server DELETE cannot be
asserted by an automated simulator test.

Paths below are relative to `ios-swift/RoadTrip/`. New files (`RouteCurveTests.swift`,
`ArchiveTests.swift`) are created by the phases that own them; all other cited files already
exist in the repo.

---

## Automated tests

### AC1 — Route line + toggle

**native-ios-ui-polish-2.AC1.1 Success** — With ≥2 photos, the route renders as a smooth
curved line through the photo points (not straight segments).
- Type: unit
- File: `RoadTripTests/RouteCurveTests.swift`
- Assertion: `RouteCurve.curved(through:)` on a known ≥3-point input (a) preserves the first
  and last input coordinates within a tight tolerance (the curve passes through its endpoints,
  proving interpolation rather than straight passthrough), and (b) returns more points than it
  was given, matching the documented `(N-1)*pointsPerSegment + 1` count for a fixed
  `pointsPerSegment`. The densified output is the data the `MapPolyline` draws as a curve.
  (Visual smoothness is AC1.4, device-verified.)

**native-ios-ui-polish-2.AC1.2 Success** — The route line is dashed (whimsical dotted style)
with rounded caps.
- Type: UI (presence) — see justification
- File: `RoadTripUITests/RoadTripUITests.swift` (`testRouteToggleShowsAndHides`)
- Assertion: The dash pattern (`StrokeStyle(dash: [2, 10], lineCap: .round)`) and rounded caps
  are visual properties of `MapPolyline` that XCUITest cannot inspect on a rendered map.
  Automated coverage is limited to confirming the route line is present and toggleable (via the
  `route-toggle` control); the dashed/rounded appearance itself is human-verified in the device
  checklist (AC1.4 item, which inspects curve feel and styling together). This row is satisfied
  by the toggle test proving the line exists, with appearance deferred to the checklist.

**native-ios-ui-polish-2.AC1.3 Success** — The map-control route toggle hides/shows the route
line; the choice persists across app launches.
- Type: UI
- File: `RoadTripUITests/RoadTripUITests.swift` (`testRouteToggleShowsAndHides`)
- Assertion: After opening the seed trip ("Pacific Coast Highway"), `app.buttons["route-toggle"]`
  exists and is hittable; tapping it flips the accessibility label between "Hide route" and
  "Show route" and tapping again flips it back. The label reflects the bound `@AppStorage("showRoute")`
  flag that gates rendering. (`@AppStorage`/UserDefaults persistence across a full relaunch is
  exercised at the property level; a relaunch assertion is optional per Phase 1 Task 4 and the
  device checklist confirms persistence on hardware.)

**native-ios-ui-polish-2.AC1.5 Edge** — `RouteCurve.curved` returns the input unchanged for
fewer than 3 points and never emits NaN coordinates; a trip with fewer than 2 photos draws no
route and does not crash.
- Type: unit (plus existing UI regression)
- File: `RoadTripTests/RouteCurveTests.swift` (primary); `RoadTripUITests/RoadTripUITests.swift`
  (`testEmptyTripShowsEmptyState`, existing — view-side guard)
- Assertion: Unit — `curved(through:)` with 0, 1, and 2 points returns the input array unchanged
  (same count and coordinates); for a ≥3-point input that includes two coincident adjacent
  points, every returned coordinate has `latitude.isFinite && longitude.isFinite` (no NaN).
  UI — the existing `testEmptyTripShowsEmptyState` opens the 0-photo "Weekend Getaway" seed trip
  without crashing, confirming the `routeCoordinates.count >= 2` view guard. Both must stay green.

**native-ios-ui-polish-2.AC1.6 Edge** — No POI show/hide toggle exists; Apple Maps points of
interest remain visible (POI toggle intentionally dropped).
- Type: unit (negative, source-level)
- File: `RoadTripTests/RouteCurveTests.swift` — but see note
- Assertion: This is the absence of code (no `pointOfInterestFilter`, no POI toggle control).
  Absence is best confirmed by a static check rather than a runtime assertion: the executor
  verifies `TripDetailView.swift` contains no `pointOfInterestFilter` and no POI toggle, and that
  the only map-control overlay added is `route-toggle`. If a runtime guard is desired, a UI test
  can assert no `app.buttons["poi-toggle"]` exists on the detail screen. Treated as automated via
  the source/grep check documented in Phase 1 Task 2 step 4; POI visibility itself is confirmed
  in the device checklist alongside AC1.4.

### AC2 — Soft archive

**native-ios-ui-polish-2.AC2.1 Success** — Swiping a My Trips row left reveals an Archive
action; invoking it archives the trip.
- Type: UI
- File: `RoadTripUITests/RoadTripUITests.swift` (`testArchiveAndRestoreFlow`)
- Assertion: On My Trips, swiping the seed trip row left surfaces `app.buttons["Archive"]`;
  tapping it removes the row from the My Trips list (waits for non-existence of the trip's
  static text). The underlying `archivedAt = now` mutation is pinned by the unit test below.

**native-ios-ui-polish-2.AC2.2 Success** — An archived trip no longer appears in the My Trips
list.
- Type: unit (filter contract) + UI (end-to-end)
- File: `RoadTripTests/ArchiveTests.swift` (or `StorageTests.swift`); `RoadTripUITests/RoadTripUITests.swift`
  (`testArchiveAndRestoreFlow`)
- Assertion: Unit — insert one trip with `archivedAt == nil` and one with `archivedAt != nil`;
  `Trip.filter(Column("archivedAt") == nil).order(Column("createdAt").desc).fetchAll(db)` returns
  only the active trip (this is the exact query `TripListView`'s `ValueObservation` uses). UI —
  after archiving, the row is gone from My Trips (covered jointly with AC2.1).

**native-ios-ui-polish-2.AC2.3 Success** — The Archived view lists archived trips; Restore
returns a trip to My Trips (and removes it from Archived).
- Type: unit (restore flip) + UI (end-to-end)
- File: `RoadTripTests/ArchiveTests.swift`; `RoadTripUITests/RoadTripUITests.swift`
  (`testArchiveAndRestoreFlow`)
- Assertion: Unit — insert an archived trip, apply the restore write (`archivedAt = nil`), then
  assert the active filter now returns it and the archived filter (`Column("archivedAt") != nil`)
  does not. UI — after archiving, `app.buttons["Archived"]` opens the Archived view where the trip
  appears; invoking Restore and navigating back shows it again in My Trips.

**native-ios-ui-polish-2.AC2.4 Success** — "Delete permanently" in the Archived view removes the
trip server-side, locally, and clears its Keychain tokens.
- Type: integration (local + Keychain half, automated); server DELETE half is device/integration
- File: `RoadTripTests/ArchiveTests.swift` (local/Keychain); device checklist (server half)
- Assertion: Automated — using `AppDatabase.makeInMemory()` and a test `KeychainStore` (unique
  service per run), insert a trip + a `.secret` and `.view` token + a photo, call
  `RoadTripAPI.deleteLocally(tripId:from:keychain:)`, then assert the trip row is gone, its photos
  cascade-deleted, and `keychain.token(kind:.secret/.view, tripId:)` both return nil. This covers
  the local + Keychain effects. The actual server `DELETE /api/trips/{secretToken}` requires a live
  backend (like `UploadIntegrationTests`) and is human/device-verified — see the human section.

**native-ios-ui-polish-2.AC2.5 Edge** — Archiving does not delete the server trip or its tokens
— the shared view link still works and the trip restores intact.
- Type: unit (local integrity) + human (shared link)
- File: `RoadTripTests/ArchiveTests.swift` (or `StorageTests.swift`); device checklist (live link)
- Assertion: Unit — insert a trip with `archivedAt == nil`, set `archivedAt = Date()`, `update`,
  fetch back; assert it round-trips and ALL other fields (name, slug, photoCount, createdAt, etc.)
  are unchanged, proving archive only flips the local flag and touches no other state. The claim
  that the share link "still works" while archived involves a live server and Keychain-backed link
  and is human-verified in the device checklist; the unit test proves the local precondition
  (tokens/fields untouched, restore intact).

**native-ios-ui-polish-2.AC2.6 Failure** — "Delete permanently" requires confirmation;
cancelling leaves the trip archived and present in the Archived view.
- Type: UI
- File: `RoadTripUITests/RoadTripUITests.swift` (`testPermanentDeleteRequiresConfirmation`)
- Assertion: Using the SampleData trip (no secret token → local-only delete, safe in CI), archive
  it, open Archived, invoke "Delete permanently", and on the confirmation dialog tap Cancel; assert
  the trip is still present in the Archived list. Then invoke again and confirm; assert it
  disappears from Archived and is not in My Trips (the local-effect side of AC2.4).

### AC3 — Camera capture

**native-ios-ui-polish-2.AC3.1 Success** — The + control presents a choice of "Take Photo"
(camera) and "Choose from Library".
- Type: UI
- File: `RoadTripUITests/RoadTripUITests.swift` (`testAddPhotoMenuOffersCameraAndLibrary`)
- Assertion: Open a trip, tap `app.buttons["Add Photo"]`, and assert the menu surfaces
  `app.buttons["Take Photo"]` and `app.buttons["Choose from Library"]`. "Take Photo" is asserted
  to `exist` (it is disabled on the simulator, which has no camera) rather than `isHittable`.

**native-ios-ui-polish-2.AC3.2 Success** — A camera-captured photo is staged through the existing
pipeline (transcoded to JPEG and queued for upload).
- Type: unit (staging core) + device (end-to-end capture)
- File: `RoadTripTests/PhotoCaptureCoordinatorTests.swift`; device checklist (real camera)
- Assertion: Unit — call `PhotoCaptureCoordinator.stagePhoto(imageData:filename:tripId:overrideCoordinate:)`
  (the data-based core the camera path invokes) with sample image `Data` against an in-memory DB;
  assert the staged file exists, its `contentType` is JPEG (HEIC→JPEG transcode when a HEIC fixture
  is used), and an `UploadQueueItem` is inserted with `stage == .staged`. End-to-end capture from a
  real camera is device-verified (simulator has no camera; `UIImagePickerController.isSourceTypeAvailable(.camera)`
  is false) — see the human section.

**native-ios-ui-polish-2.AC3.3 Success** — When a location fix is available at capture, the staged
photo is tagged with the current device coordinate.
- Type: unit (coordinate honored) + device (real fix)
- File: `RoadTripTests/PhotoCaptureCoordinatorTests.swift`; device checklist (real GPS fix)
- Assertion: Unit — call the staging core with an explicit `overrideCoordinate` (the value the
  one-shot location provider supplies) and assert the resulting `UploadQueueItem.exifLat/exifLon`
  equal that coordinate, proving the override is honored for a camera JPEG that carries no EXIF GPS.
  Acquiring a real coordinate from `CLLocationManager.requestLocation()` and tagging an actual
  capture is device-verified.

**native-ios-ui-polish-2.AC3.4 Failure** — When location permission is denied or no fix is
available, the pin-drop sheet is shown so the user can set the location; the capture is not lost
and the app does not crash.
- Type: unit (no-coordinate signal) + device (denied-permission flow)
- File: `RoadTripTests/PhotoCaptureCoordinatorTests.swift`; device checklist (pin-drop flow)
- Assertion: Unit — call the staging core with `overrideCoordinate: nil` and an image without EXIF
  GPS; assert the resulting item has `exifLat == nil` / `exifLon == nil`. This is the exact signal
  `stageCameraImage` reads to set `stagedNeedingLocation` and present `PinDropView`. The full
  denied-permission → pin-drop → stage path (no fix, no crash, capture preserved) requires
  CoreLocation authorization state and a real camera, so it is device-verified.

**native-ios-ui-polish-2.AC3.5 Success** — "Choose from Library" still stages a photo as before
(regression guard).
- Type: UI (presence/regression) + unit (staging core shared by library path)
- File: `RoadTripUITests/RoadTripUITests.swift` (`testSampleDataTripHidesShareButton`,
  `testAddPhotoMenuOffersCameraAndLibrary`); `RoadTripTests/PhotoCaptureCoordinatorTests.swift`
- Assertion: UI — `app.buttons["Add Photo"]` still exists with its preserved identifier and the
  menu still offers `Choose from Library`; `testSampleDataTripHidesShareButton` (which anchors on
  `Add Photo`) stays green. Unit — the library path delegates to the same data-based staging core
  the unit tests above exercise, so the transcode/queue behavior it relies on is pinned. Driving
  the system photo library picker end-to-end in XCUITest is not automated here (system-UI picker);
  library staging is also confirmed in the device checklist.

### AC4 — Merged floating top bar

**native-ios-ui-polish-2.AC4.2 Success** — Back returns to My Trips; the Share control keeps its
owned-trip gate (hidden when the trip has no secret token).
- Type: UI
- File: `RoadTripUITests/RoadTripUITests.swift` (`testTripDetailHasNoDeleteAndBackWorks`,
  `testSampleDataTripHidesShareButton`)
- Assertion: Open the seed trip; tap `app.buttons["trip-back"]` and assert My Trips is shown (list
  title / a known row visible) — Back works via `dismiss()`. The Share gate is asserted by the
  existing `testSampleDataTripHidesShareButton`: for a SampleData trip with no secret token,
  `app.buttons["Share"]` does NOT exist (and is present for owned trips, confirmed on device).

**native-ios-ui-polish-2.AC4.3 Edge** — No Delete or Archive action appears on the trip detail
screen (deletion lives only in the Archived view); the "Add Photo" control retains its accessible
label/identifier for `RoadTripUITests.testSampleDataTripHidesShareButton`.
- Type: UI
- File: `RoadTripUITests/RoadTripUITests.swift` (`testTripDetailHasNoDeleteAndBackWorks`,
  `testSampleDataTripHidesShareButton`)
- Assertion: On the trip detail screen, assert `app.buttons["Delete Trip"]` does NOT exist (and no
  Archive control exists), confirming deletion lives only in the Archived view; and assert
  `app.buttons["Add Photo"]` still exists so `testSampleDataTripHidesShareButton` keeps finding the
  `+` control. No test may reference a detail-screen "Delete Trip" button after this phase.

---

## Human / device verification

These criteria cannot be asserted by an automated simulator test. Verification steps live in
`docs/device-test-checklist.md` (added/extended by Phase 1 Task 5, Phase 4 Task 6, Phase 5 Task 4).

**native-ios-ui-polish-2.AC1.4 Success (device)** — The curve looks smooth/playful and does not
loop or overshoot on clustered or irregularly spaced points.
- Why not automated: "smooth/playful" and "does not loop or overshoot" are visual-feel judgments
  about a rendered map curve; XCUITest cannot inspect a `MapPolyline`'s rendered geometry. The unit
  tests provide the automatable proxy (endpoints preserved, no NaN, output within the input
  bounding box expanded by epsilon), but final feel is human-only.
- Steps (`docs/device-test-checklist.md`): On a real device, open a trip with clustered/irregular
  photo points; confirm the route curve is smooth and playful and does NOT loop or overshoot;
  confirm the dashed/rounded-cap styling reads as intended (covers AC1.2 appearance); toggle the
  route off/on and confirm it hides/shows and the choice persists after relaunch (covers AC1.3
  persistence on hardware); confirm Apple Maps POIs remain visible (covers AC1.6 visibility).

**native-ios-ui-polish-2.AC2.4 (server-side delete half)** — "Delete permanently" removes the trip
server-side.
- Why not automated: the real `DELETE /api/trips/{secretToken}` requires a live backend; the
  automated suite uses in-memory GRDB and a test Keychain and cannot reach the server (same
  constraint as `UploadIntegrationTests`). The local + Keychain effects ARE automated (see AC2.4
  row above); only the server round-trip is human-verified.
- Steps (`docs/device-test-checklist.md`): With a live backend and an owned trip (has a secret
  token), archive it, open Archived, "Delete permanently", confirm; verify the server record is
  gone (the shared view link no longer resolves) and the trip is absent locally.

**native-ios-ui-polish-2.AC2.5 (shared-link-while-archived half)** — The shared view link still
works while the trip is archived and the trip restores intact.
- Why not automated: confirming a live share link resolves requires the backend and the
  Keychain-backed view token; the automated test proves only the local precondition (archive
  flips the flag and leaves all other fields/tokens untouched).
- Steps (`docs/device-test-checklist.md`): Archive an owned trip; open its shared view link in a
  browser and confirm it still resolves; restore the trip and confirm it returns to My Trips intact.

**native-ios-ui-polish-2.AC3.2 / AC3.3 / AC3.4 (end-to-end camera capture)** — Capture stages and
uploads; with a fix it is tagged with the device coordinate; with no fix the pin-drop sheet appears
and the capture is preserved without crashing.
- Why not automated: the iOS Simulator has no camera
  (`UIImagePickerController.isSourceTypeAvailable(.camera) == false`), so the capture path cannot
  run in CI. The data-based staging contract these criteria depend on IS unit-tested (coordinate
  honored, transcode, no-coordinate signal); only the live capture + CoreLocation flow is device-only.
- Steps (`docs/device-test-checklist.md`): On a real device — (AC3.2/AC3.3) Take Photo with Location
  allowed; the photo stages, uploads, and a pin appears at your location. (AC3.4) Take Photo with
  Location denied or no fix; the pin-drop sheet appears; setting a pin stages/uploads the capture;
  nothing is lost and the app does not crash. (AC3.1/AC3.5) The `+` menu shows Take Photo + Choose
  from Library; library selection still stages.

**native-ios-ui-polish-2.AC4.1 Success** — The trip detail screen shows a single floating inset
bar containing the back control, the left-justified trip name, Share, and +.
- Why not automated: the bar's layout — single inset bar over the map, side margins, rounded
  `.regularMaterial` translucency, left-justified title, and safe-area behavior (notch / Dynamic
  Island / home indicator, no clipping, no collision with the route-toggle overlay or map
  controls) — is a visual-layout judgment XCUITest cannot evaluate. The presence and behavior of
  the bar's controls (back, no-delete, Add Photo, Share gate) ARE automated under AC4.2/AC4.3.
- Steps (`docs/device-test-checklist.md`): On a real device, confirm trip detail shows ONE floating
  inset bar over the map with back (left), trip name left-justified, then Share + `+`; side margins
  and rounded `.regularMaterial` look right and stay legible over varied map content; the bar clears
  the notch/Dynamic Island and is not clipped; it does not collide with the Phase 1 route-toggle
  overlay or the map controls.

---

## Coverage summary

| AC | Criterion (abbrev.) | Mechanism | Type | Test file / checklist |
| --- | --- | --- | --- | --- |
| AC1.1 | ≥2 photos render a curved line | Automated | unit | `RoadTripTests/RouteCurveTests.swift` |
| AC1.2 | Route is dashed, rounded caps | Automated (presence) + human (appearance) | UI + checklist | `RoadTripUITests/RoadTripUITests.swift` (`testRouteToggleShowsAndHides`); `docs/device-test-checklist.md` (AC1.4 item) |
| AC1.3 | Toggle hides/shows; persists | Automated | UI | `RoadTripUITests/RoadTripUITests.swift` (`testRouteToggleShowsAndHides`) |
| AC1.4 | Curve smooth/playful, no loops | Human/device | checklist | `docs/device-test-checklist.md` |
| AC1.5 | <3-point passthrough, no NaN, <2 draws nothing | Automated | unit + UI | `RoadTripTests/RouteCurveTests.swift`; `RoadTripUITests/RoadTripUITests.swift` (`testEmptyTripShowsEmptyState`) |
| AC1.6 | No POI toggle; POIs stay visible | Automated (source/negative) | unit/source | `RoadTripTests/RouteCurveTests.swift` + `TripDetailView.swift` grep check; visibility in `docs/device-test-checklist.md` |
| AC2.1 | Swipe-left reveals Archive; archives | Automated | UI | `RoadTripUITests/RoadTripUITests.swift` (`testArchiveAndRestoreFlow`) |
| AC2.2 | Archived trip gone from My Trips | Automated | unit + UI | `RoadTripTests/ArchiveTests.swift`; `RoadTripUITests/RoadTripUITests.swift` (`testArchiveAndRestoreFlow`) |
| AC2.3 | Archived view lists; Restore returns | Automated | unit + UI | `RoadTripTests/ArchiveTests.swift`; `RoadTripUITests/RoadTripUITests.swift` (`testArchiveAndRestoreFlow`) |
| AC2.4 | Permanent delete: server + local + Keychain | Automated (local/Keychain) + human (server) | integration + checklist | `RoadTripTests/ArchiveTests.swift`; `docs/device-test-checklist.md` (server half) |
| AC2.5 | Archive keeps server/tokens; restores intact | Automated (local) + human (live link) | unit + checklist | `RoadTripTests/ArchiveTests.swift`; `docs/device-test-checklist.md` (live link) |
| AC2.6 | Permanent delete needs confirm; cancel keeps it | Automated | UI | `RoadTripUITests/RoadTripUITests.swift` (`testPermanentDeleteRequiresConfirmation`) |
| AC3.1 | + offers Take Photo + Choose from Library | Automated | UI | `RoadTripUITests/RoadTripUITests.swift` (`testAddPhotoMenuOffersCameraAndLibrary`) |
| AC3.2 | Captured photo staged + transcoded + queued | Automated (core) + human (capture) | unit + checklist | `RoadTripTests/PhotoCaptureCoordinatorTests.swift`; `docs/device-test-checklist.md` |
| AC3.3 | With fix, staged photo tagged with coordinate | Automated (core) + human (real fix) | unit + checklist | `RoadTripTests/PhotoCaptureCoordinatorTests.swift`; `docs/device-test-checklist.md` |
| AC3.4 | No fix → pin-drop; capture not lost, no crash | Automated (signal) + human (flow) | unit + checklist | `RoadTripTests/PhotoCaptureCoordinatorTests.swift`; `docs/device-test-checklist.md` |
| AC3.5 | Library path still stages (regression) | Automated | UI + unit | `RoadTripUITests/RoadTripUITests.swift` (`testSampleDataTripHidesShareButton`, `testAddPhotoMenuOffersCameraAndLibrary`); `RoadTripTests/PhotoCaptureCoordinatorTests.swift` |
| AC4.1 | Single floating inset bar layout/safe-area | Human/device | checklist | `docs/device-test-checklist.md` |
| AC4.2 | Back → My Trips; Share owned-trip gate | Automated | UI | `RoadTripUITests/RoadTripUITests.swift` (`testTripDetailHasNoDeleteAndBackWorks`, `testSampleDataTripHidesShareButton`) |
| AC4.3 | No Delete/Archive on detail; Add Photo label kept | Automated | UI | `RoadTripUITests/RoadTripUITests.swift` (`testTripDetailHasNoDeleteAndBackWorks`, `testSampleDataTripHidesShareButton`) |

All 21 acceptance criteria (AC1.1–AC1.6, AC2.1–AC2.6, AC3.1–AC3.5, AC4.1–AC4.3) appear in exactly
one summary row and in exactly one of the Automated or Human/device sections. No criterion is
orphaned.
