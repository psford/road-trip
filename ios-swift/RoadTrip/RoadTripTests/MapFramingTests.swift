import XCTest
import MapKit
@testable import RoadTrip

/// Unit tests for the camera-framing logic behind design AC5.1 ("fits all pins on
/// first render") and AC5.4 (empty trip → no rect, caller falls back to user location).
final class MapFramingTests: XCTestCase {

    /// AC5.1: the framed rect must contain every photo coordinate.
    func testFramedRectContainsAllCoordinates() throws {
        let coordinates = [
            CLLocationCoordinate2D(latitude: 36.3615, longitude: -121.8563), // Bixby Bridge
            CLLocationCoordinate2D(latitude: 36.5160, longitude: -121.9420), // Point Lobos
            CLLocationCoordinate2D(latitude: 35.6580, longitude: -121.2530), // Piedras Blancas
        ]

        let rect = try XCTUnwrap(MapFraming.framedRect(for: coordinates))

        for coordinate in coordinates {
            XCTAssertTrue(rect.contains(MKMapPoint(coordinate)),
                          "framed rect should contain \(coordinate)")
        }
    }

    /// AC5.4: no coordinates → nil, so the view falls back to user-location framing.
    func testEmptyCoordinatesReturnsNil() {
        XCTAssertNil(MapFraming.framedRect(for: []))
    }

    /// A single pin must still get a sane, non-degenerate span (minimumMeters floor).
    func testSinglePinGetsMinimumSpan() throws {
        let single = [CLLocationCoordinate2D(latitude: 44.4605, longitude: -110.8281)]

        let rect = try XCTUnwrap(MapFraming.framedRect(for: single))

        XCTAssertTrue(rect.contains(MKMapPoint(single[0])))
        XCTAssertGreaterThan(rect.size.width, 0)
        XCTAssertGreaterThan(rect.size.height, 0)
    }

    /// Padding must widen the camera rect beyond the tight bounding box so edge pins
    /// aren't clipped at the viewport border.
    func testFramedRectIsLargerThanBoundingRect() throws {
        let coordinates = [
            CLLocationCoordinate2D(latitude: 36.3615, longitude: -121.8563),
            CLLocationCoordinate2D(latitude: 35.6580, longitude: -121.2530),
        ]

        let bounding = try XCTUnwrap(MapFraming.boundingRect(for: coordinates))
        let framed = try XCTUnwrap(MapFraming.framedRect(for: coordinates))

        XCTAssertGreaterThan(framed.size.width, bounding.size.width)
        XCTAssertGreaterThan(framed.size.height, bounding.size.height)
    }
}
