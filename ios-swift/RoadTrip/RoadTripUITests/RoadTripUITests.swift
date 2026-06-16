import XCTest

/// Scaffold UI-test target. The launch smoke test doubles as the Phase 1
/// "app runs on simulator" acceptance check when run via the Xcode MCP bridge.
final class RoadTripUITests: XCTestCase {
    func testAppLaunches() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(
            app.wait(for: .runningForeground, timeout: 10),
            "App did not reach the foreground on launch"
        )
    }
}
