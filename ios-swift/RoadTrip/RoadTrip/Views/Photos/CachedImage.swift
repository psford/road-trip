import SwiftUI

/// Image view backed by `ImageLoader` (memory → disk → network). Seeds synchronously from
/// the in-memory cache so an already-seen photo renders on the first frame with no
/// placeholder flash; otherwise it loads asynchronously. `contentMode` defaults to `.fill`
/// (crops to fill — for square pins/thumbnails); pass `.fit` to show the whole photo
/// letterboxed. Call sites supply the frame + clipping.
struct CachedImage<Placeholder: View>: View {
    private let url: URL?
    private let tripId: UUID
    private let photoId: Int
    private let tier: PhotoFileCache.Tier
    private let contentMode: ContentMode
    /// Reports the image's aspect ratio (width / height) once known — synchronously for a
    /// memory-cached image, or after async load. Lets a caller size its frame to the photo.
    private let onAspect: ((CGFloat) -> Void)?
    private let placeholder: Placeholder
    @State private var image: UIImage?

    @MainActor
    init(url: URL?, tripId: UUID, photoId: Int, tier: PhotoFileCache.Tier,
         contentMode: ContentMode = .fill,
         onAspect: ((CGFloat) -> Void)? = nil,
         @ViewBuilder placeholder: () -> Placeholder) {
        self.url = url
        self.tripId = tripId
        self.photoId = photoId
        self.tier = tier
        self.contentMode = contentMode
        self.onAspect = onAspect
        self.placeholder = placeholder()
        _image = State(initialValue: ImageLoader.shared.memoryImage(for: url, tier: tier))
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
            } else {
                placeholder
            }
        }
        .task(id: url) {
            if let image { report(image); return }   // already seeded from the memory cache
            guard let url else { return }
            let loaded = await ImageLoader.shared.image(for: url, tripId: tripId, photoId: photoId, tier: tier)
            image = loaded
            if let loaded { report(loaded) }
        }
    }

    private func report(_ img: UIImage) {
        guard img.size.height > 0 else { return }
        onAspect?(img.size.width / img.size.height)
    }
}
