import XCTest
@testable import RoadTrip

/// Phase 6 Slice B: the block-upload retry/SAS-refresh orchestration. Effects (put,
/// refresh, backoff, progress) are injected so the resilience logic is tested with fakes,
/// no network.
final class BlockUploadRunnerTests: XCTestCase {

    private func ranges(_ n: Int) -> [ChunkRange] {
        (0..<n).map { ChunkRange(index: $0, offset: $0 * 4, length: 4, blockId: BlockUpload.blockId(index: $0)) }
    }

    func testUploadsAllBlocksInOrderAgainstInitialSAS() async throws {
        var urls: [String] = []
        let ids = try await BlockUploadRunner.run(
            ranges: ranges(3), initialSasUrl: "sas0",
            chunk: { _ in Data() },
            put: { url, _, _ in urls.append(url) },
            refreshSAS: { XCTFail("should not refresh"); return "x" },
            backoff: { _ in XCTFail("should not back off") },
            onProgress: { _ in })

        XCTAssertEqual(ids, ranges(3).map(\.blockId))
        XCTAssertEqual(urls, ["sas0", "sas0", "sas0"])
    }

    func testRetriesTransientFailureWithBackoffThenSucceeds() async throws {
        var attempts = 0
        var backoffs: [Int] = []
        let ids = try await BlockUploadRunner.run(
            ranges: ranges(1), initialSasUrl: "sas0",
            chunk: { _ in Data() },
            put: { _, _, _ in
                attempts += 1
                if attempts < 3 { throw UploadTransportError.retryable(status: 503) }
            },
            refreshSAS: { "x" },
            backoff: { backoffs.append($0) },
            onProgress: { _ in })

        XCTAssertEqual(attempts, 3)
        XCTAssertEqual(backoffs, [0, 1], "backoff runs before each retry with the attempt index")
        XCTAssertEqual(ids.count, 1)
    }

    func testRefreshesSASOnExpiryAndRetriesAgainstFreshURL() async throws {
        var urls: [String] = []
        var refreshed = 0
        var first = true
        _ = try await BlockUploadRunner.run(
            ranges: ranges(1), initialSasUrl: "old",
            chunk: { _ in Data() },
            put: { url, _, _ in
                urls.append(url)
                if first { first = false; throw UploadTransportError.sasExpired }
            },
            refreshSAS: { refreshed += 1; return "fresh" },
            backoff: { _ in XCTFail("SAS refresh should not back off") },
            onProgress: { _ in })

        XCTAssertEqual(refreshed, 1)
        XCTAssertEqual(urls, ["old", "fresh"], "block retried against the refreshed SAS URL")
    }

    func testPermanentErrorAbortsImmediately() async {
        var attempts = 0
        do {
            _ = try await BlockUploadRunner.run(
                ranges: ranges(2), initialSasUrl: "sas",
                chunk: { _ in Data() },
                put: { _, _, _ in attempts += 1; throw UploadTransportError.permanent(status: 400) },
                refreshSAS: { "x" }, backoff: { _ in }, onProgress: { _ in })
            XCTFail("should throw on a permanent error")
        } catch {
            XCTAssertEqual(error as? UploadTransportError, .permanent(status: 400))
            XCTAssertEqual(attempts, 1, "no retry on permanent errors")
        }
    }

    func testExhaustsRetriesThenThrows() async {
        var attempts = 0
        do {
            _ = try await BlockUploadRunner.run(
                ranges: ranges(1), initialSasUrl: "sas", maxAttemptsPerBlock: 4,
                chunk: { _ in Data() },
                put: { _, _, _ in attempts += 1; throw UploadTransportError.retryable(status: 500) },
                refreshSAS: { "x" }, backoff: { _ in }, onProgress: { _ in })
            XCTFail("should throw after exhausting retries")
        } catch {
            XCTAssertEqual(error as? UploadTransportError, .retryable(status: 500))
            XCTAssertEqual(attempts, 4)
        }
    }

    func testReportsProgressPerCompletedBlock() async throws {
        var progressed: [Int] = []
        _ = try await BlockUploadRunner.run(
            ranges: ranges(3), initialSasUrl: "sas",
            chunk: { _ in Data() },
            put: { _, _, _ in }, refreshSAS: { "x" }, backoff: { _ in },
            onProgress: { progressed.append($0) })
        XCTAssertEqual(progressed, [0, 1, 2])
    }
}
