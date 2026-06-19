import SwiftUI
import MapKit
import GRDB
import PhotosUI
import Photos
import UIKit

/// A trip's photos pinned on a MapKit map, with a scrollable photo strip below.
///
/// Tapping a pin (or a strip thumbnail) opens a swipeable photo popup *over the map*
/// (web parity) rather than pushing a separate page. MapKit ACs (design `native-ios.AC5`):
/// AC5.1 fit-all-pins, AC5.3 controls, AC5.4 empty state; AC5.2's "see the photo" is now
/// satisfied via the popup per Patrick's product decision.
struct TripDetailView: View {
    let database: AppDatabase
    let trip: Trip
    var keychain = KeychainStore()

    @Environment(\.dismiss) private var dismiss

    @State private var photos: [Photo] = []
    @State private var cameraPosition: MapCameraPosition = .automatic
    @State private var popupIndex: Int?   // index into `photos`; nil = closed
    @State private var showingDeleteConfirm = false
    @State private var isDeleting = false
    @State private var deleteError: String?
    @State private var pickedItem: PhotosPickerItem?
    @State private var isStaging = false
    @State private var captureMessage: String?
    @State private var uploads: [UploadQueueItem] = []
    @State private var didFrameCamera = false
    @State private var toastMessage: String?
    @State private var photoToMove: Photo?
    @State private var stagedNeedingLocation: UploadQueueItem?
    @State private var pendingPost: IdentifiableCoordinate?

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                mapSection
                if !photos.isEmpty {
                    photoStrip
                }
            }

            if !uploads.isEmpty {
                VStack {
                    UploadBanner(uploads: uploads,
                                 onRetry: { item in Task { await retryUpload(item) } },
                                 onDismiss: { item in dismissUpload(item) })
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }

            if popupIndex != nil {
                PhotoPopupView(
                    photos: photos,
                    selection: Binding(
                        get: { min(max(popupIndex ?? 0, 0), photos.count - 1) },
                        set: { popupIndex = $0 }
                    ),
                    onClose: { withAnimation(.easeOut(duration: 0.2)) { popupIndex = nil } },
                    onMovePin: { photo in
                        withAnimation(.easeOut(duration: 0.2)) { popupIndex = nil }
                        photoToMove = photo
                    },
                    onDelete: { photo in deletePhoto(photo) }
                )
                .transition(.opacity)
            }

            if let toastMessage {
                VStack {
                    Spacer()
                    Text(toastMessage)
                        .font(.subheadline)
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(.regularMaterial, in: Capsule())
                        .padding(.bottom, 24)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .navigationTitle(trip.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                PhotosPicker(selection: $pickedItem, matching: .images,
                             preferredItemEncoding: .current, photoLibrary: .shared()) {
                    Label("Add Photo", systemImage: "plus")
                }
                .disabled(isStaging)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(role: .destructive) {
                    showingDeleteConfirm = true
                } label: {
                    Label("Delete Trip", systemImage: "trash")
                }
                .disabled(isDeleting)
            }
        }
        .onChange(of: pickedItem) { _, newItem in
            guard let newItem else { return }
            Task { await stage(newItem) }
        }
        .alert("Photo", isPresented: Binding(
            get: { captureMessage != nil },
            set: { if !$0 { captureMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(captureMessage ?? "")
        }
        .confirmationDialog("Delete this trip?", isPresented: $showingDeleteConfirm, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await deleteTrip() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This permanently deletes “\(trip.name)” and its photos for everyone with the link.")
        }
        .alert("Couldn’t delete trip", isPresented: Binding(
            get: { deleteError != nil },
            set: { if !$0 { deleteError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(deleteError ?? "")
        }
        .sheet(item: $photoToMove) { photo in
            PinDropView(initialCoordinate: CLLocationCoordinate2D(latitude: photo.lat, longitude: photo.lng),
                        title: "Move Pin") { coordinate in
                moveLocation(photo, to: coordinate)
            }
        }
        .sheet(item: $stagedNeedingLocation) { item in
            PinDropView(initialCoordinate: nil, title: "Where was this taken?",
                        confirmTitle: "Pin & Upload") { coordinate in
                startUploadWithLocation(item, coordinate: coordinate)
            }
        }
        .sheet(item: $pendingPost) { post in
            PostPhotoHereSheet(coordinate: post.coordinate) { picked in
                pendingPost = nil
                Task { await stage(picked, overrideCoordinate: post.coordinate) }
            }
        }
        .task { await observePhotos() }
        .task { await observeUploads() }
    }

    /// Streams this trip's photos so optimistic delete/move (and committed uploads) reflect
    /// on the map immediately. The camera frames the pins once, then stays put.
    private func observePhotos() async {
        let tripId = trip.id
        let observation = ValueObservation.tracking { db in
            try Photo.filter(Column("tripId") == tripId).order(Column("takenAt")).fetchAll(db)
        }
        do {
            for try await rows in observation.values(in: database.dbQueue) {
                photos = rows
                if !didFrameCamera {
                    if let rect = MapFraming.framedRect(for: rows.map(\.coordinate)) {
                        cameraPosition = .rect(rect)   // fit all pins, once
                        didFrameCamera = true
                    } else {
                        cameraPosition = .userLocation(fallback: .automatic)   // empty trip (AC5.4)
                    }
                }
            }
        } catch {
            print("observePhotos: \(error)")
        }
    }

    private func showToast(_ message: String) {
        withAnimation { toastMessage = message }
        Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            withAnimation { toastMessage = nil }
        }
    }

    private func deletePhoto(_ photo: Photo) {
        withAnimation(.easeOut(duration: 0.2)) { popupIndex = nil }
        Task {
            do {
                try await PhotoMutations(database: database, keychain: keychain).deletePhoto(photo)
            } catch {
                showToast("Couldn’t delete that photo — it’s back on your map.")
            }
        }
    }

    private func moveLocation(_ photo: Photo, to coordinate: CLLocationCoordinate2D) {
        Task {
            do {
                try await PhotoMutations(database: database, keychain: keychain)
                    .moveLocation(photo, lat: coordinate.latitude, lng: coordinate.longitude)
            } catch {
                showToast("Couldn’t move that pin — it’s back where it was.")
            }
        }
    }

    /// AC2.3: a no-GPS photo got a location from pin-drop; persist it on the queue item, then upload.
    private func startUploadWithLocation(_ item: UploadQueueItem, coordinate: CLLocationCoordinate2D) {
        Task {
            try? await database.dbQueue.write { db in
                guard var queued = try UploadQueueItem.fetchOne(db, key: item.uploadId) else { return }
                queued.exifLat = coordinate.latitude
                queued.exifLon = coordinate.longitude
                queued.updatedAt = Date()
                try queued.update(db)
            }
            if let updated = try? await database.dbQueue.read({ db in try UploadQueueItem.fetchOne(db, key: item.uploadId) }) {
                startUpload(updated)
            }
        }
    }

    /// Streams this trip's pending/failed uploads so the banner reflects progress live.
    private func observeUploads() async {
        let tripId = trip.id
        let observation = ValueObservation.tracking { db in
            try UploadQueueItem.filter(Column("tripId") == tripId)
                .order(Column("createdAt"))
                .fetchAll(db)
        }
        do {
            for try await rows in observation.values(in: database.dbQueue) {
                withAnimation(.easeInOut(duration: 0.2)) { uploads = rows }
            }
        } catch {
            print("observeUploads: \(error)")
        }
    }

    private func stage(_ item: PhotosPickerItem, overrideCoordinate: CLLocationCoordinate2D? = nil) async {
        isStaging = true
        defer { isStaging = false; pickedItem = nil }

        // Resolving the picked item to a PHAsset (to keep EXIF) needs library access;
        // the picker selection alone doesn't grant it.
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        guard status == .authorized || status == .limited else {
            captureMessage = "Road Trip needs photo access to keep a photo’s location. You can enable it in Settings."
            return
        }

        do {
            let staged = try await PhotoCaptureCoordinator(database: database)
                .stagePhoto(from: item, tripId: trip.id, overrideCoordinate: overrideCoordinate)

            guard staged.exifLat != nil, staged.exifLon != nil else {
                // AC2.3: no EXIF GPS → make the user drop a pin before it can upload.
                stagedNeedingLocation = staged
                return
            }

            // Hand off to the resilient uploader; the banner (driven by ValueObservation)
            // shows progress, and the pin appears when it commits.
            startUpload(staged)
        } catch PhotoCaptureCoordinator.CaptureError.noAsset {
            captureMessage = "Couldn’t read that photo from your library. Try another, or grant full photo access."
        } catch {
            captureMessage = "Couldn’t add that photo. Please try again."
        }
    }

    /// Hands the staged photo to the shared background uploader. It survives backgrounding and
    /// force-quit (true background `URLSession`), persists `.failed` on exhaustion (the banner
    /// surfaces Retry), and the committed pin appears via the photos `ValueObservation` on
    /// revalidate — no manual reload here.
    private func startUpload(_ item: UploadQueueItem) {
        BackgroundUploadSession.shared?.start(item.uploadId)
    }

    private func retryUpload(_ item: UploadQueueItem) async {
        BackgroundUploadSession.shared?.retry(item.uploadId)
    }

    /// Removes a stuck/failed upload (its row, staged file, and block files) so the banner can
    /// be cleared even when retry is futile (e.g. the source photo is gone).
    private func dismissUpload(_ item: UploadQueueItem) {
        BackgroundUploadSession.shared?.abort(item.uploadId)
    }

    private func deleteTrip() async {
        isDeleting = true
        do {
            try await RoadTripAPI.shared.deleteTrip(trip, from: database, keychain: keychain)
            dismiss()   // pop back to the list; ValueObservation drops the row
        } catch RoadTripAPIError.networkUnavailable {
            deleteError = "Couldn’t reach the server. Check your connection and try again."
            isDeleting = false
        } catch {
            deleteError = "The server couldn’t delete this trip. Please try again."
            isDeleting = false
        }
    }

    private var mapSection: some View {
        MapReader { proxy in
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
                            PinThumbnail(photo: photo)
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
            // Long-press to post a photo at that spot (Apple Maps "drop a pin" pattern).
            // `.simultaneousGesture` keeps pan/zoom and pin taps working; the long-press
            // requires a hold, so it won't fire on a quick tap or a pan.
            .simultaneousGesture(longPressToPost(proxy))
            .overlay {
                if photos.isEmpty {
                    ContentUnavailableView(
                        "No photos yet",
                        systemImage: "photo.on.rectangle.angled",
                        description: Text("Long-press the map to post a photo, or tap +.")
                    )
                    .background(.thinMaterial)
                    .allowsHitTesting(false)   // don't let the overlay swallow map gestures
                }
            }
        }
    }

    /// Long-press → screen point → map coordinate → "post a photo here" sheet.
    private func longPressToPost(_ proxy: MapProxy) -> some Gesture {
        LongPressGesture(minimumDuration: 0.4)
            .sequenced(before: DragGesture(minimumDistance: 0, coordinateSpace: .local))
            .onEnded { value in
                guard case .second(true, let drag?) = value,
                      let coordinate = proxy.convert(drag.location, from: .local) else { return }
                pendingPost = IdentifiableCoordinate(coordinate: coordinate)
            }
    }

    private var photoStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                    Button {
                        openPopup(at: index)
                    } label: {
                        CachedImage(url: URL(string: photo.displayUrl), tripId: photo.tripId,
                                    photoId: photo.id, tier: .display) {
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
}

private extension Photo {
    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }
}

/// Wraps a coordinate so it can drive a `.sheet(item:)` (CLLocationCoordinate2D isn't Identifiable).
private struct IdentifiableCoordinate: Identifiable {
    let id = UUID()
    let coordinate: CLLocationCoordinate2D
}

/// Sheet shown after a long-press on the map: confirms the spot and lets the user pick a
/// photo to post there (location-first — the chosen coordinate overrides the photo's EXIF).
private struct PostPhotoHereSheet: View {
    let coordinate: CLLocationCoordinate2D
    let onPick: (PhotosPickerItem) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var item: PhotosPickerItem?

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                Image(systemName: "mappin.circle.fill")
                    .font(.system(size: 52))
                    .foregroundStyle(.red)
                Text("Add a photo here")
                    .font(.headline)
                Text("It’ll be pinned to this spot on your map, wherever the photo was actually taken.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                PhotosPicker(selection: $item, matching: .images,
                             preferredItemEncoding: .current, photoLibrary: .shared()) {
                    Label("Choose Photo", systemImage: "photo.on.rectangle")
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
            .navigationTitle("Post Here")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .onChange(of: item) { _, newItem in
                if let newItem { onPick(newItem) }
            }
        }
    }
}

/// Top-of-map banner showing this trip's in-flight and failed uploads. Progress is
/// driven by the persisted `bytesUploaded`; failed items expose a Retry button (AC3.5).
private struct UploadBanner: View {
    let uploads: [UploadQueueItem]
    let onRetry: (UploadQueueItem) -> Void
    let onDismiss: (UploadQueueItem) -> Void

    var body: some View {
        VStack(spacing: 8) {
            ForEach(uploads) { item in
                HStack(spacing: 12) {
                    if item.stage == .failed {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.filename).font(.subheadline).lineLimit(1)
                            Text(item.errorMessage ?? "Upload failed").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Retry") { onRetry(item) }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                        Button { onDismiss(item) } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.title3)
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Dismiss")
                    } else {
                        Group {
                            if let fraction = fraction(item) {
                                ProgressView(value: fraction)
                            } else {
                                ProgressView()
                            }
                        }
                        .progressViewStyle(.circular)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.filename).font(.subheadline).lineLimit(1)
                            Text("Uploading…").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding(.horizontal)
        .padding(.top, 8)
    }

    /// Determinate fraction when the size is known; nil (indeterminate) otherwise.
    private func fraction(_ item: UploadQueueItem) -> Double? {
        guard item.sizeBytes > 0 else { return nil }
        return min(1.0, Double(item.bytesUploaded) / Double(item.sizeBytes))
    }
}

/// Circular thumbnail used as a map annotation marker.
private struct PinThumbnail: View {
    let photo: Photo

    var body: some View {
        CachedImage(url: URL(string: photo.thumbnailUrl), tripId: photo.tripId,
                    photoId: photo.id, tier: .thumb) {
            Image(systemName: "photo").imageScale(.small).foregroundStyle(.secondary)
        }
        .frame(width: 40, height: 40)
        .clipShape(Circle())
        .overlay(Circle().stroke(.white, lineWidth: 2))
        .shadow(radius: 2)
    }
}
