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
    /// photoId → aspect ratio (width / height), learned from each loaded image so the card can
    /// size to the photo with no letterbox. Defaults to 4:3 until a photo's image loads.
    @State private var aspectByPhoto: [Int: CGFloat] = [:]

    /// The photo currently shown (selection clamped to a valid index).
    private var currentPhoto: Photo? {
        guard photos.indices.contains(selection) else { return photos.last }
        return photos[selection]
    }

    private let dismissThreshold: CGFloat = 120

    var body: some View {
        GeometryReader { geo in
            // The card fills a near-full width; the image height follows the CURRENT photo's aspect
            // ratio (learned from its loaded image, cached per-photo), CAPPED at maxImageHeight so a
            // tall portrait can't run off-screen. Bounded both ways → it never overflows (the failure
            // that drove the old fixed-size design). The cap is the only thing that can show a bar,
            // and only for an extreme aspect (panorama / very tall).
            let inset: CGFloat = 8
            let cardWidth = geo.size.width - inset * 2
            let maxImageHeight = geo.size.height * 0.62
            let captionHeight: CGFloat = 104
            let currentAspect = currentPhoto.flatMap { aspectByPhoto[$0.id] } ?? 4.0 / 3.0
            let imageHeight = min(maxImageHeight, cardWidth / currentAspect)
            let cardHeight = imageHeight + captionHeight
            // Backdrop dims as the card is dragged toward dismissal. Keep every term
            // explicitly CGFloat (then convert once) so there's no ambiguous CGFloat/Double
            // mix — Xcode 26 infers it, but Xcode 16.4's compiler flags it as ambiguous.
            let dragProgress: CGFloat = min(dragOffset / dismissThreshold, 1)
            let backdropOpacity: CGFloat = 0.55 * (1 - dragProgress)

            ZStack {
                Color.black
                    .opacity(Double(backdropOpacity))
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
                                // The image overlays a bounded clear box, so it can never push the layout
                                // off-screen. The box matches the current photo's aspect, so `.fit` fills it
                                // edge-to-edge with no bars; onAspect feeds each photo's size back up.
                                Color.clear
                                    .frame(width: cardWidth, height: imageHeight)
                                    .overlay {
                                        CachedImage(url: URL(string: photo.displayUrl), tripId: photo.tripId,
                                                    photoId: photo.id, tier: .display, contentMode: .fit,
                                                    onAspect: { aspectByPhoto[photo.id] = $0 }) {
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
                            .frame(width: cardWidth, height: imageHeight + captionHeight)
                            .tag(index)
                        }
                    }
                    .tabViewStyle(.page(indexDisplayMode: photos.count > 1 ? .always : .never))
                    .frame(width: cardWidth, height: cardHeight)
                    // Card height morphs smoothly to each photo's aspect as you swipe.
                    .animation(.spring(response: 0.35, dampingFraction: 0.85), value: cardHeight)
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
