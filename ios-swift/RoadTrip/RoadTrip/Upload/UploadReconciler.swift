import Foundation

/// Decides, for each persisted upload, what the background coordinator should do on
/// relaunch — the heart of force-quit resume (AC3.2).
///
/// A user force-quit *cancels* the in-flight block `uploadTask`s (background sessions
/// survive backgrounding and crashes, but not a deliberate kill), yet the session and our
/// GRDB state both persist. So on next launch we diff three things — what the plan needs,
/// what Azure has already accepted (`completedBlockIndices`), and what tasks the system
/// still holds (`liveTaskKeys` from `getAllTasks`) — and emit one action per upload.
///
/// Pure: file existence is injected, so this whole resume policy is unit-testable with no
/// disk, network, or `URLSession`.
enum UploadReconciler {
    enum Action: Equatable {
        /// Staged with no usable plan yet (no SAS / block size / photo id) → request-upload then enqueue all blocks.
        case start(UUID)
        /// Has a plan; re-enqueue these missing block indices (with a freshly refreshed SAS).
        case resume(UUID, indices: [Int])
        /// Every block accepted (or mid-commit) → run commit + finalize.
        case commit(UUID)
        /// Blocks still in flight as live system tasks → do nothing; their callbacks will drive it.
        case wait(UUID)
        /// Unrecoverable — the staged source file is gone, or it's empty. Surface for manual dismissal.
        case fail(UUID, reason: String)
    }

    /// One action per non-terminal upload. `.failed`/`.done` items are skipped (failed waits
    /// for an explicit user retry; done items are already deleted).
    static func plan(
        items: [UploadQueueItem],
        liveTaskKeys: [UploadTaskDescriptor],
        fileExists: (UploadQueueItem) -> Bool,
        now: Date = Date()
    ) -> [Action] {
        items.compactMap { item in
            switch item.stage {
            case .done, .failed: return nil
            default: break
            }

            guard fileExists(item) else {
                return .fail(item.uploadId, reason: "The photo is no longer available.")
            }

            // No usable plan yet → (re)start from request-upload.
            guard let blockSize = item.blockSizeBytes, blockSize > 0,
                  item.serverPhotoId != nil, item.sasUrl != nil else {
                return .start(item.uploadId)
            }

            let total = BlockUpload.chunkRanges(fileSize: Int(item.sizeBytes), chunkSize: blockSize).count
            guard total > 0 else {
                return .fail(item.uploadId, reason: "The photo file is empty.")
            }

            let completed = Set(item.completedBlockIndices)
            if completed.count >= total {
                return .commit(item.uploadId)   // also the normal `.committing` path
            }

            let live = Set(liveTaskKeys.filter { $0.uploadId == item.uploadId }.map(\.blockIndex))
            let missing = Set(0..<total).subtracting(completed).subtracting(live)
            if missing.isEmpty {
                return .wait(item.uploadId)      // remaining blocks are still in flight
            }
            return .resume(item.uploadId, indices: missing.sorted())
        }
    }
}
