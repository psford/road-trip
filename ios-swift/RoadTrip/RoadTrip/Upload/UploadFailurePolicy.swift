import Foundation

/// Decides what an upload error means: a transport-level failure (no service, timeout, connection
/// lost) is NOT a failure the user should see — the photo waits and uploads when service returns
/// (poor-service support). Everything else is a genuine failure.
///
/// Pure, so the policy is unit-testable with no network. `RoadTripAPI.send` already collapses every
/// transport error to `.networkUnavailable` (HTTP status errors become `.serverError`/`.unauthorized`),
/// so that single case is the reliable "we never reached the server" signal.
enum UploadFailurePolicy {
    enum Decision: Equatable {
        /// Leave the upload in its current stage; `reconcile()` retries it when connectivity returns.
        case waitForNetwork
        /// Mark the upload `.failed` with this message (the banner surfaces Retry).
        case fail(message: String)
    }

    static func decide(_ error: Error, message: String) -> Decision {
        if case RoadTripAPIError.networkUnavailable = error { return .waitForNetwork }
        return .fail(message: message)
    }
}
