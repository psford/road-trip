import XCTest
import GRDB
@testable import RoadTrip

/// Phase 2 storage-layer tests: schema migration, record round-trips + cascade,
/// Keychain round-trip, and file-cache LRU eviction.
final class StorageTests: XCTestCase {

    // Whole-second dates round-trip exactly through GRDB's millisecond datetime format,
    // so full-struct equality is stable.
    private let fixedDate = Date(timeIntervalSince1970: 1_700_000_000)

    private func makeTrip(id: UUID = UUID(), slug: String? = "test-trip") -> Trip {
        Trip(id: id, name: "Test Trip", description: "desc", slug: slug,
             photoCount: 0, createdAt: fixedDate, cachedAt: fixedDate)
    }

    // MARK: - Migration

    func testMigrationCreatesSchema() throws {
        let appDB = try AppDatabase.makeInMemory()
        try appDB.dbQueue.read { db in
            XCTAssertTrue(try db.tableExists("trip"))
            XCTAssertTrue(try db.tableExists("photo"))
            XCTAssertTrue(try db.tableExists("uploadQueueItem"))
        }
    }

    // MARK: - Record round-trip

    func testTripRoundTrip() throws {
        let appDB = try AppDatabase.makeInMemory()
        let trip = makeTrip()
        try appDB.dbQueue.write { db in try trip.insert(db) }
        let fetched = try appDB.dbQueue.read { db in try Trip.fetchOne(db, key: trip.id) }
        XCTAssertEqual(fetched, trip)
    }

    func testImportedTripHasNilSlug() throws {
        let appDB = try AppDatabase.makeInMemory()
        let trip = makeTrip(slug: nil)
        try appDB.dbQueue.write { db in try trip.insert(db) }
        let fetched = try appDB.dbQueue.read { db in try Trip.fetchOne(db, key: trip.id) }
        XCTAssertNil(fetched?.slug)
    }

    // MARK: - Cascade delete (also exercises Photo + UploadQueueItem insert,
    // JSON blockIds, and the stage enum)

    func testDeleteTripCascadesPhotosAndQueueItems() throws {
        let appDB = try AppDatabase.makeInMemory()
        let trip = makeTrip()
        let photo = Photo(id: 1, tripId: trip.id, thumbnailUrl: "t", displayUrl: "d",
                          originalUrl: "o", lat: 47.6, lng: -122.3, placeName: "Seattle",
                          caption: nil, takenAt: fixedDate, uploadId: nil)
        let item = UploadQueueItem(
            uploadId: UUID(), tripId: trip.id, localFilePath: "/tmp/x.jpg",
            filename: "x.jpg", contentType: "image/jpeg", sizeBytes: 1234,
            exifLat: 47.6, exifLon: -122.3, takenAt: fixedDate,
            stage: .uploadingOriginal, bytesUploaded: 0, blockIds: ["AAAA", "BBBB"],
            sasUrl: nil, displaySasUrl: nil, thumbSasUrl: nil, blobPath: nil,
            sasIssuedAt: nil, errorMessage: nil, createdAt: fixedDate, updatedAt: fixedDate)

        try appDB.dbQueue.write { db in
            try trip.insert(db)
            try photo.insert(db)
            try item.insert(db)
        }

        // Confirm the queue item round-trips its JSON array + enum.
        let fetchedItem = try appDB.dbQueue.read { db in try UploadQueueItem.fetchOne(db, key: item.uploadId) }
        XCTAssertEqual(fetchedItem?.blockIds, ["AAAA", "BBBB"])
        XCTAssertEqual(fetchedItem?.stage, .uploadingOriginal)

        try appDB.dbQueue.write { db in _ = try trip.delete(db) }

        try appDB.dbQueue.read { db in
            XCTAssertEqual(try Photo.fetchCount(db), 0, "photos should cascade-delete with the trip")
            XCTAssertEqual(try UploadQueueItem.fetchCount(db), 0, "queue items should cascade-delete with the trip")
        }
    }

    // MARK: - Delete trip local cleanup (AC1.4)

