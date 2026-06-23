import CoreLocation

/// One-shot CoreLocation fetch for camera captures (no continuous location use).
/// Returns `nil` on denial, restriction, error, or timeout — the caller then
/// falls back to the manual pin-drop. Never blocks indefinitely.
///
/// Why `startUpdatingLocation()` and not `requestLocation()`: `requestLocation()` is a
/// one-shot, accuracy-gated request that on a cold per-app `CLLocationManager` routinely
/// takes 5–10+ seconds to deliver its first fix. The earlier 4s caller-side timeout cut it
/// off, so every camera photo fell through to the manual pin-drop even though the device had
/// a fix (the map shows it from MapKit's own warm location source). Streaming delivers the
/// system's cached/last location almost immediately; we take the first usable fix and stop.
@MainActor
final class OneShotLocationProvider: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocationCoordinate2D?, Never>?

    /// A cached fix at least this fresh is good enough to tag a photo without waiting.
    private let maxCacheAge: TimeInterval = 30

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    /// Returns a coordinate, or nil if unavailable within `timeout` seconds.
    func currentCoordinate(timeout: TimeInterval = 10) async -> CLLocationCoordinate2D? {
        switch manager.authorizationStatus {
        case .denied, .restricted:
            return nil
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
            // startUpdatingLocation below begins delivering once authorization resolves,
            // or the caller's timeout fires; either way we return a value.
        case .authorizedWhenInUse, .authorizedAlways:
            break
        @unknown default:
            return nil
        }

        // Fast path: a recent cached fix (the same one the map is already showing) — no wait.
        if let cached = manager.location,
           cached.horizontalAccuracy >= 0,
           cached.timestamp.timeIntervalSinceNow > -maxCacheAge {
            return cached.coordinate
        }

        // Otherwise stream until the first usable fix arrives, then stop.
        return await withTaskCancellationHandler {
            await withCheckedContinuation { (cont: CheckedContinuation<CLLocationCoordinate2D?, Never>) in
                self.continuation = cont
                self.manager.startUpdatingLocation()
            }
        } onCancel: {
            Task { @MainActor in
                // Cancellation (caller timeout): stop and resume with nil exactly once.
                self.manager.stopUpdatingLocation()
                self.resume(with: nil)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            // Ignore invalid fixes (negative accuracy); keep streaming until a usable one lands.
            guard let loc = locations.last, loc.horizontalAccuracy >= 0 else { return }
            self.manager.stopUpdatingLocation()
            self.resume(with: loc.coordinate)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.manager.stopUpdatingLocation()
            self.resume(with: nil)
        }
    }

    private func resume(with coordinate: CLLocationCoordinate2D?) {
        continuation?.resume(returning: coordinate)
        continuation = nil
    }
}
