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
    /// consistent across renders within a session). Folds all 16 bytes (FNV-1a) so distinct uploads
    /// don't collide; negative keeps it clear of server ids (positive) and sample data (900_000_000+).
    var optimisticPhotoID: Int {
        let b = uuid
        let bytes = [b.0, b.1, b.2, b.3, b.4, b.5, b.6, b.7,
                     b.8, b.9, b.10, b.11, b.12, b.13, b.14, b.15]
        var hash: UInt64 = 1_469_598_103_934_665_603   // FNV-1a 64-bit offset basis
        for byte in bytes { hash = (hash ^ UInt64(byte)) &* 1_099_511_628_211 }
        return -Int(hash & 0x7FFF_FFFF_FFFF_FFFF) - 1   // mask to 63 bits → always a valid negative Int
    }
}
