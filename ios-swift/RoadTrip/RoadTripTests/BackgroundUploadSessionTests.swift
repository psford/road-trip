import XCTest
import GRDB
@testable import RoadTrip

/// Slice B.2: background-uploader behavior that needs no network. Aborting a stuck/failed
/// upload must remove the queue row, the staged source file, AND any sliced block files.
final class BackgroundUploadSessionTests: XCTestCase {

    func testAbortRemovesQueueRowStagedFileAndBlockFiles() async throws {
        let db = try AppDatabase.makeInMemory()
        let keychain = KeychainStore(service: "com.psford.roadtripmap.native.tests.abort.\(UUID().uuidString)")

        let tripId = UUID()
        try await db.dbQueue.write { d in
            try Trip(id: tripId, name: "T", description: nil, slug: nil, photoCount: 0,
                     createdAt: Date(timeIntervalSince1970: 1), cachedAt: Date(timeIntervalSince1970: 1)).insert(d)
        }

        // Staged original + a failed queue item pointing at it.
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let stagedURL = dir.appendingPathComponent("staged.jpg")
        try Data("jpeg".utf8).write(to: stagedURL)

        let uploadId = UUID()
        try await db.dbQueue.write { d in
            try UploadQueueItem(
                uploadId: uploadId, tripId: tripId, localFilePath: stagedURL.path,
                filename: "IMG.jpg", contentType: "image/jpeg", sizeBytes: 4,
                exifLat: 1, exifLon: 2, takenAt: nil, stage: .failed, bytesUploaded: 0, blockIds: [],
                blockSizeBytes: 4, serverPhotoId: "p", completedBlockIndices: [],
                sasUrl: nil, displaySasUrl: nil, thumbSasUrl: nil, blobPath: nil, sasIssuedAt: nil,
                errorMessage: "Upload failed", createdAt: Date(timeIntervalSince1970: 1),
                updatedAt: Date(timeIntervalSince1970: 1)).insert(d)
        }

        // A leftover block file for this upload, under an isolated writer base dir.
        let blockBase = dir.appendingPathComponent("blocks", isDirectory: true)
        let writer = UploadBlockFileWriter(baseDirectory: blockBase)
        let blockDir = writer.directory(for: uploadId)
        try FileManager.default.createDirectory(at: blockDir, withIntermediateDirectories: true)
        try Data("block".utf8).write(to: blockDir.appendingPathComponent("block-0.bin"))

        let session = BackgroundUploadSession(database: db, keychain: keychain,
                                              configuration: .ephemeral, fileWriter: writer)
        session.abort(uploadId)

        // abort() is fire-and-forget — wait for the queue row to disappear.
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline {
            let count = try await db.dbQueue.read { try UploadQueueItem.fetchCount($0) }
            if count == 0 { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }

        let finalCount = try await db.dbQueue.read { try UploadQueueItem.fetchCount($0) }
        XCTAssertEqual(finalCount, 0, "queue row removed")
        XCTAssertFalse(FileManager.default.fileExists(atPath: stagedURL.path), "staged source file removed")
        XCTAssertFalse(FileManager.default.fileExists(atPath: blockDir.path), "block files removed")
        withExtendedLifetime(session) {}
    }
}
