import XCTest
import ImageIO
import CoreGraphics
import CoreLocation
import UIKit
import SwiftUI
import UniformTypeIdentifiers
import Photos
import PhotosUI
@testable import RoadTrip

// MARK: - Fakes for PhotoAssetLoading (Mitigation 3a)

/// Simulates a picker that was NOT bound to photoLibrary:.shared() — itemIdentifier is nil.
private struct NilIdentifierLoader: PhotoAssetLoading {
    func itemIdentifier(for item: PhotosPickerItem) -> String? { nil }
    func fetchAsset(localIdentifier: String) -> PHAsset? { nil }
    func loadImageData(forIdentifier localIdentifier: String) async throws -> (Data, String) {
        throw PhotoCaptureCoordinator.CaptureError.noAsset
    }
}

/// Simulates the limited-selection case: identifier is present but PHAsset lookup returns nil.
private struct LimitedSelectionLoader: PhotoAssetLoading {
    func itemIdentifier(for item: PhotosPickerItem) -> String? { "fake-id" }
    func fetchAsset(localIdentifier: String) -> PHAsset? { nil }
    func loadImageData(forIdentifier localIdentifier: String) async throws -> (Data, String) {
        // Matches what SystemPhotoAssetLoader does when fetchAsset returns nil.
        throw PhotoCaptureCoordinator.CaptureError.noAsset
    }
}

/// Simulates PHImageManager returning no data (e.g. iCloud photo not yet downloaded).
private struct NoDataLoader: PhotoAssetLoading {
    func itemIdentifier(for item: PhotosPickerItem) -> String? { "fake-id" }
    func fetchAsset(localIdentifier: String) -> PHAsset? { nil }
    func loadImageData(forIdentifier localIdentifier: String) async throws -> (Data, String) {
        throw PhotoCaptureCoordinator.CaptureError.dataUnavailable
    }
}

/// Simulates a successful asset resolution — returns canned bytes and filename.
private struct SuccessLoader: PhotoAssetLoading {
    let data: Data
    let filename: String
    func itemIdentifier(for item: PhotosPickerItem) -> String? { "fake-id" }
    func fetchAsset(localIdentifier: String) -> PHAsset? { nil }
    func loadImageData(forIdentifier localIdentifier: String) async throws -> (Data, String) {
        return (data, filename)
    }
}

