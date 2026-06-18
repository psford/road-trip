import XCTest

/// UI tests. `testAppLaunches` doubles as the Phase 1 "app runs on simulator" check;
/// the rest assert the AC5 (MapKit) behaviors end-to-end on the simulator.
final class RoadTripUITests: XCTestCase {

    func testAppLaunches() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(
            app.wait(for: .runningForeground, timeout: 10),
            "App did not reach the foreground on launch"
        )
    }

    /// AC5.2: tapping a map annotation opens `PhotoDetailView` via the NavigationStack.
    /// Also visually captures the fitted map + controls (AC5.1 / AC5.3).
    func testTappingMapPinOpensPhotoDetail() {
        let app = XCUIApplication()
        app.launch()

        let trip = app.staticTexts["Pacific Coast Highway"]
        XCTAssertTrue(trip.waitForExistence(timeout: 10), "seed trip should appear in the list")
        trip.tap()

        // The annotation is an accessible button labelled with the photo's place name.
        let pin = app.buttons["Bixby Bridge"]
        XCTAssertTrue(pin.waitForExistence(timeout: 10),
                      "map annotation should render and be accessible (AC5.1 frames it on-screen)")
        attach(app.screenshot(), name: "AC5.1-5.3-trip-map")

        pin.tap()

        // The caption text is unique to PhotoDetailView, so its presence proves the push.
        let caption = app.staticTexts["Classic stop on Highway 1"]
        XCTAssertTrue(caption.waitForExistence(timeout: 5),
                      "tapping a pin should push PhotoDetailView (AC5.2)")
        attach(app.screenshot(), name: "AC5.2-photo-detail")
    }

    /// AC5.4: a trip with zero photos shows the "No photos yet" empty state.
    func testEmptyTripShowsEmptyState() {
        let app = XCUIApplication()
        app.launch()

        let emptyTrip = app.staticTexts["Weekend Getaway"]
        XCTAssertTrue(emptyTrip.waitForExistence(timeout: 10), "empty seed trip should appear in the list")
        emptyTrip.tap()

        let emptyState = app.staticTexts["No photos yet"]
        XCTAssertTrue(emptyState.waitForExistence(timeout: 5),
                      "a 0-photo trip should show the empty state (AC5.4)")
        attach(app.screenshot(), name: "AC5.4-empty-state")
    }

    /// Phase 3 end-to-end: the app hydrates a REAL trip from the local backend and
    /// renders its geotagged photos on the map. Requires the backend running on :5100.
    func testRealBackendTripRenders() {
        let app = XCUIApplication()
        app.launch()

        let trip = app.staticTexts["Big Sur Run"]
        XCTAssertTrue(trip.waitForExistence(timeout: 15),
                      "real backend trip should hydrate into the list")
        trip.tap()

        let pin = app.buttons["Monterey County, California, United States"]
        XCTAssertTrue(pin.waitForExistence(timeout: 15),
                      "real photo pin should render on the map")
        attach(app.screenshot(), name: "real-trip-map")

        pin.tap()
        let caption = app.staticTexts["Bixby Bridge at golden hour"]
        XCTAssertTrue(caption.waitForExistence(timeout: 10),
                      "tapping the real pin opens the photo popup over the map")
        attach(app.screenshot(), name: "real-photo-popup")

        // Web-parity swipe: advance to the next photo within the popup.
        app.swipeLeft()
        let nextCaption = app.staticTexts["Big Sur coastline"]
        XCTAssertTrue(nextCaption.waitForExistence(timeout: 5),
                      "swiping the popup advances to the next photo")
        attach(app.screenshot(), name: "real-photo-popup-swiped")
    }

    private func attach(_ screenshot: XCUIScreenshot, name: String) {
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
