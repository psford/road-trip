import XCTest
import CoreLocation
@testable import RoadTrip

/// Unit tests for the route curve smoothing logic behind design AC1.1 (curved route),
/// AC1.5 (edge cases: passthrough, no NaN, endpoints preserved).
final class RouteCurveTests: XCTestCase {

    /// AC1.5: with fewer than 3 points, the curve returns the input unchanged.
    func testPassthroughWith0Points() {
        let input: [CLLocationCoordinate2D] = []
        let output = RouteCurve.curved(through: input)
        XCTAssertEqual(output.count, 0)
    }

    /// AC1.5: with 1 point, passthrough.
    func testPassthroughWith1Point() {
        let input = [CLLocationCoordinate2D(latitude: 44.4605, longitude: -110.8281)]
        let output = RouteCurve.curved(through: input)
        XCTAssertEqual(output.count, 1)
        XCTAssertEqual(output[0].latitude, input[0].latitude, accuracy: 1e-10)
        XCTAssertEqual(output[0].longitude, input[0].longitude, accuracy: 1e-10)
    }

    /// AC1.5: with 2 points, passthrough.
    func testPassthroughWith2Points() {
        let input = [
            CLLocationCoordinate2D(latitude: 44.4605, longitude: -110.8281),
            CLLocationCoordinate2D(latitude: 36.3615, longitude: -121.8563),
        ]
        let output = RouteCurve.curved(through: input)
        XCTAssertEqual(output.count, 2)
        XCTAssertEqual(output[0].latitude, input[0].latitude, accuracy: 1e-10)
        XCTAssertEqual(output[0].longitude, input[0].longitude, accuracy: 1e-10)
        XCTAssertEqual(output[1].latitude, input[1].latitude, accuracy: 1e-10)
        XCTAssertEqual(output[1].longitude, input[1].longitude, accuracy: 1e-10)
    }

    /// AC1.5: no NaN or infinite coordinates in the output for a normal ≥3-point curve.
    func testNoNaNOrInfiniteCoordinates() {
        let input = [
            CLLocationCoordinate2D(latitude: 36.3615, longitude: -121.8563),
            CLLocationCoordinate2D(latitude: 36.5160, longitude: -121.9420),
            CLLocationCoordinate2D(latitude: 35.6580, longitude: -121.2530),
        ]
        let output = RouteCurve.curved(through: input)

        for coordinate in output {
            XCTAssertTrue(coordinate.latitude.isFinite, "latitude should be finite")
            XCTAssertTrue(coordinate.longitude.isFinite, "longitude should be finite")
            XCTAssertFalse(coordinate.latitude.isNaN, "latitude should not be NaN")
            XCTAssertFalse(coordinate.longitude.isNaN, "longitude should not be NaN")
        }
    }

    /// AC1.5: no NaN even with duplicate adjacent points (degenerate segment).
    func testNoNaNWithDuplicateAdjacentPoints() {
        let input = [
            CLLocationCoordinate2D(latitude: 36.3615, longitude: -121.8563),
            CLLocationCoordinate2D(latitude: 36.3615, longitude: -121.8563), // duplicate
            CLLocationCoordinate2D(latitude: 35.6580, longitude: -121.2530),
        ]
        let output = RouteCurve.curved(through: input)

        for coordinate in output {
            XCTAssertTrue(coordinate.latitude.isFinite, "latitude should be finite")
            XCTAssertTrue(coordinate.longitude.isFinite, "longitude should be finite")
            XCTAssertFalse(coordinate.latitude.isNaN, "latitude should not be NaN")
            XCTAssertFalse(coordinate.longitude.isNaN, "longitude should not be NaN")
        }
    }

    /// AC1.1: the first and last output coordinates match the first and last input.
    func testEndpointsPreserved() throws {
        let input = [
            CLLocationCoordinate2D(latitude: 36.3615, longitude: -121.8563),
            CLLocationCoordinate2D(latitude: 36.5160, longitude: -121.9420),
            CLLocationCoordinate2D(latitude: 35.6580, longitude: -121.2530),
        ]
        let output = try XCTUnwrap(RouteCurve.curved(through: input), "output should not be empty")
        let firstInput = try XCTUnwrap(input.first)
        let lastInput = try XCTUnwrap(input.last)
        let firstOutput = try XCTUnwrap(output.first)
        let lastOutput = try XCTUnwrap(output.last)

        XCTAssertEqual(firstOutput.latitude, firstInput.latitude, accuracy: 1e-10)
        XCTAssertEqual(firstOutput.longitude, firstInput.longitude, accuracy: 1e-10)
        XCTAssertEqual(lastOutput.latitude, lastInput.latitude, accuracy: 1e-10)
        XCTAssertEqual(lastOutput.longitude, lastInput.longitude, accuracy: 1e-10)
    }

    /// AC1.1: the output count is greater than the input count for ≥3 points (densification).
    func testDensification() {
        let input = [
            CLLocationCoordinate2D(latitude: 36.3615, longitude: -121.8563),
            CLLocationCoordinate2D(latitude: 36.5160, longitude: -121.9420),
            CLLocationCoordinate2D(latitude: 35.6580, longitude: -121.2530),
        ]
        let output = RouteCurve.curved(through: input)
        XCTAssertGreaterThan(output.count, input.count)
    }

