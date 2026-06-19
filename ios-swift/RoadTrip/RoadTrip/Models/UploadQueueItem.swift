import Foundation
import GRDB

/// The stages a queued upload moves through. Persisted as its raw `String` value.
///
/// Swift note: a `String`-backed enum — each case has a stable on-disk spelling, so
/// renaming a case in Swift wouldn't silently change stored data.
enum UploadStage: String, Codable {
    case staged
    case uploadingOriginal = "uploading_original"
    case uploadingDisplay = "uploading_display"
    case uploadingThumb = "uploading_thumb"
    case committing
    case done
    case failed
}

/// Pre-commit state for a single photo upload. Persisted (not just in memory) so the
/// background `URLSession` coordinator in Phase 6 can resume after the app is
/// backgrounded or force-quit, and refresh an expired SAS without losing progress.
///
/// Security: `exifLat`/`exifLon` and the SAS URLs are sensitive and must never be
/// logged raw (mirrors the server's `LogSanitizer` rule). Storing them here is fine —
/// the prohibition is on logging, not persistence.
struct UploadQueueItem: Codable, Identifiable, Equatable {
    /// Client-generated correlation key. The server echoes this back as the photo's
    /// id on commit (`RequestUploadResponse.photoId == uploadId`). Primary key.
    var uploadId: UUID

    /// Owning trip (foreign key → `Trip.id`).
    var tripId: UUID

    // Source file + metadata
    var localFilePath: String
    var filename: String
    var contentType: String
    var sizeBytes: Int64

    // EXIF extracted client-side (sensitive)
    var exifLat: Double?
    var exifLon: Double?
    var takenAt: Date?

    // State machine
    var stage: UploadStage
    var bytesUploaded: Int64
    /// Legacy (foreground path, removed in Slice B.2): ordered block IDs. The background
    /// uploader tracks progress via `completedBlockIndices` instead. Kept as a column so
    /// existing on-disk rows still decode; no longer written.
    var blockIds: [String]

    // Background-upload resume state (Slice B.2 / v2 migration). A force-quit cancels the
    // in-flight block `uploadTask`s, so resume rebuilds the plan from these + the staged file.
    /// Block size the plan was sliced with — re-slice with this so boundaries/ids match.
    var blockSizeBytes: Int? = nil
    /// Photo id from `request-upload`, needed to commit. (Equals the uploadId server-side,
    /// but persisted explicitly rather than assumed.)
    var serverPhotoId: String? = nil
    /// Block indices Azure has already accepted (HTTP 201). Resume re-enqueues the rest;
    /// commit sends `completedBlockIndices.sorted().map(BlockUpload.blockId)`.
    var completedBlockIndices: [Int] = []

    // SAS material from `request-upload`. Kept so a relaunched upload can continue;
    // refreshed when `sasIssuedAt` is older than ~1.75h (SAS TTL is 2h).
    var sasUrl: String?
    var displaySasUrl: String?
    var thumbSasUrl: String?
    var blobPath: String?
    var sasIssuedAt: Date?

    var errorMessage: String?
    var createdAt: Date
    var updatedAt: Date

    /// `Identifiable` conformance — the upload id is the natural identity.
    var id: UUID { uploadId }
}

// MARK: - GRDB persistence

extension UploadQueueItem: FetchableRecord, PersistableRecord {
    static let databaseTableName = "uploadQueueItem"
}
