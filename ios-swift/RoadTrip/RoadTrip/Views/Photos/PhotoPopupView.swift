import SwiftUI

/// A photo shown as a swipeable popup *over the map* (web parity), instead of pushing a
/// separate page. Swipe left/right to move between the trip's photos; tap the dimmed
/// backdrop or the ✕ to dismiss.
struct PhotoPopupView: View {
    let photos: [Photo]
    @Binding var selection: Int
    let onClose: () -> Void
    var onMovePin: ((Photo) -> Void)? = nil
    var onDelete: ((Photo) -> Void)? = nil

    /// The photo currently shown (selection clamped to a valid index).
    private var currentPhoto: Photo? {
        guard photos.indices.contains(selection) else { return photos.last }
        return photos[selection]
    }

    var body: some View {
        GeometryReader { geo in
            // DEFINITE heights for both the image and the caption band. A flexible image
            // frame let `scaledToFill` resize the card the instant the AsyncImage finished
            // loading (~150ms after appear), pushing it past the screen. With fixed heights
            // the loaded image is always clipped to its slot — the layout never changes.
            let imageHeight = min(360, max(220, geo.size.height * 0.46))
            let captionHeight: CGFloat = 104
            let cardHeight = imageHeight + captionHeight

            ZStack {
                Color.black.opacity(0.55)
                    .ignoresSafeArea()
                    .onTapGesture { onClose() }

                TabView(selection: $selection) {
                    ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                        PhotoCard(photo: photo, imageHeight: imageHeight, captionHeight: captionHeight)
                            .padding(.horizontal, 20)
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: photos.count > 1 ? .always : .never))
                .frame(height: cardHeight)

                VStack {
                HStack {
                    if onMovePin != nil || onDelete != nil, let photo = currentPhoto {
                        Menu {
                            if let onMovePin {
                                Button { onMovePin(photo) } label: { Label("Move Pin", systemImage: "mappin.and.ellipse") }
                            }
                            if let onDelete {
                                Button(role: .destructive) { onDelete(photo) } label: { Label("Delete Photo", systemImage: "trash") }
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle.fill")
                                .font(.title)
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .black.opacity(0.45))
                        }
                        .padding()
                        .accessibilityLabel("Photo actions")
                    }
                    Spacer()
                    Button(action: onClose) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title)
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.white, .black.opacity(0.45))
                    }
                    .padding()
                    .accessibilityLabel("Close")
                }
                Spacer()
                }
            }
        }
    }
}

/// A single photo card inside the popup: a fixed-height image slot, then a fixed-height
/// caption band. Both heights are definite so the card can't resize when the image loads.
private struct PhotoCard: View {
    let photo: Photo
    let imageHeight: CGFloat
    let captionHeight: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // A fixed-size clear box defines the slot; the image is an OVERLAY, so it can
            // never affect layout regardless of its aspect ratio (portrait, landscape, or
            // a rotated source). scaledToFill fills the slot, clipped() trims the overflow.
            Color.clear
                .frame(maxWidth: .infinity)
                .frame(height: imageHeight)
                .overlay {
                    AsyncImage(url: URL(string: photo.displayUrl)) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Color.secondary.opacity(0.12).overlay(ProgressView())
                    }
                }
                .clipped()

            VStack(alignment: .leading, spacing: 6) {
                if let caption = photo.caption, !caption.isEmpty {
                    Text(caption).font(.headline).lineLimit(1)
                }
                Label(photo.placeName, systemImage: "mappin.and.ellipse")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                if let takenAt = photo.takenAt {
                    Label(takenAt.formatted(date: .abbreviated, time: .omitted), systemImage: "calendar")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding()
            // The page dots (multi-photo) render at the band's bottom — its padding gives room.
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(height: imageHeight + captionHeight)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(radius: 14)
    }
}