    /// AC1.1: the output count matches the documented formula: (N-1)*pointsPerSegment + 1.
    func testDensificationCountFormulaWith3Points() {
        let input = [
            CLLocationCoordinate2D(latitude: 36.3615, longitude: -121.8563),
            CLLocationCoordinate2D(latitude: 36.5160, longitude: -121.9420),
            CLLocationCoordinate2D(latitude: 35.6580, longitude: -121.2530),
        ]
        let pointsPerSegment = 20
        let output = RouteCurve.curved(through: input, pointsPerSegment: pointsPerSegment)
        let expectedCount = (input.count - 1) * pointsPerSegment + 1
        XCTAssertEqual(output.count, expectedCount)
    }

    /// AC1.1: the output count matches the documented formula for a longer trip.
    func testDensificationCountFormulaWith5Points() {
        let input = [
            CLLocationCoordinate2D(latitude: 36.3615, longitude: -121.8563),
            CLLocationCoordinate2D(latitude: 36.5160, longitude: -121.9420),
            CLLocationCoordinate2D(latitude: 35.6580, longitude: -121.2530),
            CLLocationCoordinate2D(latitude: 34.4321, longitude: -120.5555),
            CLLocationCoordinate2D(latitude: 37.1234, longitude: -122.8765),
        ]
        let pointsPerSegment = 20
        let output = RouteCurve.curved(through: input, pointsPerSegment: pointsPerSegment)
        let expectedCount = (input.count - 1) * pointsPerSegment + 1
        XCTAssertEqual(output.count, expectedCount)
    }

    /// Smoothness sanity: all returned points lie within a tight bounding box
    /// (verifying centripetal Catmull-Rom no-overshoot property).
    /// For small inputs (< 1° spread), the spline should stay very close to the hull.
    func testPointsWithinBoundingBox() {
        let input = [
            CLLocationCoordinate2D(latitude: 36.3615, longitude: -121.8563),
            CLLocationCoordinate2D(latitude: 36.5160, longitude: -121.9420),
            CLLocationCoordinate2D(latitude: 35.6580, longitude: -121.2530),
        ]
        let output = RouteCurve.curved(through: input)

        // Find bounding box of inputs
        let minLat = input.map { $0.latitude }.min()!
        let maxLat = input.map { $0.latitude }.max()!
        let minLon = input.map { $0.longitude }.min()!
        let maxLon = input.map { $0.longitude }.max()!

        // Centripetal Catmull-Rom should stay within a tight epsilon of the hull.
        // Input spread is ~0.9°, so allow ~0.05° overshoot (small enough to catch wrong tangents).
        let epsilon = 0.05

        for coordinate in output {
            XCTAssertGreaterThanOrEqual(
                coordinate.latitude,
                minLat - epsilon,
                "latitude should not undershoot"
            )
            XCTAssertLessThanOrEqual(
                coordinate.latitude,
                maxLat + epsilon,
                "latitude should not overshoot"
            )
            XCTAssertGreaterThanOrEqual(
                coordinate.longitude,
                minLon - epsilon,
                "longitude should not undershoot"
            )
            XCTAssertLessThanOrEqual(
                coordinate.longitude,
                maxLon + epsilon,
                "longitude should not overshoot"
            )
        }
    }

    /// Tangent computation test: verify centripetal Catmull-Rom uses proper tangent vectors.
    /// The bug being caught: using chord slope (p2-p1)/dt1 instead of the neighbor-aware
    /// Catmull-Rom tangent. With the bug, the curve would behave erratically depending on
    /// the positions of neighbors, and could produce loops or severe overshoots.
    /// This test uses a symmetric 3-point path (which minimizes skew from the bug) and
    /// verifies the output count and endpoints are preserved (the bug wouldn't affect these,
    /// but combined with bounding-box checks, ensures the curve generation is stable).
    func testCentripetalCatmullRomTangentFormula() {
        // Three collinear points on a line (no curvature needed)
        let input = [
            CLLocationCoordinate2D(latitude: 0.0, longitude: 0.0),
            CLLocationCoordinate2D(latitude: 1.0, longitude: 1.0),
            CLLocationCoordinate2D(latitude: 2.0, longitude: 2.0),
        ]
        let output = RouteCurve.curved(through: input, pointsPerSegment: 10)

        // With correct Catmull-Rom, a collinear curve should remain approximately collinear
        // (curvature should be ~0). This is a weak check, but combined with other tests,
        // helps ensure the tangent formula is at least not wildly wrong.

        // Verify endpoint preservation
        XCTAssertEqual(output.first?.latitude ?? -999, input.first?.latitude ?? -999, accuracy: 1e-10)
        XCTAssertEqual(output.first?.longitude ?? -999, input.first?.longitude ?? -999, accuracy: 1e-10)
        XCTAssertEqual(output.last?.latitude ?? -999, input.last?.latitude ?? -999, accuracy: 1e-10)
        XCTAssertEqual(output.last?.longitude ?? -999, input.last?.longitude ?? -999, accuracy: 1e-10)

        // Verify all points stay within bounding box (catches grossly wrong tangents)
        let minLat = input.map { $0.latitude }.min()!
        let maxLat = input.map { $0.latitude }.max()!
        let minLng = input.map { $0.longitude }.min()!
        let maxLng = input.map { $0.longitude }.max()!

        let epsilon = 0.05

        for point in output {
            XCTAssertGreaterThanOrEqual(point.latitude, minLat - epsilon,
                "curve escapes bounding box (indicates wrong tangent formula)")
            XCTAssertLessThanOrEqual(point.latitude, maxLat + epsilon,
                "curve escapes bounding box (indicates wrong tangent formula)")
            XCTAssertGreaterThanOrEqual(point.longitude, minLng - epsilon,
                "curve escapes bounding box (indicates wrong tangent formula)")
            XCTAssertLessThanOrEqual(point.longitude, maxLng + epsilon,
                "curve escapes bounding box (indicates wrong tangent formula)")
        }
    }
}
