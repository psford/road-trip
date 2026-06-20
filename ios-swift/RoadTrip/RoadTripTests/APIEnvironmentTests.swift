import XCTest
@testable import RoadTrip

/// Base-URL selection: an explicit override (env var, for tests/ad-hoc) wins; otherwise the
/// compile-time default for the active build configuration. Tests run under DEBUG → localhost.
final class APIEnvironmentTests: XCTestCase {

    func testOverrideURLWins() {
        XCTAssertEqual(APIEnvironment.resolve(override: "https://example.com"),
                       URL(string: "https://example.com"))
    }

    func testNilOverrideUsesDefault() {
        XCTAssertEqual(APIEnvironment.resolve(override: nil), APIEnvironment.defaultBaseURL)
    }

    func testEmptyOrInvalidOverrideFallsBackToDefault() {
        XCTAssertEqual(APIEnvironment.resolve(override: ""), APIEnvironment.defaultBaseURL)
    }

    func testDebugBuildTargetsLocalBackend() {
        XCTAssertEqual(APIEnvironment.defaultBaseURL, URL(string: "http://localhost:5100"))
    }
}
