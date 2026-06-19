import XCTest
import ImageIO
import CoreGraphics
import CoreLocation
import UniformTypeIdentifiers
@testable import RoadTrip

/// Phase 5: the capture pipeline's testable core — turning raw picked-photo bytes into a
/// persisted `.staged` UploadQueueItem with EXIF + a transcoded JPEG source file.
/// (The PhotosPicker/PHAsset front end needs a real library and is verified on-device.)
final class PhotoCaptureCoordinatorTests: XCTestCase {

    func testStageHEICTranscodesToJPEGAndStoresEXIF() async throws {
        guard let heic = makeImageData(uti: .heic, lat: 37.7749, latRef: "N",
                                       lng: 122.4194, lngRef: "W", date: "2024:07:15 13:45:30") else {
            throw XCTSkip("HEIC encoding unavailable on this simulator")
        }
        let (db, coordinator, dir) = try makeCoordinator()
        defer { try? FileManager.default.removeItem(at: dir) }
        let tripId = try await seedTrip(db)

        let item = try await coordinator.stagePhoto(imageData: heic, filename: "IMG_0001.HEIC", tripId: tripId)

        XCTAssertEqual(item.stage, .staged)
        XCTAssertEqual(item.tripId, tripId)
        XCTAssertEqual(item.exifLat ?? .nan, 37.7749, accuracy: 0.0001)
        XCTAssertEqual(item.exifLon ?? .nan, -122.4194, accuracy: 0.0001, "west longitude negated")
        XCTAssertEqual(item.contentType, "image/jpeg", "HEIC source should be transcoded to JPEG")

        let bytes = try Data(contentsOf: URL(fileURLWithPath: item.localFilePath))
        XCTAssertEqual(Array(bytes.prefix(2)), [0xFF, 0xD8], "staged source file should be JPEG")

        let stored = try await db.dbQueue.read { try UploadQueueItem.fetchCount($0) }
        XCTAssertEqual(stored, 1, "item persisted to GRDB")
    }

    func testStageJPEGWithoutGPSHasNilCoordinates() async throws {
        let jpeg = makeImageData(uti: .jpeg, lat: nil, latRef: nil, lng: nil, lngRef: nil, date: nil)!
        let (db, coordinator, dir) = try makeCoordinator()
        defer { try? FileManager.default.removeItem(at: dir) }
        let tripId = try await seedTrip(db)

        let item = try await coordinator.stagePhoto(imageData: jpeg, filename: "IMG_0002.JPG", tripId: tripId)

        XCTAssertEqual(item.stage, .staged)
        XCTAssertNil(item.exifLat, "no GPS → nil latitude (UI must prompt for a pin-drop)")
        XCTAssertNil(item.exifLon)
    }

    func testOverrideCoordinateWinsOverEXIF() async throws {
        // A photo WITH EXIF GPS, but the user dropped a pin elsewhere (location-first).
        let jpeg = makeImageData(uti: .jpeg, lat: 10, latRef: "N", lng: 20, lngRef: "E", date: nil)!
        let (db, coordinator, dir) = try makeCoordinator()
        defer { try? FileManager.default.removeItem(at: dir) }
        let tripId = try await seedTrip(db)

        let override = CLLocationCoordinate2D(latitude: 48.8584, longitude: 2.2945)
        let item = try await coordinator.stagePhoto(imageData: jpeg, filename: "IMG.jpg",
                                                    tripId: tripId, overrideCoordinate: override)

        XCTAssertEqual(item.exifLat ?? .nan, 48.8584, accuracy: 0.0001, "override coordinate wins")
        XCTAssertEqual(item.exifLon ?? .nan, 2.2945, accuracy: 0.0001)
    }

    // MARK: - Helpers

    private func makeCoordinator() throws -> (AppDatabase, PhotoCaptureCoordinator, URL) {
        let db = try AppDatabase.makeInMemory()
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        return (db, PhotoCaptureCoordinator(database: db, stagingDirectory: dir), dir)
    }

    private func seedTrip(_ db: AppDatabase) async throws -> UUID {
        let id = UUID()
        try await db.dbQueue.write { d in
            try Trip(id: id, name: "Trip", description: nil, slug: nil,
                     photoCount: 0, createdAt: Date(timeIntervalSince1970: 1_700_000_000),
                     cachedAt: Date(timeIntervalSince1970: 1_700_000_000)).insert(d)
        }
        return id
    }

    private func makeImageData(uti: UTType, lat: Double?, latRef: String?, lng: Double?,
                               lngRef: String?, date: String?) -> Data? {
        let side = 8
        let ctx = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8,
                            bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.setFillColor(CGColor(red: 0.3, green: 0.6, blue: 0.4, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: side, height: side))
        let image = ctx.makeImage()!

        var props: [CFString: Any] = [:]
        if let lat, let lng, let latRef, let lngRef {
            props[kCGImagePropertyGPSDictionary] = [
                kCGImagePropertyGPSLatitude: lat, kCGImagePropertyGPSLatitudeRef: latRef,
                kCGImagePropertyGPSLongitude: lng, kCGImagePropertyGPSLongitudeRef: lngRef,
            ] as [CFString: Any]
        }
        if let date {
            props[kCGImagePropertyExifDictionary] = [kCGImagePropertyExifDateTimeOriginal: date] as [CFString: Any]
        }

        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, uti.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, props as CFDictionary)
        guard CGImageDestinationFinalize(dest), out.length > 0 else { return nil }
        return out as Data
    }
}
