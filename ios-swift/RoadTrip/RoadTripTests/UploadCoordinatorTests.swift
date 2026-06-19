import XCTest
import GRDB
@testable import RoadTrip

/// Phase 6: queue housekeeping that doesn't need a network — aborting a stuck upload must
/// remove both the queue row and its staged source file.
final class UploadCoordinatorTests: XCTestCase {

    func testAbortRemovesQueueItemAndStagedFile() async throws {
        let db = try AppDatabase.makeInMemory()
        let keychain = KeychainStore(service: "com.psford.roadtripmap.native.tests.abort.\(UUID().uuidString)")

        let tripId = UUID()
        try await db.dbQueue.write { d in
            try Trip(id: tripId, name: "T", description: nil, slug: nil, photoCount: 0,
                     createdAt: Date(timeIntervalSince1970: 1), cachedAt: Date(timeIntervalSince1970: 1)).insert(d)
        }

        // A staged file on disk + a failed queue item pointing at it.
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let fileURL = dir.appendingPathComponent("staged.jpg")
        try Data("jpeg".utf8).write(to: fileURL)
        defer { try? FileManager.default.removeItem(at: dir) }

        let item = UploadQueueItem(
            uploadId: UUID(), tripId: tripId, localFilePath: fileURL.path,
            filename: "IMG.jpg", contentType: "image/jpeg", sizeBytes: 4,
            exifLat: 1, exifLon: 2, takenAt: nil, stage: .failed, bytesUploaded: 0, blockIds: [],
            sasUrl: nil, displaySasUrl: nil, thumbSasUrl: nil, blobPath: nil, sasIssuedAt: nil,
            errorMessage: "Upload failed", createdAt: Date(timeIntervalSince1970: 1), updatedAt: Date(timeIntervalSince1970: 1))
        try await db.dbQueue.write { d in try item.insert(d) }

        await UploadCoordinator(database: db, keychain: keychain).abort(item)

        let count = try await db.dbQueue.read { try UploadQueueItem.fetchCount($0) }
        XCTAssertEqual(count, 0, "queue row removed")
        XCTAssertFalse(FileManager.default.fileExists(atPath: fileURL.path), "staged source file removed")
    }
}
