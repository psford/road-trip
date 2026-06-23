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
        try SampleData.seedIfEmpty(database)
        // Ensure the route toggle starts in a known state (shown) for deterministic test isolation.
        // This is a normal write and doesn't corrupt UserDefaults cache like removePersistentDomain would.
        UserDefaults.standard.set(true, forKey: "showRoute")
        if seedPendingUpload { try seedStagedPendingUpload(database) }
    }

    /// UI-test fixture (`-uitest-pending-upload`): a staged-but-not-yet-uploaded photo with a
    /// location on the first sample trip, so the optimistic ("pending") map pin can be verified
    /// without driving the out-of-process PhotosPicker.
    private static func seedStagedPendingUpload(_ database: AppDatabase) throws {
        guard let trip = try database.dbQueue.read({
            try Trip.filter(Column("name") == "Pacific Coast Highway").fetchOne($0)
        }) else { return }

        // A real trip has a secret token; without one the upload fails the token guard before it
        // ever reaches the network. Give the fixture trip a (throwaway) token so it exercises the
        // genuine offline path: reconcile → request-upload → networkUnavailable → stays staged.
        try? KeychainStore().setToken(UUID(), kind: .secret, tripId: trip.id)

        let uploadId = UUID()
        let dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("uitest-pending", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let fileURL = dir.appendingPathComponent("\(uploadId).jpg")
        let swatch = UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64)).image { ctx in
            UIColor.systemTeal.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
        }
        try swatch.jpegData(compressionQuality: 0.8)?.write(to: fileURL)

        // Near the Pacific Coast Highway cluster so it lands inside the framed map region.
        try database.dbQueue.write { db in
            try UploadQueueItem(
                uploadId: uploadId, tripId: trip.id, localFilePath: fileURL.path,
                filename: "PENDING.jpg", contentType: "image/jpeg", sizeBytes: 64,
                exifLat: 36.45, exifLon: -121.90, takenAt: nil,
                stage: .staged, bytesUploaded: 0, blockIds: [],
                sasUrl: nil, displaySasUrl: nil, thumbSasUrl: nil, blobPath: nil, sasIssuedAt: nil,
                errorMessage: nil, createdAt: Date(), updatedAt: Date()).insert(db)
        }
    }
}
