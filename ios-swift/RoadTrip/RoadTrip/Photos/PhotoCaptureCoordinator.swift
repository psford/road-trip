import Foundation
import SwiftUI
import UIKit
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
    let assetLoader: any PhotoAssetLoading

    init(database: AppDatabase,
         stagingDirectory: URL = PhotoCaptureCoordinator.defaultStagingDirectory,
         assetLoader: any PhotoAssetLoading = SystemPhotoAssetLoader()) {
        self.database = database
        self.stagingDirectory = stagingDirectory
        self.assetLoader = assetLoader
    }

    /// Persistent staging location — Application Support, NOT `temporaryDirectory` (which
    /// iOS purges on relaunch / under storage pressure). A staged upload must survive
    /// relaunch so it can be retried or resumed; tmp/ left orphaned, un-retryable items.
    static let defaultStagingDirectory: URL = {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                 appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("PendingUploads", isDirectory: true)
    }()

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

    /// Produces upload-ready JPEG bytes. Re-encodes when the server can't read the format
    /// (HEIC) OR the image carries a non-upright EXIF orientation — the server's SkiaSharp
    /// resize ignores EXIF orientation, so we bake it into upright pixels here; otherwise the
    /// derived display/thumb tiers come out rotated. An already-upright JPEG passes through
    /// untouched (no re-encode, no quality loss). GPS is read from the original before this,
    /// so dropping EXIF in the re-encode is fine.
    static func normalizedImage(_ data: Data, filename: String) -> (Data, String, String) {
        let base = (filename as NSString).deletingPathExtension
        let jpegName = base.isEmpty ? "photo.jpg" : base + ".jpg"
        let isHEIC = HEICTranscoder.isHEIC(data)

        if let image = UIImage(data: data), isHEIC || image.imageOrientation != .up {
            // Redraw into a context so EXIF orientation is baked into upright pixels.
            // (UIImage.jpegData alone preserves the orientation tag — a redraw normalizes it.)
            // scale = 1 keeps the original pixel dimensions (no device-scale upscaling).
            let format = UIGraphicsImageRendererFormat.default()
            format.scale = 1
            format.opaque = true
            let renderer = UIGraphicsImageRenderer(size: image.size, format: format)
            let upright = renderer.image { _ in
                image.draw(in: CGRect(origin: .zero, size: image.size))
            }
            if let jpeg = upright.jpegData(compressionQuality: 0.95) {
                return (jpeg, "image/jpeg", jpegName)
            }
        }
        return (data, "image/jpeg", filename)
    }

    /// Resolves a picked item to its raw bytes (EXIF intact) via the injected `assetLoader`.
    /// Returns the image data and original filename.
    private func loadImageData(from item: PhotosPickerItem) async throws -> (Data, String) {
        guard let localId = assetLoader.itemIdentifier(for: item) else { throw CaptureError.noAsset }
        return try await assetLoader.loadImageData(forIdentifier: localId)
    }

#if DEBUG
    /// Test-only entry point that drives the asset-loader pipeline from the identifier step,
    /// bypassing the need for a real `PhotosPickerItem` (which cannot be constructed in unit
    /// tests). The injected `assetLoader` fake controls every branch:
    ///   • `identifier` is nil → throws `.noAsset` (simulates picker without .shared())
    ///   • `loadImageData(forIdentifier:)` throws `.noAsset` → limited selection / no asset
    ///   • `loadImageData(forIdentifier:)` throws `.dataUnavailable` → PHImageManager returned nil
    ///   • `loadImageData(forIdentifier:)` returns data → stages photo normally
    ///
    /// In production code, always call `stagePhoto(from:tripId:overrideCoordinate:)` instead.
    func stageUsingLoader(
        identifier: String?,
        tripId: UUID,
        overrideCoordinate: CLLocationCoordinate2D? = nil
    ) async throws -> UploadQueueItem {
        guard let localId = identifier else { throw CaptureError.noAsset }
        let (data, filename) = try await assetLoader.loadImageData(forIdentifier: localId)
        return try await stagePhoto(imageData: data, filename: filename, tripId: tripId,
                                    overrideCoordinate: overrideCoordinate)
    }
#endif
}
