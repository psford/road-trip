import XCTest
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers
import GRDB
@testable import RoadTrip

/// Phase 6 Slice A end-to-end against the LIVE local backend (:5100 + Azurite). Exercises
/// the whole resilient-upload protocol — request-upload → block PUTs → commit — minus the
/// system PhotosPicker (verified manually). Skips if the backend isn't running.
final class UploadIntegrationTests: XCTestCase {

    func testStagedPhotoUploadsAndComesBackAsACommittedPhoto() async throws {
        let api = RoadTripAPI.shared
        let db = try AppDatabase.makeInMemory()
        let keychain = KeychainStore(service: "com.psford.roadtripmap.native.tests.upload.\(UUID().uuidString)")

        // Create a real trip (skips the whole test if the backend is down).
        let trip: Trip
        do {
            trip = try await api.createTrip(name: "Upload IT", description: nil, into: db, keychain: keychain)
        } catch {
            throw XCTSkip("Local backend not reachable on :5100 — skipping integration test (\(error))")
        }
        defer { Task { try? await api.deleteTrip(trip, from: db, keychain: keychain) } }

        // Stage a JPEG with GPS, then upload it end-to-end.
        let lat = 37.7749, lng = -122.4194
        let jpeg = makeJPEGWithGPS(lat: lat, lng: lng)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let staged = try await PhotoCaptureCoordinator(database: db, stagingDirectory: dir)
            .stagePhoto(imageData: jpeg, filename: "IMG_IT.jpg", tripId: trip.id)

        try await UploadCoordinator(database: db, keychain: keychain).upload(staged)

        // The queue item is consumed and a committed Photo row now exists for the trip.
        let queueCount = try await db.dbQueue.read { try UploadQueueItem.fetchCount($0) }
        XCTAssertEqual(queueCount, 0, "staged item should be removed after a successful commit")

        let photos = try await db.dbQueue.read { db in
            try Photo.filter(Column("tripId") == trip.id).fetchAll(db)
        }
        XCTAssertEqual(photos.count, 1, "committed photo should hydrate into the local cache (AC3.6)")
        if let photo = photos.first {
            XCTAssertEqual(photo.lat, lat, accuracy: 0.01, "server should keep the EXIF latitude")
            XCTAssertEqual(photo.lng, lng, accuracy: 0.01, "server should keep the EXIF longitude")
        }
    }

    /// Phase 7 (AC4.1/4.3): upload a photo, then move its pin and delete it, asserting both
    /// the local cache and the server agree at each step.
    func testMoveThenDeletePhotoAgainstLiveBackend() async throws {
        let api = RoadTripAPI.shared
        let db = try AppDatabase.makeInMemory()
        let keychain = KeychainStore(service: "com.psford.roadtripmap.native.tests.mutate.\(UUID().uuidString)")

        let trip: Trip
        do {
            trip = try await api.createTrip(name: "Mutation IT", description: nil, into: db, keychain: keychain)
        } catch {
            throw XCTSkip("Local backend not reachable on :5100 — skipping (\(error))")
        }
        defer { Task { try? await api.deleteTrip(trip, from: db, keychain: keychain) } }
        let token = try XCTUnwrap(try keychain.token(kind: .secret, tripId: trip.id)).uuidString.lowercased()

        // Upload one photo and grab the committed Photo row.
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let staged = try await PhotoCaptureCoordinator(database: db, stagingDirectory: dir)
            .stagePhoto(imageData: makeJPEGWithGPS(lat: 37.7749, lng: -122.4194), filename: "IMG.jpg", tripId: trip.id)
        try await UploadCoordinator(database: db, keychain: keychain).upload(staged)
        let committed = try await db.dbQueue.read { db in
            try Photo.filter(Column("tripId") == trip.id).fetchAll(db)
        }
        let photo = try XCTUnwrap(committed.first)

        let mutations = PhotoMutations(database: db, keychain: keychain)

        // Move the pin → local + server reflect the new coordinate.
        try await mutations.moveLocation(photo, lat: 40.0, lng: -105.0)
        let moved = try await db.dbQueue.read { db in try Photo.fetchOne(db, key: photo.id) }
        XCTAssertEqual(moved?.lat ?? .nan, 40.0, accuracy: 0.05)
        let afterMove = try await api.photosForPost(secretToken: token)
        XCTAssertEqual(afterMove.first?.lat ?? .nan, 40.0, accuracy: 0.05, "server kept the moved coordinate")

        // Delete → gone locally and on the server.
        try await mutations.deletePhoto(try XCTUnwrap(moved))
        let localCount = try await db.dbQueue.read { db in try Photo.fetchCount(db) }
        XCTAssertEqual(localCount, 0)
        let afterDelete = try await api.photosForPost(secretToken: token)
        XCTAssertTrue(afterDelete.isEmpty, "server deleted the photo")
    }

    // MARK: - Helper

    private func makeJPEGWithGPS(lat: Double, lng: Double) -> Data {
        let side = 16
        let ctx = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8,
                            bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.setFillColor(CGColor(red: 0.4, green: 0.6, blue: 0.9, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: side, height: side))
        let image = ctx.makeImage()!

        let props: [CFString: Any] = [
            kCGImagePropertyGPSDictionary: [
                kCGImagePropertyGPSLatitude: abs(lat),
                kCGImagePropertyGPSLatitudeRef: lat >= 0 ? "N" : "S",
                kCGImagePropertyGPSLongitude: abs(lng),
                kCGImagePropertyGPSLongitudeRef: lng >= 0 ? "E" : "W",
            ] as [CFString: Any],
            kCGImagePropertyExifDictionary: [
                kCGImagePropertyExifDateTimeOriginal: "2024:07:15 13:45:30"
            ] as [CFString: Any],
        ]

        let out = NSMutableData()
        let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(dest, image, props as CFDictionary)
        CGImageDestinationFinalize(dest)
        return out as Data
    }
}
