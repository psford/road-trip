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
        // Server-hydrated photos carry uploadId: nil, so the optimistic→committed hand-off can't
        // de-dup by uploadId in practice. Correlate by LOCATION instead: during commit the committed
        // twin sits at the same coordinate as the optimistic. Rounded to ~0.1m to tolerate any
        // server-side coordinate rounding; two *distinct* photos at the same micro-degree is
        // implausible (GPS jitter / continuous map taps never collide to 6 decimals).
        let committedUploadIds = Set(committed.compactMap(\.uploadId))
        let committedCoords = Set(committed.map { CoordKey(lat: $0.lat, lng: $0.lng) })
        let optimistic: [Photo] = pending.compactMap { item in
            guard let lat = item.exifLat, let lng = item.exifLon else { return nil }
            switch item.stage {
            case .done, .failed: return nil   // committed → real pin; failed → banner, not a pin
            default: break
            }
            // De-dup the commit hand-off (by uploadId if present, else by coordinate).
            guard !committedUploadIds.contains(item.uploadId) else { return nil }
            guard !committedCoords.contains(CoordKey(lat: lat, lng: lng)) else { return nil }
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

/// A location rounded to ~0.1m (6 decimal degrees) so an optimistic photo and its committed twin
/// hash equal despite any server-side rounding.
private struct CoordKey: Hashable {
    let lat: Int
    let lng: Int
    init(lat: Double, lng: Double) {
        self.lat = Int((lat * 1_000_000).rounded())
        self.lng = Int((lng * 1_000_000).rounded())
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
