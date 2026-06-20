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

    // AC2.4 (Minor 2 fix): Path with query string should still extract UUID
    func testExtractsUUIDFromPathWithQueryString() {
        let uuid = UUID()
        let urlWithQuery = "/trips/\(uuid.uuidString)?foo=bar&x=1"
        let result = RoadTripAPI.viewToken(fromViewUrl: urlWithQuery)
        XCTAssertEqual(result, uuid, "should extract UUID from path even with query string")
    }

    // AC2.4 (Minor 2 fix): Path with fragment should still extract UUID
    func testExtractsUUIDFromPathWithFragment() {
        let uuid = UUID()
        let urlWithFragment = "/trips/\(uuid.uuidString)#section"
        let result = RoadTripAPI.viewToken(fromViewUrl: urlWithFragment)
        XCTAssertEqual(result, uuid, "should extract UUID from path even with fragment")
    }

    // AC2.4 (Minor 2 fix): Absolute URL with query string should extract UUID
    func testExtractsUUIDFromAbsoluteUrlWithQuery() {
        let uuid = UUID()
        let absoluteUrlWithQuery = "https://example.com/trips/\(uuid.uuidString)?foo=bar"
        let result = RoadTripAPI.viewToken(fromViewUrl: absoluteUrlWithQuery)
        XCTAssertEqual(result, uuid, "should extract UUID from absolute URL with query string")
    }

    // AC2.4 (Minor 1 fix): storeViewToken seam no-ops on nil viewUrl
    func testStoreViewTokenNilViewUrlNeverWritesToken() {
        let api = RoadTripAPI.shared
        let keychain = KeychainStore(service: "com.psford.roadtripmap.native.tests.store-nil.\(UUID().uuidString)")
        let tripId = UUID()

        // Call the seam with nil — should not throw, should not write anything.
        api.storeViewToken(from: nil, tripId: tripId, keychain: keychain)

        // Assert no token was written.
        let result = try? keychain.token(kind: .view, tripId: tripId)
        XCTAssertNil(result, "storeViewToken(from: nil, ...) must not write a view token (AC2.4)")
    }

    // AC2.4 (Minor 1 fix): storeViewToken seam no-ops on garbage viewUrl
    func testStoreViewTokenGarbageViewUrlNeverWritesToken() {
        let api = RoadTripAPI.shared
        let keychain = KeychainStore(service: "com.psford.roadtripmap.native.tests.store-garbage.\(UUID().uuidString)")
        let tripId = UUID()

        // Call the seam with garbage — should not throw, should not write anything.
        api.storeViewToken(from: "not-a-url", tripId: tripId, keychain: keychain)

        // Assert no token was written.
        let result = try? keychain.token(kind: .view, tripId: tripId)
        XCTAssertNil(result, "storeViewToken(from: garbage, ...) must not write a view token (AC2.4)")
    }

    // AC2.4 (Minor 1 fix): storeViewToken seam writes token on valid viewUrl
    func testStoreViewTokenValidViewUrlWritesToken() {
        let api = RoadTripAPI.shared
        let keychain = KeychainStore(service: "com.psford.roadtripmap.native.tests.store-valid.\(UUID().uuidString)")
        let tripId = UUID()
        let uuid = UUID()
        let viewUrl = "/trips/\(uuid.uuidString)"

        // Call the seam with a valid URL — should write the token.
        api.storeViewToken(from: viewUrl, tripId: tripId, keychain: keychain)

        // Assert the token was written and matches.
        let result = try? keychain.token(kind: .view, tripId: tripId)
        XCTAssertEqual(result, uuid, "storeViewToken(from: valid, ...) must write the extracted UUID")
    }
}
