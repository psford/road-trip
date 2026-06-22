import SwiftUI
import PhotosUI
import Photos

// MARK: - Why .shared() is required
//
// The staging pipeline (PhotoCaptureCoordinator.loadImageData) resolves the picked item
// to a PHAsset via `item.itemIdentifier`. That identifier is only populated when the
// picker is bound to the shared system photo library (.shared()). If you construct a
// PhotosPicker without `photoLibrary: .shared()` the identifier comes back nil and
// every pick throws CaptureError.noAsset ("Couldn't read that photo from your library").
//
// These wrappers make it structurally impossible to forget .shared(): any picker in this
// app must go through StagingPhotosPicker or .stagingPhotosPicker — both hard-code the
// required parameters so call-site typos or copy-paste omissions can't break EXIF capture.

/// A drop-in replacement for `PhotosPicker` that hard-codes the parameters required by
/// the staging pipeline. Use in place of every `PhotosPicker` in this app.
///
/// - `matching: .images` — only photos, no videos
/// - `preferredItemEncoding: .current` — keep the native format (HEIC/JPEG) for EXIF
/// - `photoLibrary: .shared()` — required so `item.itemIdentifier` is populated
struct StagingPhotosPicker<Label: View>: View {
    @Binding var selection: PhotosPickerItem?
    // PhotosPicker's `label` parameter is `@Sendable`, so store the closure as @Sendable and
    // forward it directly. (Erasing to AnyView and using that property in the closure tripped a
    // main-actor-from-Sendable warning; a plain non-Sendable closure tripped a conversion warning.)
    private let label: @Sendable () -> Label

    init(selection: Binding<PhotosPickerItem?>, @ViewBuilder label: @escaping @Sendable () -> Label) {
        self._selection = selection
        self.label = label
    }

    var body: some View {
        PhotosPicker(
            selection: $selection,
            matching: .images,
            preferredItemEncoding: .current,
            photoLibrary: .shared(),
            label: label
        )
    }
}

// MARK: - View modifier variant

extension View {
    /// Presents the system photo picker sheet, wiring `photoLibrary: .shared()` so the
    /// staging pipeline can resolve `item.itemIdentifier` → PHAsset → raw EXIF bytes.
    func stagingPhotosPicker(
        isPresented: Binding<Bool>,
        selection: Binding<PhotosPickerItem?>
    ) -> some View {
        self.photosPicker(
            isPresented: isPresented,
            selection: selection,
            matching: .images,
            preferredItemEncoding: .current,
            photoLibrary: .shared()
        )
    }
}
