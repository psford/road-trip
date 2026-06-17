import SwiftUI

/// Full-size view of a single photo with its place + capture metadata.
struct PhotoDetailView: View {
    let photo: Photo

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                AsyncImage(url: URL(string: photo.originalUrl)) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 280)
                }
                .clipShape(RoundedRectangle(cornerRadius: 16))

                if let caption = photo.caption, !caption.isEmpty {
                    Text(caption).font(.body)
                }

                Label(photo.placeName, systemImage: "mappin.and.ellipse")
                    .foregroundStyle(.secondary)

                if let takenAt = photo.takenAt {
                    Label(takenAt.formatted(date: .long, time: .shortened), systemImage: "calendar")
                        .foregroundStyle(.secondary)
                }
            }
            .padding()
        }
        .navigationTitle(photo.placeName)
        .navigationBarTitleDisplayMode(.inline)
    }
}
