# Native iOS UI Polish (Round 2) — Phase 1: Curved route line + show/hide toggle

**Goal:** Replace the straight `MapPolyline` route with a smooth dashed centripetal Catmull-Rom curve, and add a persistent map-overlay toggle button that shows/hides the route line.

**Architecture:** A new pure helper `RouteCurve` (Functional Core) densifies the ordered photo coordinates into a smooth, non-overshooting curve. `TripDetailView` (Imperative Shell) feeds that curve into the existing `MapPolyline`, strokes it dashed with rounded caps, and gates rendering behind an `@AppStorage("showRoute")` flag toggled by a custom overlay button.

**Tech Stack:** SwiftUI, MapKit (`Map`, `MapPolyline`, `StrokeStyle`), CoreLocation (`CLLocationCoordinate2D`), GRDB (unaffected here), XCTest.

**Scope:** Phase 1 of 5 from `docs/design-plans/2026-06-20-native-ios-ui-polish-2.md`.

**Codebase verified:** 2026-06-20 via codebase-investigator.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### native-ios-ui-polish-2.AC1: Route line + toggle
- **native-ios-ui-polish-2.AC1.1 Success:** With ≥2 photos, the route renders as a smooth curved line through the photo points (not straight segments).
- **native-ios-ui-polish-2.AC1.2 Success:** The route line is dashed (whimsical dotted style) with rounded caps.
- **native-ios-ui-polish-2.AC1.3 Success:** The map-control route toggle hides/shows the route line; the choice persists across app launches.
- **native-ios-ui-polish-2.AC1.5 Edge:** `RouteCurve.curved` returns the input unchanged for fewer than 3 points and never emits NaN coordinates; a trip with fewer than 2 photos draws no route and does not crash.
- **native-ios-ui-polish-2.AC1.6 Edge:** No POI show/hide toggle exists; Apple Maps points of interest remain visible (POI toggle intentionally dropped).

> **Device-verified (not automatable here):** native-ios-ui-polish-2.AC1.4 (the curve looks smooth/playful and does not loop/overshoot on clustered or irregularly spaced points). Add to `docs/device-test-checklist.md` (see Task 5).

---

## Findings that shape this phase (from investigation)

- The route is drawn today at `Views/Trips/TripDetailView.swift:334-337` (the `if` is at `:334`, the `MapPolyline` at `:335`):
  ```swift
  if routeCoordinates.count >= 2 {
      MapPolyline(coordinates: routeCoordinates)
          .stroke(.tint, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
  }
  ```
