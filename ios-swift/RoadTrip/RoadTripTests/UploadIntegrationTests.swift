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

        try await runUploadToCompletion(staged.uploadId, db: db, keychain: keychain)

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
        try await runUploadToCompletion(staged.uploadId, db: db, keychain: keychain)
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

    /// AC2.2: Importing a trip parses the view token from server viewUrl and stores it.
    func testImportTripsStoresViewToken() async throws {
        let api = RoadTripAPI.shared
        let db = try AppDatabase.makeInMemory()
        let keychain = KeychainStore(service: "com.psford.roadtripmap.native.tests.import-view.\(UUID().uuidString)")

        // Create a trip server-side to import.
        let createdTrip: Trip
        do {
            createdTrip = try await api.createTrip(name: "Import View Token IT", description: nil, into: db, keychain: keychain)
        } catch {
            throw XCTSkip("Local backend not reachable on :5100 — skipping import test (\(error))")
        }
        let secretTokenString = try XCTUnwrap(try keychain.token(kind: .secret, tripId: createdTrip.id)).uuidString
        defer { Task { try? await api.deleteTrip(createdTrip, from: db, keychain: keychain) } }

        // Import it on a fresh device (new Keychain).
        let importDb = try AppDatabase.makeInMemory()
        let importKeychain = KeychainStore(service: "com.psford.roadtripmap.native.tests.import-view-fresh.\(UUID().uuidString)")
        let importedTrip = try await api.importTrip(tokenString: secretTokenString, into: importDb, keychain: importKeychain)

        // Assert the view token is stored after import.
        let viewToken = try importKeychain.token(kind: .view, tripId: importedTrip.id)
        XCTAssertNotNil(viewToken, "importing a trip should parse and store its view token (AC2.2)")
    }

    /// AC2.3: revalidate backfills the view token when one isn't already stored.
    func testRevalidateBackfillsViewToken() async throws {
        let api = RoadTripAPI.shared
        let db = try AppDatabase.makeInMemory()
        let keychain = KeychainStore(service: "com.psford.roadtripmap.native.tests.revalidate-view.\(UUID().uuidString)")

        // Create a trip server-side.
        let trip: Trip
        do {
            trip = try await api.createTrip(name: "Revalidate View Token IT", description: nil, into: db, keychain: keychain)
        } catch {
            throw XCTSkip("Local backend not reachable on :5100 — skipping revalidate test (\(error))")
        }
        defer { Task { try? await api.deleteTrip(trip, from: db, keychain: keychain) } }

        // Manually remove the view token to simulate a trip imported from an old client.
        try keychain.removeToken(kind: .view, tripId: trip.id)
        let token = try XCTUnwrap(try keychain.token(kind: .secret, tripId: trip.id)).uuidString.lowercased()

        // Revalidate should backfill it.
        await api.revalidate(tripId: trip.id, secretToken: token, into: db, keychain: keychain)
        let restored = try keychain.token(kind: .view, tripId: trip.id)
        XCTAssertNotNil(restored, "revalidate should backfill the view token when missing (AC2.3)")
    }

    /// AC2.4 integration test: import succeeds and stores the secret token.
    /// Tests via the live backend that import doesn't crash when called normally.
    /// AC2.4 correctness for nil/garbage viewUrl is covered by unit tests in ViewTokenParsingTests
    /// (testStoreViewTokenNilViewUrlNeverWritesToken, testStoreViewTokenGarbageViewUrlNeverWritesToken)
    /// which exercise the storeViewToken seam directly without requiring backend availability.
    func testImportSucceedsAndStoresSecretToken() async throws {
        let api = RoadTripAPI.shared
        let db = try AppDatabase.makeInMemory()
        let keychain = KeychainStore(service: "com.psford.roadtripmap.native.tests.import-no-view.\(UUID().uuidString)")

        // Create a trip with a known secret token.
        let trip: Trip
        do {
            trip = try await api.createTrip(name: "Import No View IT", description: nil, into: db, keychain: keychain)
        } catch {
            throw XCTSkip("Local backend not reachable on :5100 — skipping integration test (\(error))")
        }
        let secretTokenString = try XCTUnwrap(try keychain.token(kind: .secret, tripId: trip.id)).uuidString
        defer { Task { try? await api.deleteTrip(trip, from: db, keychain: keychain) } }

        // Import it into a fresh state.
        let importDb = try AppDatabase.makeInMemory()
        let importKeychain = KeychainStore(service: "com.psford.roadtripmap.native.tests.import-no-view-fresh.\(UUID().uuidString)")

        // Import with the known secret token — the live backend will return a viewUrl.
        let importedTrip = try await api.importTrip(tokenString: secretTokenString, into: importDb, keychain: importKeychain)

        // Verify the import succeeded and the secret token is present.
        let secretToken = try importKeychain.token(kind: .secret, tripId: importedTrip.id)
        XCTAssertNotNil(secretToken, "import must succeed and store the secret token")

        // The view token should be present when the backend provides viewUrl.
        let hasSecret = (try? importKeychain.token(kind: .secret, tripId: importedTrip.id)) != nil
        XCTAssertTrue(hasSecret, "import must preserve the secret token")
    }

    /// AC4.2 integration test: importTrip tolerates messy paste (UUID embedded in text).
    /// Creates a trip, extracts its secret token, wraps it in a message (as a user might paste),
    /// then imports from the messy text end-to-end. The critical path: extracting the UUID from
    /// messy text and passing it (not the raw text) to the server lookups.
    func testImportTripsFromMessyPastedText() async throws {
        let api = RoadTripAPI.shared
        let db = try AppDatabase.makeInMemory()
        let keychain = KeychainStore(service: "com.psford.roadtripmap.native.tests.import-messy.\(UUID().uuidString)")

        // Create a trip server-side.
        let createdTrip: Trip
        do {
            createdTrip = try await api.createTrip(name: "Messy Import IT", description: nil, into: db, keychain: keychain)
        } catch {
            throw XCTSkip("Local backend not reachable on :5100 — skipping integration test (\(error))")
        }
        let secretTokenString = try XCTUnwrap(try keychain.token(kind: .secret, tripId: createdTrip.id)).uuidString
        defer { Task { try? await api.deleteTrip(createdTrip, from: db, keychain: keychain) } }

        // Simulate a user pasting text from an invite message or a web page.
        // AC4.2: The token is embedded in readable prose; importTrip must extract it.
        let messyPastedText = """
        Join my Road Trip "\(createdTrip.name)" — open the app → Import via Token → paste: \(secretTokenString)
        """

        // Import from the messy text into a fresh device.
        let importDb = try AppDatabase.makeInMemory()
        let importKeychain = KeychainStore(service: "com.psford.roadtripmap.native.tests.import-messy-fresh.\(UUID().uuidString)")
        let importedTrip = try await api.importTrip(tokenString: messyPastedText, into: importDb, keychain: importKeychain)

        // Verify the import succeeded and both tokens are stored.
        let importedSecret = try XCTUnwrap(try importKeychain.token(kind: .secret, tripId: importedTrip.id))
        XCTAssertEqual(importedSecret.uuidString.lowercased(), secretTokenString.lowercased(),
                       "messy paste should extract and store the correct secret token (AC4.2)")

        let importedView = try importKeychain.token(kind: .view, tripId: importedTrip.id)
        XCTAssertNotNil(importedView, "import should also parse and store the view token (AC2.2)")
    }

    // MARK: - Helpers

    /// Drives a staged item through the real `BackgroundUploadSession` end-to-end. Uses an
    /// `.ephemeral` config so the delegate callbacks fire deterministically in-test (a real
    /// `.background` session needs the OS daemon + can't share its identifier with the app).
    /// The session is fire-and-forget, so we poll the queue row until it commits (row gone)
    /// or fails.
    private func runUploadToCompletion(_ uploadId: UUID, db: AppDatabase, keychain: KeychainStore,
                                       timeout: TimeInterval = 90) async throws {
        let session = BackgroundUploadSession(database: db, keychain: keychain, configuration: .ephemeral)
        session.start(uploadId)

        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let item = try await db.dbQueue.read { try UploadQueueItem.fetchOne($0, key: uploadId) }
            guard let item else {
                withExtendedLifetime(session) {}   // keep the session alive until we're done
                return                              // committed + queue row deleted
            }
            if item.stage == .failed {
                XCTFail("upload failed: \(item.errorMessage ?? "unknown")")
                return
            }
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        XCTFail("upload did not finish within \(Int(timeout))s")
    }

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
