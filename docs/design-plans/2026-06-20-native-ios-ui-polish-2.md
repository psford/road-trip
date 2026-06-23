# Native iOS UI Polish (Round 2) Design

## Summary

This design polishes four areas of the native iOS SwiftUI trip-detail experience. The route line on the map is upgraded from straight polyline segments to a smooth dashed curve computed via a centripetal Catmull-Rom spline, with a persistent toggle button to show or hide it. The trip-deletion flow is replaced by a two-step soft archive: swiping a trip left on the My Trips list archives it locally (no server call), and a new Archived view provides Restore and a deliberately gated "Delete permanently" action that performs the actual server delete. The photo-add control gains a camera-capture path that feeds captured photos — tagged with a one-shot device location, or routed to a pin-drop sheet if location is unavailable — through the existing staging pipeline without duplicating the transcode logic. Finally, the trip detail screen consolidates its back button, title, Share menu, and + control into a single floating inset bar, replacing the system navigation bar and a separate floating pill.

The five implementation phases are largely independent: the spline helper (Phase 1), archive data model and swipe action (Phase 2), and camera capture (Phase 4) can proceed in parallel, with the Archived view (Phase 3) depending only on Phase 2's model change and the merged top bar (Phase 5) depending on Phases 3 and 4 landing their controls first. All changes are client-side only — the backend, Keychain tokens, and shared view links are unaffected by archiving — and follow existing app patterns: GRDB migrations for schema changes, `ValueObservation` for reactive list updates, and `UIViewControllerRepresentable` bridges for UIKit capabilities SwiftUI cannot cover natively.

## Definition of Done

Four UI-polish features for the native iOS trip experience (SwiftUI app under `ios-swift/RoadTrip`). Archive is client-side only; no backend or web changes.

1. **Curved route line + toggle.** The map route renders as a smooth, slightly playful **dashed curved line** (centripetal Catmull-Rom spline through the ordered photo points — no bezier overshoot/loops) instead of straight `MapPolyline` segments. A **map-control button** toggles the route line on/off. The separate POI show/hide toggle is **dropped** — Apple Maps points of interest remain on by default.

2. **Soft archive replaces delete.** The **Delete button is removed from the trip detail page.** On the **My Trips** list, a swipe-left row action reveals **Archive** (local, recoverable). Archived trips are hidden from the main My Trips list. An **Archived view** lists archived trips and offers **Restore** and **Delete permanently** — the latter is the only path to a real server-side delete (the existing hard delete). Archive is a local-only flag on the iOS Trip model; no backend change, so shared view links keep working while a trip is archived.

3. **Camera capture from +.** The Add-Photo **`+` control offers "Take Photo" (camera)** in addition to "Choose from Library". A captured photo feeds the existing staging pipeline (EXIF GPS extraction, HEIC→JPEG transcode, no-GPS pin-drop fallback). Adds `NSCameraUsageDescription`.