    func testDeleteLocallyRemovesTripPhotosAndToken() async throws {
        let appDB = try AppDatabase.makeInMemory()
        let keychain = KeychainStore(service: "com.psford.roadtripmap.native.tests.\(UUID().uuidString)")
        let trip = makeTrip()
        let photo = Photo(id: 1, tripId: trip.id, thumbnailUrl: "t", displayUrl: "d",
                          originalUrl: "o", lat: 47.6, lng: -122.3, placeName: "Seattle",
                          caption: nil, takenAt: fixedDate, uploadId: nil)
        try await appDB.dbQueue.write { db in
            try trip.insert(db)
            try photo.insert(db)
        }
        try keychain.setToken(UUID(), kind: .secret, tripId: trip.id)
        try keychain.setToken(UUID(), kind: .view, tripId: trip.id)

        try await RoadTripAPI.deleteLocally(tripId: trip.id, from: appDB, keychain: keychain)

        try await appDB.dbQueue.read { db in
            XCTAssertEqual(try Trip.fetchCount(db), 0, "trip row removed")
            XCTAssertEqual(try Photo.fetchCount(db), 0, "photos cascade-delete with the trip")
        }
        XCTAssertNil(try keychain.token(kind: .secret, tripId: trip.id), "secret token removed")
        XCTAssertNil(try keychain.token(kind: .view, tripId: trip.id), "view token removed")
    }

    // MARK: - Keychain

    func testKeychainRoundTrip() throws {
        // Unique service per run so we never collide with or pollute other items.
        let store = KeychainStore(service: "com.psford.roadtripmap.native.tests.\(UUID().uuidString)")
        let tripId = UUID()
        let secret = UUID()
        let view = UUID()

        XCTAssertNil(try store.token(kind: .secret, tripId: tripId))

        try store.setToken(secret, kind: .secret, tripId: tripId)
        try store.setToken(view, kind: .view, tripId: tripId)
        XCTAssertEqual(try store.token(kind: .secret, tripId: tripId), secret)
        XCTAssertEqual(try store.token(kind: .view, tripId: tripId), view)

        // Overwrite (upsert) the secret.
        let secret2 = UUID()
        try store.setToken(secret2, kind: .secret, tripId: tripId)
        XCTAssertEqual(try store.token(kind: .secret, tripId: tripId), secret2)

        try store.removeAll(tripId: tripId)
        XCTAssertNil(try store.token(kind: .secret, tripId: tripId))
        XCTAssertNil(try store.token(kind: .view, tripId: tripId))
    }

    // MARK: - File cache LRU

    func testFileCacheEvictsLeastRecentlyUsed() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        // Capacity fits two 100-byte files but not three.
        let cache = try PhotoFileCache(rootURL: root, capacityBytes: 250)
        defer { try? fm.removeItem(at: root) }

        let tripId = UUID()
        let blob = Data(repeating: 0, count: 100)

        try cache.store(blob, tripId: tripId, photoId: 1, tier: .thumb)
        try cache.store(blob, tripId: tripId, photoId: 2, tier: .thumb)

        // Make photo 1 the oldest, photo 2 newer (deterministic LRU order).
        try fm.setAttributes([.modificationDate: Date(timeIntervalSince1970: 1000)],
                             ofItemAtPath: cache.fileURL(tripId: tripId, photoId: 1, tier: .thumb).path)
        try fm.setAttributes([.modificationDate: Date(timeIntervalSince1970: 2000)],
                             ofItemAtPath: cache.fileURL(tripId: tripId, photoId: 2, tier: .thumb).path)

        // Third store pushes total to 300 > 250 and triggers eviction of the oldest.
        try cache.store(blob, tripId: tripId, photoId: 3, tier: .thumb)

        XCTAssertFalse(cache.contains(tripId: tripId, photoId: 1, tier: .thumb), "oldest should be evicted")
        XCTAssertTrue(cache.contains(tripId: tripId, photoId: 2, tier: .thumb))
        XCTAssertTrue(cache.contains(tripId: tripId, photoId: 3, tier: .thumb))
    }

    func testFileCacheRoundTripAndRemoveAll() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let cache = try PhotoFileCache(rootURL: root)
        defer { try? fm.removeItem(at: root) }

        let tripId = UUID()
        let bytes = Data("jpeg-bytes".utf8)
        try cache.store(bytes, tripId: tripId, photoId: 7, tier: .display)

        XCTAssertTrue(cache.contains(tripId: tripId, photoId: 7, tier: .display))
        XCTAssertEqual(cache.data(tripId: tripId, photoId: 7, tier: .display), bytes)

        try cache.removeAll(tripId: tripId)
        XCTAssertFalse(cache.contains(tripId: tripId, photoId: 7, tier: .display))
    }
}
