import XCTest
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers
@testable import RoadTrip

/// Phase 5: EXIF GPS + capture-date extraction (design `native-ios.AC2.1`).
///
/// Each test synthesizes a real JPEG with known GPS/date metadata via ImageIO, then
/// reads it back through `EXIFExtractor` — a true round-trip, no committed binary fixtures.
final class EXIFExtractorTests: XCTestCase {

    func testExtractsNorthWestCoordinateAndDate() {
        // GPS stores magnitude + hemisphere ref; west longitude → negative.
        let data = makeJPEG(lat: 37.7749, latRef: "N", lng: 122.4194, lngRef: "W",
                            dateOriginal: "2024:07:15 13:45:30")

        let meta = EXIFExtractor.extract(from: data)

        XCTAssertEqual(meta.lat ?? .nan, 37.7749, accuracy: 0.0001)
        XCTAssertEqual(meta.lng ?? .nan, -122.4194, accuracy: 0.0001, "west ref should make longitude negative")
        XCTAssertEqual(meta.takenAt, expectedDate(2024, 7, 15, 13, 45, 30))
    }

    func testAppliesSouthernAndEasternHemisphereRefs() {
        // Sydney: south latitude (negative), east longitude (positive).
        let data = makeJPEG(lat: 33.8688, latRef: "S", lng: 151.2093, lngRef: "E",
                            dateOriginal: nil)

        let meta = EXIFExtractor.extract(from: data)

        XCTAssertEqual(meta.lat ?? .nan, -33.8688, accuracy: 0.0001, "south ref should make latitude negative")
        XCTAssertEqual(meta.lng ?? .nan, 151.2093, accuracy: 0.0001)
        XCTAssertNil(meta.takenAt, "no DateTimeOriginal → nil takenAt")
    }

    func testNoGPSReturnsNilCoordinate() {
        let data = makeJPEG(lat: nil, latRef: nil, lng: nil, lngRef: nil,
                            dateOriginal: "2024:07:15 13:45:30")

        let meta = EXIFExtractor.extract(from: data)

        XCTAssertNil(meta.lat)
        XCTAssertNil(meta.lng)
        XCTAssertNil(meta.coordinate, "no GPS → no coordinate")
        XCTAssertEqual(meta.takenAt, expectedDate(2024, 7, 15, 13, 45, 30), "date still extracted without GPS")
    }

    // MARK: - Helpers

    private func expectedDate(_ y: Int, _ mo: Int, _ d: Int, _ h: Int, _ mi: Int, _ s: Int) -> Date {
        var c = DateComponents()
        (c.year, c.month, c.day, c.hour, c.minute, c.second) = (y, mo, d, h, mi, s)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal.date(from: c)!
    }

    private func makeJPEG(lat: Double?, latRef: String?, lng: Double?, lngRef: String?,
                          dateOriginal: String?) -> Data {
        let side = 4
        let ctx = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8,
                            bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        let image = ctx.makeImage()!

        var props: [CFString: Any] = [:]
        if let lat, let lng, let latRef, let lngRef {
            props[kCGImagePropertyGPSDictionary] = [
                kCGImagePropertyGPSLatitude: lat,
                kCGImagePropertyGPSLatitudeRef: latRef,
                kCGImagePropertyGPSLongitude: lng,
                kCGImagePropertyGPSLongitudeRef: lngRef,
            ] as [CFString: Any]
        }
        if let dateOriginal {
            props[kCGImagePropertyExifDictionary] = [
                kCGImagePropertyExifDateTimeOriginal: dateOriginal
            ] as [CFString: Any]
        }

        let out = NSMutableData()
        let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(dest, image, props as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(dest), "failed to encode test JPEG")
        return out as Data
    }
}
