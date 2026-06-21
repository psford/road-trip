import CoreLocation

/// One-shot CoreLocation fetch for camera captures (no continuous location use).
/// Returns `nil` on denial, restriction, error, or timeout — the caller then
/// falls back to the manual pin-drop. Never blocks indefinitely.
@MainActor
final class OneShotLocationProvider: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocationCoordinate2D?, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    /// Returns a coordinate, or nil if unavailable within `timeout` seconds.
    func currentCoordinate(timeout: TimeInterval = 4) async -> CLLocationCoordinate2D? {
        switch manager.authorizationStatus {
        case .denied, .restricted:
            return nil
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
            // requestLocation() below will deliver once authorization resolves, or
            // the timeout fires; either way we return a value.
        case .authorizedWhenInUse, .authorizedAlways:
            break
        @unknown default:
            return nil
        }

        let fix = await withCheckedContinuation { (cont: CheckedContinuation<CLLocationCoordinate2D?, Never>) in
            self.continuation = cont
            self.manager.requestLocation()
        }
        // (Timeout handled by the caller-side race below; see note.)
        return fix
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in self.resume(with: locations.last?.coordinate) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.resume(with: nil) }
    }

    private func resume(with coordinate: CLLocationCoordinate2D?) {
        continuation?.resume(returning: coordinate)
        continuation = nil
    }
}