// MARK: - Tests

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

    func testNormalizeBakesNonUprightOrientationUpright() {
        // A JPEG tagged with EXIF orientation 6 (rotate 90°) — what a sideways camera shot
        // produces. The server's resize ignores the tag, so we must bake it in client-side.
        let rotated = makeOrientedJPEG(width: 8, height: 16, orientation: .right)
        XCTAssertNotEqual(UIImage(data: rotated)?.imageOrientation, .up, "fixture should be rotated")

        let (out, contentType, _) = PhotoCaptureCoordinator.normalizedImage(rotated, filename: "IMG.JPG")

        XCTAssertEqual(contentType, "image/jpeg")
        XCTAssertEqual(UIImage(data: out)?.imageOrientation, .up,
                       "orientation must be baked into upright pixels before upload")
    }

    func testNormalizeUprightJPEGStaysUpright() {
        let upright = makeOrientedJPEG(width: 16, height: 8, orientation: .up)
        let (out, _, _) = PhotoCaptureCoordinator.normalizedImage(upright, filename: "IMG.JPG")
        XCTAssertEqual(UIImage(data: out)?.imageOrientation, .up)
    }

    private func makeOrientedJPEG(width: Int, height: Int, orientation: CGImagePropertyOrientation) -> Data {
        let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                            bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.setFillColor(CGColor(red: 0.3, green: 0.6, blue: 0.4, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let image = ctx.makeImage()!
        let out = NSMutableData()
        let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(dest, image, [kCGImagePropertyOrientation: orientation.rawValue] as CFDictionary)
        CGImageDestinationFinalize(dest)
        return out as Data
    }

    // MARK: - Helpers

    // MARK: - PhotoAssetLoading protocol seam tests (Mitigation 3a)
    //
    // PhotosPickerItem and PHAsset cannot be constructed in unit tests (no public initialiser).
    // The stageUsingLoader(identifier:tripId:) entry point (#if DEBUG) drives the pipeline
    // from the identifier step so every branch can be exercised with fakes.

    func testNilIdentifierThrowsNoAsset() async throws {
        let (db, _, dir) = try makeCoordinator()
        defer { try? FileManager.default.removeItem(at: dir) }
        let tripId = try await seedTrip(db)
        let coordinator = makeCoordinatorWithLoader(db: db, dir: dir, loader: NilIdentifierLoader())

        do {
            _ = try await coordinator.stageUsingLoader(identifier: nil, tripId: tripId)
            XCTFail("expected CaptureError.noAsset")
        } catch PhotoCaptureCoordinator.CaptureError.noAsset {
            // expected
        }
    }

    func testLimitedSelectionThrowsNoAsset() async throws {
        let (db, _, dir) = try makeCoordinator()
        defer { try? FileManager.default.removeItem(at: dir) }
        let tripId = try await seedTrip(db)
        let coordinator = makeCoordinatorWithLoader(db: db, dir: dir, loader: LimitedSelectionLoader())

        do {
            // LimitedSelectionLoader.loadImageData throws .noAsset to simulate fetchAsset→nil
            _ = try await coordinator.stageUsingLoader(identifier: "fake-id", tripId: tripId)
            XCTFail("expected CaptureError.noAsset")
        } catch PhotoCaptureCoordinator.CaptureError.noAsset {
            // expected
        }
    }

    func testDataUnavailableThrowsDataUnavailable() async throws {
        let (db, _, dir) = try makeCoordinator()
        defer { try? FileManager.default.removeItem(at: dir) }
        let tripId = try await seedTrip(db)
        let coordinator = makeCoordinatorWithLoader(db: db, dir: dir, loader: NoDataLoader())

        do {
            _ = try await coordinator.stageUsingLoader(identifier: "fake-id", tripId: tripId)
            XCTFail("expected CaptureError.dataUnavailable")
        } catch PhotoCaptureCoordinator.CaptureError.dataUnavailable {
            // expected
        }
    }

    func testSuccessLoaderStagesPhoto() async throws {
        let (db, _, dir) = try makeCoordinator()
        defer { try? FileManager.default.removeItem(at: dir) }
        let tripId = try await seedTrip(db)

        // Use a JPEG with GPS so we can verify the EXIF round-trip via the success path.
        let jpeg = makeImageData(uti: .jpeg, lat: 51.5074, latRef: "N",
                                 lng: 0.1278, lngRef: "W", date: nil)!
        let loader = SuccessLoader(data: jpeg, filename: "IMG_success.jpg")
        let coordinator = makeCoordinatorWithLoader(db: db, dir: dir, loader: loader)

        let item = try await coordinator.stageUsingLoader(identifier: "fake-id", tripId: tripId)
        XCTAssertEqual(item.stage, .staged)
        XCTAssertEqual(item.exifLat ?? .nan, 51.5074, accuracy: 0.0001)
        XCTAssertEqual(item.exifLon ?? .nan, -0.1278, accuracy: 0.0001)

        let count = try await db.dbQueue.read { try UploadQueueItem.fetchCount($0) }
        XCTAssertEqual(count, 1)
    }

    private func makeCoordinator() throws -> (AppDatabase, PhotoCaptureCoordinator, URL) {
        let db = try AppDatabase.makeInMemory()
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        return (db, PhotoCaptureCoordinator(database: db, stagingDirectory: dir), dir)
    }

    private func makeCoordinatorWithLoader(db: AppDatabase, dir: URL, loader: any PhotoAssetLoading) -> PhotoCaptureCoordinator {
        PhotoCaptureCoordinator(database: db, stagingDirectory: dir, assetLoader: loader)
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
