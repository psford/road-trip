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

    @State private var dragOffset: CGFloat = 0

    /// The photo currently shown (selection clamped to a valid index).
    private var currentPhoto: Photo? {
        guard photos.indices.contains(selection) else { return photos.last }
        return photos[selection]
    }

    private let dismissThreshold: CGFloat = 120

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
                Color.black
                    .opacity(0.55 * (1 - min(dragOffset / dismissThreshold, 1)))
                    .ignoresSafeArea()
                    .onTapGesture { onClose() }

                VStack(spacing: 0) {
                    // Header bar with controls
                    HStack {
                        Button(action: onClose) {
                            Image(systemName: "xmark")
                                .font(.title3)
                                .foregroundStyle(.primary)
                        }
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                        .accessibilityIdentifier("popup-close")

                        Spacer()

                        if onMovePin != nil || onDelete != nil, let photo = currentPhoto {
                            Menu {
                                if let onMovePin {
                                    Button { onMovePin(photo) } label: { Label("Move Pin", systemImage: "mappin.and.ellipse") }
                                }
                                if let onDelete {
                                    Button(role: .destructive) { onDelete(photo) } label: { Label("Delete Photo", systemImage: "trash") }
                                }
                            } label: {
                                Image(systemName: "ellipsis")
                                    .font(.title3)
                                    .foregroundStyle(.primary)
                            }
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                            .accessibilityLabel("Photo actions")
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 2)
                    .background(.regularMaterial)

                    // Paged photos
                    TabView(selection: $selection) {
                        ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                            VStack(alignment: .leading, spacing: 0) {
                                // A fixed-size clear box defines the slot; the image is an OVERLAY, so it can
                                // never affect layout regardless of its aspect ratio (portrait, landscape, or
                                // a rotated source). scaledToFill fills the slot, clipped() trims the overflow.
                                Color.clear
                                    .frame(maxWidth: .infinity)
                                    .frame(height: imageHeight)
                                    .overlay {
                                        CachedImage(url: URL(string: photo.displayUrl), tripId: photo.tripId,
                                                    photoId: photo.id, tier: .display) {
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
                            .tag(index)
                        }
                    }
                    .tabViewStyle(.page(indexDisplayMode: photos.count > 1 ? .always : .never))
                    .frame(height: cardHeight)
                }
                .background(.regularMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .shadow(radius: 14)
                .offset(y: dragOffset)
                .gesture(
                    DragGesture(minimumDistance: 10)
                        .onChanged { value in
                            // Only claim vertical-dominant downward drags
                            let isDownward = value.translation.height > 0
                            let isVerticalDominant = abs(value.translation.height) > abs(value.translation.width)
                            if isDownward && isVerticalDominant {
                                dragOffset = value.translation.height
                            }
                        }
                        .onEnded { value in
                            let isDownward = value.translation.height > 0
                            let isVerticalDominant = abs(value.translation.height) > abs(value.translation.width)
                            let isPastThreshold = dragOffset > dismissThreshold
                            let isFastFlick = isDownward && isVerticalDominant && value.predictedEndTranslation.height > dismissThreshold

                            if isPastThreshold || isFastFlick {
                                onClose()
                            } else {
                                // Spring back animation
                                withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                                    dragOffset = 0
                                }
                            }
                        }
                )
            }
        }
    }
}
