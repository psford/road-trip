import XCTest
@testable import RoadTrip

/// Pure unit tests for building the shareable trip view URL.
/// Verifies native-ios-sharing-polish.AC3.2 at the builder level.
final class TripShareLinkTests: XCTestCase {

    // AC3.2: Happy path — known base URL + view token produces correct URL
    func testBuildsCorrectViewURLWithDevHost() {
        let viewToken = UUID()
        let baseURL = URL(string: "https://app-roadtripmap-prod-dev.azurewebsites.net")!

        let result = TripShareLinks.shareViewURL(viewToken: viewToken, baseURL: baseURL)

        let expected = URL(string: "https://app-roadtripmap-prod-dev.azurewebsites.net/trips/\(viewToken.uuidString)")!
        XCTAssertEqual(result, expected, "should build correct view URL with dev host")
    }

    // AC3.2: Localhost base URL
    func testBuildsCorrectViewURLWithLocalhost() {
        let viewToken = UUID()
        let baseURL = URL(string: "http://localhost:5100")!

        let result = TripShareLinks.shareViewURL(viewToken: viewToken, baseURL: baseURL)

        let expected = URL(string: "http://localhost:5100/trips/\(viewToken.uuidString)")!
        XCTAssertEqual(result, expected, "should build correct view URL with localhost")
    }

    // AC3.2: Prod base URL
    func testBuildsCorrectViewURLWithProdHost() {
        let viewToken = UUID()
        let baseURL = URL(string: "https://app-roadtripmap-prod.azurewebsites.net")!

        let result = TripShareLinks.shareViewURL(viewToken: viewToken, baseURL: baseURL)

        let expected = URL(string: "https://app-roadtripmap-prod.azurewebsites.net/trips/\(viewToken.uuidString)")!
        XCTAssertEqual(result, expected, "should build correct view URL with prod host")
    }

    // AC3.2: UUID case is preserved as-is (web view lookup is case-insensitive per server)
    func testPreservesUUIDCase() {
        let viewToken = UUID()
        let baseURL = URL(string: "http://localhost:5100")!

        let result = TripShareLinks.shareViewURL(viewToken: viewToken, baseURL: baseURL)

        // UUID.uuidString produces a standard UUID format; the built URL should contain the UUID as-is
        XCTAssertTrue(result.absoluteString.contains(viewToken.uuidString),
                     "should preserve UUID exactly from uuidString")
    }

    // AC3.2: Base URL with trailing slash doesn't produce double slash
    func testHandlesBaseURLWithTrailingSlash() {
        let viewToken = UUID()
        let baseURL = URL(string: "http://localhost:5100/")!

        let result = TripShareLinks.shareViewURL(viewToken: viewToken, baseURL: baseURL)

        // Should not have double slashes in the path
        XCTAssertFalse(result.absoluteString.contains("//trips"),
                      "should not create double slashes in path")
        XCTAssertTrue(result.absoluteString.contains("/trips/"),
                     "should contain /trips/ path component")
    }

    // AC3.2: Scheme and host are preserved from base URL
    func testPreservesSchemeAndHost() {
        let viewToken = UUID()
        let baseURL = URL(string: "https://custom-host.example.com:9000")!

        let result = TripShareLinks.shareViewURL(viewToken: viewToken, baseURL: baseURL)

        XCTAssertEqual(result.scheme, "https", "should preserve https scheme")
        XCTAssertEqual(result.host, "custom-host.example.com", "should preserve host")
        XCTAssertEqual(result.port, 9000, "should preserve port")
    }

    // AC3.2: Multiple calls with same inputs produce identical results
    func testIsIdempotent() {
        let viewToken = UUID()
        let baseURL = URL(string: "http://localhost:5100")!

        let result1 = TripShareLinks.shareViewURL(viewToken: viewToken, baseURL: baseURL)
        let result2 = TripShareLinks.shareViewURL(viewToken: viewToken, baseURL: baseURL)

        XCTAssertEqual(result1, result2, "should produce identical results for same inputs")
    }
}
