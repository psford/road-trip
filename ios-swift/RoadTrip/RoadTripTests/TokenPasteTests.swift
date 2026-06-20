import XCTest
@testable import RoadTrip

/// Pure unit tests for extracting UUIDs from messy pasted text.
/// Verifies native-ios-sharing-polish.AC4.2, AC4.3, and AC4.1 (regression).
final class TokenPasteTests: XCTestCase {

    // AC4.1: Regression — bare UUID string still parses (the happy path)
    func testBareUUIDStringParses() {
        let uuid = UUID()
        let result = RoadTripAPI.firstUUID(in: uuid.uuidString)
        XCTAssertEqual(result, uuid, "bare UUID string should parse")
    }

    // AC4.1: Bare UUID with surrounding whitespace
    func testBareUUIDWithWhitespace() {
        let uuid = UUID()
        let padded = "  \(uuid.uuidString)  \n"
        let result = RoadTripAPI.firstUUID(in: padded)
        XCTAssertEqual(result, uuid, "UUID with whitespace should extract")
    }

    // AC4.2: UUID inside a sentence/message
    func testExtractsUUIDFromSentence() {
        let uuid = UUID()
        let message = "Join my Road Trip \"My Vacation\" — open the app → Import via Token → paste: \(uuid.uuidString)"
        let result = RoadTripAPI.firstUUID(in: message)
        XCTAssertEqual(result, uuid, "should extract UUID from invite message")
    }

    // AC4.2: UUID inside a URL path
    func testExtractsUUIDFromURLPath() {
        let uuid = UUID()
        let url = "https://example.com/trips/\(uuid.uuidString)"
        let result = RoadTripAPI.firstUUID(in: url)
        XCTAssertEqual(result, uuid, "should extract UUID from URL path")
    }

    // AC4.2: UUID in a /post/ path
    func testExtractsUUIDFromPostPath() {
        let uuid = UUID()
        let text = "Check this out: /post/\(uuid.uuidString) on the website"
        let result = RoadTripAPI.firstUUID(in: text)
        XCTAssertEqual(result, uuid, "should extract UUID from /post/ path")
    }

    // AC4.2: Multiple UUIDs — returns first one
    func testExtractsFirstUUIDWhenMultiple() {
        let uuid1 = UUID()
        let uuid2 = UUID()
        let text = "First: \(uuid1.uuidString) and second: \(uuid2.uuidString)"
        let result = RoadTripAPI.firstUUID(in: text)
        XCTAssertEqual(result, uuid1, "should extract the first UUID when multiple present")
    }

    // AC4.2: UUID with query parameters
    func testExtractsUUIDFromURLWithQuery() {
        let uuid = UUID()
        let url = "https://example.com/trips/\(uuid.uuidString)?foo=bar&x=1"
        let result = RoadTripAPI.firstUUID(in: url)
        XCTAssertEqual(result, uuid, "should extract UUID from URL with query string")
    }

    // AC4.3: No UUID in text returns nil
    func testNoUUIDReturnsNil() {
        let text = "This text has no UUID at all"
        let result = RoadTripAPI.firstUUID(in: text)
        XCTAssertNil(result, "should return nil when no UUID is present")
    }

    // AC4.3: Empty string returns nil
    func testEmptyStringReturnsNil() {
        let result = RoadTripAPI.firstUUID(in: "")
        XCTAssertNil(result, "should return nil for empty string")
    }

    // AC4.3: UUID-like but invalid format returns nil
    func testInvalidUUIDFormatReturnsNil() {
        // Create an invalid UUID-looking string with non-hex characters
        let invalid = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        let result = RoadTripAPI.firstUUID(in: invalid)
        XCTAssertNil(result, "should return nil for invalid UUID hex characters")
    }

    // AC4.3: Case-insensitive UUID extraction
    func testExtractsLowercaseUUID() {
        // Use a hardcoded mixed-case UUID to genuinely exercise case handling.
        // UUID(uuidString:) is case-insensitive, so this ensures the regex and parser work correctly.
        let mixedCaseString = "550e8400-E29b-41d4-a716-446655440000"
        let expected = UUID(uuidString: "550E8400-E29B-41D4-A716-446655440000")!
        let result = RoadTripAPI.firstUUID(in: mixedCaseString)
        XCTAssertEqual(result, expected, "should extract UUID regardless of hex case")
    }

    // AC4.2: UUID surrounded by newlines
    func testExtractsUUIDWithNewlines() {
        let uuid = UUID()
        let text = "Here's your token:\n\n\(uuid.uuidString)\n\nPaste it in the app."
        let result = RoadTripAPI.firstUUID(in: text)
        XCTAssertEqual(result, uuid, "should extract UUID with newlines around it")
    }
}
