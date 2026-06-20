import XCTest
@testable import RoadTrip

/// Slice B.2: slicing the staged original into per-block files for `uploadTask(with:fromFile:)`.
/// The concatenation of the block files must reproduce the original exactly, with boundaries
/// matching `BlockUpload.chunkRanges`.
final class UploadBlockFileWriterTests: XCTestCase {

    private var tmp: URL!
    private var writer: UploadBlockFileWriter!

    override func setUpWithError() throws {
        tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        writer = UploadBlockFileWriter(baseDirectory: tmp)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tmp)
    }

    private func stagedItem(bytes: Data, blockSize: Int) throws -> UploadQueueItem {
        let fileURL = tmp.appendingPathComponent("original.bin")
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        try bytes.write(to: fileURL)
        let now = Date(timeIntervalSince1970: 1)
        return UploadQueueItem(
            uploadId: UUID(), tripId: UUID(), localFilePath: fileURL.path,
            filename: "o.bin", contentType: "application/octet-stream", sizeBytes: Int64(bytes.count),
            exifLat: nil, exifLon: nil, takenAt: nil, stage: .uploadingOriginal, bytesUploaded: 0, blockIds: [],
            blockSizeBytes: blockSize, serverPhotoId: "p", completedBlockIndices: [],
            sasUrl: "s", displaySasUrl: nil, thumbSasUrl: nil, blobPath: nil, sasIssuedAt: now,
            errorMessage: nil, createdAt: now, updatedAt: now)
    }

    func testPrepareSlicesAllBlocksToFilesThatReconstructTheOriginal() throws {
        let original = Data((0..<10).map { UInt8($0) })   // 0,1,...,9
        let item = try stagedItem(bytes: original, blockSize: 4)   // → 4,4,2

        let blocks = try writer.prepare(item: item, indices: [0, 1, 2])
        XCTAssertEqual(blocks.map(\.length), [4, 4, 2])
        XCTAssertEqual(blocks.map(\.blockId), (0..<3).map { BlockUpload.blockId(index: $0) })

        let reassembled = try blocks.reduce(Data()) { acc, block in
            acc + (try Data(contentsOf: block.fileURL))
        }
        XCTAssertEqual(reassembled, original, "block files concatenate back into the original")
    }

    func testPreparePartialIndexReadsCorrectSliceOnly() throws {
        let original = Data((0..<10).map { UInt8($0) })
        let item = try stagedItem(bytes: original, blockSize: 4)

        let blocks = try writer.prepare(item: item, indices: [1])   // bytes 4..8
        XCTAssertEqual(blocks.count, 1)
        XCTAssertEqual(try Data(contentsOf: blocks[0].fileURL), Data([4, 5, 6, 7]))
    }

    func testCleanupRemovesPerUploadDirectory() throws {
        let item = try stagedItem(bytes: Data((0..<10).map { UInt8($0) }), blockSize: 4)
        _ = try writer.prepare(item: item, indices: [0, 1, 2])
        XCTAssertTrue(FileManager.default.fileExists(atPath: writer.directory(for: item.uploadId).path))

        writer.cleanup(uploadId: item.uploadId)
        XCTAssertFalse(FileManager.default.fileExists(atPath: writer.directory(for: item.uploadId).path))
    }
}
