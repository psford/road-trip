import Foundation
import GRDB

/// Drives a staged photo through the resilient upload protocol (design Phase 6): request-
/// upload → block-PUT the original (with retry/backoff + SAS refresh) → commit. The server
/// regenerates the display/thumb tiers from the committed original, so the client uploads
/// only the original (keeps the client lightweight, matching the web app).
///
/// State transitions, block progress, and SAS material are persisted to `UploadQueueItem`
/// so a failed upload can be retried and (in Slice B's background work) resumed. Per AC3.6,
/// a `Photo` row appears only after a successful commit, so a half-uploaded photo is never
/// visible.
///
/// Slice B (this pass) adds retry/backoff (AC3.4), reactive SAS refresh (AC3.3), and a
/// persisted `.failed` state for manual retry (AC3.5). True background-`URLSession` survival
/// of force-quit (AC3.1/3.2) is the next sub-slice.
struct UploadCoordinator {
    let database: AppDatabase
    let keychain: KeychainStore
    var api: RoadTripAPI = .shared

    enum UploadError: Error, Equatable {
        case missingToken
        case sourceUnavailable   // staged source file is gone (e.g. purged) — retry is futile
    }

    /// Re-runs a failed (or staged) item from the start. request-upload is idempotent on
    /// the uploadId, so the server returns the same photo id.
    func retry(_ item: UploadQueueItem) async throws {
        try await upload(item)
    }

    /// Cancels a stuck/failed upload: removes its queue row and deletes the staged source
    /// file. Used by the banner's dismiss action (and when the source is gone).
    func abort(_ item: UploadQueueItem) async {
        removeStagedFile(item)
        try? await database.dbQueue.write { db in
            _ = try UploadQueueItem.deleteOne(db, key: item.uploadId)
        }
    }

    /// Uploads one staged item end-to-end. On failure, persists `.failed` + the error and
    /// rethrows so the caller can react.
    func upload(_ item: UploadQueueItem) async throws {
        guard let token = (try? keychain.token(kind: .secret, tripId: item.tripId))?.uuidString.lowercased() else {
            try? await setStage(item.uploadId, .failed, error: "No upload token for this trip")
            throw UploadError.missingToken
        }

        do {
            try await setStage(item.uploadId, .uploadingOriginal, resetProgress: true)

            let response = try await requestUpload(item, token: token)
            try await persistSAS(item.uploadId, sasUrl: response.sasUrl)

            guard let fileData = try? Data(contentsOf: URL(fileURLWithPath: item.localFilePath)) else {
                throw UploadError.sourceUnavailable   // staged file purged — can't upload
            }
            let ranges = BlockUpload.chunkRanges(fileSize: fileData.count, chunkSize: response.maxBlockSizeBytes)

            // Track the live SAS URL across reactive refreshes and cumulative bytes for progress.
            var currentSasUrl = response.sasUrl
            var uploaded: Int64 = 0

            let blockIds = try await BlockUploadRunner.run(
                ranges: ranges,
                initialSasUrl: response.sasUrl,
                chunk: { range in fileData.subdata(in: range.offset ..< (range.offset + range.length)) },
                put: { sasUrl, blockId, data in try await api.putBlock(sasUrl: sasUrl, blockId: blockId, data: data) },
                refreshSAS: {
                    let refreshed = try await requestUpload(item, token: token)
                    currentSasUrl = refreshed.sasUrl
                    try await persistSAS(item.uploadId, sasUrl: refreshed.sasUrl)
                    return refreshed.sasUrl
                },
                backoff: { attempt in
                    let ms = Backoff.delayMs(attempt: attempt, jitter: Double.random(in: 0 ..< 1))
                    try? await Task.sleep(nanoseconds: UInt64(ms * 1_000_000))
                },
                onProgress: { index in
                    uploaded += Int64(ranges[index].length)
                    try? await persistProgress(item.uploadId, bytesUploaded: uploaded, blockIds: Array(ranges[0...index].map(\.blockId)))
                })
            _ = currentSasUrl   // silence unused-write warning; kept for clarity/B.2 resume

            try await setStage(item.uploadId, .committing)
            try await api.commitUpload(secretToken: token, photoId: response.photoId, blockIds: blockIds)

            // Re-hydrate so the committed photo becomes a local Photo row + map pin, then
            // drop the finished queue item.
            await api.revalidate(tripId: item.tripId, secretToken: token, into: database)
            try await database.dbQueue.write { db in
                _ = try UploadQueueItem.deleteOne(db, key: item.uploadId)
            }
            removeStagedFile(item)   // committed → the staged source is no longer needed
        } catch {
            try? await setStage(item.uploadId, .failed, error: friendlyError(error))
            throw error
        }
    }

    // MARK: - Effects

    private func requestUpload(_ item: UploadQueueItem, token: String) async throws -> RequestUploadResponse {
        let exif = ExifDTO(gpsLat: item.exifLat, gpsLon: item.exifLon, takenAt: item.takenAt)
        let request = RequestUploadRequest(
            uploadId: item.uploadId.uuidString.lowercased(),
            filename: item.filename, contentType: item.contentType,
            sizeBytes: item.sizeBytes, exif: exif)
        return try await api.requestUpload(request, secretToken: token)
    }

    private func setStage(_ uploadId: UUID, _ stage: UploadStage, error: String? = nil, resetProgress: Bool = false) async throws {
        try await database.dbQueue.write { db in
            guard var item = try UploadQueueItem.fetchOne(db, key: uploadId) else { return }
            item.stage = stage
            item.errorMessage = error
            if resetProgress { item.bytesUploaded = 0; item.blockIds = [] }
            item.updatedAt = Date()
            try item.update(db)
        }
    }

    private func persistSAS(_ uploadId: UUID, sasUrl: String) async throws {
        try await database.dbQueue.write { db in
            guard var item = try UploadQueueItem.fetchOne(db, key: uploadId) else { return }
            item.sasUrl = sasUrl
            item.sasIssuedAt = Date()
            item.updatedAt = Date()
            try item.update(db)
        }
    }

    private func persistProgress(_ uploadId: UUID, bytesUploaded: Int64, blockIds: [String]) async throws {
        try await database.dbQueue.write { db in
            guard var item = try UploadQueueItem.fetchOne(db, key: uploadId) else { return }
            item.bytesUploaded = bytesUploaded
            item.blockIds = blockIds
            item.updatedAt = Date()
            try item.update(db)
        }
    }

    private func removeStagedFile(_ item: UploadQueueItem) {
        try? FileManager.default.removeItem(atPath: item.localFilePath)
    }

    private func friendlyError(_ error: Error) -> String {
        switch error {
        case UploadError.sourceUnavailable: return "This photo is no longer available — remove it and add it again."
        case UploadTransportError.permanent(let status): return "Upload rejected (HTTP \(status))."
        case UploadTransportError.retryable: return "Upload kept failing. Tap to retry."
        case RoadTripAPIError.networkUnavailable: return "Couldn’t reach the server. Check your connection."
        case RoadTripAPIError.serverError(let detail): return "Server error: \(detail)"
        default: return "Upload failed. Tap to retry."
        }
    }
}
