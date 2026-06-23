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

    @AppStorage("showRoute") private var showRoute = true

    @State private var photos: [Photo] = []
    @State private var cameraPosition: MapCameraPosition = .automatic
    @State private var popupPhotoID: Int?   // id of the open photo (stable across list changes); nil = closed
    @State private var popupImmersive = false   // popup tapped into full-black mode → hide the floating bar
    @State private var pickedItem: PhotosPickerItem?
    @State private var isStaging = false
    @State private var captureMessage: String?
    @State private var uploads: [UploadQueueItem] = []
    @State private var didFrameCamera = false
    @State private var toastMessage: String?
    @State private var photoToMove: Photo?
    @State private var stagedNeedingLocation: UploadQueueItem?
    @State private var pendingPost: IdentifiableCoordinate?
    @State private var shareViewToken: UUID?
    @State private var secretToken: UUID?
    @State private var showCamera = false
    @State private var showLibraryPicker = false
    @State private var locationProvider: any LocationProviding = OneShotLocationProvider()

    var body: some View {
        // Build the committed+optimistic list ONCE per render and thread it through, rather than
        // recomputing it in the map, strip, popup, and empty-state separately.
        let shown = displayPhotos
        return ZStack {
            VStack(spacing: 0) {
                mapSection(shown)
                // Show the strip when there's anything to show — committed or optimistic — so a
                // brand-new trip whose first photo is added offline still gets a filmstrip entry.
                if !shown.isEmpty {
                    photoStrip(shown)
                }
            }

            if let openIndex = shown.firstIndex(where: { $0.id == popupPhotoID }) {
                PhotoPopupView(
                    photos: shown,
                    // Track the open photo by IDENTITY, not position: when the list reorders (an
                    // upload commits and sorts into capture-time order) the popup stays on the same
                    // photo instead of jumping to whatever now sits at the old index.
                    selection: Binding(
                        get: { shown.firstIndex(where: { $0.id == popupPhotoID }) ?? openIndex },
                        set: { idx in if shown.indices.contains(idx) { popupPhotoID = shown[idx].id } }
                    ),
                    immersive: $popupImmersive,
                    onClose: { closePopup() },
                    onMovePin: { photo in
                        closePopup()
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
        .toolbar(.hidden, for: .navigationBar)
        .overlay(alignment: .top) {
            // Floating bar and the upload banner share the top region — stack them so the
            // banner appears BELOW the bar instead of colliding behind it. Both fall away when
            // the photo popup goes full-black immersive, so nothing floats over the photo.
            if !popupImmersive {
                VStack(spacing: 8) {
                    floatingTopBar
                    // Only FAILED uploads get a banner (with Retry). In-progress/waiting uploads
                    // are shown by their pending map pin + filmstrip thumbnail instead — a progress
                    // banner would sit stuck on screen for the whole no-service period.
                    if !failedUploads.isEmpty {
                        UploadBanner(uploads: failedUploads,
                                     onRetry: { item in Task { await retryUpload(item) } },
                                     onDismiss: { item in dismissUpload(item) })
                            .accessibilityIdentifier("upload-banner")
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .transition(.opacity)
            }
        }
        .onChange(of: pickedItem) { _, newItem in
            guard let newItem else { return }
            Task { await stage(newItem) }
        }
        // If the open photo leaves the list (an optimistic photo finished uploading / failed), the
        // popup has nothing valid to show — dismiss it rather than snap to a different photo.
        .onChange(of: openPopupIndex) { _, idx in
            if popupPhotoID != nil && idx == nil { closePopup() }
        }
        .alert("Photo", isPresented: Binding(
            get: { captureMessage != nil },
            set: { if !$0 { captureMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(captureMessage ?? "")
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
        // `photoLibrary: .shared()` is REQUIRED, not optional: the staging pipeline resolves the
        // picked item to a PHAsset via `item.itemIdentifier` (PhotosPicker strips EXIF, so we read
        // raw bytes from the asset to keep location). `itemIdentifier` is only populated when the
        // picker is bound to the shared library — drop `.shared()` and every pick throws
        // CaptureError.noAsset ("Couldn't read that photo from your library"). See PhotoCaptureCoordinator.loadImageData.
        // StagingPhotosPicker hard-codes .shared() so this can't be accidentally dropped.
        .stagingPhotosPicker(isPresented: $showLibraryPicker, selection: $pickedItem)
        .sheet(isPresented: $showCamera) {
            CameraPicker { image in
                guard let image else { return }
                Task { await stageCameraImage(image) }
            }
            .ignoresSafeArea()
        }
        .task { await observePhotos() }
        .task { await observeUploads() }
        .task { loadShareTokens() }
    }

    @ViewBuilder private var floatingTopBar: some View {
        ZStack {
            // Centered trip name. Back (left) and Share (right) are single glyphs, so the title
            // sits at the true center; horizontal padding keeps it clear of those buttons.
            Text(trip.name)
                .font(.headline)
                .lineLimit(1)
                .truncationMode(.tail)
                .padding(.horizontal, 44)

            HStack(spacing: 12) {
                Button { dismiss() } label: {
                    Image(systemName: "chevron.backward")
                        .font(.headline)
                }
                .accessibilityLabel(Text("Back"))
                .accessibilityIdentifier("trip-back")

                Spacer()

                if secretToken != nil {
                    shareMenu
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        // Shadow goes on the background SHAPE only — applying .shadow to the whole bar
        // makes the translucent material let each text glyph cast its own shadow ("bloom").
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(.regularMaterial)
                .shadow(radius: 4, y: 2)
        )
    }

    @ViewBuilder private var shareMenu: some View {
        if let secretToken {
            Menu {
                if let shareViewToken {
                    ShareLink(item: TripShareLinks.shareViewURL(viewToken: shareViewToken,
                                                                baseURL: APIEnvironment.baseURL)) {
                        Label("Share view link", systemImage: "link")
                    }
                }
                ShareLink(item: inviteText(name: trip.name, secret: secretToken)) {
                    Label("Invite to edit", systemImage: "person.badge.plus")
                }
            } label: { Label("Share", systemImage: "square.and.arrow.up").labelStyle(.iconOnly) }
        }
    }

    @ViewBuilder private var addPhotoMenu: some View {
        Menu {
            Button {
                showCamera = true
            } label: { Label("Take Photo", systemImage: "camera") }
                .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
            Button {
                showLibraryPicker = true
            } label: { Label("Choose from Library", systemImage: "photo.on.rectangle") }
        } label: {
            // Styled like the recenter/route map controls — it now lives at the lower-right.
            // Accessibility label/identifier kept for VoiceOver + UI tests.
            mapControlIcon("photo.badge.plus")
        }
        .accessibilityLabel(Text("Add Photo"))
        .accessibilityIdentifier("Add Photo")
        .disabled(isStaging)
    }

    /// Shared style for the floating map-overlay controls (recenter, route toggle) so they are
    /// identical in size and color. The fixed frame normalizes differing SF Symbol glyph widths.
    private func mapControlIcon(_ systemName: String) -> some View {
        Image(systemName: systemName)
            .font(.title2)
            .frame(width: 29, height: 29)
            .padding(10)
            .background(.regularMaterial, in: Circle())
    }

    private func loadShareTokens() {
        // Compute tokens once, handling UUID?? by flattening with ?? nil
        shareViewToken = (try? keychain.token(kind: .view, tripId: trip.id)) ?? nil
        secretToken = (try? keychain.token(kind: .secret, tripId: trip.id)) ?? nil
    }

    private func inviteText(name: String, secret: UUID) -> String {
        "Join my Road Trip \"\(name)\" — open the app → Import via Token → paste: \(secret.uuidString)"
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
        closePopup()
        Task {
            do {
                try await PhotoMutations(database: database, keychain: keychain).deletePhoto(photo)
            } catch {
                showToast("Couldn't delete that photo — it's back on your map.")
            }
        }
    }

    private func moveLocation(_ photo: Photo, to coordinate: CLLocationCoordinate2D) {
        Task {
            do {
                try await PhotoMutations(database: database, keychain: keychain)
                    .moveLocation(photo, lat: coordinate.latitude, lng: coordinate.longitude)
            } catch {
                showToast("Couldn't move that pin — it's back where it was.")
            }
        }
    }

    /// Camera capture path: transcode JPEG, fetch one-shot location, stage, and handle no-GPS case.
    private func stageCameraImage(_ image: UIImage) async {
        isStaging = true
        defer { isStaging = false }

        guard let data = image.jpegData(compressionQuality: 0.9) else { return }
        let coordinate = await locationWithTimeout(locationProvider)
        let filename = "camera-\(UUID().uuidString).jpg"
        do {
            let item = try await PhotoCaptureCoordinator(database: database)
                .stagePhoto(imageData: data, filename: filename, tripId: trip.id, overrideCoordinate: coordinate)
            if item.exifLat == nil || item.exifLon == nil {
                stagedNeedingLocation = item
            } else {
                startUpload(item)
            }
        } catch {
            captureMessage = "Couldn't add that photo. Please try again."
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
            captureMessage = "Road Trip needs photo access to keep a photo's location. You can enable it in Settings."
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
            captureMessage = "Couldn't read that photo from your library. Try another, or grant full photo access."
        } catch {
            captureMessage = "Couldn't add that photo. Please try again."
        }
    }

    /// Hands the staged photo to the shared background uploader. It survives backgrounding and
    /// force-quit (true background `URLSession`), persists `.failed` on exhaustion (the banner
    /// surfaces Retry), and the committed pin appears via the photos `ValueObservation` on
    /// revalidate — no manual reload here.
    private func startUpload(_ item: UploadQueueItem) {
        guard let session = BackgroundUploadSession.shared else {
            assertionFailure("BackgroundUploadSession.shared is nil — configureShared must be called at launch before any upload")
            captureMessage = "Upload system not ready. Please restart the app and try again."
            return
        }
        session.start(item.uploadId)
    }

    private func retryUpload(_ item: UploadQueueItem) async {
        guard let session = BackgroundUploadSession.shared else {
            assertionFailure("BackgroundUploadSession.shared is nil — configureShared must be called at launch before any retry")
            return
        }
        session.retry(item.uploadId)
    }

    /// Removes a stuck/failed upload (its row, staged file, and block files) so the banner can
    /// be cleared even when retry is futile (e.g. the source photo is gone).
    private func dismissUpload(_ item: UploadQueueItem) {
        guard let session = BackgroundUploadSession.shared else {
            assertionFailure("BackgroundUploadSession.shared is nil — configureShared must be called at launch before any dismiss")
            return
        }
        session.abort(item.uploadId)
    }

    private func mapSection(_ shown: [Photo]) -> some View {
        MapReader { proxy in
            Map(position: $cameraPosition) {
                if showRoute, routeCoordinates.count >= 2 {
                    MapPolyline(coordinates: RouteCurve.curved(through: routeCoordinates))
                        .stroke(.tint, style: StrokeStyle(
                            lineWidth: 3,
                            lineCap: .round,
                            lineJoin: .round,
                            dash: [2, 10]))
                }

                // Committed AND optimistic (staged, not-yet-uploaded) photos render as one list, so
                // an offline photo is a first-class pin — tappable into the same popup — differing
                // only by an upload badge.
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, photo in
                    Annotation(photo.placeName, coordinate: photo.coordinate) {
                        Button {
                            openPopup(at: index)
                        } label: {
                            PinThumbnail(photo: photo)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(photo.isOptimistic ? "Photo uploading" : photo.placeName))
                        .accessibilityIdentifier(photo.isOptimistic ? "pending-pin" : "photo-pin")
                        .accessibilityAddTraits(.isButton)
                    }
                }
            }
            // MapCompass appears only when rotated; MapScaleView only during zoom. We drop
            // MapUserLocationButton and provide our own recenter button below so the two
            // map-overlay controls share one consistent style and can't collide.
            .mapControls {
                MapCompass()
                MapScaleView()
            }
            // Custom control cluster (top-trailing, below the floating bar). Built by hand rather
            // than via .mapControls so both buttons match in size, color, and alignment and are
            // vertically stacked — no collision with MapKit's auto-placed user-location button.
            .overlay(alignment: .topTrailing) {
                VStack(spacing: 10) {
                    Button {
                        withAnimation(.easeInOut(duration: 0.3)) {
                            cameraPosition = .userLocation(fallback: .automatic)
                        }
                    } label: {
                        mapControlIcon("location")
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Center on my location"))
                    .accessibilityIdentifier("recenter-location")

                    Button {
                        showRoute = !showRoute
                    } label: {
                        mapControlIcon(showRoute ? "point.topleft.down.curvedto.point.bottomright.up"
                                                 : "point.topleft.down.curvedto.point.bottomright.up.fill")
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(showRoute ? "Hide route" : "Show route"))
                    .accessibilityIdentifier("route-toggle")
                }
                .padding(.top, 70)
                .padding(.trailing, 12)
            }
            // Primary action — Add Photo — pulled out of the top bar and placed prominently at the
            // lower-right (same size/style and trailing column as the recenter + route controls).
            // Posting photos is the app's core action, so it shouldn't hide in a top corner.
            .overlay(alignment: .bottomTrailing) {
                addPhotoMenu
                    .padding(.trailing, 12)
                    .padding(.bottom, 16)
            }
            // Long-press to post a photo at that spot (Apple Maps "drop a pin" pattern).
            // `.simultaneousGesture` keeps pan/zoom and pin taps working; the long-press
            // requires a hold, so it won't fire on a quick tap or a pan.
            .simultaneousGesture(longPressToPost(proxy))
            .overlay {
                // Key on the combined list (committed + optimistic) so a trip whose only photo is an
                // offline/pending one doesn't show "No photos yet" over its visible pending pin.
                if shown.isEmpty {
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

    private func photoStrip(_ shown: [Photo]) -> some View {
        // As the popup pages between photos, keep the open photo's thumbnail centred in the strip
        // (Photos.app filmstrip behaviour). At the first/last photo the ScrollView clamps, so the
        // edge thumbnail simply rests against the end rather than forcing a centre.
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, photo in
                        Button {
                            openPopup(at: index)
                        } label: {
                            CachedImage(url: URL(string: photo.displayUrl), tripId: photo.tripId,
                                        photoId: photo.id, tier: .display) {
                                Color.secondary.opacity(0.15)
                            }
                            .frame(width: 92, height: 92)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .optimisticBadge(if: photo.isOptimistic, size: 20, alignment: .bottomTrailing, inset: 5)
                        }
                        .buttonStyle(.plain)
                        .id(photo.id)
                        .accessibilityIdentifier(photo.isOptimistic ? "pending-strip-item" : "strip-item")
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 12)
            }
            .frame(height: 116)
            .background(.thinMaterial)
            .onChange(of: popupPhotoID) { _, newValue in
                guard let newValue else { return }
                withAnimation(.easeInOut(duration: 0.25)) {
                    proxy.scrollTo(newValue, anchor: .center)   // strip cells are .id(photo.id)
                }
            }
        }
    }

    private func openPopup(at index: Int) {
        let shown = displayPhotos
        guard shown.indices.contains(index) else { return }
        popupImmersive = false
        withAnimation(.easeIn(duration: 0.2)) { popupPhotoID = shown[index].id }
    }

    /// Dismiss the popup. ALWAYS clear `popupImmersive` here too — otherwise dismissing from the
    /// black immersive view leaves the map's floating title bar hidden until the next open.
    private func closePopup() {
        withAnimation(.easeOut(duration: 0.2)) {
            popupPhotoID = nil
            popupImmersive = false
        }
    }

    private var routeCoordinates: [CLLocationCoordinate2D] {
        photos.map(\.coordinate)
    }

    /// The single list the map, filmstrip, and popup all render: committed photos plus optimistic
    /// (staged, not-yet-uploaded) ones, so an offline photo behaves exactly like a posted one.
    private var displayPhotos: [Photo] {
        DisplayPhotos.build(committed: photos, pending: uploads)
    }

    /// Only genuinely failed uploads get the banner; waiting/in-progress ones are shown by their
    /// optimistic pin + filmstrip thumbnail instead.
    private var failedUploads: [UploadQueueItem] {
        uploads.filter { $0.stage == .failed }
    }

    /// The index of the open photo in `displayPhotos`, resolved by id. `nil` when closed, or when
    /// the open photo has left the list (an optimistic photo that just committed/failed) — that case
    /// dismisses the popup rather than letting a stale index point at the wrong photo.
    private var openPopupIndex: Int? {
        guard let popupPhotoID else { return nil }
        return displayPhotos.firstIndex { $0.id == popupPhotoID }
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
                Text("It'll be pinned to this spot on your map, wherever the photo was actually taken.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                StagingPhotosPicker(selection: $item) {
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

/// Circular thumbnail used as a map annotation marker. Renders committed (server) and optimistic
/// (local `file://`) photos identically — `CachedImage`/`ImageLoader` resolve both — and overlays an
/// upload badge while the photo is still optimistic.
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
        .optimisticBadge(if: photo.isOptimistic, size: 16, alignment: .bottomTrailing, inset: 1)
        .shadow(radius: 2)
    }
}

/// The "uploading" marker shown on an optimistic photo (map pin, filmstrip, popup) — the only visual
/// difference from a posted photo.
struct OptimisticUploadBadge: View {
    var size: CGFloat = 16

    var body: some View {
        Image(systemName: "arrow.up.circle.fill")
            .font(.system(size: size))
            .symbolRenderingMode(.palette)
            .foregroundStyle(.white, .blue)
            .accessibilityHidden(true)
    }
}

extension View {
    /// The single optimistic-photo treatment used on the map pin, filmstrip, and popup: an upload
    /// badge in `alignment` plus an optional dim — so the look can't drift between the three sites.
    @ViewBuilder
    func optimisticBadge(if show: Bool, size: CGFloat, alignment: Alignment, inset: CGFloat, dim: Bool = true) -> some View {
        opacity(show && dim ? 0.9 : 1)
            .overlay(alignment: alignment) {
                if show { OptimisticUploadBadge(size: size).padding(inset) }
            }
    }
}
