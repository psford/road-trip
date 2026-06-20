import XCTest
@testable import RoadTrip

/// Slice B.2: force-quit resume policy (AC3.2). The reconciler is pure, so every branch of
/// "what do we do with this persisted upload on relaunch" is covered here with no disk or
/// network — file existence is injected.
final class UploadReconcilerTests: XCTestCase {

    private let chunk = 4 * 1024 * 1024          // 4 MB
    private var threeBlockSize: Int64 { Int64(10_000_000) }   // → 3 blocks (0,1,2)

    /// A planned, in-flight item: SAS + photo id + block size set, `count` blocks completed.
    private func item(stage: UploadStage = .uploadingOriginal,
                      completed: [Int] = [],
                      planned: Bool = true,
                      size: Int64? = nil) -> UploadQueueItem {
        let now = Date()
        return UploadQueueItem(
            uploadId: UUID(), tripId: UUID(),
            localFilePath: "/tmp/x.jpg", filename: "x.jpg", contentType: "image/jpeg",
            sizeBytes: size ?? threeBlockSize,
            exifLat: nil, exifLon: nil, takenAt: nil,
            stage: stage, bytesUploaded: 0, blockIds: [],
            blockSizeBytes: planned ? chunk : nil,
            serverPhotoId: planned ? "photo-1" : nil,
            completedBlockIndices: completed,
            sasUrl: planned ? "https://host/blob?sig=x" : nil,
            displaySasUrl: nil, thumbSasUrl: nil, blobPath: nil, sasIssuedAt: now,
            errorMessage: nil, createdAt: now, updatedAt: now)
    }

    private func plan(_ items: [UploadQueueItem], live: [UploadTaskDescriptor] = [],
                      exists: Bool = true) -> [UploadReconciler.Action] {
        UploadReconciler.plan(items: items, liveTaskKeys: live, fileExists: { _ in exists })
    }

    func testStagedWithNoPlanStartsFromScratch() {
        let it = item(stage: .staged, planned: false)
        XCTAssertEqual(plan([it]), [.start(it.uploadId)])
    }

    func testPartialProgressResumesOnlyMissingBlocks() {
        let it = item(completed: [0])   // 3 blocks total, 0 done → resume 1,2
        XCTAssertEqual(plan([it]), [.resume(it.uploadId, indices: [1, 2])])
    }

    func testLiveTasksAreNotReEnqueued() {
        let it = item(completed: [0])
        let live = [UploadTaskDescriptor(uploadId: it.uploadId, blockIndex: 1)]
        // 0 done, 1 in flight → only 2 is missing.
        XCTAssertEqual(plan([it], live: live), [.resume(it.uploadId, indices: [2])])
    }

    func testAllBlocksCompletedCommits() {
        let it = item(completed: [0, 1, 2])
        XCTAssertEqual(plan([it]), [.commit(it.uploadId)])
    }

    func testCommittingStageCommits() {
        let it = item(stage: .committing, completed: [0, 1, 2])
        XCTAssertEqual(plan([it]), [.commit(it.uploadId)])
    }

    func testNothingMissingButTasksStillLiveWaits() {
        let it = item(completed: [0, 1])   // block 2 not done, but it's a live task
        let live = [UploadTaskDescriptor(uploadId: it.uploadId, blockIndex: 2)]
        XCTAssertEqual(plan([it], live: live), [.wait(it.uploadId)])
    }

    func testMissingSourceFileFails() {
        let it = item(completed: [0])
        XCTAssertEqual(plan([it], exists: false),
                       [.fail(it.uploadId, reason: "The photo is no longer available.")])
    }

    func testEmptyFileFails() {
        let it = item(completed: [], size: 0)
        XCTAssertEqual(plan([it]), [.fail(it.uploadId, reason: "The photo file is empty.")])
    }

    func testFailedAndDoneItemsAreSkipped() {
        XCTAssertEqual(plan([item(stage: .failed), item(stage: .done)]), [])
    }
}
