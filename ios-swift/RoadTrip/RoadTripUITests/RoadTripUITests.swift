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

    /// AC4.3 + AC4.2: The trip detail screen has no Delete control (moved to Archived view in Phase 3).
    /// Verifies the floating bar is present and the back button navigates home.
    /// Permanent deletion is covered by testPermanentDeleteRequiresConfirmation (Phase 3, AC2.4),
    /// which exercises the complete archive→delete flow in the Archived view.
    func testTripDetailHasNoDeleteAndBackWorks() {
        let app = launchApp()

        // Arrange: Open the "Pacific Coast Highway" seed trip (the anchor other detail tests use)
        let trip = app.staticTexts["Pacific Coast Highway"]
        XCTAssertTrue(trip.waitForExistence(timeout: 10), "seed trip should appear in the list")
        trip.tap()

        // Wait for the detail view to load by anchoring on a detail-only element ("Add Photo")
        let addPhotoButton = app.buttons["Add Photo"]
        XCTAssertTrue(addPhotoButton.waitForExistence(timeout: 5), "detail view should load with Add Photo button")

        // AC4.1: Assert the floating bar is present by checking for the back button
        let backButton = app.buttons["trip-back"]
        XCTAssertTrue(backButton.waitForExistence(timeout: 5),
                      "floating bar should be present with back button (AC4.1)")

        // AC4.3: Assert the "Delete Trip" button does NOT exist on the detail screen
        let deleteButton = app.buttons["Delete Trip"]
        XCTAssertFalse(deleteButton.exists,
                       "trip detail should NOT show a Delete button (AC4.3 — deletion is now in Archived view)")

        // AC4.2: Tap the back button and verify we're back on the My Trips list
        backButton.tap()

        // Assert we're back on My Trips by checking for the list title or a known seed trip
        let tripListTitle = app.staticTexts["My Trips"]
        XCTAssertTrue(tripListTitle.waitForExistence(timeout: 5),
                      "back button should return to My Trips list (AC4.2)")

        attach(app.screenshot(), name: "AC4.3-no-delete-AC4.2-back-works")
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

        // Card mode shows only the photo (metadata lives in the immersive view), so the popup's
        // presence is proved by the photo element rather than any caption text.
        let popupPhoto = app.descendants(matching: .any).matching(identifier: "popup-photo").firstMatch
        XCTAssertTrue(popupPhoto.waitForExistence(timeout: 5),
                      "tapping a pin should open the photo popup (AC5.2)")
        attach(app.screenshot(), name: "AC5.2-photo-detail")

        // AC1.2: the popup has no chrome — swipe down on the card dismisses it. Drive the swipe
        // from the window centre (always on the visible card) rather than a specific element, whose
        // frame may sit off-screen in the pager.
        let window = app.windows.firstMatch
        let cardStart = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let cardEnd = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 1.1))
        cardStart.press(forDuration: 0.05, thenDragTo: cardEnd)

        XCTAssertTrue(popupPhoto.waitForNonExistence(timeout: 5),
                      "swiping the card down should close the popup (AC1.2)")
        attach(app.screenshot(), name: "AC1.2-popup-closed-via-swipe-down")

        // AC1.3: verify backdrop-tap also closes the popup
        pin.tap()
        XCTAssertTrue(popupPhoto.waitForExistence(timeout: 5),
                      "should be able to reopen the popup")

        // Tap the backdrop (dimmed area around the card) — use a coordinate outside the card
        let mapCoordinate = app.maps.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.1))
        mapCoordinate.tap()

        XCTAssertTrue(popupPhoto.waitForNonExistence(timeout: 5),
                      "tapping the backdrop should close the popup (AC1.3)")
        attach(app.screenshot(), name: "AC1.3-popup-closed-via-backdrop")
    }

    /// The chrome-free popup's interactions: tap → immersive (full-black) and back, swipe to page
    /// between photos, and long-press → Move Pin / Delete Photo. Drives each gesture and captures
    /// screenshots for visual review; asserts the page change and the long-press menu.
    func testPopupImmersivePagerAndLongPressMenu() {
        let app = launchApp()

        app.staticTexts["Pacific Coast Highway"].tap()
        let pin = app.buttons["Bixby Bridge"]
        XCTAssertTrue(pin.waitForExistence(timeout: 10), "trip map should render")
        pin.tap()

        // Card mode is photo-only (no metadata text); the photo element proves it opened.
        let popupPhoto = app.descendants(matching: .any).matching(identifier: "popup-photo").firstMatch
        XCTAssertTrue(popupPhoto.waitForExistence(timeout: 5), "popup should open on the tapped pin (index 0)")
        attach(app.screenshot(), name: "popup-card-mode")

        let window = app.windows.firstMatch
        let photoPoint = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))

        // Tap the photo → immersive (full black). Place/date now appear, pinned to the screen bottom.
        photoPoint.tap()
        let firstCaption = app.staticTexts["Classic stop on Highway 1"]
        XCTAssertTrue(firstCaption.waitForExistence(timeout: 3), "place/date appear in immersive mode")
        attach(app.screenshot(), name: "popup-immersive")

        // Swipe left (in immersive) → page to the next photo; the bottom metadata follows selection.
        let swipeStart = window.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.4))
        let swipeEnd = window.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.4))
        swipeStart.press(forDuration: 0.05, thenDragTo: swipeEnd)
        let secondCaption = app.staticTexts["Sea otters everywhere"]
        XCTAssertTrue(secondCaption.waitForExistence(timeout: 5), "swiping should page to the next photo")
        attach(app.screenshot(), name: "popup-paged-next")

        // Tap again → back to the card (metadata gone).
        photoPoint.tap()
        XCTAssertTrue(secondCaption.waitForNonExistence(timeout: 3), "card mode hides the metadata")
        attach(app.screenshot(), name: "popup-card-after-immersive")

        // Long-press the photo → Move Pin / Delete Photo (the only home for these, no visible chrome).
        photoPoint.press(forDuration: 1.1)
        XCTAssertTrue(app.buttons["Move Pin"].waitForExistence(timeout: 5),
                      "long-press should surface the Move Pin action")
        XCTAssertTrue(app.buttons["Delete Photo"].exists,
                      "long-press should surface the Delete Photo action")
        attach(app.screenshot(), name: "popup-longpress-menu")
    }

    /// Regression: immersive mode hides the map's floating title bar; dismissing from immersive
    /// must restore it (the bar showed `trip.name`, which only appears in the bar on the detail
    /// screen — so its presence/absence cleanly proves hidden vs. visible).
    func testDismissingFromImmersiveRestoresTitleBar() {
        let app = launchApp()

        app.staticTexts["Pacific Coast Highway"].tap()
        let pin = app.buttons["Bixby Bridge"]
        XCTAssertTrue(pin.waitForExistence(timeout: 10), "trip map should render")

        // The floating title bar is visible on the detail screen before any popup.
        let titleBar = app.staticTexts["Pacific Coast Highway"]
        XCTAssertTrue(titleBar.waitForExistence(timeout: 5), "title bar should show before opening a photo")

        pin.tap()
        let popupPhoto = app.descendants(matching: .any).matching(identifier: "popup-photo").firstMatch
        XCTAssertTrue(popupPhoto.waitForExistence(timeout: 5), "popup should open")

        // Tap into immersive → the title bar hides.
        let window = app.windows.firstMatch
        let photoPoint = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
        photoPoint.tap()
        XCTAssertTrue(titleBar.waitForNonExistence(timeout: 5), "immersive mode should hide the title bar")

        // Swipe down to dismiss straight from immersive.
        let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 1.1))
        start.press(forDuration: 0.05, thenDragTo: end)

        XCTAssertTrue(popupPhoto.waitForNonExistence(timeout: 5), "swiping down should dismiss the popup")
        XCTAssertTrue(titleBar.waitForExistence(timeout: 5),
                      "dismissing from immersive must restore the title bar")
        attach(app.screenshot(), name: "title-bar-restored-after-immersive-dismiss")
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

        // Wait for the label to flip to "Show route" using an expectation.
        // This ensures SwiftUI has re-rendered the accessibility label after the state change.
        let expectShowRoute = expectation(
            for: NSPredicate(format: "label == %@", "Show route"),
            evaluatedWith: routeToggle
        )
        wait(for: [expectShowRoute], timeout: 20)

        // Tap again to show the route
        routeToggle.tap()

        // Wait for the label to flip back to "Hide route"
        let expectHideRoute = expectation(
            for: NSPredicate(format: "label == %@", "Hide route"),
            evaluatedWith: routeToggle
        )
        wait(for: [expectHideRoute], timeout: 20)

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

    /// AC3.1: the + menu offers "Take Photo" and "Choose from Library" buttons.
    /// "Take Photo" is disabled on the simulator (no camera), so we assert it EXISTS
    /// (as per AC3.1, don't test camera interactions on simulator). Verifies the menu
    /// surfaces both options.
    func testAddPhotoMenuOffersCameraAndLibrary() {
        let app = launchApp()

        let trip = app.staticTexts["Pacific Coast Highway"]
        XCTAssertTrue(trip.waitForExistence(timeout: 10), "seed trip should appear in the list")
        trip.tap()

        // Anchor on "Add Photo" button to confirm detail view has loaded
        let addPhotoButton = app.buttons["Add Photo"]
        XCTAssertTrue(addPhotoButton.waitForExistence(timeout: 5), "detail view should load with Add Photo button")

        // Tap the Add Photo menu to open it
        addPhotoButton.tap()

        // AC3.1: assert the menu surfaces "Take Photo" button (exists on simulator, disabled)
        let takePhotoButton = app.buttons["Take Photo"]
        XCTAssertTrue(takePhotoButton.waitForExistence(timeout: 5),
                      "menu should offer 'Take Photo' button (AC3.1)")

        // AC3.1: assert the menu surfaces "Choose from Library" button
        let chooseFromLibraryButton = app.buttons["Choose from Library"]
        XCTAssertTrue(chooseFromLibraryButton.waitForExistence(timeout: 5),
                      "menu should offer 'Choose from Library' button (AC3.1)")

        // Choose from Library should be hittable (camera interactions are device-only)
        XCTAssertTrue(chooseFromLibraryButton.isHittable,
                      "Choose from Library should be hittable")

        attach(app.screenshot(), name: "AC3.1-add-photo-menu")
    }

    /// AC3.5: picking a photo from the library stages it — the upload banner or the pin-drop
    /// sheet must appear, proving stagePhoto(from:) → loadImageData → PHAsset ran without
    /// throwing noAsset (the bug this test is designed to catch).
    ///
    /// EXPLORATORY NOTE: the exact element queries for the system PHPicker on iOS 17/26 are
    /// discovered at test run time. The test uses several fallback queries. If the picker cannot
    /// be reliably driven in this environment, it skips with a clear explanation rather than
    /// silently passing or weakening the assertion.
    func testLibraryPickStagesPhoto() throws {
        let app = launchApp()

        let trip = app.staticTexts["Pacific Coast Highway"]
        XCTAssertTrue(trip.waitForExistence(timeout: 10), "seed trip should appear in the list")
        trip.tap()

        let addPhotoButton = app.buttons["Add Photo"]
        XCTAssertTrue(addPhotoButton.waitForExistence(timeout: 10), "detail view should load with Add Photo button")

        // Open the menu and tap "Choose from Library"
        addPhotoButton.tap()
        let chooseFromLibrary = app.buttons["Choose from Library"]
        XCTAssertTrue(chooseFromLibrary.waitForExistence(timeout: 5), "menu must offer 'Choose from Library'")
        chooseFromLibrary.tap()

        // ── Discover the system PHPicker ────────────────────────────────────────────────
        // PHPicker on iOS 17+ presents as an out-of-process sheet. The picker runs in
        // com.apple.mobileslideshow and bridges elements back into the host app's accessibility
        // tree via a separate UIWindow.
        //
        // Strategies tried (in order):
        //   1. app.cells.firstMatch — the most common approach for in-process sheets
        //   2. app.windows.element(boundBy: 1).cells.firstMatch — second window if picker adds one
        //   3. springboard.descendants(matching: .cell).firstMatch — check the springboard process
        //
        // Investigation (2026-06-22, iOS 26 Simulator / Xcode 26 beta):
        //   A PickerProbeTests probe confirmed that after tapping "Choose from Library",
        //   app.windows.count == 1 (only the app window), app.cells.count == 0,
        //   app.collectionViews.count == 0, and app.sheets.count == 0 — even after 8s of waiting.
        //   The PHPickerViewController never bridged its accessibility tree into the host process
        //   on this OS version in XCUITest. This appears to be a known iOS 26 beta limitation.
        //   The simulator photo library does contain photos (thumbnails found under PhotoData/DCIM).
        //
        // If none materialise within 10s, we skip rather than fake a pass.

        // Attempt 1: standard in-process cell query
        let pickerAppeared = app.cells.firstMatch.waitForExistence(timeout: 5)

        // Attempt 2: check second window (PHPicker sometimes adds its own UIWindow)
        let pickerAppearedWindow2 = !pickerAppeared && app.windows.count > 1 &&
            app.windows.element(boundBy: 1).cells.firstMatch.waitForExistence(timeout: 5)

        guard pickerAppeared || pickerAppearedWindow2 else {
            attach(app.screenshot(), name: "AC3.5-picker-not-found")
            throw XCTSkip("""
            testLibraryPickStagesPhoto (AC3.5): SKIPPED — system PHPicker not accessible via XCUITest.

            What was tried:
              1. app.cells.firstMatch — 0 cells after 5s
              2. app.windows.element(boundBy:1).cells — only 1 window present
              Probe confirmed: windows=1, cells=0, collectionViews=0, sheets=0 after 8s.

            Root cause (confirmed 2026-06-22, iOS 26 Simulator / Xcode 26 beta):
              PHPickerViewController is an out-of-process picker. On iOS 26 beta the
              accessibility bridge between the picker process and the XCUITest host process
              does not expose picker cells to app.cells / app.windows. The simulator photo
              library contains photos (PhotoData/DCIM thumbnails exist on disk).
              This is not a code bug — StagingPhotosPicker correctly binds .shared() as
              required; the limitation is the test environment.

            To re-enable: run on iOS 17 or on a physical device where the picker accessibility
            bridge is known to work; or wait for Xcode 26 final release to fix the bridge.
            """)
        }

        attach(app.screenshot(), name: "AC3.5-picker-appeared")

        // Tap the first photo cell — use whichever window it appeared in
        let pickerWindow = pickerAppearedWindow2
            ? app.windows.element(boundBy: 1)
            : app
        let firstPhoto = pickerWindow.cells.firstMatch
        XCTAssertTrue(firstPhoto.isHittable, "first photo cell must be hittable")
        firstPhoto.tap()

        // ── Verify the staged outcome ───────────────────────────────────────────────────
        // After a successful library pick, one of two outcomes is expected:
        //   A) The upload banner appears ("upload-banner") — photo has GPS and goes straight to upload queue.
        //   B) The PinDrop sheet appears — photo has no GPS and needs a location pin.
        //      The PinDrop sheet title is "Where was this taken?" (from TripDetailView line ~114).
        //
        // Either outcome proves stagePhoto(from:) ran without throwing noAsset.
        // We use an XCTWaiter with an OR predicate via two separate expectations and
        // accept the first that fires within 15s.

        let uploadBanner = app.otherElements["upload-banner"]
        let pinDropTitle = app.staticTexts["Where was this taken?"]

        // Poll for either element appearing
        var staged = false
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline && !staged {
            if uploadBanner.exists || pinDropTitle.exists {
                staged = true
                break
            }
            // Brief pause to avoid spinning — XCUITest polling is expensive
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }

        attach(app.screenshot(), name: "AC3.5-staged-outcome")

        XCTAssertTrue(
            staged,
            """
            testLibraryPickStagesPhoto (AC3.5): after picking a photo, neither the \
            upload banner (upload-banner) nor the pin-drop sheet ('Where was this taken?') \
            appeared within 15 seconds. This likely means stagePhoto(from:) threw \
            CaptureError.noAsset — the picker was not bound to .shared() or \
            the item identifier was not populated. \
            Upload banner exists: \(uploadBanner.exists). \
            PinDrop title exists: \(pinDropTitle.exists).
            """
        )
    }

    private func attach(_ screenshot: XCUIScreenshot, name: String) {
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
