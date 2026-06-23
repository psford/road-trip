import CoreLocation

// MARK: - LocationProviding

/// Abstracts one-shot coordinate lookup so camera-staging code can be tested without
/// a real CLLocationManager (which requires a device or a stubbed authorization state).
@MainActor
protocol LocationProviding: AnyObject, Sendable {
    /// Returns the device's current coordinate, or `nil` if permission is denied or
    /// the request fails within `timeout` seconds.
    func currentCoordinate(timeout: TimeInterval) async -> CLLocationCoordinate2D?
}

// MARK: - Production conformance

extension OneShotLocationProvider: LocationProviding {}

// MARK: - locationWithTimeout free function

/// Races a one-shot location fetch against a wall-clock timeout.
/// Returns the coordinate if it arrives before `seconds` elapses; otherwise nil.
///
/// Extracted from TripDetailView so it can be called with any `LocationProviding`
/// implementation — real or fake — making camera-staging logic unit-testable.
@MainActor
func locationWithTimeout(_ provider: any LocationProviding, seconds: TimeInterval = 10) async -> CLLocationCoordinate2D? {
    await withTaskGroup(of: CLLocationCoordinate2D?.self) { group in
        group.addTask { await provider.currentCoordinate(timeout: seconds) }
        group.addTask { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)); return nil }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first
    }
}
