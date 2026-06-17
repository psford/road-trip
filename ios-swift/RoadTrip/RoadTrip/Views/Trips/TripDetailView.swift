import SwiftUI
import MapKit
import GRDB

/// A trip's photos pinned on a MapKit map, with a scrollable photo strip below.
struct TripDetailView: View {
    let database: AppDatabase
    let trip: Trip

    @State private var photos: [Photo] = []
    @State private var cameraPosition: MapCameraPosition = .automatic

    var body: some View {
        VStack(spacing: 0) {
            Map(position: $cameraPosition) {
                ForEach(photos) { photo in
                    Annotation(photo.placeName,
                               coordinate: CLLocationCoordinate2D(latitude: photo.lat, longitude: photo.lng)) {
                        PinThumbnail(url: photo.thumbnailUrl)
                    }
                }
            }
            .mapControls {
                MapCompass()
                MapScaleView()
            }

            photoStrip
        }
        .navigationTitle(trip.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var photoStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(photos) { photo in
                    NavigationLink {
                        PhotoDetailView(photo: photo)
                    } label: {
                        AsyncImage(url: URL(string: photo.displayUrl)) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            Color.secondary.opacity(0.15)
                        }
                        .frame(width: 92, height: 92)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
        }
        .frame(height: 116)
        .background(.thinMaterial)
    }

    private func load() async {
        let tripId = trip.id
        photos = (try? await database.dbQueue.read { db in
            try Photo.filter(Column("tripId") == tripId)
                .order(Column("takenAt"))
                .fetchAll(db)
        }) ?? []
    }
}

/// Circular thumbnail used as a map annotation marker.
private struct PinThumbnail: View {
    let url: String

    var body: some View {
        AsyncImage(url: URL(string: url)) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Image(systemName: "photo").imageScale(.small).foregroundStyle(.secondary)
        }
        .frame(width: 40, height: 40)
        .clipShape(Circle())
        .overlay(Circle().stroke(.white, lineWidth: 2))
        .shadow(radius: 2)
    }
}
