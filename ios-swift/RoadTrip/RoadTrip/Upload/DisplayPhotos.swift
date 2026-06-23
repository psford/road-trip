import Foundation

extension Photo {
    /// True for an *optimistic* photo: one synthesized from a staged-but-not-yet-uploaded upload so
    /// it appears on the map/strip/popup immediately (poor-service support). Optimistic photos use a
    /// negative id (a real server id is positive), a local `file://` image URL, and carry the
    /// `uploadId` they came from. They are replaced by the committed photo once the upload lands.
    var isOptimistic: Bool { id < 0 }
}

/// Builds the single list the map, filmstrip, and popup all render: committed photos plus optimistic
/// photos for in-flight uploads — so a photo added with no service behaves exactly like a posted one
/// (tap, swipe), differing only by an upload marker. Pure (no map, no disk).
enum DisplayPhotos {
    static func build(committed: [Photo], pending: [UploadQueueItem]) -> [Photo] {
        let committedUploadIds = Set(committed.compactMap(\.uploadId))
        let optimistic: [Photo] = pending.compactMap { item in
            guard let lat = item.exifLat, let lng = item.exifLon else { return nil }
            switch item.stage {
            case .done, .failed: return nil   // committed → real pin; failed → banner, not a pin
            default: break
            }
            guard !committedUploadIds.contains(item.uploadId) else { return nil }   // de-dup hand-off
            let fileURL = URL(fileURLWithPath: item.localFilePath).absoluteString    // file://…
            return Photo(
                id: item.uploadId.optimisticPhotoID,
                tripId: item.tripId,
                thumbnailUrl: fileURL, displayUrl: fileURL, originalUrl: fileURL,
                lat: lat, lng: lng,
                placeName: "Uploading…", caption: nil,
                takenAt: item.takenAt, uploadId: item.uploadId)
        }
        return committed + optimistic
    }
}

private extension UUID {
    /// A stable, negative pseudo-id for an optimistic photo (derived from the upload id, so it's
    /// consistent across renders within a session). Negative keeps it clear of server ids (positive)
    /// and sample data (900_000_000+).
    var optimisticPhotoID: Int {
        let b = uuid
        let high = (Int(b.0) << 24) | (Int(b.1) << 16) | (Int(b.2) << 8) | Int(b.3)
        return -(high & 0x7FFF_FFFF) - 1
    }
}
