import XCTest
@testable import RoadTrip

/// Pure unit tests for view-token extraction from server viewUrl paths.
/// Verifies native-ios-sharing-polish.AC2.2 and AC2.4 at the parser level.
final class ViewTokenParsingTests: XCTestCase {

    // AC2.2: Happy path — valid viewUrl with UUID
    func testExtractsViewTokenFromValidViewUrl() {
        let uuid = UUID()
        let viewUrl = "/trips/\(uuid.uuidString)"
        let result = RoadTripAPI.viewToken(fromViewUrl: viewUrl)
        XCTAssertEqual(result, uuid, "should extract UUID from /trips/{uuid}")
    }

    // AC2.2: UUID parsing is case-insensitive
    func testHandlesLowercaseUUID() {
        let uuid = UUID()
        let lowercaseUrl = "/trips/\(uuid.uuidString.lowercased())"
        let result = RoadTripAPI.viewToken(fromViewUrl: lowercaseUrl)
        XCTAssertEqual(result, uuid, "should accept lowercase UUID strings")
    }

    // AC2.2: Absolute URLs should still extract the UUID
    func testExtractsFromAbsoluteUrl() {
        let uuid = UUID()
        let absoluteUrl = "https://example.com/trips/\(uuid.uuidString)"
        let result = RoadTripAPI.viewToken(fromViewUrl: absoluteUrl)
        XCTAssertEqual(result, uuid, "should extract UUID from absolute URLs")
    }

    // AC2.4: Nil viewUrl returns nil
    func testNilViewUrlReturnsNil() {
        let result = RoadTripAPI.viewToken(fromViewUrl: nil)
        XCTAssertNil(result, "should return nil for nil input")
    }

    // AC2.4: Empty string returns nil
    func testEmptyViewUrlReturnsNil() {
        let result = RoadTripAPI.viewToken(fromViewUrl: "")
        XCTAssertNil(result, "should return nil for empty string")
    }

    // AC2.4: Missing path component returns nil
    func testMissingPathComponentReturnsNil() {
        let result = RoadTripAPI.viewToken(fromViewUrl: "/trips/")
        XCTAssertNil(result, "should return nil for /trips/ with no UUID")
    }

    // AC2.4: Invalid UUID string returns nil
    func testInvalidUUIDReturnsNil() {
        let result = RoadTripAPI.viewToken(fromViewUrl: "/trips/not-a-uuid")
        XCTAssertNil(result, "should return nil for non-UUID path component")
    }

    // AC2.4: Garbage input returns nil
    func testGarbageInputReturnsNil() {
        let result = RoadTripAPI.viewToken(fromViewUrl: "garbage")
        XCTAssertNil(result, "should return nil for malformed input")
    }
}
