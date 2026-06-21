import XCTest

/// UI tests. `testAppLaunches` doubles as the Phase 1 "app runs on simulator" check;
/// the rest assert the AC1 (trip CRUD) and AC5 (MapKit) behaviors end-to-end.
///
/// All tests launch with `-uitest` so the app resets to a deterministic state
/// (SampleData only) on each run — see `RoadTripApp.init`.
final class RoadTripUITests: XCTestCase {

    /// SecretToken of the trip seeded on the local backend ("Big Sur Run", 3 photos).
    /// Used to exercise the Import-via-token flow against real data.
    private let demoToken = "e0213ab5-2018-4ecc-9c90-f0ab1533d4bc"

    private func launchApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest"]
        app.launch()
        return app
    }

    func testAppLaunches() {
        let app = launchApp()
        XCTAssertTrue(
            app.wait(for: .runningForeground, timeout: 10),
            "App did not reach the foreground on launch"
        )
    }

    /// AC1.1: create a trip via the native client → it appears in the list.
    func testCreateTripFlow() {
        let app = launchApp()

        app.buttons["New Trip"].tap()

        let nameField = app.textFields["Trip name"]
        XCTAssertTrue(nameField.waitForExistence(timeout: 5), "create sheet should show a name field")
        nameField.tap()
        nameField.typeText("UITest Created Trip")

        app.buttons["Create"].tap()

        let created = app.staticTexts["UITest Created Trip"]
        XCTAssertTrue(created.waitForExistence(timeout: 15),
                      "created trip should appear in the list via ValueObservation (AC1.1)")
        attach(app.screenshot(), name: "AC1.1-trip-created")
    }

    /// AC1.3 + Phase 3 read: import a real trip by token, then confirm its photos render
    /// on the map. Requires the backend running on :5100.
    func testImportTripFlow() {
        let app = launchApp()

        app.buttons["Import via Token"].tap()

        let tokenField = app.textFields["Secret token"]
        XCTAssertTrue(tokenField.waitForExistence(timeout: 5), "import sheet should show a token field")
        tokenField.tap()
        tokenField.typeText(demoToken)

        app.buttons["Import"].tap()

        let trip = app.staticTexts["Big Sur Run"]
        XCTAssertTrue(trip.waitForExistence(timeout: 15),
                      "imported trip should hydrate into the list (AC1.3)")
        attach(app.screenshot(), name: "AC1.3-trip-imported")
        trip.tap()

        let pin = app.buttons["Monterey County, California, United States"]
        XCTAssertTrue(pin.waitForExistence(timeout: 15),
                      "real photo pin should render on the map")
        attach(app.screenshot(), name: "imported-trip-map")

        pin.tap()
        let caption = app.staticTexts["Bixby Bridge at golden hour"]
        XCTAssertTrue(caption.waitForExistence(timeout: 10),
                      "tapping the real pin opens the photo popup over the map")
        attach(app.screenshot(), name: "imported-photo-popup")
    }

    /// AC1.4: deleting a trip removes it from the list (server DELETE + local cascade +
    /// Keychain cleanup). Creates an owned trip first so the server DELETE path runs.
    func testDeleteTripFlow() {
        let app = launchApp()

        app.buttons["New Trip"].tap()
        let nameField = app.textFields["Trip name"]
        XCTAssertTrue(nameField.waitForExistence(timeout: 5))
        nameField.tap()
        nameField.typeText("Trip To Delete")
        app.buttons["Create"].tap()

        let created = app.staticTexts["Trip To Delete"]
        XCTAssertTrue(created.waitForExistence(timeout: 15), "trip should be created")
        created.tap()

        let deleteButton = app.buttons["Delete Trip"]
        XCTAssertTrue(deleteButton.waitForExistence(timeout: 10), "detail view should have a delete control")
        deleteButton.tap()

        // Confirm in the dialog (wait for it to present before tapping).
        let confirm = app.buttons["Delete"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "confirmation dialog should appear")
        confirm.tap()

        XCTAssertTrue(
            app.staticTexts["Trip To Delete"].waitForNonExistence(timeout: 15),
            "deleted trip should disappear from the list (AC1.4)")
        attach(app.screenshot(), name: "AC1.4-trip-deleted")
    }

    /// AC1.5: an invalid token surfaces an error and adds no trip.
    func testImportInvalidTokenShowsError() {
        let app = launchApp()

        app.buttons["Import via Token"].tap()
        let tokenField = app.textFields["Secret token"]
        XCTAssertTrue(tokenField.waitForExistence(timeout: 5))
        tokenField.tap()
        tokenField.typeText("00000000-0000-0000-0000-000000000000")
        app.buttons["Import"].tap()

        let error = app.staticTexts["No trip found for that token. Double-check it and try again."]
        XCTAssertTrue(error.waitForExistence(timeout: 15),
                      "an unknown token should surface an error and write nothing (AC1.5)")
        attach(app.screenshot(), name: "AC1.5-invalid-token")
    }

    /// AC5.2: tapping a map annotation opens the photo view via the NavigationStack.
    /// Also visually captures the fitted map + controls (AC5.1 / AC5.3).
    /// Extended to verify AC1.2: ✕ button closes the popup.
    /// Extended to verify AC1.3: backdrop-tap closes the popup.
    func testTappingMapPinOpensPhotoDetail() {
        let app = launchApp()

        let trip = app.staticTexts["Pacific Coast Highway"]
        XCTAssertTrue(trip.waitForExistence(timeout: 10), "seed trip should appear in the list")
        trip.tap()

        // The annotation is an accessible button labelled with the photo's place name.
        let pin = app.buttons["Bixby Bridge"]
        XCTAssertTrue(pin.waitForExistence(timeout: 10),
                      "map annotation should render and be accessible (AC5.1 frames it on-screen)")
        attach(app.screenshot(), name: "AC5.1-5.3-trip-map")

        pin.tap()

        // The caption text is unique to the photo view, so its presence proves navigation.
        let caption = app.staticTexts["Classic stop on Highway 1"]
        XCTAssertTrue(caption.waitForExistence(timeout: 5),
                      "tapping a pin should open the photo view (AC5.2)")
        attach(app.screenshot(), name: "AC5.2-photo-detail")

        // AC1.2: verify the ✕ button exists and tapping it closes the popup
        let closeButton = app.buttons["popup-close"]
        XCTAssertTrue(closeButton.waitForExistence(timeout: 5),
                      "popup should have a close button (AC1.2)")
        closeButton.tap()

        // Caption should now be gone, proving the popup closed
        XCTAssertTrue(caption.waitForNonExistence(timeout: 5),
                      "tapping the ✕ button should close the popup (AC1.2)")
        attach(app.screenshot(), name: "AC1.2-popup-closed-via-close-button")

        // AC1.3: verify backdrop-tap also closes the popup
        pin.tap()
        XCTAssertTrue(caption.waitForExistence(timeout: 5),
                      "should be able to reopen the popup")

        // Tap the backdrop (dimmed area around the card) — use a coordinate outside the card
        let mapCoordinate = app.maps.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.1))
        mapCoordinate.tap()

        XCTAssertTrue(caption.waitForNonExistence(timeout: 5),
                      "tapping the backdrop should close the popup (AC1.3)")
        attach(app.screenshot(), name: "AC1.3-popup-closed-via-backdrop")
    }

    /// Long-press on the trip map offers to post a photo at that spot (Apple Maps drop-pin
    /// pattern). Verifies the gesture → sheet wiring without driving the system picker.
    func testLongPressMapOffersPostHere() {
        let app = launchApp()

        let trip = app.staticTexts["Pacific Coast Highway"]
        XCTAssertTrue(trip.waitForExistence(timeout: 10))
        trip.tap()

        let map = app.maps.firstMatch
        XCTAssertTrue(map.waitForExistence(timeout: 10), "trip map should render")
        // Long-press an empty-ish area away from the pins.
        map.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.3)).press(forDuration: 0.8)

        let sheet = app.staticTexts["Add a photo here"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 5),
                      "long-press should offer to post a photo at that spot")
        attach(app.screenshot(), name: "longpress-post-here")
    }

    /// AC5.4: a trip with zero photos shows the "No photos yet" empty state.
    func testEmptyTripShowsEmptyState() {
        let app = launchApp()

        let emptyTrip = app.staticTexts["Weekend Getaway"]
        XCTAssertTrue(emptyTrip.waitForExistence(timeout: 10), "empty seed trip should appear in the list")
        emptyTrip.tap()

        let emptyState = app.staticTexts["No photos yet"]
        XCTAssertTrue(emptyState.waitForExistence(timeout: 5),
                      "a 0-photo trip should show the empty state (AC5.4)")
        attach(app.screenshot(), name: "AC5.4-empty-state")
    }

    /// AC3.5 (Edge): a SampleData trip (no secret token) must NOT show the Share button.
    /// Opens a SampleData trip and asserts the Share toolbar button does not exist.
    func testSampleDataTripHidesShareButton() {
        let app = launchApp()

        let trip = app.staticTexts["Pacific Coast Highway"]
        XCTAssertTrue(trip.waitForExistence(timeout: 10), "seed trip should appear in the list")
        trip.tap()

        // Wait for detail view to load by anchoring on the "Add Photo" button, a detail-only
        // toolbar item. This avoids false-positive waits on the trip title, which exists in
        // both the list row and the detail view's navigation title.
        let addPhotoButton = app.buttons["Add Photo"]
        XCTAssertTrue(addPhotoButton.waitForExistence(timeout: 5), "detail view should load with Add Photo button")

        // AC3.5: the Share button should not exist for a SampleData trip (no secret token)
        let shareButton = app.buttons["Share"]
        XCTAssertFalse(shareButton.exists,
                       "SampleData trip should NOT show a Share button (AC3.5 — no secret token)")
        attach(app.screenshot(), name: "AC3.5-share-button-absent")
    }

    /// AC1.3: the route toggle persists its state (via @AppStorage). Opens the "Pacific Coast
    /// Highway" seed trip and exercises the toggle: tap to hide, verify label flips, tap again
    /// to show, verify label flips back. (Persistence across app launches is optional per the
    /// spec and may be added to the device checklist if full relaunch proves flaky in CI.)
    func testRouteToggleShowsAndHides() {
        let app = launchApp()

        let trip = app.staticTexts["Pacific Coast Highway"]
        XCTAssertTrue(trip.waitForExistence(timeout: 10), "seed trip should appear in the list")
        trip.tap()

        // Anchor on "Add Photo" to confirm detail view has loaded
        let addPhotoButton = app.buttons["Add Photo"]
        XCTAssertTrue(addPhotoButton.waitForExistence(timeout: 5), "detail view should load")

        // Locate the route toggle button by its accessibility identifier
        let routeToggle = app.buttons["route-toggle"]
        XCTAssertTrue(routeToggle.waitForExistence(timeout: 5), "route toggle should exist and be accessible")
        XCTAssertTrue(routeToggle.isHittable, "route toggle should be hittable")

        // Initial label should be "Hide route" (toggle starts as true, showRoute = true)
        var label = routeToggle.label
        XCTAssertEqual(label, "Hide route", "route toggle should initially show 'Hide route'")

        // Tap to hide the route
        routeToggle.tap()

        // After tapping, label should flip to "Show route"
        label = routeToggle.label
        XCTAssertEqual(label, "Show route", "after tap, route toggle should show 'Show route'")

        // Tap again to show the route
        routeToggle.tap()

        // Label should flip back to "Hide route"
        label = routeToggle.label
        XCTAssertEqual(label, "Hide route", "after second tap, route toggle should show 'Hide route'")

        // Attach screenshot for artifact trail
        attach(app.screenshot(), name: "AC1.3-route-toggle")
    }

    private func attach(_ screenshot: XCUIScreenshot, name: String) {
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
