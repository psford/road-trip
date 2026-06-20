import Foundation
import GRDB

/// Thin GRDB layer for the upload state machine — every mutation the background coordinator
/// makes to an `UploadQueueItem`, in one place so the delegate callbacks stay tiny and the
/// persistence is testable on its own.
///
/// Each progress write is a single read-modify-write *inside one* `dbQueue.write`, so two
/// block callbacks finishing at once can't clobber `completedBlockIndices` — GRDB serializes
/// the transactions and each one sees the latest committed state.
struct UploadStore {
    let database: AppDatabase

    // MARK: - Reads

    func all() async throws -> [UploadQueueItem] {
        try await database.dbQueue.read { try UploadQueueItem.fetchAll($0) }
    }

    func fetch(_ uploadId: UUID) async throws -> UploadQueueItem? {
        try await database.dbQueue.read { try UploadQueueItem.fetchOne($0, key: uploadId) }
    }

    // MARK: - Writes

    /// Records the result of `request-upload`: the SAS, the server photo id, and the block
    /// size the plan is sliced with. Moves the item into `uploading_original` and clears any
    /// prior progress/error (a fresh start or retry).
    func persistPlan(_ uploadId: UUID, sasUrl: String, photoId: String, blockSize: Int) async throws {
        try await mutate(uploadId) { item in
            item.sasUrl = sasUrl
            item.sasIssuedAt = Date()
            item.serverPhotoId = photoId
            item.blockSizeBytes = blockSize
            item.stage = .uploadingOriginal
            item.errorMessage = nil
        }
    }

    /// Updates only the live SAS after a proactive/reactive refresh (keeps progress).
    func refreshSAS(_ uploadId: UUID, sasUrl: String) async throws {
        try await mutate(uploadId) { item in
            item.sasUrl = sasUrl
            item.sasIssuedAt = Date()
        }
    }

    /// Marks one block accepted by Azure (idempotent — re-recording the same index is a no-op)
    /// and advances the byte counter for the progress bar.
    func markBlockComplete(_ uploadId: UUID, index: Int, bytes: Int) async throws {
        try await mutate(uploadId) { item in
            guard !item.completedBlockIndices.contains(index) else { return }
            item.completedBlockIndices.append(index)
            item.bytesUploaded += Int64(bytes)
        }
    }

    func setStage(_ uploadId: UUID, _ stage: UploadStage) async throws {
        try await mutate(uploadId) { $0.stage = stage }
    }

    /// Wipes progress so a user retry re-uploads from scratch (Put Block is idempotent).
    func resetForRetry(_ uploadId: UUID) async throws {
        try await mutate(uploadId) { item in
            item.stage = .staged
            item.completedBlockIndices = []
            item.bytesUploaded = 0
            item.errorMessage = nil
        }
    }

    /// Atomically claims the commit: moves `uploading_original` → `committing` and returns
    /// `true` only for the caller that won. Stops two final blocks from committing twice.
    func claimCommit(_ uploadId: UUID) async throws -> Bool {
        try await database.dbQueue.write { db in
            guard var item = try UploadQueueItem.fetchOne(db, key: uploadId), item.stage != .committing else {
                return false
            }
            item.stage = .committing
            item.updatedAt = Date()
            try item.update(db)
            return true
        }
    }

    func setFailed(_ uploadId: UUID, message: String) async throws {
        try await mutate(uploadId) { item in
            item.stage = .failed
            item.errorMessage = message
        }
    }

    func delete(_ uploadId: UUID) async throws {
        try await database.dbQueue.write { db in
            _ = try UploadQueueItem.deleteOne(db, key: uploadId)
        }
    }

    /// Read-modify-write a single item in one transaction; bumps `updatedAt`. No-op if gone.
    private func mutate(_ uploadId: UUID, _ change: @escaping @Sendable (inout UploadQueueItem) -> Void) async throws {
        try await database.dbQueue.write { db in
            guard var item = try UploadQueueItem.fetchOne(db, key: uploadId) else { return }
            change(&item)
            item.updatedAt = Date()
            try item.update(db)
        }
    }
}
