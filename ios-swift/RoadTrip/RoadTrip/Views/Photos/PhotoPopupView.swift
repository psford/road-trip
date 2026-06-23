import SwiftUI

/// A photo shown over the map, with no window chrome. Two states:
///   • **card** — just the photo, rounded, floating over a dimmed map (tap a pin to get here).
///     No caption/place/date here: it's a clean photo viewer; tap in for details.
///   • **immersive** — tap the photo and the backdrop goes fully black, the card falls away, and
///     the photo's place/date appear pinned to the bottom of the screen. Tap again to return.
///
/// Gestures (no buttons): swipe left/right to page between the trip's photos; swipe down to
/// dismiss; tap the dimmed backdrop to dismiss; long-press a photo for Move Pin / Delete Photo.
///
/// The pager is hand-rolled (not `TabView`) so each page sizes to its *own* photo's aspect: the
/// container height interpolates between the current and incoming page as you drag, which kills
/// the mid-swipe letterbox flicker a shared-frame `TabView` produced.
struct PhotoPopupView: View {
    let photos: [Photo]
    @Binding var selection: Int
    /// Full-black mode: the parent watches this to hide its own floating chrome (the title bar)
    /// so nothing overlays the photo. Owned by the parent so it resets cleanly per presentation.
    @Binding var immersive: Bool
    let onClose: () -> Void
    var onMovePin: ((Photo) -> Void)? = nil
    var onDelete: ((Photo) -> Void)? = nil

    @State private var dragOffset: CGFloat = 0    // vertical drag → dismiss
    @State private var pageDrag: CGFloat = 0      // horizontal drag → page
    @State private var dragAxis: Axis?            // axis claimed by the in-flight drag
    /// photoId → aspect ratio (width / height), learned from each loaded image so a card can size
    /// to its photo with no letterbox. Defaults to 4:3 until a photo's image loads.
    @State private var aspectByPhoto: [Int: CGFloat] = [:]

    private let dismissThreshold: CGFloat = 120

    private var hasMenu: Bool { onMovePin != nil || onDelete != nil }

    private var currentPhoto: Photo? {
        guard photos.indices.contains(selection) else { return photos.last }
        return photos[selection]
    }

    private func aspect(_ photo: Photo) -> CGFloat { aspectByPhoto[photo.id] ?? 4.0 / 3.0 }

    private func imageHeight(_ photo: Photo, maxImageHeight: CGFloat, cardWidth: CGFloat) -> CGFloat {
        min(maxImageHeight, cardWidth / aspect(photo))
    }

