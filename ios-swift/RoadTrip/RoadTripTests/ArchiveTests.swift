import XCTest
import GRDB
@testable import RoadTrip

/// Phase 3 archive-layer tests: restore filter flip and permanent-delete local/Keychain cleanup.
final class ArchiveTests: XCTestCase {

    private let fixedDate = Date(timeIntervalSince1970: 1_700_000_000)

    private func makeTrip(id: UUID = UUID(), slug: String? = "test-trip") -> Trip {
        Trip(id: id, name: "Test Trip", description: "desc", slug: slug,
             photoCount: 0, createdAt: fixedDate, cachedAt: fixedDate)
    }

    // MARK: - Restore (AC2.3)

    /// Verifies that restoring an archived trip (setting archivedAt = nil) flips its
    /// visibility: it reappears in the active filter and disappears from the archived filter.
    func testRestoreArchivedTripFlipsFilters() async throws {
        let appDB = try AppDatabase.makeInMemory()
        let trip = makeTrip()

        // Insert a fresh trip (archivedAt = nil, in active list).
        try await appDB.dbQueue.write { db in
            try trip.insert(db)
        }

        // Verify initial state: trip is in active filter (archivedAt == nil).
        var activeTrips = try await appDB.dbQueue.read { db in
            try Trip.filter(Column("archivedAt") == nil)
                .order(Column("createdAt").desc)
                .fetchAll(db)
        }
        var archivedTrips = try await appDB.dbQueue.read { db in
            try Trip.filter(Column("archivedAt") != nil)
                .order(Column("createdAt").desc)
                .fetchAll(db)
        }
        XCTAssertEqual(activeTrips.count, 1, "trip should be in active list initially")
        XCTAssertEqual(archivedTrips.count, 0, "trip should not be in archived list initially")

        // Archive the trip (set archivedAt).
        let archiveTime = Date()
        try await appDB.dbQueue.write { db in
            guard var t = try Trip.fetchOne(db, key: trip.id) else {
                XCTFail("trip not found")
                return
            }
            t.archivedAt = archiveTime
            try t.update(db)
        }

        // Verify archived state: trip is in archived filter, not active.
        activeTrips = try await appDB.dbQueue.read { db in
            try Trip.filter(Column("archivedAt") == nil)
                .order(Column("createdAt").desc)
                .fetchAll(db)
        }
        archivedTrips = try await appDB.dbQueue.read { db in
            try Trip.filter(Column("archivedAt") != nil)
                .order(Column("createdAt").desc)
                .fetchAll(db)
        }
        XCTAssertEqual(activeTrips.count, 0, "trip should be removed from active list after archive")
        XCTAssertEqual(archivedTrips.count, 1, "trip should appear in archived list after archive")

        // Restore the trip (set archivedAt = nil).
        try await appDB.dbQueue.write { db in
            guard var t = try Trip.fetchOne(db, key: trip.id) else {
                XCTFail("trip not found during restore")
                return
            }
            t.archivedAt = nil
            try t.update(db)
        }

        // Verify restored state: trip is back in active filter, no longer archived.
        activeTrips = try await appDB.dbQueue.read { db in
            try Trip.filter(Column("archivedAt") == nil)
                .order(Column("createdAt").desc)
                .fetchAll(db)
        }
        archivedTrips = try await appDB.dbQueue.read { db in
            try Trip.filter(Column("archivedAt") != nil)
                .order(Column("createdAt").desc)
                .fetchAll(db)
        }
        XCTAssertEqual(activeTrips.count, 1, "trip should return to active list after restore")
        XCTAssertEqual(activeTrips[0].id, trip.id, "restored trip should be the same trip")
        XCTAssertNil(activeTrips[0].archivedAt, "restored trip should have archivedAt = nil")
        XCTAssertEqual(archivedTrips.count, 0, "trip should be removed from archived list after restore")
    }

    // MARK: - Permanent delete local cleanup (AC2.4)

    /// Verifies that `RoadTripAPI.deleteLocally` removes the trip row (with cascade-deleted
    /// photos) and clears both Keychain tokens. This tests the local-state guarantee of the
    /// permanent-delete operation without requiring a live backend.
    ///
    /// Note: The server-DELETE half of `deleteTrip(_:from:keychain:)` (line 431-442) requires
    /// a live backend and is covered by the human/device test plan for AC2.4 (UploadIntegrationTests).
    func testDeleteLocallyRemovesTripPhotosAndTokens() async throws {
        let appDB = try AppDatabase.makeInMemory()
        let keychain = KeychainStore(service: "com.psford.roadtripmap.native.tests.\(UUID().uuidString)")

        let trip = makeTrip()
        let photo = Photo(
            id: 1, tripId: trip.id, thumbnailUrl: "https://example.com/t",
            displayUrl: "https://example.com/d", originalUrl: "https://example.com/o",
            lat: 47.6, lng: -122.3, placeName: "Seattle",
            caption: nil, takenAt: fixedDate, uploadId: nil
        )

        // Insert trip + photo + tokens.
        try await appDB.dbQueue.write { db in
            try trip.insert(db)
            try photo.insert(db)
        }
        let secretToken = UUID()
        let viewToken = UUID()
        try keychain.setToken(secretToken, kind: .secret, tripId: trip.id)
        try keychain.setToken(viewToken, kind: .view, tripId: trip.id)

        // Verify setup: trip, photo, and tokens exist.
        var tripCount = try await appDB.dbQueue.read { db in try Trip.fetchCount(db) }
        var photoCount = try await appDB.dbQueue.read { db in try Photo.fetchCount(db) }
        var secretStored = try keychain.token(kind: .secret, tripId: trip.id)
        var viewStored = try keychain.token(kind: .view, tripId: trip.id)

        XCTAssertEqual(tripCount, 1, "trip should be inserted")
        XCTAssertEqual(photoCount, 1, "photo should be inserted")
        XCTAssertEqual(secretStored, secretToken, "secret token should be stored")
        XCTAssertEqual(viewStored, viewToken, "view token should be stored")

        // Execute the local-cleanup half: deleteLocally.
        try await RoadTripAPI.deleteLocally(tripId: trip.id, from: appDB, keychain: keychain)

        // Verify cleanup: trip and photo are gone, tokens are cleared.
        tripCount = try await appDB.dbQueue.read { db in try Trip.fetchCount(db) }
        photoCount = try await appDB.dbQueue.read { db in try Photo.fetchCount(db) }
        secretStored = try keychain.token(kind: .secret, tripId: trip.id)
        viewStored = try keychain.token(kind: .view, tripId: trip.id)

        XCTAssertEqual(tripCount, 0, "trip row should be removed")
        XCTAssertEqual(photoCount, 0, "photos should cascade-delete with the trip")
        XCTAssertNil(secretStored, "secret token should be cleared")
        XCTAssertNil(viewStored, "view token should be cleared")
    }
}
