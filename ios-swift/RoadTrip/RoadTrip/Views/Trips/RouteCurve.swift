import CoreLocation

/// Pure helpers for smoothing the trip route line.
///
/// Extracted from `TripDetailView` (like `MapFraming`) so the curve math is
/// unit-testable without standing up a SwiftUI `Map`. Functional Core: no I/O,
/// no mutation of shared state, deterministic.
enum RouteCurve {
    /// Smooth, non-overshooting curve through ordered waypoints, computed with a
    /// centripetal Catmull-Rom spline (alpha = 0.5).
    ///
    /// - Returns the input unchanged when `points.count < 3` (nothing to smooth).
    /// - Never emits NaN/infinite coordinates: any degenerate segment (e.g.
    ///   duplicate adjacent points producing a zero parameter delta) falls back to
    ///   the straight segment between the two control points.
    /// - For N input points it emits roughly `(N - 1) * pointsPerSegment + 1`
    ///   coordinates, always including the original first and last point.
    static func curved(through points: [CLLocationCoordinate2D],
                       pointsPerSegment: Int = 20) -> [CLLocationCoordinate2D] {
        // Passthrough for fewer than 3 points: nothing to smooth
        guard points.count >= 3 else {
            return points
        }

        // Guard against invalid pointsPerSegment
        let segments = max(1, pointsPerSegment)

        var result: [CLLocationCoordinate2D] = []

        // For each consecutive pair (P1, P2) in points
        for i in 0 ..< points.count - 1 {
            let P1 = points[i]
            let P2 = points[i + 1]

            // Neighbors for Catmull-Rom: clamp/duplicate endpoints
            let P0 = (i == 0) ? points[0] : points[i - 1]
            let P3 = (i == points.count - 2) ? points[points.count - 1] : points[i + 2]

            // Sample this segment
            let segmentPoints = catmullRomSegment(P0: P0, P1: P1, P2: P2, P3: P3,
                                                  pointsPerSegment: segments)
            // Append all but the last point (next segment will contribute its start)
            result.append(contentsOf: segmentPoints.dropLast())
        }

        // Append the final point exactly once
        result.append(points[points.count - 1])

        return result
    }

    /// Computes a single Catmull-Rom segment between P1 and P2, using neighbors P0 and P3.
    /// Alpha = 0.5 (centripetal) to prevent overshoot on clustered/irregular points.
    private static func catmullRomSegment(P0: CLLocationCoordinate2D,
                                         P1: CLLocationCoordinate2D,
                                         P2: CLLocationCoordinate2D,
                                         P3: CLLocationCoordinate2D,
                                         pointsPerSegment: Int) -> [CLLocationCoordinate2D] {
        // Work in lat/lng space directly (treating as planar for small distances).
        let p0 = (lat: P0.latitude, lng: P0.longitude)
        let p1 = (lat: P1.latitude, lng: P1.longitude)
        let p2 = (lat: P2.latitude, lng: P2.longitude)
        let p3 = (lat: P3.latitude, lng: P3.longitude)

        // Centripetal knot spacing: t_{i+1} = t_i + distance(P_i, P_{i+1})^0.5
        let t0 = 0.0
        let t1 = t0 + sqrt(distance(p0, p1))
        let t2 = t1 + sqrt(distance(p1, p2))
        let t3 = t2 + sqrt(distance(p2, p3))

        var segment: [CLLocationCoordinate2D] = []

        // Guard against degenerate case: if t1 == t2, fall back to straight interpolation
        if abs(t2 - t1) < 1e-14 {
            // Degenerate: use straight segment from P1 to P2
            for i in 0 ... pointsPerSegment {
                let alpha = Double(i) / Double(pointsPerSegment)
                let interpLat = p1.lat + (p2.lat - p1.lat) * alpha
                let interpLng = p1.lng + (p2.lng - p1.lng) * alpha
                segment.append(CLLocationCoordinate2D(latitude: interpLat, longitude: interpLng))
            }
            return segment
        }

        // Normal case: compute Catmull-Rom with centripetal parameterization
        for i in 0 ... pointsPerSegment {
            let t = t1 + (t2 - t1) * (Double(i) / Double(pointsPerSegment))

            let lat = catmullRomInterpolate(p0.lat, p1.lat, p2.lat, p3.lat,
                                            t0, t1, t2, t3, t)
            let lng = catmullRomInterpolate(p0.lng, p1.lng, p2.lng, p3.lng,
                                            t0, t1, t2, t3, t)

            // Guard against NaN: use straight interpolation if Catmull-Rom fails
            if !lat.isFinite || !lng.isFinite {
                let alpha = Double(i) / Double(pointsPerSegment)
                let safeLat = p1.lat + (p2.lat - p1.lat) * alpha
                let safeLng = p1.lng + (p2.lng - p1.lng) * alpha
                segment.append(CLLocationCoordinate2D(latitude: safeLat, longitude: safeLng))
            } else {
                segment.append(CLLocationCoordinate2D(latitude: lat, longitude: lng))
            }
        }

        return segment
    }

    /// Centripetal Catmull-Rom interpolation (alpha = 0.5) for a scalar value.
    private static func catmullRomInterpolate(_ p0: Double,
                                             _ p1: Double,
                                             _ p2: Double,
                                             _ p3: Double,
                                             _ t0: Double,
                                             _ t1: Double,
                                             _ t2: Double,
                                             _ t3: Double,
                                             _ t: Double) -> Double {
        // Catmull-Rom tangent vectors (centripetal parameterization, alpha = 0.5)
        // Based on: https://en.wikipedia.org/wiki/Centripetal_Catmull%E2%80%93Rom_spline

        // Pre-compute differences and knot spacings
        let dt0 = t1 - t0
        let dt1 = t2 - t1
        let dt2 = t3 - t2

        // Guard against zero deltas (degenerate knot spacing)
        guard dt1 > 1e-14 else { return p1 }

        // Compute the tangent vector at each control point using neighbor-aware Catmull-Rom
        let chordSlope = (p2 - p1) / dt1
        let tangentStart = ((p1 - p0) / dt0) * (1 + dt1 / (dt0 + dt1))
                         - chordSlope * (dt0 / (dt0 + dt1))
        let tangentEnd = ((p3 - p2) / dt2) * (1 + dt1 / (dt1 + dt2))
                       - chordSlope * (dt2 / (dt1 + dt2))

        let s = (t - t1) / dt1  // Parameter in [0, 1]

        // Hermite basis functions for the interval [p1, p2]
        let h00 = (2 * s * s - 3 * s + 1)
        let h01 = (-2 * s * s + 3 * s)
        let h10 = (s * s - 2 * s + 1) * dt1
        let h11 = (s * s - 1 * s) * dt1

        return h00 * p1 + h01 * p2 + h10 * tangentStart + h11 * tangentEnd
    }

    /// Euclidean distance between two (lat, lng) points (planar approximation).
    private static func distance(_ a: (lat: Double, lng: Double),
                                _ b: (lat: Double, lng: Double)) -> Double {
        let dlat = a.lat - b.lat
        let dlng = a.lng - b.lng
        return sqrt(dlat * dlat + dlng * dlng)
    }
}