4. **Merged floating top bar.** The trip detail screen uses a single **floating inset bar** (rounded, small side margins, over the map) containing: the **back button**, the **left-justified trip name**, and the **Share** and **+** actions. (Delete is gone from this screen per #2.)

### Success criteria
- Route line is smooth/curved/dashed and does not loop or overshoot on clustered/irregular points; the map-control toggle shows/hides it; device-verified for feel.
- Deleting is no longer one tap on the trip page; swipe-archive hides a trip and an Archived view restores it; only "Delete permanently" removes server data.
- `+` can capture from the camera and stage the photo (with GPS or pin-drop); library path still works.
- The trip detail top bar is a single floating inset bar with back + left-justified title + Share + `+`.

### Out of scope
- POI show/hide toggle (intentionally dropped — Apple Maps POIs stay on).
- Any web (`src/RoadTripMap/wwwroot`) changes.
- Backend changes (archive is client-side; the existing `TripEntity.IsActive` is not used for this).

## Acceptance Criteria

### native-ios-ui-polish-2.AC1: Route line + toggle
- **native-ios-ui-polish-2.AC1.1 Success:** With ≥2 photos, the route renders as a smooth curved line through the photo points (not straight segments).
- **native-ios-ui-polish-2.AC1.2 Success:** The route line is dashed (whimsical dotted style) with rounded caps.
- **native-ios-ui-polish-2.AC1.3 Success:** The map-control route toggle hides/shows the route line; the choice persists across app launches.
- **native-ios-ui-polish-2.AC1.4 Success (device):** The curve looks smooth/playful and does not loop or overshoot on clustered or irregularly spaced points.
- **native-ios-ui-polish-2.AC1.5 Edge:** `RouteCurve.curved` returns the input unchanged for fewer than 3 points and never emits NaN coordinates; a trip with fewer than 2 photos draws no route and does not crash.
- **native-ios-ui-polish-2.AC1.6 Edge:** No POI show/hide toggle exists; Apple Maps points of interest remain visible (POI toggle intentionally dropped).

### native-ios-ui-polish-2.AC2: Soft archive
- **native-ios-ui-polish-2.AC2.1 Success:** Swiping a My Trips row left reveals an Archive action; invoking it archives the trip.
- **native-ios-ui-polish-2.AC2.2 Success:** An archived trip no longer appears in the My Trips list.
- **native-ios-ui-polish-2.AC2.3 Success:** The Archived view lists archived trips; Restore returns a trip to My Trips (and removes it from Archived).
- **native-ios-ui-polish-2.AC2.4 Success:** "Delete permanently" in the Archived view removes the trip server-side, locally, and clears its Keychain tokens.
- **native-ios-ui-polish-2.AC2.5 Edge:** Archiving does not delete the server trip or its tokens — the shared view link still works and the trip restores intact.
- **native-ios-ui-polish-2.AC2.6 Failure:** "Delete permanently" requires confirmation; cancelling leaves the trip archived and present in the Archived view.

### native-ios-ui-polish-2.AC3: Camera capture
- **native-ios-ui-polish-2.AC3.1 Success:** The + control presents a choice of "Take Photo" (camera) and "Choose from Library".
- **native-ios-ui-polish-2.AC3.2 Success:** A camera-captured photo is staged through the existing pipeline (transcoded to JPEG and queued for upload).
- **native-ios-ui-polish-2.AC3.3 Success:** When a location fix is available at capture, the staged photo is tagged with the current device coordinate.
- **native-ios-ui-polish-2.AC3.4 Failure:** When location permission is denied or no fix is available, the pin-drop sheet is shown so the user can set the location; the capture is not lost and the app does not crash.
- **native-ios-ui-polish-2.AC3.5 Success:** "Choose from Library" still stages a photo as before (regression guard).

### native-ios-ui-polish-2.AC4: Merged floating top bar
- **native-ios-ui-polish-2.AC4.1 Success:** The trip detail screen shows a single floating inset bar containing the back control, the left-justified trip name, Share, and +.
- **native-ios-ui-polish-2.AC4.2 Success:** Back returns to My Trips; the Share control keeps its owned-trip gate (hidden when the trip has no secret token).
- **native-ios-ui-polish-2.AC4.3 Edge:** No Delete or Archive action appears on the trip detail screen (deletion lives only in the Archived view); the "Add Photo" control retains its accessible label/identifier for `RoadTripUITests.testSampleDataTripHidesShareButton`.

## Glossary

- **Centripetal Catmull-Rom spline**: An interpolating curve that passes through each control point and uses a parameterization (α = 0.5) that prevents loops and overshooting on tightly clustered or unevenly spaced points. Used to smooth the route line through photo coordinates.
- **MapPolyline**: A SwiftUI MapKit type that draws a line through an ordered array of `CLLocationCoordinate2D` on a `Map`. Currently draws the straight route; extended here with a dashed `StrokeStyle`.
- **StrokeStyle**: A SwiftUI/Core Graphics value controlling how a path is stroked (dash pattern, line cap, width); applied to `MapPolyline` for the dashed, rounded-cap route line.
- **`@AppStorage`**: A SwiftUI property wrapper that persists a value in `UserDefaults` and republishes it as state. Remembers the route-line toggle across launches.
- **GRDB**: The Swift SQLite library used for local persistence. Schema changes go through numbered migrations in `AppDatabase`.
- **`ValueObservation`**: A GRDB mechanism that tracks a query and pushes new results to SwiftUI state when rows change. Keeps the My Trips list in sync.
- **archivedAt**: A new nullable `Date?` column on the local `Trip` model. Non-nil = archived; nil = active. Exists only in the iOS SQLite database — the server has no knowledge of it.
- **Soft archive**: A recoverable hide that sets `archivedAt` locally without touching the server record, Keychain tokens, or share link. Contrasted with "Delete permanently."
- **Keychain tokens**: Per-trip secret/view tokens in the iOS Keychain that authorize share-link generation and server operations. Soft archive leaves these intact so restore works and the share link keeps functioning.
- **`UIViewControllerRepresentable`**: A SwiftUI protocol for wrapping a UIKit view controller in a SwiftUI hierarchy. Used to present `UIImagePickerController` for camera capture (SwiftUI has no native camera-capture view).
- **`UIImagePickerController`**: A UIKit controller presenting the system camera/library UI. Configured with `sourceType: .camera` to capture a new photo.
- **EXIF GPS**: Geographic metadata embedded in image files by cameras/phones. Library photos may carry it; UIImagePickerController camera captures do not, so a separate CoreLocation fetch is needed.
- **HEIC→JPEG transcode**: Conversion of Apple's HEIC format (default iOS camera format) to JPEG before upload, handled by the existing `PhotoCaptureCoordinator` and reused for the camera path.
- **`PhotoCaptureCoordinator`**: The existing class that receives a `PhotosPickerItem`, extracts GPS/timestamp, transcodes HEIC→JPEG, and queues the result for upload. Refactored in Phase 4 to accept raw image data plus an explicit coordinate so the camera path shares the same core.
- **`PhotosPickerItem`**: A SwiftUI PhotosUI type for a library-selected item. The library path wraps this; the camera path supplies raw data directly instead.
- **PinDropView / pin-drop sheet**: An existing sheet that lets the user manually place a pin to assign a location when no GPS coordinate is available. Reused as the camera fallback.
- **One-shot CoreLocation fetch (`requestLocation()`)**: A `CLLocationManager` API that requests a single location fix then stops — tags a camera capture without keeping location services running continuously.
- **`NSCameraUsageDescription` / `NSLocationWhenInUseUsageDescription`**: iOS Info.plist keys whose strings appear in the system permission prompts for camera and location access. Required by App Store review.
- **Functional Core / Imperative Shell (FCIS)**: Architecture pattern separating pure, side-effect-free logic (functional core, e.g. `RouteCurve`) from I/O/mutation/UI code (imperative shell, e.g. views and coordinators).
- **`.regularMaterial`**: A SwiftUI translucent blur background style. Used for the floating top bar so the map shows through.
- **Floating inset bar**: The custom top control bar (Phase 5) overlaying the map with side margins, `.regularMaterial` translucency, safe-area aware — replaces the system nav bar and the prior floating action pill.
- **`.swipeActions`**: A SwiftUI `List` row modifier revealing action buttons on horizontal swipe. Exposes the Archive action on My Trips rows.
- **`RoadTripAPI.deleteTrip`**: The existing function that sends a server DELETE, removes the local record, and clears Keychain tokens. Now called only from "Delete permanently" in the Archived view.
- **Safe area**: The screen region not obscured by notch/Dynamic Island/home indicator. The floating top bar must respect the top safe area.
- **`testSampleDataTripHidesShareButton`**: An existing XCUITest that opens a SampleData trip (no secret token) and asserts no Share button. Phase 5 must keep the "Add Photo" accessible label so the test still finds the + control.

## Architecture

All changes are in the native iOS SwiftUI app (`ios-swift/RoadTrip/RoadTrip`). No backend or web changes. Four largely independent feature areas plus one shared model change.

**Route line + toggle** (`Views/Trips/TripDetailView.swift`, new `RouteCurve` helper). Today the route is straight `MapPolyline(coordinates: photos.map(\.coordinate))` segments rendered unconditionally (`TripDetailView.swift:334-337`, `routeCoordinates` at `:414-416`). A new pure helper densifies the ordered photo coordinates along a **centripetal Catmull-Rom spline** (α=0.5) into many `CLLocationCoordinate2D`, which feeds the same `MapPolyline` stroked with a dashed `StrokeStyle` (rounded caps). A map-control button (rendered in/near the existing `.mapControls` block at `:352-356`) toggles a `showRoute` flag (persisted via `@AppStorage`, default on); when off, the polyline is omitted from the `Map` content. POIs are unchanged (Apple Maps default; no `pointOfInterestFilter`, no toggle).

`RouteCurve` contract (pure, Functional Core):
```swift
enum RouteCurve {
    /// Smooth, non-overshooting curve through ordered waypoints.
    /// Returns the input unchanged for < 3 points; never returns NaN coordinates.
    static func curved(through points: [CLLocationCoordinate2D],
                       pointsPerSegment: Int = 20) -> [CLLocationCoordinate2D]
}
```

**Floating top bar** (`Views/Trips/TripDetailView.swift`). The system nav bar (`navigationTitle` at `:87-88`, system back, and the floating action pill) is replaced by `.toolbar(.hidden)` plus a custom floating inset bar overlaid at the top: `[back] · TripName (leading) · Spacer · [Share menu] · [+ menu]` on `.regularMaterial`, rounded, inset side margins, top-safe-area aware. Back calls `dismiss()`. The Share menu keeps its owned-trip gate (`secretToken != nil`, `:90-104`). The Delete toolbar item (`:112-119`) is removed entirely. The `+` control retains an accessible **"Add Photo"** label/identifier so the existing `RoadTripUITests.testSampleDataTripHidesShareButton` (which waits on `app.buttons["Add Photo"]`) still passes.

**Soft archive** (`Models/Trip.swift`, `AppDatabase` migration, `Views/Trips/TripListView.swift`, new Archived view). The iOS `Trip` model gains `archivedAt: Date?` (nil = active) via a new GRDB migration. This is local-only — the server row and Keychain tokens are untouched, so archiving never affects the shared view link and restore is instant. The My Trips `ValueObservation` query (`TripListView.swift:57-69`) filters `archivedAt == nil`. Rows gain `.swipeActions(edge: .trailing)` with an **Archive** action (sets `archivedAt = now`). A new **Archived** view (reached from a My Trips toolbar item) lists `archivedAt != nil` trips with **Restore** (`archivedAt = nil`) and **Delete permanently** (the existing `RoadTripAPI.deleteTrip` → server DELETE + local + Keychain, behind a confirmation). Permanent delete exists *only* here.

**Camera capture** (`Views/Trips/TripDetailView.swift`, `Photos/PhotoCaptureCoordinator.swift`, new camera + location wrappers). The `+` becomes a `Menu`: **Take Photo** / **Choose from Library** (existing `PhotosPicker`). Take Photo presents `UIImagePickerController(sourceType: .camera)` via a `UIViewControllerRepresentable`. Because camera captures carry no EXIF GPS, the app requests a one-shot `CLLocationManager.requestLocation()` (when-in-use) and passes the captured JPEG bytes **plus an explicit coordinate** into the staging pipeline. `PhotoCaptureCoordinator` (currently `stagePhoto(from: PhotosPickerItem, …)` at `:42-77`) is refactored so its transcode/stage core accepts raw image data + an optional coordinate, shared by both the library and camera entry points. If location is denied/unavailable, the existing no-GPS `PinDropView` flow (`TripDetailView.swift:153-158, 283-287`) handles it.

## Existing Patterns

This design follows established native-app patterns:
- **FCIS:** pure helpers (`RouteCurve`, and the existing `RoadTripAPI.viewToken`/`firstUUID`/`TripShareLinks`) are side-effect-free static functions; SwiftUI views and `PhotoCaptureCoordinator` are the imperative shell. Mirrors the Phase 2/3 sharing work.
- **GRDB migrations + `ValueObservation`:** schema changes go through `AppDatabase` migrations; the trip list already reacts to DB changes via `ValueObservation.tracking` (`TripListView.swift:57-69`). Adding `archivedAt` and filtering follows this exactly.
- **SwiftUI `List` + `.swipeActions`:** My Trips is already a `List(.plain)` with `NavigationLink` rows (`TripListView.swift:14-49`) — `.swipeActions` is the standard, idiomatic addition.
- **UIViewControllerRepresentable bridges:** the project already bridges UIKit where SwiftUI can't (per project memory: SwiftUI-first, bridge when needed). Camera capture is such a case.
- **PhotosPicker → PHAsset staging:** the existing capture pipeline (`PhotoCaptureCoordinator.swift`) extracts GPS/takenAt and transcodes HEIC→JPEG; the camera path reuses the transcode/stage core via a new data-based entry point.
- **Device-checklist for feel:** SwiftUI layout/gesture/map feel is routed to `docs/device-test-checklist.md` with XCUITest for reachable behaviors — same strategy as the popup work.

New pattern introduced: a one-shot CoreLocation fetch for camera capture (no CoreLocation usage exists today). It is encapsulated in a small location-provider wrapper rather than scattered through the view.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Curved route line + show/hide toggle
**Goal:** Replace straight route segments with a smooth dashed curve and add a map-control toggle.

**Components:**
- `RouteCurve` pure helper (new file under `ios-swift/RoadTrip/RoadTrip/` near other Networking/utility helpers) — centripetal Catmull-Rom densification.
- `Views/Trips/TripDetailView.swift` — feed `RouteCurve.curved(through:)` into `MapPolyline`, apply dashed `StrokeStyle`; add a map-control toggle button bound to `@AppStorage("showRoute")`; omit the polyline when off.

**Dependencies:** None.

**Covers ACs:** native-ios-ui-polish-2.AC1.1, AC1.2, AC1.3, AC1.5 (AC1.4 route *feel* is device-verified).

**Done when:** `RouteCurve` unit tests pass (endpoints preserved, expected densified count, no NaN, <3-point passthrough); build succeeds; route renders curved+dashed and toggles on device/simulator.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Soft-archive data model + My Trips swipe
**Goal:** Add the archive flag and the swipe-to-archive action; hide archived trips from the main list.

**Components:**
- `Models/Trip.swift` — add `archivedAt: Date?`.
- `AppDatabase` migration — add nullable `archivedAt` column.
- `Views/Trips/TripListView.swift` — filter `archivedAt == nil` in the `ValueObservation` query; add `.swipeActions(edge: .trailing)` Archive button that sets `archivedAt = now`.

**Dependencies:** None (independent of Phase 1).

**Covers ACs:** native-ios-ui-polish-2.AC2.1, AC2.2, AC2.5.

**Done when:** migration applies cleanly; unit tests verify the archive filter (archived excluded, active included) and the archive mutation; swiping a row archives it and it disappears from My Trips.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Archived view (restore + permanent delete)
**Goal:** Give archived trips a home with restore and the only permanent-delete path.

**Components:**
- New Archived view (`Views/Trips/`) — lists `archivedAt != nil` trips; Restore sets `archivedAt = nil`; Delete permanently calls the existing `RoadTripAPI.deleteTrip` (server DELETE + local + Keychain) behind a confirmation.
- `Views/Trips/TripListView.swift` — toolbar entry point to the Archived view.

**Dependencies:** Phase 2 (archive flag).

**Covers ACs:** native-ios-ui-polish-2.AC2.3, AC2.4, AC2.6.

**Done when:** restore returns a trip to My Trips; permanent delete removes it server-side and locally; unit tests verify restore and the delete delegation; reachable from My Trips.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Camera capture from the + control
**Goal:** Let users take a photo with the camera and stage it via the existing pipeline.

**Components:**
- `Photos/PhotoCaptureCoordinator.swift` — refactor so the transcode/stage core accepts raw JPEG data + optional coordinate; keep the existing `PhotosPickerItem` entry point delegating to it.
- New camera bridge (`UIViewControllerRepresentable` over `UIImagePickerController(.camera)`) and a one-shot CoreLocation provider wrapper.
- `Views/Trips/TripDetailView.swift` — turn `+` into a Menu (Take Photo / Choose from Library); wire camera → location → staging; reuse `PinDropView` when no location.
- `project.yml` — add `NSCameraUsageDescription` and `NSLocationWhenInUseUsageDescription`.

**Dependencies:** None (independent of 1-3), but touches `TripDetailView` like Phase 5.

**Covers ACs:** native-ios-ui-polish-2.AC3.1, AC3.2, AC3.3, AC3.4.

**Done when:** the staging core's data-based entry point is unit-tested (coordinate honored; transcode invoked); on device, Take Photo captures, attaches current location (or pin-drop), and the photo stages/uploads; library path still works.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Merged floating top bar
**Goal:** Replace the system nav bar + floating action pill with one floating inset bar.

**Components:**
- `Views/Trips/TripDetailView.swift` — hide the system nav bar; add a custom floating inset bar (`[back] · TripName leading · Spacer · Share · +`) on `.regularMaterial`; remove the Delete toolbar item; preserve Share gating and the "Add Photo" accessible label.

**Dependencies:** Phase 3 (Delete must have an alternative home before removal) and Phase 4 (the `+` menu lands in the bar).

**Covers ACs:** native-ios-ui-polish-2.AC4.1, AC4.2, AC4.3.

**Done when:** trip detail shows the single floating bar with back + left-justified title + Share + `+`; no Delete on this screen; `testSampleDataTripHidesShareButton` still passes; device-verified layout (safe area, legibility over map).
<!-- END_PHASE_5 -->

## Additional Considerations

**Toolbar/test stability:** the existing `RoadTripUITests.testSampleDataTripHidesShareButton` waits on `app.buttons["Add Photo"]` and asserts no `Share` button for SampleData (no secret token). Phase 5 must keep an "Add Photo"-labeled control and the Share gate so this test stays valid.

**Archive vs revalidation:** archived trips keep their Keychain tokens, so `TripListView` revalidation should skip `archivedAt != nil` trips (don't re-fetch archived trips from the server). Surface during implementation.

**Permanent-delete reachability:** because real delete now lives two levels deep (My Trips → Archived → Delete permanently), the Archived view must make it discoverable (clear label + confirmation) so users aren't stuck with un-deletable trips.

**Camera location timing:** a cold CoreLocation fix can take 1-5s. Capture shouldn't block on it indefinitely — if no fix arrives promptly, fall through to `PinDropView` rather than hanging.
