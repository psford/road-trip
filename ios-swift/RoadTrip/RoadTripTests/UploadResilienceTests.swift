import XCTest
@testable import RoadTrip

/// Phase 6 Slice B: the pure resilience primitives — backoff schedule, HTTP→error
/// classification, and SAS-expiry decision. All mirror the web client's transport.
final class UploadResilienceTests: XCTestCase {

    // MARK: - Backoff (decorrelated jitter, base 1s, cap 30s)

    func testBaseDelayCapsExponential() {
        XCTAssertEqual(Backoff.baseDelayMs(attempt: 0), 1000)
        XCTAssertEqual(Backoff.baseDelayMs(attempt: 1), 2000)
        XCTAssertEqual(Backoff.baseDelayMs(attempt: 3), 8000)
        XCTAssertEqual(Backoff.baseDelayMs(attempt: 10), 30000, "exponential is capped at 30s")
    }

    func testJitterAddsBoundedDelay() {
        // maxJitter = min(3*base, cap) - base = 2000ms; jitter in [0,1) maps to [0,2000).
        XCTAssertEqual(Backoff.delayMs(attempt: 0, jitter: 0.0), 1000, accuracy: 0.001)
        XCTAssertEqual(Backoff.delayMs(attempt: 0, jitter: 0.5), 2000, accuracy: 0.001)
        let high = Backoff.delayMs(attempt: 0, jitter: 0.999)
        XCTAssertGreaterThanOrEqual(high, 1000)
        XCTAssertLessThan(high, 3000)
    }

    // MARK: - HTTP status classification

    func testSuccessStatusesClassifyAsNil() {
        XCTAssertNil(UploadTransportError.classify(status: 200))
        XCTAssertNil(UploadTransportError.classify(status: 201))
    }

    func testForbiddenIsSasExpired() {
        XCTAssertEqual(UploadTransportError.classify(status: 403), .sasExpired)
    }

    func testTransientStatusesAreRetryable() {
        for status in [408, 429, 500, 503] {
            XCTAssertEqual(UploadTransportError.classify(status: status), .retryable(status: status))
        }
    }

    func testOtherStatusesArePermanent() {
        XCTAssertEqual(UploadTransportError.classify(status: 400), .permanent(status: 400))
        XCTAssertEqual(UploadTransportError.classify(status: 404), .permanent(status: 404))
    }

    // MARK: - SAS expiry (refresh when older than 1.75h; TTL is 2h)

    func testSASNotStaleBeforeThreshold() {
        let issued = Date(timeIntervalSince1970: 0)
        XCTAssertFalse(SASRefresher.needsRefresh(issuedAt: issued, now: issued.addingTimeInterval(1.5 * 3600)))
    }

    func testSASStaleAfterThreshold() {
        let issued = Date(timeIntervalSince1970: 0)
        XCTAssertTrue(SASRefresher.needsRefresh(issuedAt: issued, now: issued.addingTimeInterval(1.75 * 3600 + 1)))
    }
}
