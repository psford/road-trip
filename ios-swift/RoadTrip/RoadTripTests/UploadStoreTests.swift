import XCTest
import GRDB
@testable import RoadTrip

/// Slice B.2: the GRDB layer behind the background uploader. Progress writes must be
/// idempotent (a block can complete more than once on retry) and the commit claim must have
/// exactly one winner (two final blocks can finish together).
final class UploadStoreTests: XCTestCase {

    private func makeDBWithItem(stage: UploadStage = .uploadingOriginal,
                               completed: [Int] = []) async throws -> (AppDatabase, UploadStore, UUID) {
        let db = try AppDatabase.makeInMemory()
        let tripId = UUID()
        let uploadId = UUID()
        let now = Date(timeIntervalSince1970: 1)
        try await db.dbQueue.write { d in
            try Trip(id: tripId, name: "T", description: nil, slug: nil, photoCount: 0,
                     createdAt: now, cachedAt: now).insert(d)
            try UploadQueueItem(
                uploadId: uploadId, tripId: tripId, localFilePath: "/tmp/x.jpg",
                filename: "x.jpg", contentType: "image/jpeg", sizeBytes: 10,
                exifLat: nil, exifLon: nil, takenAt: nil,
                stage: stage, bytesUploaded: 0, blockIds: [],
                blockSizeBytes: 4, serverPhotoId: "p1", completedBlockIndices: completed,
                sasUrl: "https://host/blob?sig=x", displaySasUrl: nil, thumbSasUrl: nil,
                blobPath: nil, sasIssuedAt: now, errorMessage: nil, createdAt: now, updatedAt: now).insert(d)
        }
        return (db, UploadStore(database: db), uploadId)
    }

    func testMarkBlockCompleteIsIdempotentAndCountsBytes() async throws {
        let (db, store, id) = try await makeDBWithItem()
        try await store.markBlockComplete(id, index: 0, bytes: 4)
        try await store.markBlockComplete(id, index: 0, bytes: 4)   // duplicate (a retry that actually landed twice)
        try await store.markBlockComplete(id, index: 1, bytes: 4)

        let item = try await db.dbQueue.read { try UploadQueueItem.fetchOne($0, key: id) }
        XCTAssertEqual(item?.completedBlockIndices.sorted(), [0, 1], "no duplicate index")
        XCTAssertEqual(item?.bytesUploaded, 8, "duplicate didn't double-count bytes")
    }

    func testClaimCommitHasExactlyOneWinner() async throws {
        let (_, store, id) = try await makeDBWithItem(completed: [0, 1, 2])
        let first = try await store.claimCommit(id)
        let second = try await store.claimCommit(id)
        XCTAssertTrue(first, "first caller claims the commit")
        XCTAssertFalse(second, "second caller is rejected — no double commit")
    }

    func testResetForRetryWipesProgress() async throws {
        let (db, store, id) = try await makeDBWithItem(stage: .failed, completed: [0, 1])
        try await store.setFailed(id, message: "boom")
        try await store.resetForRetry(id)

        let item = try await db.dbQueue.read { try UploadQueueItem.fetchOne($0, key: id) }
        XCTAssertEqual(item?.stage, .staged)
        XCTAssertEqual(item?.completedBlockIndices, [])
        XCTAssertEqual(item?.bytesUploaded, 0)
        XCTAssertNil(item?.errorMessage)
    }

    func testPersistPlanStoresSASPhotoIdAndBlockSize() async throws {
        let (db, store, id) = try await makeDBWithItem(stage: .staged)
        try await store.persistPlan(id, sasUrl: "https://new/sas", photoId: "photo-9", blockSize: 1024)

        let item = try await db.dbQueue.read { try UploadQueueItem.fetchOne($0, key: id) }
        XCTAssertEqual(item?.sasUrl, "https://new/sas")
        XCTAssertEqual(item?.serverPhotoId, "photo-9")
        XCTAssertEqual(item?.blockSizeBytes, 1024)
        XCTAssertEqual(item?.stage, .uploadingOriginal)
        XCTAssertNotNil(item?.sasIssuedAt)
    }
}
