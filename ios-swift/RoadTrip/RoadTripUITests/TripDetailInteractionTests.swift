import XCTest

/// Composite occlusion / z-order regression tests for TripDetailView.
///
/// These tests are deliberately deterministic — they do not exercise the system photo
/// picker, network calls, or any non-deterministic external state. Every assertion is
/// against in-process layout and accessibility, so they are stable in CI.
///
/// Design concern: TripDetailView uses a ZStack with a floating top bar (`.overlay(alignment: .top)`).
/// Past iOS layout changes have placed controls under the bar's hit area, silently intercepting
/// taps. These tests catch that class of regression by:
///   1. Asserting every key control is *both* hittable AND responsive after a tap.
///   2. Making a geometric assertion that the route-toggle button sits below the bar's bottom edge.
final class TripDetailInteractionTests: XCTestCase {

    private func launchApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest"]
        app.launch()
        return app
    }

    private func attach(_ screenshot: XCUIScreenshot, name: String) {
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    // MARK: - testAllControlsHittableWithAllPhasesComposed

    /// Verifies that all key controls in TripDetailView are reachable AND responsive when
    /// the full ZStack composition is active (floating bar, upload banner not present for
    /// a fresh seed trip, popup closed).
    ///
    /// "Hittable + responds" is more rigorous than `isHittable` alone: an occluded button
    /// can report `isHittable == true` while a transparent overlay intercepts the actual tap.
    /// The route-toggle test proves responsiveness: if the floating bar intercepts the tap,
    /// the button's accessibility label never flips to the expected value, failing the waiter.
    func testAllControlsHittableWithAllPhasesComposed() {
        let app = launchApp()

        // Open the "Pacific Coast Highway" seed trip (deterministic via -uitest launch arg)
        let trip = app.staticTexts["Pacific Coast Highway"]
        XCTAssertTrue(trip.waitForExistence(timeout: 10), "seed trip should appear in the list")
        trip.tap()

        // Anchor: wait for the detail view to be fully loaded
        let addPhotoButton = app.buttons["Add Photo"]
        XCTAssertTrue(addPhotoButton.waitForExistence(timeout: 10), "Add Photo button must appear before proceeding")

        attach(app.screenshot(), name: "occlusion-initial-state")

        // ── 1. Back button ──────────────────────────────────────────────────────────────
        // Assert exists + hittable but do NOT tap (it navigates away).
        let backButton = app.buttons["trip-back"]
        XCTAssertTrue(backButton.waitForExistence(timeout: 5), "trip-back button must exist")
        XCTAssertTrue(backButton.isHittable, "trip-back button must be hittable (not occluded)")

        // ── 2. Add Photo menu — tap it and prove the tap reached the button ──────────────
        // If an overlay were intercepting the tap, the menu would not open.
        XCTAssertTrue(addPhotoButton.isHittable, "Add Photo button must be hittable")
        addPhotoButton.tap()

        let takePhotoButton = app.buttons["Take Photo"]
        XCTAssertTrue(
            takePhotoButton.waitForExistence(timeout: 5),
            "tapping Add Photo must open the menu (proves the tap was not intercepted by an overlay)"
        )
        attach(app.screenshot(), name: "occlusion-add-photo-menu-open")

        // Dismiss the menu by tapping the map area below the floating bar
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6)).tap()

        // Wait for the menu to go away before proceeding
        XCTAssertTrue(
            takePhotoButton.waitForNonExistence(timeout: 5),
            "menu should dismiss after tapping elsewhere"
        )

        // ── 3. Route toggle — tap and assert label flips ────────────────────────────────
        // This is the real occlusion catch: if the floating bar intercepts the tap, the
        // label never flips and the predicate waiter times out with a clear failure message.
        let routeToggle = app.buttons["route-toggle"]
        XCTAssertTrue(routeToggle.waitForExistence(timeout: 5), "route-toggle must exist")
        XCTAssertTrue(routeToggle.isHittable, "route-toggle must be hittable")

        // Capture the current label so the test is independent of persisted AppStorage state
        let initialLabel = routeToggle.label
        let flippedLabel = initialLabel == "Hide route" ? "Show route" : "Hide route"

        routeToggle.tap()

        // Wait for the label to flip — proves the tap hit the button, not an overlay
        let expectFlip = expectation(
            for: NSPredicate(format: "label == %@", flippedLabel),
            evaluatedWith: routeToggle
        )
        let flipResult = XCTWaiter.wait(for: [expectFlip], timeout: 8)
        XCTAssertEqual(
            flipResult, .completed,
            "route-toggle label must flip to '\(flippedLabel)' — if this fails, the floating bar is intercepting the tap (z-order regression)"
        )
        attach(app.screenshot(), name: "occlusion-route-toggled")

        // Restore original state
        routeToggle.tap()
        let expectRestore = expectation(
            for: NSPredicate(format: "label == %@", initialLabel),
            evaluatedWith: routeToggle
        )
        let restoreResult = XCTWaiter.wait(for: [expectRestore], timeout: 8)
        XCTAssertEqual(restoreResult, .completed, "route-toggle must restore to '\(initialLabel)'")
    }

    // MARK: - testRouteToggleNotOccludedByFloatingBar

    /// Geometric guard: asserts that the route-toggle button's top edge sits strictly below
    /// the floating bar's bottom edge (using trip-back as a proxy for the bar's bottom edge).
    ///
    /// This test catches layout regressions where a `.padding(.top:)` change on the toggle
    /// or a height increase of the floating bar would cause overlap. The failure message
    /// includes the actual clearance value so the engineer can see by how much the overlap
    /// occurred.
    ///
    /// Note: `frame` values from XCUIElement are in screen-logical points (not pixels),
    /// consistent with SwiftUI's coordinate space.
    func testRouteToggleNotOccludedByFloatingBar() {
        let app = launchApp()

        let trip = app.staticTexts["Pacific Coast Highway"]
        XCTAssertTrue(trip.waitForExistence(timeout: 10), "seed trip should appear in the list")
        trip.tap()

        let addPhotoButton = app.buttons["Add Photo"]
        XCTAssertTrue(addPhotoButton.waitForExistence(timeout: 10), "detail view must load")

        let backButton = app.buttons["trip-back"]
        XCTAssertTrue(backButton.waitForExistence(timeout: 5), "trip-back must exist for bar-proxy measurement")

        let routeToggle = app.buttons["route-toggle"]
        XCTAssertTrue(routeToggle.waitForExistence(timeout: 5), "route-toggle must exist")

        // The floating bar's bottom edge ~ trip-back's maxY (the bar is a single HStack; the
        // back button sits at the bar's leading edge and has the same vertical extent as the bar).
        let barBottomEdge = backButton.frame.maxY
        let toggleTopEdge = routeToggle.frame.minY

        let clearance = toggleTopEdge - barBottomEdge

        // Require at least 1 point of clearance so the toggle is not underneath the bar.
        // A large positive clearance is normal and desirable (~50+ pt for the current layout).
        XCTAssertGreaterThan(
            clearance, 0,
            "route-toggle (minY=\(toggleTopEdge)) must sit below the floating bar bottom (maxY=\(barBottomEdge)). Current clearance: \(clearance)pt. A negative value means the toggle is UNDER the bar (z-order regression)."
        )

        attach(app.screenshot(), name: "geometric-clearance-bar-vs-toggle")
    }
}