- `routeCoordinates` is at `TripDetailView.swift:414-416`: `photos.map(\.coordinate)`.
- `.mapControls { MapUserLocationButton(); MapCompass(); MapScaleView() }` is at `TripDetailView.swift:352-356`. **`.mapControls` only accepts MapKit control types** — a custom SwiftUI toggle button CANNOT be a child of it. The toggle must be a separate overlay button on the map.
- **No `@AppStorage` exists in the app yet** — this phase introduces the first use. The app otherwise uses `@State`.
- The closest existing pure-helper pattern is `Views/Trips/MapFraming.swift` (a pure `enum` of map geometry helpers extracted from `TripDetailView` for testability). **`RouteCurve` follows this exact pattern and lives next to it** (the design's looser "near Networking helpers" suggestion is superseded by this stronger local convention).
- `Photo.coordinate` is a `private extension` in `TripDetailView.swift:419-422`: `CLLocationCoordinate2D(latitude: lat, longitude: lng)`.
- New `.swift` files under `RoadTrip/` are auto-included by XcodeGen; you MUST re-run `xcodegen generate` after adding a file before building.

**Build/test commands** (run from `ios-swift/RoadTrip`):
```bash
xcodegen generate
xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  -only-testing:RoadTripTests/RouteCurveTests test     # focused
xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip \
  -destination 'platform=iOS Simulator,name=iPhone 15' test   # full suite
```
(If `iPhone 15` is not an installed simulator, substitute any booted iOS simulator name from `xcrun simctl list devices available`. XcodeBuildMCP `build_sim`/`test_sim` are an alternative.)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Create the `RouteCurve` pure helper

**Verifies:** native-ios-ui-polish-2.AC1.1 (implementation), native-ios-ui-polish-2.AC1.5 (implementation)

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Views/Trips/RouteCurve.swift`

**Implementation:**

Create a pure `enum RouteCurve` mirroring the `MapFraming` style (file-level doc comment explaining it is extracted for testability). Implement a **centripetal Catmull-Rom spline (α = 0.5)** that interpolates through the ordered waypoints. Centripetal parameterization is what prevents the loops/overshoots that a uniform Catmull-Rom or naive Bézier would produce on clustered/irregular points.

Contract (exactly as the design specifies):
```swift
import CoreLocation

/// Pure helpers for smoothing the trip route line.
///
/// Extracted from `TripDetailView` (like `MapFraming`) so the curve math is
/// unit-testable without standing up a SwiftUI `Map`. Functional Core: no I/O,
/// no mutation of shared state, deterministic.
enum RouteCurve {
    /// Smooth, non-overshooting curve through ordered waypoints, computed with a
    /// centripetal Catmull-Rom spline (alpha = 0.5).
    ///
    /// - Returns the input unchanged when `points.count < 3` (nothing to smooth).
    /// - Never emits NaN/infinite coordinates: any degenerate segment (e.g.
    ///   duplicate adjacent points producing a zero parameter delta) falls back to
    ///   the straight segment between the two control points.
    /// - For N input points it emits roughly `(N - 1) * pointsPerSegment + 1`
    ///   coordinates, always including the original first and last point.
    static func curved(through points: [CLLocationCoordinate2D],
                       pointsPerSegment: Int = 20) -> [CLLocationCoordinate2D]
}
```

Algorithm notes for the implementer:
- Work in lat/lng space directly (the distances involved are small; treating lat/lng as planar for the spline is acceptable and matches how the straight polyline already maps points).
- For each consecutive pair `(P1, P2)` in `points`, build the Catmull-Rom segment using neighbors `P0` and `P3` (clamp/duplicate endpoints at the ends: `P0 = points[0]` for the first segment, `P3 = points[last]` for the last).
- Centripetal knot spacing: `t_{i+1} = t_i + distance(P_i, P_{i+1})^0.5`. Guard every division: if any knot delta is `0` (coincident points), emit the straight interpolation for that segment instead of dividing by zero (this is the NaN guard).
- Sample each segment at `pointsPerSegment` steps; append the segment's start, sample the interior, and let the next segment contribute its start so points are not duplicated. Ensure the final original point is appended exactly once at the end.
- Guard `pointsPerSegment < 1` by treating it as `1`.

Include the complete, compiling implementation (no TODOs). This is non-obvious math, so write the full spline rather than describing it.

**Testing:** (Task 3 writes the tests.)

**Verification:**
Run: `xcodegen generate` (from `ios-swift/RoadTrip`)
Expected: regenerates `RoadTrip.xcodeproj` with the new file, no errors.

**Commit:** `feat(ios): add RouteCurve centripetal Catmull-Rom helper`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Render the curved, dashed, toggleable route in `TripDetailView`

**Verifies:** native-ios-ui-polish-2.AC1.1, native-ios-ui-polish-2.AC1.2, native-ios-ui-polish-2.AC1.3, native-ios-ui-polish-2.AC1.6

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Views/Trips/TripDetailView.swift` (route polyline block `:334-337` — `if` at `:334`, `MapPolyline` at `:335`, `.stroke` at `:336`; map controls `:352-356`; state declarations near `:21-37`)

**Implementation:**

1. Add a persisted toggle to the view's state (first `@AppStorage` in the app):
   ```swift
   @AppStorage("showRoute") private var showRoute = true
   ```

2. Replace the straight polyline block (currently `:334-337`) so it (a) only renders when `showRoute` is true and there are ≥2 points, (b) uses the curved coordinates, and (c) is dashed with rounded caps:
   ```swift
   if showRoute, routeCoordinates.count >= 2 {
       MapPolyline(coordinates: RouteCurve.curved(through: routeCoordinates))
           .stroke(.tint, style: StrokeStyle(
               lineWidth: 3,
               lineCap: .round,
               lineJoin: .round,
               dash: [2, 10]))   // whimsical dotted look; rounded caps make round dots
   }
   ```
   Keep `routeCoordinates` (`:414-416`) unchanged — it stays the raw photo coordinates; `RouteCurve` densifies them at render time.

3. Add the toggle button as a **custom overlay on the map** (NOT inside `.mapControls`, which rejects non-control views). Add it as an `.overlay` on the `Map` aligned to a free corner (top-trailing keeps it clear of the bottom photo strip and the existing controls), styled to read like a map control:
   ```swift
   .overlay(alignment: .topTrailing) {
       Button {
           showRoute.toggle()
       } label: {
           Image(systemName: showRoute ? "point.topleft.down.curvedto.point.bottomright.up"
                                       : "point.topleft.down.curvedto.point.bottomright.up.fill")
               .font(.title3)
               .padding(8)
               .background(.regularMaterial, in: Circle())
       }
       .buttonStyle(.plain)
       .accessibilityLabel(Text(showRoute ? "Hide route" : "Show route"))
       .accessibilityIdentifier("route-toggle")
       .padding(12)
   }
   ```
   Place this overlay on the `Map` (the same view that carries `.mapControls`). Pick whichever SF Symbol pair reads clearly as "route on/off"; the exact glyph is not asserted by tests — the accessibility label/identifier are.

4. **AC1.6:** Do NOT add any `pointOfInterestFilter` and do NOT add a POI toggle. Confirm none is introduced. Apple Maps POIs stay on by default (no code needed — just verify nothing filters them).

5. **AC1.5 (view-side guard):** the `routeCoordinates.count >= 2` condition is the protection that a trip with fewer than 2 photos draws no route and does not crash. The existing UI test `testEmptyTripShowsEmptyState` (the "Weekend Getaway" seed trip, 0 photos) already exercises opening a route-less trip without crashing — run it and confirm it stays green after this change rather than adding a redundant test. (The `RouteCurve` passthrough for 0/1/2 points is unit-tested in Task 3.)

**Testing:** UI behavior of the toggle is covered by a UI test in Task 4; the curve math is covered by Task 3.

**Verification:**
Run: `xcodegen generate && xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 15' build`
Expected: builds without errors.

**Commit:** `feat(ios): curved dashed route line with persistent show/hide toggle`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Unit tests for `RouteCurve`

**Verifies:** native-ios-ui-polish-2.AC1.1, native-ios-ui-polish-2.AC1.5

**Files:**
- Create: `ios-swift/RoadTrip/RoadTripTests/RouteCurveTests.swift` (unit)

**Testing:**
Follow the existing pure-helper test style (see `RoadTripTests/MapFramingTests.swift`): `import XCTest`, `@testable import RoadTrip`, `XCTestCase`, call the static function directly (no view, no DB). Tests must verify:
- **native-ios-ui-polish-2.AC1.5 — passthrough:** `curved(through:)` with 0, 1, and 2 points returns the input array unchanged (same count, same coordinates).
- **native-ios-ui-polish-2.AC1.5 — no NaN:** for a ≥3-point input (including a case with two coincident adjacent points), every returned coordinate has finite, non-NaN `latitude` and `longitude` (assert with `isFinite` / `!isNaN`).
- **native-ios-ui-polish-2.AC1.1 — endpoints preserved:** for a ≥3-point input, the first and last returned coordinates equal the first and last input coordinates (within a tight tolerance).
- **native-ios-ui-polish-2.AC1.1 — densification:** for N≥3 points the output count is greater than N and matches the documented `(N-1)*pointsPerSegment + 1` shape (assert the exact expected count for a known small input and `pointsPerSegment`).
- **smoothness sanity:** all returned points lie within the lat/lng bounding box of the inputs expanded by a small epsilon (centripetal Catmull-Rom must not overshoot far outside the hull) — this is the automatable proxy for AC1.4.

Task-implementor writes the actual assertions against the real signature.

**Verification:**
Run: `xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:RoadTripTests/RouteCurveTests test`
Expected: all `RouteCurveTests` pass.

**Commit:** `test(ios): RouteCurve passthrough, no-NaN, endpoints, densification`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: UI test for the route toggle persistence

**Verifies:** native-ios-ui-polish-2.AC1.3

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTripUITests/RoadTripUITests.swift` (add one test method)

**Testing:**
Add an XCUITest that opens the seed trip (`"Pacific Coast Highway"`, the same anchor used by `testSampleDataTripHidesShareButton`) and exercises the toggle via `app.buttons["route-toggle"]`:
- Wait for the detail view (anchor on `app.buttons["Add Photo"]`).
- Assert `app.buttons["route-toggle"]` exists and is hittable.
- Tap it; assert its accessibility label flips (e.g. from "Hide route" to "Show route") — read `app.buttons["route-toggle"].label`.
- Tap again; assert it flips back.
- (Persistence across launches: `@AppStorage` persistence itself is exercised at the unit/UserDefaults level; a full relaunch assertion is optional and may be added to the device checklist if XCUITest relaunch proves flaky. Document the choice in the test comment.)

Attach a screenshot named `AC1.3-route-toggle` for the artifact trail (matches the existing `attach(app.screenshot(), name:)` pattern).

**Verification:**
Run: `xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:RoadTripUITests/RoadTripUITests/testRouteToggleShowsAndHides test`
Expected: the new test passes.

**Commit:** `test(ios): UI test for route toggle show/hide`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Record device-only criteria in the device checklist

**Verifies:** native-ios-ui-polish-2.AC1.4 (device verification only)

**Files:**
- Modify: `ios-swift/RoadTrip/docs/device-test-checklist.md` if it exists; otherwise Create: `docs/device-test-checklist.md` at repo root following the existing "device-checklist for feel" pattern referenced in the design. (Investigate which path the project already uses before creating a new one.)

**Implementation:**
Add a checklist item:
- [ ] **AC1.4 (device):** On a real device, with a trip of clustered/irregular photo points, confirm the route curve looks smooth and playful and does NOT loop or overshoot. Toggle the route off/on and confirm it hides/shows. Confirm Apple Maps POIs remain visible (AC1.6).

**Verification:** Markdown only — no build. Confirm the file contains the new item.

**Commit:** `docs(ios): device checklist entry for route curve feel (AC1.4)`
<!-- END_TASK_5 -->

---

## Phase 1 Done When
- `RouteCurveTests` pass (passthrough <3 points, no NaN, endpoints preserved, densification count, bounding-box sanity).
- `testRouteToggleShowsAndHides` passes.
- Full build succeeds after `xcodegen generate`; the existing suite stays green (notably `testEmptyTripShowsEmptyState` and `testDeleteTripFlow` — this phase does not touch the toolbar/Delete, so both must remain passing).
- Route renders curved + dashed and the overlay toggle shows/hides it (device/simulator).
- No POI filter or POI toggle was introduced (AC1.6).
