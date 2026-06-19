import Foundation
import SwiftUI
import CoreLocation
import GRDB
import Photos
import PhotosUI

/// Drives the photo-capture pipeline (design Phase 5): take a picked photo, recover its
/// EXIF GPS + capture date, transcode HEIC → JPEG, and enqueue a `.staged`
/// `UploadQueueItem`. The background coordinator (Phase 6) executes the upload later.
///
/// Why PHAsset and not `PhotosPickerItem.loadTransferable`: `PhotosPicker` strips EXIF
/// for privacy, so we resolve the picked item back to a `PHAsset` and read the raw bytes
/// (GPS intact) via `PHImageManager`. This requires `.readWrite`/`.limited` library access.
struct PhotoCaptureCoordinator {
    let database: AppDatabase
    let stagingDirectory: URL

    init(database: AppDatabase,
         stagingDirectory: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent("staged-uploads", isDirectory: true)) {
        self.database = database
        self.stagingDirectory = stagingDirectory
    }

    enum CaptureError: Error, Equatable {
        case noAsset           // picked item has no resolvable PHAsset (no library access)
        case dataUnavailable   // PHImageManager returned no bytes
    }

    /// Full path: picked item → raw bytes (EXIF intact) → staged queue item.
    /// `overrideCoordinate` (from a map long-press / pin-drop) takes precedence over EXIF GPS.
    @discardableResult
    func stagePhoto(from item: PhotosPickerItem, tripId: UUID,
                    overrideCoordinate: CLLocationCoordinate2D? = nil) async throws -> UploadQueueItem {
        let (data, filename) = try await loadImageData(from: item)
        return try await stagePhoto(imageData: data, filename: filename, tripId: tripId,
                                    overrideCoordinate: overrideCoordinate)
    }

    /// Testable core: extract EXIF, transcode HEIC→JPEG, write a temp source file, and
    /// insert a `.staged` UploadQueueItem. `overrideCoordinate` wins over EXIF (location-first
    /// posting). With neither, the item stages with nil coordinates and the UI must collect a
    /// location via pin-drop before it can upload (AC2.3).
    @discardableResult
    func stagePhoto(imageData: Data, filename: String, tripId: UUID,
                    overrideCoordinate: CLLocationCoordinate2D? = nil) async throws -> UploadQueueItem {
        let meta = EXIFExtractor.extract(from: imageData)
        let lat = overrideCoordinate?.latitude ?? meta.lat
        let lng = overrideCoordinate?.longitude ?? meta.lng
        let (bytes, contentType, outName) = Self.normalizedImage(imageData, filename: filename)

        try FileManager.default.createDirectory(at: stagingDirectory, withIntermediateDirectories: true)
        let uploadId = UUID()
        let fileURL = stagingDirectory.appendingPathComponent("\(uploadId.uuidString).jpg")
        try bytes.write(to: fileURL, options: .atomic)

        let now = Date()
        let item = UploadQueueItem(
            uploadId: uploadId, tripId: tripId,
            localFilePath: fileURL.path, filename: outName, contentType: contentType,
            sizeBytes: Int64(bytes.count),
            exifLat: lat, exifLon: lng, takenAt: meta.takenAt,
            stage: .staged, bytesUploaded: 0, blockIds: [],
            sasUrl: nil, displaySasUrl: nil, thumbSasUrl: nil, blobPath: nil, sasIssuedAt: nil,
            errorMessage: nil, createdAt: now, updatedAt: now)
        try await database.dbQueue.write { db in try item.insert(db) }
        return item
    }

    /// Transcodes HEIC to JPEG; other formats pass through. Road Trip photos are camera
    /// JPEG/HEIC, and the server expects `image/jpeg`, so the content type is always JPEG.
    static func normalizedImage(_ data: Data, filename: String) -> (Data, String, String) {
        if HEICTranscoder.isHEIC(data), let jpeg = HEICTranscoder.transcodedToJPEG(data) {
            let base = (filename as NSString).deletingPathExtension
            return (jpeg, "image/jpeg", base.isEmpty ? "photo.jpg" : base + ".jpg")
        }
        return (data, "image/jpeg", filename)
    }

    /// Resolves a picked item to its `PHAsset` and returns the raw image bytes (EXIF intact)
    /// plus the original filename.
    private func loadImageData(from item: PhotosPickerItem) async throws -> (Data, String) {
        guard let localId = item.itemIdentifier else { throw CaptureError.noAsset }
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [localId], options: nil).firstObject else {
            throw CaptureError.noAsset
        }
        let filename = PHAssetResource.assetResources(for: asset).first?.originalFilename ?? "photo.jpg"

        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = true   // fetch from iCloud if not local
        options.version = .current

        return try await withCheckedThrowingContinuation { continuation in
            PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, _, _, _ in
                if let data {
                    continuation.resume(returning: (data, filename))
                } else {
                    continuation.resume(throwing: CaptureError.dataUnavailable)
                }
            }
        }
    }
}
