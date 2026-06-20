import XCTest
@testable import RoadTrip

/// Phase 7: the optimistic-mutation core (design AC4) — apply a local change immediately,
/// run the server effect, and revert the local change if the server fails.
final class OptimisticMutationTests: XCTestCase {

    func testServerSuccessAppliesAndKeepsChange() async throws {
        var applied = false
        var reverted = false

        try await OptimisticMutation.run(
            apply: { applied = true },
            server: { /* succeeds */ },
            revert: { reverted = true })

        XCTAssertTrue(applied)
        XCTAssertFalse(reverted, "no revert when the server succeeds")
    }

    func testServerFailureRevertsAndRethrows() async {
        struct ServerError: Error {}
        var applied = false
        var reverted = false

        do {
            try await OptimisticMutation.run(
                apply: { applied = true },
                server: { throw ServerError() },
                revert: { reverted = true })
            XCTFail("should rethrow the server error")
        } catch {
            XCTAssertTrue(error is ServerError, "original error is rethrown")
        }

        XCTAssertTrue(applied)
        XCTAssertTrue(reverted, "local change is reverted on server failure")
    }

    func testApplyFailureDoesNotCallServerOrRevert() async {
        struct ApplyError: Error {}
        var serverCalled = false
        var reverted = false

        do {
            try await OptimisticMutation.run(
                apply: { throw ApplyError() },
                server: { serverCalled = true },
                revert: { reverted = true })
            XCTFail("should rethrow the apply error")
        } catch {
            XCTAssertTrue(error is ApplyError)
        }

        XCTAssertFalse(serverCalled, "server is not called if the local apply fails")
        XCTAssertFalse(reverted, "nothing to revert if apply never took effect")
    }
}
