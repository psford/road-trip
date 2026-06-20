import MapKit

/// Pure helpers for framing a MapKit camera around a set of photo coordinates.
///
/// Extracted from `TripDetailView` so the "fit all pins on first render" logic
/// (design AC5.1) is unit-testable without standing up a SwiftUI view.
enum MapFraming {
    /// Smallest span we will frame to, so a single pin (or tightly clustered pins)
    /// doesn't zoom to absurd street level. ~2 km across.
    static let minimumMeters: Double = 2_000

    /// Fraction of the bounding box added as padding on each axis, so edge pins sit
    /// inside the viewport rather than on its border.
    static let defaultPaddingFactor: Double = 0.35

    /// An `MKMapRect` that tightly bounds every coordinate. `nil` when there are none.
    static func boundingRect(for coordinates: [CLLocationCoordinate2D]) -> MKMapRect? {
        guard let first = coordinates.first else { return nil }
        var rect = MKMapRect(origin: MKMapPoint(first), size: MKMapSize(width: 0, height: 0))
        for coordinate in coordinates.dropFirst() {
            let point = MKMapPoint(coordinate)
            rect = rect.union(MKMapRect(origin: point, size: MKMapSize(width: 0, height: 0)))
        }
        return rect
    }

    /// A camera-ready rect: bounds all coordinates, floored to `minimumMeters` so a
    /// single pin stays at a sane zoom, then padded so edge pins aren't clipped.
    /// `nil` when there are no coordinates (caller falls back to user location — AC5.4).
    static func framedRect(for coordinates: [CLLocationCoordinate2D],
                           paddingFactor: Double = defaultPaddingFactor) -> MKMapRect? {
        guard var rect = boundingRect(for: coordinates) else { return nil }

        // Floor the size to minimumMeters (converted to map points at this latitude).
        let latitude = MKMapPoint(x: rect.midX, y: rect.midY).coordinate.latitude
        let minSize = minimumMeters * MKMapPointsPerMeterAtLatitude(latitude)
        if rect.size.width < minSize {
            rect = MKMapRect(x: rect.midX - minSize / 2, y: rect.origin.y,
                             width: minSize, height: rect.size.height)
        }
        if rect.size.height < minSize {
            rect = MKMapRect(x: rect.origin.x, y: rect.midY - minSize / 2,
                             width: rect.size.width, height: minSize)
        }

        // Expand each axis (negative inset grows the rect).
        return rect.insetBy(dx: -rect.size.width * paddingFactor,
                            dy: -rect.size.height * paddingFactor)
    }
}
