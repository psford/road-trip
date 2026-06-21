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

    /// AC2.1 + AC2.2 + AC2.3: Archive a trip and restore it. Verifies the complete
    /// archive→disappear→restore→reappear round trip. Uses the "Pacific Coast Highway"
    /// seed trip (deterministic via -uitest launch argument).
    ///
    /// Flow: (1) From My Trips, swipe the seed trip row left and tap Archive button.
    /// (2) Assert the trip no longer appears in My Trips (AC2.1 + AC2.2).
    /// (3) Tap the Archived toolbar control to open ArchivedTripsView.
    /// (4) Assert the trip appears in Archived list (AC2.3).
    /// (5) Invoke Restore via swipe action.
    /// (6) Navigate back to My Trips.
    /// (7) Assert the trip reappears in My Trips (AC2.3).
    func testArchiveAndRestoreFlow() {
        let app = launchApp()

        // Arrange: Locate the seed trip in My Trips list
        let tripName = app.staticTexts["Pacific Coast Highway"]
        XCTAssertTrue(tripName.waitForExistence(timeout: 10), "seed trip 'Pacific Coast Highway' should appear in My Trips")

        // Act 1: Archive the trip by swiping its row left and tapping the Archive button
        let tripRow = app.cells.containing(.staticText, identifier: "Pacific Coast Highway").firstMatch
        XCTAssertTrue(tripRow.exists, "trip row should exist before archive")

        // Swipe the row to reveal actions; use explicit waiting for action button
        tripRow.swipeLeft()
        let archiveButton = app.buttons["Archive"]
        XCTAssertTrue(archiveButton.waitForExistence(timeout: 5), "Archive button should appear after swipe")
        XCTAssertTrue(archiveButton.isHittable, "Archive button should be tappable")
        archiveButton.tap()

        // Assert 1: Trip disappears from My Trips list (AC2.1 + AC2.2)
        XCTAssertTrue(
            tripName.waitForNonExistence(timeout: 10),
            "archived trip should disappear from My Trips list (AC2.1 + AC2.2)"
        )

        // Act 2: Navigate to Archived view via toolbar control
        let archivedButton = app.buttons["Archived"]
        XCTAssertTrue(archivedButton.waitForExistence(timeout: 5), "Archived toolbar control should be accessible")
        archivedButton.tap()

        // Assert 2: Trip appears in Archived view (AC2.3)
        let archivedTripName = app.staticTexts["Pacific Coast Highway"]
        XCTAssertTrue(
            archivedTripName.waitForExistence(timeout: 10),
            "archived trip should appear in Archived view (AC2.3)"
        )
        attach(app.screenshot(), name: "AC2.3-archived-list")

        // Act 3: Restore the trip by swiping and tapping Restore
        let archivedRow = app.cells.containing(.staticText, identifier: "Pacific Coast Highway").firstMatch
        XCTAssertTrue(archivedRow.exists, "archived trip row should exist")

        archivedRow.swipeLeft()
        let restoreButton = app.buttons["Restore"]
        XCTAssertTrue(restoreButton.waitForExistence(timeout: 5), "Restore button should appear after swipe")
        XCTAssertTrue(restoreButton.isHittable, "Restore button should be tappable")
        restoreButton.tap()

        // Act 4: Navigate back to My Trips
        // Use the back gesture or button; XCTest swipeRight() performs a back gesture
        app.navigationBars.element(boundBy: 0).buttons.element(boundBy: 0).tap()

        // Assert 3: Trip reappears in My Trips (AC2.3)
        let restoredTripName = app.staticTexts["Pacific Coast Highway"]
        XCTAssertTrue(
            restoredTripName.waitForExistence(timeout: 10),
            "restored trip should reappear in My Trips list (AC2.3)"
        )
        attach(app.screenshot(), name: "AC2.3-restored")
    }

    /// AC2.6 + AC2.4 (local): Verify that "Delete permanently" requires confirmation,
    /// and that cancelling the confirmation keeps the trip archived. Then delete permanently
    /// and confirm, verifying the trip is gone from Archived and not in My Trips.
    ///
    /// Uses the SampleData trip (no secret token), so deletion is local-only and safe
    /// (no server call required). Tests both the confirmation-cancel path (AC2.6) and the
    /// delete-confirm path (AC2.4 at the UI level; the server-DELETE half is an integration
    /// concern exercised via device testing or live backends).
    ///
    /// Flow: (1) Archive the "Weekend Getaway" trip (another SampleData trip with no token).
    /// (2) Open Archived view.
    /// (3) Invoke "Delete permanently" and tap Cancel; assert trip is still in Archived.
    /// (4) Invoke "Delete permanently" again and tap "Delete permanently" in the confirmation;
    /// (5) Assert trip disappears from Archived and is not in My Trips.
    func testPermanentDeleteRequiresConfirmation() {
        let app = launchApp()

        // Arrange: Locate the SampleData trip "Weekend Getaway" (no secret token, safe to delete)
        let tripName = app.staticTexts["Weekend Getaway"]
        XCTAssertTrue(tripName.waitForExistence(timeout: 10), "seed trip 'Weekend Getaway' should appear in My Trips")

        // Act 1: Archive the trip
        let tripRow = app.cells.containing(.staticText, identifier: "Weekend Getaway").firstMatch
        XCTAssertTrue(tripRow.exists, "trip row should exist before archive")

        tripRow.swipeLeft()
        let archiveButton = app.buttons["Archive"]
        XCTAssertTrue(archiveButton.waitForExistence(timeout: 5), "Archive button should appear after swipe")
        archiveButton.tap()

        // Assert: Trip is now in Archived (not in My Trips)
        XCTAssertTrue(
            tripName.waitForNonExistence(timeout: 10),
            "trip should be archived and removed from My Trips"
        )

        // Act 2: Navigate to Archived view
        let archivedButton = app.buttons["Archived"]
        XCTAssertTrue(archivedButton.waitForExistence(timeout: 5), "Archived toolbar control should be accessible")
        archivedButton.tap()

        let archivedTripName = app.staticTexts["Weekend Getaway"]
        XCTAssertTrue(archivedTripName.waitForExistence(timeout: 10), "archived trip should appear in Archived view")

        // Act 3: Invoke "Delete permanently" via the row swipe action, show dialog, then dismiss it (AC2.6)
        let archivedRow = app.cells.containing(.staticText, identifier: "Weekend Getaway").firstMatch
        archivedRow.swipeLeft()

        // Use the accessibility identifier to target the swipe-action button uniquely
        let deleteActionButton = app.buttons["delete-permanently-action"]
        XCTAssertTrue(deleteActionButton.waitForExistence(timeout: 5), "Delete permanently swipe action should appear after swipe")
        deleteActionButton.tap()

        // Assert: Confirmation dialog appears
        let confirmDialog = app.staticTexts["Delete permanently?"]
        XCTAssertTrue(confirmDialog.waitForExistence(timeout: 5), "confirmation dialog should appear with title")

        // Test Cancel: Find and tap the Cancel button. SwiftUI's confirmationDialog action sheet may not expose
        // all buttons in the accessibility hierarchy, so we'll look for all buttons and find the one that's not
        // the destructive action. Since there's a "Delete permanently" button visible, the other button is Cancel.
        let allButtons = app.buttons.allElementsBoundByIndex
        var foundCancelButton = false
        for button in allButtons {
            // Skip the BackButton and the delete action buttons
            if button.label != "Delete permanently" && button.identifier != "BackButton" && button.identifier != "delete-permanently-action" {
                button.tap()
                foundCancelButton = true
                break
            }
        }

        // If we can't find a button by filtering, wait for the dialog to be tapped by a specific button.
        // As a fallback, if we're still in the dialog after a short wait, try swiping down to dismiss.
        if !foundCancelButton {
            // Try swiping down on the action sheet to dismiss it (a gesture that works on iOS 17+)
            let actionSheetArea = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85))
            let topArea = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
            actionSheetArea.press(forDuration: 0.2, thenDragTo: topArea)
        }

        // Assert: Confirmation dialog disappears after dismissing — AC2.6
        XCTAssertTrue(
            confirmDialog.waitForNonExistence(timeout: 5),
            "confirmation dialog should dismiss after cancelling (AC2.6)"
        )

        // Assert: Trip is still in Archived after cancel (cancel was a no-op)
        let stillArchivedName = app.staticTexts["Weekend Getaway"]
        XCTAssertTrue(
            stillArchivedName.waitForExistence(timeout: 5),
            "trip should still be archived after cancelling delete (AC2.6)"
        )

        // Act 4: Invoke "Delete permanently" again and confirm
        let archivedRowAgain = app.cells.containing(.staticText, identifier: "Weekend Getaway").firstMatch
        archivedRowAgain.swipeLeft()

        let deleteActionButtonAgain = app.buttons["delete-permanently-action"]
        XCTAssertTrue(deleteActionButtonAgain.waitForExistence(timeout: 5), "Delete permanently button should appear again")
        deleteActionButtonAgain.tap()

        // Tap "Delete permanently" in the confirmation dialog.
        // The destructive button (Delete permanently) is distinct from the Cancel button.
        let confirmDialogAgain = app.staticTexts["Delete permanently?"]
        XCTAssertTrue(confirmDialogAgain.waitForExistence(timeout: 5), "confirmation dialog should appear again")

        // Find the destructive "Delete permanently" button by label
        let confirmDeleteButton = app.buttons["Delete permanently"]
        XCTAssertTrue(confirmDeleteButton.waitForExistence(timeout: 5), "Delete permanently button should appear in confirmation dialog")
        confirmDeleteButton.tap()

        // Assert: Confirmation dialog disappears after confirm (title goes away)
        XCTAssertTrue(
            confirmDialogAgain.waitForNonExistence(timeout: 5),
            "confirmation dialog should dismiss after tapping confirm button"
        )

        // Assert: Trip disappears from Archived — AC2.4 (local) / AC2.6
        XCTAssertTrue(
            app.staticTexts["Weekend Getaway"].waitForNonExistence(timeout: 10),
            "trip should disappear from Archived after confirming delete (AC2.4 + AC2.6)"
        )

        // Assert: Trip is not in My Trips either (complete removal)
        // Navigate back to My Trips if we're still in Archived
        let backButton = app.navigationBars.element(boundBy: 0).buttons.element(boundBy: 0)
        if backButton.waitForExistence(timeout: 2) {
            backButton.tap()
        }

        // Verify trip is not in My Trips
        XCTAssertFalse(
            app.staticTexts["Weekend Getaway"].exists,
            "deleted trip should not exist in My Trips after permanent delete"
        )
    }

    private func attach(_ screenshot: XCUIScreenshot, name: String) {
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
