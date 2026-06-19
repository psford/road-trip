import XCTest
@testable import RoadTrip

/// Phase 6 (Slice A): block-id generation + file slicing. These must match the web
/// client's scheme (`uploadUtils.js`) byte-for-byte so Azure accepts the block list:
/// a 64-byte buffer with the block index as a big-endian Int64 in the last 8 bytes,
/// base64-encoded (constant length across blocks, an Azure requirement).
final class BlockUploadTests: XCTestCase {

    func testBlockIdEncodesIndexAsBigEndianInt64InLast8Bytes() throws {
        for index in [0, 1, 255, 256, 70_000] {
            let id = BlockUpload.blockId(index: index)
            let bytes = try XCTUnwrap(Data(base64Encoded: id))
            XCTAssertEqual(bytes.count, 64, "block id decodes to a 64-byte buffer")
            XCTAssertTrue(bytes.prefix(56).allSatisfy { $0 == 0 }, "first 56 bytes are zero")

            let tail = bytes.suffix(8)
            let value = tail.reduce(Int(0)) { ($0 << 8) | Int($1) }   // big-endian
            XCTAssertEqual(value, index, "last 8 bytes hold the index big-endian")
        }
    }

    func testBlockIdsAreConstantLength() {
        XCTAssertEqual(BlockUpload.blockId(index: 0).count, BlockUpload.blockId(index: 999_999).count)
    }

    func testBlockIdZeroIsAllZeroBytes() {
        XCTAssertEqual(BlockUpload.blockId(index: 0), Data(count: 64).base64EncodedString())
    }

    func testChunkRangesCoverFileExactlyAndContiguously() {
        let fileSize = 10_000_000
        let chunk = 4 * 1024 * 1024   // 4 MB
        let ranges = BlockUpload.chunkRanges(fileSize: fileSize, chunkSize: chunk)

        XCTAssertEqual(ranges.count, 3)
        XCTAssertEqual(ranges.map(\.length), [chunk, chunk, fileSize - 2 * chunk])
        XCTAssertEqual(ranges.map(\.offset), [0, chunk, 2 * chunk])
        XCTAssertEqual(ranges.map(\.blockId), (0..<3).map { BlockUpload.blockId(index: $0) })

        // Contiguous, no gaps/overlaps, fully covering the file.
        var cursor = 0
        for r in ranges {
            XCTAssertEqual(r.offset, cursor)
            cursor += r.length
        }
        XCTAssertEqual(cursor, fileSize)
    }

    func testExactMultipleChunkBoundary() {
        let chunk = 4 * 1024 * 1024
        let ranges = BlockUpload.chunkRanges(fileSize: 2 * chunk, chunkSize: chunk)
        XCTAssertEqual(ranges.map(\.length), [chunk, chunk], "no trailing empty block on an exact multiple")
    }

    func testEmptyFileYieldsNoRanges() {
        XCTAssertTrue(BlockUpload.chunkRanges(fileSize: 0, chunkSize: 4 * 1024 * 1024).isEmpty)
    }
}
