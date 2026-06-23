import XCTest
@testable import RoadTrip

/// Poor-service support: deciding whether an upload error means "no connectivity — wait and
/// retry when service returns" vs "a real failure — surface it". Pure, so every branch is here.
final class UploadFailurePolicyTests: XCTestCase {

    func testNetworkUnavailableWaitsForNetwork() {
        let decision = UploadFailurePolicy.decide(RoadTripAPIError.networkUnavailable, message: "boom")
        XCTAssertEqual(decision, .waitForNetwork,
                       "a transport-level failure (no service / timeout) must wait, not fail")
    }

    func testServerErrorFails() {
        let decision = UploadFailurePolicy.decide(RoadTripAPIError.serverError("HTTP 500"), message: "boom")
        XCTAssertEqual(decision, .fail(message: "boom"),
                       "a real server error is a genuine failure the user should see")
    }

    func testUnauthorizedFails() {
        let decision = UploadFailurePolicy.decide(RoadTripAPIError.unauthorized, message: "boom")
        XCTAssertEqual(decision, .fail(message: "boom"))
    }

    func testUnknownErrorFails() {
        struct Other: Error {}
        let decision = UploadFailurePolicy.decide(Other(), message: "boom")
        XCTAssertEqual(decision, .fail(message: "boom"),
                       "anything we can't classify as offline is treated as a failure")
    }
}
