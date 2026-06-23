import Foundation
import GRDB
import UIKit

/// Launch-time database preparation.
///
/// `SampleData` trips are local-only fixtures with no Keychain token and no server
/// identity, so they can't accept uploads/mutations — presenting them in real runs made
/// "Add Photo" fail with "No upload token for this trip". They're therefore seeded ONLY
/// for UI tests (`-uitest`), which also reset to a deterministic state. Real launches
/// (incl. TestFlight) start empty; the user creates or imports real trips.
enum AppBootstrap {
    static func prepare(_ database: AppDatabase, isUITest: Bool,
                        seedPendingUpload: Bool = false) throws {
        guard isUITest else { return }   // real launches: no sample data
        try database.wipeAllData()
        // Sample/created trips get fresh random ids each run; clear their tokens so the Keychain
        // doesn't accumulate orphans across UI-test launches.
        try? KeychainStore().removeAllTokens()
        try SampleData.seedIfEmpty(database)
        // Ensure the route toggle starts in a known state (shown) for deterministic test isolation.
        // This is a normal write and doesn't corrupt UserDefaults cache like removePersistentDomain would.
        UserDefaults.standard.set(true, forKey: "showRoute")
        if seedPendingUpload { try seedStagedPendingUpload(database) }
    }

    /// UI-test fixture (`-uitest-pending-upload`): a staged-but-not-yet-uploaded photo on the
    /// "Pacific Coast Highway" sample trip (the one the matching UI test opens), so the optimistic
    /// pin/thumbnail can be verified without driving the out-of-process PhotosPicker.
    private static func seedStagedPendingUpload(_ database: AppDatabase) throws {
        let tripAndPhoto = try database.dbQueue.read { db -> (Trip, Photo)? in
            guard let trip = try Trip.filter(Column("name") == "Pacific Coast Highway").fetchOne(db),
                  let photo = try Photo.filter(Column("tripId") == trip.id).fetchOne(db) else { return nil }
            return (trip, photo)
        }
        guard let (trip, anchor) = tripAndPhoto else { return }

        // A real trip has a secret token; without one the upload fails the token guard before it
        // ever reaches the network. Give the fixture trip a (throwaway) token so it exercises the
        // genuine offline path: reconcile → request-upload → networkUnavailable → stays staged.
        try? KeychainStore().setToken(UUID(), kind: .secret, tripId: trip.id)

        // Place it near a real photo (so it's inside the framed map region) but offset enough that
        // it doesn't share a committed coordinate — otherwise DisplayPhotos' commit-handoff de-dup
        // would suppress the pin. Derived from the trip so it survives SampleData coordinate changes.
        let lat = anchor.lat + 0.03
        let lng = anchor.lng + 0.03

        let uploadId = UUID()
        let dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("uitest-pending", isDirectory: true)
        try? FileManager.default.removeItem(at: dir)   // clean any prior run's staged files
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let fileURL = dir.appendingPathComponent("\(uploadId).jpg")
        let swatch = UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64)).image { ctx in
            UIColor.systemTeal.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
        }
        try swatch.jpegData(compressionQuality: 0.8)?.write(to: fileURL)

        try database.dbQueue.write { db in
            try UploadQueueItem(
                uploadId: uploadId, tripId: trip.id, localFilePath: fileURL.path,
                filename: "PENDING.jpg", contentType: "image/jpeg", sizeBytes: 64,
                exifLat: lat, exifLon: lng, takenAt: nil,
                stage: .staged, bytesUploaded: 0, blockIds: [],
                sasUrl: nil, displaySasUrl: nil, thumbSasUrl: nil, blobPath: nil, sasIssuedAt: nil,
                errorMessage: nil, createdAt: Date(), updatedAt: Date()).insert(db)
        }
    }
}
