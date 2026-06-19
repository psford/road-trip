import SwiftUI

/// Image view backed by `ImageLoader` (memory → disk → network). Seeds synchronously from
/// the in-memory cache so an already-seen photo renders on the first frame with no
/// placeholder flash; otherwise it loads asynchronously. Renders `scaledToFill` to fill
/// its container (call sites supply the frame + clipping).
struct CachedImage<Placeholder: View>: View {
    private let url: URL?
    private let tripId: UUID
    private let photoId: Int
    private let tier: PhotoFileCache.Tier
    private let placeholder: Placeholder
    @State private var image: UIImage?

    @MainActor
    init(url: URL?, tripId: UUID, photoId: Int, tier: PhotoFileCache.Tier,
         @ViewBuilder placeholder: () -> Placeholder) {
        self.url = url
        self.tripId = tripId
        self.photoId = photoId
        self.tier = tier
        self.placeholder = placeholder()
        _image = State(initialValue: ImageLoader.shared.memoryImage(for: url))
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                placeholder
            }
        }
        .task(id: url) {
            guard image == nil, let url else { return }
            image = await ImageLoader.shared.image(for: url, tripId: tripId, photoId: photoId, tier: tier)
        }
    }
}