    var body: some View {
        GeometryReader { geo in
            let pageStride = geo.size.width
            let inset: CGFloat = 8
            let cardWidth = geo.size.width - inset * 2
            // Immersive lets a photo grow nearly full-screen; card mode caps lower so the dimmed
            // map stays visible around it (so it reads as a floating popup, not a pushed page).
            let maxImageHeight = geo.size.height * (immersive ? 0.92 : 0.7)

            // Keep every term CGFloat (convert once) so Xcode 16.4 doesn't flag an ambiguous mix.
            let dismissProgress: CGFloat = min(dragOffset / dismissThreshold, 1)
            let backdropOpacity: CGFloat = immersive ? 1 : 0.55 * (1 - dismissProgress)

            ZStack {
                Color.black
                    .opacity(Double(backdropOpacity))
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture {
                        if immersive {
                            withAnimation(.easeInOut(duration: 0.25)) { immersive = false }
                        } else {
                            onClose()
                        }
                    }

                // Each page is its own rounded photo, sized to its exact aspect and centred in a
                // full-width slot. There is NO shared, height-morphing container — that would clip
                // a taller page's rounded corners to squares mid-swipe. Pages just slide; a photo's
                // corners stay round at every offset. Neighbours sit a full screen-width away, so
                // they're off-screen until the swipe brings them in (no clipping needed).
                HStack(spacing: 0) {
                    ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                        if abs(index - selection) <= 1 {
                            page(photo, cardWidth: cardWidth, maxImageHeight: maxImageHeight, pageStride: pageStride)
                        } else {
                            Color.clear.frame(width: pageStride)
                        }
                    }
                }
                // Leading-align: the HStack is N pages wide, so a centered frame would park the
                // MIDDLE page at offset 0. Leading puts page 0's edge at x=0 so selection maps right.
                .frame(width: geo.size.width, alignment: .leading)
                .offset(x: -CGFloat(selection) * pageStride + pageDrag)
                .offset(y: dragOffset)
                .gesture(dragGesture(pageStride: pageStride))

                // Immersive metadata, pinned to the bottom of the screen (in the black). Overlaps
                // the photo only when the photo runs that low. Non-interactive so a tap anywhere
                // still toggles immersive off.
                if immersive, let photo = currentPhoto {
                    VStack(spacing: 0) {
                        Spacer()
                        metadata(photo)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 20)
                            .padding(.top, 44)
                            .padding(.bottom, 36)
                            .background(
                                LinearGradient(colors: [.clear, .black.opacity(0.6)],
                                               startPoint: .top, endPoint: .bottom)
                            )
                    }
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .transition(.opacity)
                }
            }
        }
    }

    // MARK: - One page (photo only)

    @ViewBuilder
    private func page(_ photo: Photo, cardWidth: CGFloat, maxImageHeight: CGFloat, pageStride: CGFloat) -> some View {
        // Box sized to the photo's exact display rect: height capped at maxImageHeight, width then
        // derived from the aspect (so it's ≤ cardWidth). The image fills it edge-to-edge, so the
        // rounded clip hugs the photo with no side/letterbox bars — even on a tall portrait.
        let h = imageHeight(photo, maxImageHeight: maxImageHeight, cardWidth: cardWidth)
        let w = min(cardWidth, h * aspect(photo))
        let photoBox = Color.clear
            .frame(width: w, height: h)
            .overlay {
                CachedImage(url: URL(string: photo.displayUrl), tripId: photo.tripId,
                            photoId: photo.id, tier: .display, contentMode: .fill,
                            onAspect: { aspectByPhoto[photo.id] = $0 }) {
                    Color.secondary.opacity(0.12).overlay(ProgressView())
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: immersive ? 0 : 16))
            .shadow(radius: immersive ? 0 : 12)
            .overlay(alignment: .topTrailing) {
                // The only visual cue that this photo isn't posted yet.
                if photo.isOptimistic { OptimisticUploadBadge(size: 28).padding(12) }
            }
            .contentShape(Rectangle())
            .onTapGesture { withAnimation(.easeInOut(duration: 0.25)) { immersive.toggle() } }
            .accessibilityIdentifier("popup-photo")

        applyMenu(to: photoBox, photo: photo)
            .frame(width: pageStride)
    }

    /// Place + date, shown only in immersive mode (white over the dark scrim).
    @ViewBuilder
    private func metadata(_ photo: Photo) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let caption = photo.caption, !caption.isEmpty {
                Text(caption)
                    .font(.headline)
                    .lineLimit(2)
                    .foregroundStyle(.white)
            }
            Label(photo.placeName, systemImage: "mappin.and.ellipse")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.85))
                .lineLimit(2)
            if let takenAt = photo.takenAt {
                Label(takenAt.formatted(date: .abbreviated, time: .omitted), systemImage: "calendar")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.85))
            }
        }
    }

    /// Long-press → Move Pin / Delete Photo. The actions have no visible chrome (per design);
    /// they live on the photo's context menu, the way Photos.app surfaces per-item actions.
    @ViewBuilder
    private func applyMenu(to view: some View, photo: Photo) -> some View {
        // No Move/Delete on an optimistic photo — it isn't on the server yet (those actions are
        // server calls). They become available once it commits.
        if hasMenu && !photo.isOptimistic {
            view.contextMenu {
                if let onMovePin {
                    Button { onMovePin(photo) } label: { Label("Move Pin", systemImage: "mappin.and.ellipse") }
                }
                if let onDelete {
                    Button(role: .destructive) { onDelete(photo) } label: { Label("Delete Photo", systemImage: "trash") }
                }
            }
        } else {
            view
        }
    }

    // MARK: - Drag (page horizontally / dismiss vertically)

    private func dragGesture(pageStride: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 10)
            .onChanged { value in
                if dragAxis == nil {
                    dragAxis = abs(value.translation.width) > abs(value.translation.height) ? .horizontal : .vertical
                }
                switch dragAxis {
                case .horizontal:
                    pageDrag = value.translation.width
                case .vertical:
                    if value.translation.height > 0 { dragOffset = value.translation.height }
                case .none:
                    break
                }
            }
            .onEnded { value in
                defer { dragAxis = nil }
                if dragAxis == .horizontal {
                    let predicted = value.predictedEndTranslation.width
                    let shouldPage = abs(pageDrag) > pageStride * 0.28 || abs(predicted) > pageStride * 0.5
                    var dir = shouldPage ? (pageDrag < 0 ? 1 : -1) : 0
                    if !photos.indices.contains(selection + dir) { dir = 0 }
                    if dir != 0 {
                        // Compensate the offset so changing `selection` doesn't jump a full page,
                        // then spring the residual drag to zero — a continuous slide into place.
                        pageDrag += CGFloat(dir) * pageStride
                        selection += dir
                    }
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { pageDrag = 0 }
                } else {
                    let isFastFlick = value.predictedEndTranslation.height > dismissThreshold
                    if dragOffset > dismissThreshold || isFastFlick {
                        onClose()
                    } else {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { dragOffset = 0 }
                    }
                }
            }
    }
}
