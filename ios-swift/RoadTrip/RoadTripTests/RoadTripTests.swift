import XCTest
@testable import RoadTrip

/// Scaffold unit-test target. Real coverage begins in Phase 2 (Storage:
/// GRDB migration, Keychain round-trip, file-cache LRU). This single test
/// exists so the test target compiles and runs in the Phase 1 build.
final class RoadTripTests: XCTestCase {
    func testAppTypeExists() {
        // Proves the app module links into the test target.
        _ = RoadTripApp.self
    }
}
