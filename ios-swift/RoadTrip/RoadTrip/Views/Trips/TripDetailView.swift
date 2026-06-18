import SwiftUI
import MapKit
import GRDB

/// A trip's photos pinned on a MapKit map, with a scrollable photo strip below.
///
/// Tapping a pin (or a strip thumbnail) opens a swipeable photo popup *over the map*
/// (web parity) rather than pushing a separate page. MapKit ACs (design `native-ios.AC5`):
/// AC5.1 fit-all-pins, AC5.3 controls, AC5.4 empty state; AC5.2's "see the photo" is now
/// satisfied via the popup per Patrick's product decision.
struct TripDetailView: View {
    let database: AppDatabase
    let trip: Trip

    @State private var photos: [Photo] = []
    @State private var cameraPosition: MapCameraPosition = .automatic
    @State private var popupIndex: Int?   // index into `photos`; nil = closed

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                mapSection
                if !photos.isEmpty {
                    photoStrip
                }
            }

            if popupIndex != nil {
                PhotoPopupView(
                    photos: photos,
                    selection: Binding(
                        get: { min(max(popupIndex ?? 0, 0), photos.count - 1) },
                        set: { popupIndex = $0 }
                    ),
                    onClose: { withAnimation(.easeOut(duration: 0.2)) { popupIndex = nil } }
                )
                .transition(.opacity)
            }
        }
        .navigationTitle(trip.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var mapSection: some View {
        Map(position: $cameraPosition) {
            if routeCoordinates.count >= 2 {
                MapPolyline(coordinates: routeCoordinates)
                    .stroke(.tint, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
            }

            ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                Annotation(photo.placeName, coordinate: photo.coordinate) {
                    Button {
                        openPopup(at: index)
                    } label: {
                        PinThumbnail(url: photo.thumbnailUrl)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(photo.placeName))
                    .accessibilityAddTraits(.isButton)
                }
            }
        }
        .mapControls {
            MapUserLocationButton()
            MapCompass()
            MapScaleView()
        }
        .overlay {
            if photos.isEmpty {
                ContentUnavailableView(
                    "No photos yet",
                    systemImage: "photo.on.rectangle.angled",
                    description: Text("Photos you add to this trip will appear here on the map.")
                )
                .background(.thinMaterial)
            }
        }
    }

    private var photoStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                    Button {
                        openPopup(at: index)
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

    private func openPopup(at index: Int) {
        withAnimation(.easeIn(duration: 0.2)) { popupIndex = index }
    }

    private var routeCoordinates: [CLLocationCoordinate2D] {
        photos.map(\.coordinate)
    }

    private func load() async {
        let tripId = trip.id
        let loaded = (try? await database.dbQueue.read { db in
            try Photo.filter(Column("tripId") == tripId)
                .order(Column("takenAt"))
                .fetchAll(db)
        }) ?? []
        photos = loaded

        if let rect = MapFraming.framedRect(for: loaded.map(\.coordinate)) {
            cameraPosition = .rect(rect)
        } else {
            cameraPosition = .userLocation(fallback: .automatic)
        }
    }
}

private extension Photo {
    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lng)
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
