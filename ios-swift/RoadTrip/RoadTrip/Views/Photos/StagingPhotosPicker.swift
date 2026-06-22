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
    // Store as AnyView so the generic Label type is erased: avoids a strict-concurrency warning
    // about capturing non-Sendable generic types in the PhotosPicker @ViewBuilder closure.
    private let labelView: AnyView

    @MainActor
    init(selection: Binding<PhotosPickerItem?>, @ViewBuilder label: () -> Label) {
        self._selection = selection
        self.labelView = AnyView(label())
    }

    var body: some View {
        PhotosPicker(
            selection: $selection,
            matching: .images,
            preferredItemEncoding: .current,
            photoLibrary: .shared()
        ) {
            labelView
        }
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
