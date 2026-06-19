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
        ZStack {
            Color.black.opacity(0.55)
                .ignoresSafeArea()
                .onTapGesture { onClose() }

            TabView(selection: $selection) {
                ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                    PhotoCard(photo: photo)
                        .padding(.horizontal, 20)
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: photos.count > 1 ? .always : .never))
            .frame(height: 440)

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

/// A single photo card inside the popup: image, caption, place, capture date.
private struct PhotoCard: View {
    let photo: Photo

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            AsyncImage(url: URL(string: photo.displayUrl)) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                ProgressView().frame(maxWidth: .infinity, minHeight: 260)
            }
            .frame(height: 300)
            .clipped()

            VStack(alignment: .leading, spacing: 6) {
                if let caption = photo.caption, !caption.isEmpty {
                    Text(caption).font(.headline)
                }
                Label(photo.placeName, systemImage: "mappin.and.ellipse")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if let takenAt = photo.takenAt {
                    Label(takenAt.formatted(date: .abbreviated, time: .omitted), systemImage: "calendar")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(radius: 14)
    }
}
