import Foundation
import SwiftUI
import Photos
import PhotosUI

// MARK: - PhotoAssetLoading protocol

/// Abstracts the Photos system bridge so PhotoCaptureCoordinator can be tested without a
/// real photo library.
///
/// The protocol intentionally exposes three separate methods so fakes can short-circuit at
/// any step:
///   • `itemIdentifier` returns nil  → simulates picker bound without `photoLibrary:.shared()`
///   • `fetchAsset` returns nil      → simulates the `.limited` selection case (user picked a
///     photo outside the granted subset, so PHAsset lookup returns nothing)
///   • `loadImageData` throws        → simulates PHImageManager returning no bytes (iCloud
///     original not yet downloaded)
///
/// ## Unit-test strategy
///
/// `PhotosPickerItem` and `PHAsset` cannot be constructed in unit tests (no public
/// initialiser). To test every branch of the coordinator's `loadImageData(from:)` without
/// real library objects, use the `#if DEBUG` entry point
/// `PhotoCaptureCoordinator.stageUsingLoader(identifier:tripId:overrideCoordinate:)`.
/// That method drives the pipeline from the identifier step, letting fakes control the
/// outcome:
///
///   • Nil-identifier fake  → `itemIdentifier` returns nil → `.noAsset`
///   • Limited-selection fake → `fetchAsset` returns nil → `.noAsset`
///   • No-data fake → `loadImageData(forIdentifier:)` throws `.dataUnavailable`
///   • Success fake → `loadImageData(forIdentifier:)` returns real bytes
///
/// Because `fetchAsset(localIdentifier:)` produces a `PHAsset` that unit tests cannot
/// construct, the coordinator's DEBUG entry point skips `fetchAsset` and delegates the
/// full "identifier → (Data, String)" resolution to `loadImageData(forIdentifier:)`.
/// The production `SystemPhotoAssetLoader` performs `fetchAssets` + `requestImageData`
/// inside that single method.
protocol PhotoAssetLoading {
    /// Returns the local Photos library identifier for the given picker item, or `nil`
    /// when the picker was not bound to `photoLibrary: .shared()`.
    func itemIdentifier(for item: PhotosPickerItem) -> String?

    /// Fetches the PHAsset for the given local identifier, or `nil` when the asset is
    /// outside the app's limited-selection set (or the library is inaccessible).
    ///
    /// Used in production (called from `loadImageData(from: PhotosPickerItem)`).
    func fetchAsset(localIdentifier: String) -> PHAsset?

    /// Loads the raw image bytes (EXIF intact) and the original filename, resolving the
    /// full pipeline from identifier → PHAsset → bytes.
    ///
    /// The production implementation calls `fetchAsset` then `PHImageManager`. Test fakes
    /// ignore the identifier and return controlled data (or throw a controlled error),
    /// bypassing the need for a constructable `PHAsset`.
    ///
    /// Throws `PhotoCaptureCoordinator.CaptureError.noAsset` when the identifier cannot
    /// be resolved to a `PHAsset`.
    /// Throws `PhotoCaptureCoordinator.CaptureError.dataUnavailable` when `PHImageManager`
    /// returns no data.
    func loadImageData(forIdentifier localIdentifier: String) async throws -> (Data, String)
}

// MARK: - Production implementation

/// Delegates to the real Photos APIs used in the original `PhotoCaptureCoordinator.loadImageData`.
struct SystemPhotoAssetLoader: PhotoAssetLoading {

    func itemIdentifier(for item: PhotosPickerItem) -> String? {
        item.itemIdentifier
    }

    func fetchAsset(localIdentifier: String) -> PHAsset? {
        PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier], options: nil).firstObject
    }

    func loadImageData(forIdentifier localIdentifier: String) async throws -> (Data, String) {
        guard let asset = fetchAsset(localIdentifier: localIdentifier) else {
            throw PhotoCaptureCoordinator.CaptureError.noAsset
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
                    continuation.resume(throwing: PhotoCaptureCoordinator.CaptureError.dataUnavailable)
                }
            }
        }
    }
}
