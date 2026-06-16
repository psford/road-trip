import Foundation
import GRDB

/// A committed photo, mirroring the server's `PhotoResponse`.
///
/// Only photos that have fully committed (all three blob tiers) ever become a `Photo`
/// row — an in-flight upload lives in `UploadQueueItem` until commit succeeds. That
/// guarantees there are never half-uploaded photos visible (design AC3.6).
struct Photo: Codable, Identifiable, Equatable {
    /// Server-assigned id (`PhotoResponse.id`). Globally unique; the primary key.
    var id: Int

    /// Owning trip's local id (foreign key → `Trip.id`).
    var tripId: UUID

    var thumbnailUrl: String
    var displayUrl: String
    var originalUrl: String

    var lat: Double
    var lng: Double
    var placeName: String
    var caption: String?

    /// EXIF capture time; `nil` when the source had no `DateTimeOriginal`
    /// (`PhotoResponse.takenAt` is nullable).
    var takenAt: Date?

    /// Correlates back to the `UploadQueueItem` that produced this photo
    /// (`PhotoResponse.uploadId`). `nil` for photos hydrated from the server that this
    /// device didn't upload.
    var uploadId: UUID?
}

// MARK: - GRDB persistence

extension Photo: FetchableRecord, PersistableRecord {
    static let databaseTableName = "photo"
}
