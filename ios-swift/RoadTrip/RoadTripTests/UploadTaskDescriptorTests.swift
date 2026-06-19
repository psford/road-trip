import XCTest
@testable import RoadTrip

/// Slice B.2: the correlation key on each background task's `taskDescription`. It must
/// survive a relaunch round-trip exactly (uuid + block index) and reject anything malformed
/// rather than crash, because the system can hand our memory-less delegate stray tasks.
final class UploadTaskDescriptorTests: XCTestCase {

    func testRoundTripsThroughEncodeDecode() {
        for index in [0, 1, 7, 255, 70_000] {
            let descriptor = UploadTaskDescriptor(uploadId: UUID(), blockIndex: index)
            XCTAssertEqual(UploadTaskDescriptor.decode(descriptor.encode()), descriptor)
        }
    }

    func testEncodeFormatIsPipeSeparated() {
        let id = UUID()
        XCTAssertEqual(UploadTaskDescriptor(uploadId: id, blockIndex: 3).encode(), "\(id.uuidString)|3")
    }

    func testDecodeRejectsMalformedOrForeignStrings() {
        for bad in [nil, "", "not-a-uuid|0", "\(UUID().uuidString)|notanumber",
                    "\(UUID().uuidString)", "\(UUID().uuidString)|-1"] as [String?] {
            XCTAssertNil(UploadTaskDescriptor.decode(bad), "should ignore: \(bad ?? "nil")")
        }
    }
}
