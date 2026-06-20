import Foundation

/// Classifies the outcome of a block PUT, mirroring the web client's transport rules.
/// `nil` from `classify` means success.
enum UploadTransportError: Error, Equatable {
    case sasExpired              // 403 — SAS token expired/invalid; refresh and retry
    case retryable(status: Int)  // 408/429/500/503 — transient; retry with backoff
    case permanent(status: Int)  // anything else — give up

    /// Maps an HTTP status to an error, or `nil` for success (2xx).
    static func classify(status: Int) -> UploadTransportError? {
        switch status {
        case 200..<300: return nil
        case 403: return .sasExpired
        case 408, 429, 500, 503: return .retryable(status: status)
        default: return .permanent(status: status)
        }
    }
}

/// Retry backoff with decorrelated jitter: `min(2^attempt * 1s, 30s)` plus jitter in
/// `[0, 2s)`. Matches `uploadUtils.js` so client behavior is consistent across platforms.
enum Backoff {
    static let baseMs = 1000.0
    static let capMs = 30000.0

    /// Capped exponential, no jitter.
    static func baseDelayMs(attempt: Int) -> Double {
        min(pow(2.0, Double(attempt)) * baseMs, capMs)
    }

    /// Full delay including jitter. `jitter` is a value in `[0, 1)` (caller supplies the RNG).
    static func delayMs(attempt: Int, jitter: Double) -> Double {
        let maxJitter = min(3 * baseMs, capMs) - baseMs   // 2000ms
        return baseDelayMs(attempt: attempt) + jitter * maxJitter
    }
}

/// Decides when a SAS token is too old to keep using. Tokens have a 2h TTL; refresh once
/// they pass 1.75h so a long-queued upload never PUTs against an expired token.
enum SASRefresher {
    static let refreshAfterSeconds: TimeInterval = 1.75 * 3600

    static func needsRefresh(issuedAt: Date, now: Date = Date()) -> Bool {
        now.timeIntervalSince(issuedAt) > refreshAfterSeconds
    }
}
