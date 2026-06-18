# Native iOS — Phase 3: Owner View Core (Trip List/Create/Import + MKMapView + Carousel Sync) Implementation Plan

**Goal:** The owner read experience at website parity — trip list/create/import backed by Keychain + GRDB, the `MKMapView` map with tappable thumbnail annotations, the photo carousel, the **two-way popup↔carousel sync** (single `selectedPhotoId` source of truth, feedback-loop-guarded), fit-bounds, and the fullscreen slideshow.

**Architecture:** SwiftUI `NavigationStack` for List → Detail → (Photo) drill-down, `@Observable` view models (one per screen), GRDB `ValueObservation` driving reactive updates (stale-while-revalidate: render cached rows, background-fetch via `RoadTripAPI`, write GRDB, observation re-fires). The map is the **sole UIKit component**: `MKMapView` wrapped in `UIViewRepresentable` with a `Coordinator` as `MKMapViewDelegate`. Selection is one `selectedPhotoId: Int?` on `TripDetailViewModel`; the map sets `mapView.selectedAnnotations` from it (one-way in `updateUIView`) and the delegate writes taps back (no loop).

**Tech Stack:** SwiftUI (iOS 17), MapKit (`MKMapView`, `MKAnnotation`, `MKMarkerAnnotationView`, `setVisibleMapRect`), GRDB `ValueObservation`, `RoadTripAPI` (Phase 2), `KeychainStore`/`PhotoFileCache` (scaffold). `AsyncImage` with `PhotoFileCache` fallback for thumbnails.

**Scope:** Phase 3 of 8. **This is the signature parity surface — a simulator screenshot is required for sign-off.**

**Codebase verified:** 2026-06-18.

---

## Verified facts grounding this phase

- **Precondition (facade absence):** Phase 1 Task 4 confirmed the design's PR #108 facade (`Views/*`, `App/SampleData.swift`) does **not** exist — there is nothing to build on. Re-confirm before creating files: `Views/` and `ViewModels/` must not exist (create them fresh); `ContentView.swift` is a placeholder to be replaced by the `NavigationStack` root. If `Views/` or `App/SampleData.swift` is unexpectedly present (codebase drift), **STOP and reconcile** — do not build on facade code.
- `Trip` (UUID id, name, description?, slug?, photoCount, createdAt, cachedAt), `Photo` (Int id, tripId, 3 tier URL strings, lat/lng NOT NULL, placeName, caption?, takenAt?, uploadId?, **placeNamePending** from Phase 1) are the GRDB records to observe.
- `KeychainStore`: `setToken(_:kind:tripId:)`, `token(kind:tripId:)`, `removeToken`, `removeAll`. `TokenKind.secret` / `.view`. There is **no server "list my trips" endpoint** — the trip list is exactly the set of trips whose `secretToken` is in Keychain (mirrored as GRDB `trip` rows). Design native-ios.AC1.2 sorts by `created_at desc`.
- `RoadTripAPI` (Phase 2) provides `createTrip`, `tripForPost`, `photosForPost`, `tripForView`, `photosForView`.
- Web behavioral source of truth to PORT (do not reinvent): `src/RoadTripMap/wwwroot/js/photoCarousel.js` (scroll-snap strip + fullscreen viewer: Escape/arrows/swipe/tap-chrome) and `postUI.js` (`renderPhotoMap`: fit-bounds, popup↔carousel two-way sync, single `selectedPhotoId`). Read both.
- Tier URLs in `PhotoResponse` are server-relative; prefix `AppConfig.apiBaseURL` to load images.
- **MapKit two-way sync (research):** drive `mapView.selectedAnnotations` from model state in `updateUIView`; in `Coordinator.mapView(_:didSelect:)` write back to the model on the main actor; guard so a model-driven selection doesn't re-fire as a user tap. Use `clusteringIdentifier` for built-in clustering (sufficient for 50+ pins).

---

## Acceptance Criteria Coverage

### native-ios.AC1: Trip CRUD via native client
- **native-ios.AC1.1 Success:** User taps "+ New Trip", fills form, submits → trip appears in TripListView from GRDB; SecretToken stored in Keychain
- **native-ios.AC1.2 Success:** TripListView shows all trips for which a SecretToken is in Keychain, sorted by `created_at` descending
- **native-ios.AC1.3 Success:** User taps "Import via Token", pastes a SecretToken Guid → app calls `/api/post/{token}`, hydrates Trip + photos into GRDB, trip appears in list

### native-ios.AC5: MapKit display for road-trip use case
- **native-ios.AC5.1 Success:** TripDetailView's `MKMapView` (via `UIViewRepresentable`) renders a thumbnail annotation for each photo with non-null GPS; `setVisibleMapRect` fits all pins on first render
- **native-ios.AC5.2 Success:** Tap on a map annotation selects it (drives `selectedPhotoId`) and opens `PhotoDetailView` via `NavigationStack`
- **native-ios.AC5.3 Success:** Map controls (compass, user-location, scale) visible and functional via `showsCompass` / `showsUserLocation` / `showsScale`
- **native-ios.AC5.4 Success:** Trip with 0 photos → map renders centered on user location with "no photos yet" empty state

### native-ios.AC9: Owner-view parity — carousel, map sync, slideshow
- **native-ios.AC9.1 Success:** Carousel strip renders horizontal scroll-snap thumbnails with place-name labels, ordered by `COALESCE(takenAt, createdAt)` ascending
- **native-ios.AC9.2 Success:** Tapping a map annotation scrolls/highlights the matching carousel item; selecting a carousel item selects + pans to the matching map annotation (single `selectedPhotoId`, no feedback loop)
- **native-ios.AC9.3 Success:** Fullscreen slideshow opens from a thumbnail and supports prev/next, horizontal-swipe, keyboard arrows, and tap-to-toggle-chrome
- **native-ios.AC9.4 Success:** Map annotation popup shows thumbnail + place name + caption + date; opening a popup selects the photo

**Environment:** **Mac** (Swift build + simulator). Screenshot required.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) — Trip list / create / import -->

<!-- START_TASK_1 -->
### Task 1: `TripListView` + `TripListViewModel` (NavigationStack root)

**Verifies:** native-ios.AC1.2

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/ViewModels/TripListViewModel.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/Views/Trips/TripListView.swift`
- Modify: `ios-swift/RoadTrip/RoadTrip/App/ContentView.swift` (replace placeholder with `NavigationStack { TripListView() }`)
- Create/modify: dependency wiring in `App/RoadTripApp.swift` (inject `AppDatabase`, `RoadTripAPI`, `KeychainStore` via `@Environment` or an `AppContainer` passed down)
- Test: `ios-swift/RoadTrip/RoadTripTests/TripListViewModelTests.swift`

**Implementation:**
- `@Observable @MainActor final class TripListViewModel` holding `var trips: [Trip] = []`. On `start()`, open a GRDB `ValueObservation` over `Trip.order(Column("createdAt").desc)` and assign results to `trips` (Swift note: GRDB's `ValueObservation.values(in:)` async sequence delivers on the main actor by iOS 17; `for try await rows in observation.values(in: dbQueue) { self.trips = rows }` inside a `Task`).
- `TripListView`: `List(viewModel.trips)` → `NavigationLink(value: trip)` rows showing name + photoCount + relative date. Toolbar: `+` (presents `CreateTripView` sheet) and an import button (presents `PasteTokenView` sheet). `.navigationTitle("My Trips")` (large title). `navigationDestination(for: Trip.self) { TripDetailView(trip:) }`. Empty state when `trips.isEmpty` ("No trips yet — create or import one").
- **Idempotency:** `start()` must be safe to call repeatedly (guard with an `_observing` flag) — SwiftUI may call `.task`/`onAppear` more than once.

**Testing (TripListViewModelTests, in-memory GRDB):**
- native-ios.AC1.2: insert three `Trip` rows with distinct `createdAt`; start the VM; assert `trips` is sorted `createdAt` descending.
- Idempotency: calling `start()` twice does not duplicate the observation / rows.

**Verification (Mac):** `xcodebuild test -only-testing:RoadTripTests/TripListViewModelTests` passes; app launches showing an empty "My Trips" list on the simulator.

**Commit:** `feat(ios): TripListView + TripListViewModel (GRDB ValueObservation, native-ios.AC1.2)`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: `CreateTripView` (online-only create → Keychain + GRDB)

**Verifies:** native-ios.AC1.1

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/ViewModels/CreateTripViewModel.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/Views/Trips/CreateTripView.swift`
- Test: `ios-swift/RoadTrip/RoadTripTests/CreateTripViewModelTests.swift`

**Implementation:**
- Modal sheet `Form` with `name` (required, ≤500 chars) + `description` (optional). "Create" disabled until name non-empty.
- `CreateTripViewModel.create()` (async): call `RoadTripAPI.createTrip` → on success, persist `secretToken` AND `viewToken` to `KeychainStore` (both kinds), insert a `Trip` GRDB row (`id = UUID()` device-generated, `slug` from response, `photoCount = 0`, `createdAt = Date()` — note the server's create response does not return `createdAt`; use device time, the next `tripForPost` revalidation reconciles it, OR call `tripForPost` immediately after create to get the authoritative `createdAt`; prefer the immediate revalidate). Dismiss sheet; `ValueObservation` updates the list.
- Online-only: if `createTrip` throws `.networkUnavailable`, show an error ("Creating a trip needs a connection") and do not write Keychain/GRDB. (Design: trip creation stays online.)
- The Keychain write and GRDB insert must both succeed or neither persist — wrap so a GRDB failure after Keychain write rolls back the Keychain entry (native-ios.AC1.6's no-orphan principle applies on create too).

**Testing (CreateTripViewModelTests):**
- native-ios.AC1.1: with a stubbed `RoadTripAPI` returning a `CreateTripResponse`, `create()` writes the secret token to an (in-memory/unique-service) `KeychainStore` and inserts a `Trip` row; the row's fields match.
- Failure: stubbed API throws `.networkUnavailable` → no Keychain entry, no GRDB row, error surfaced.

**Verification (Mac):** tests pass; on the simulator, creating a trip (against dev slot) makes it appear in the list. Screenshot.

**Commit:** `feat(ios): CreateTripView online create → Keychain + GRDB (native-ios.AC1.1)`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: `PasteTokenView` (import via SecretToken)

**Verifies:** native-ios.AC1.3

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/ViewModels/ImportTripViewModel.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/Views/Trips/PasteTokenView.swift`
- Test: `ios-swift/RoadTrip/RoadTripTests/ImportTripViewModelTests.swift`

**Implementation:**
- Modal sheet: a text field for a SecretToken GUID + "Import". Validate the string parses as `UUID` before calling.
- `ImportTripViewModel.import(token:)`: `RoadTripAPI.tripForPost(secretToken:)` → on 200, write secret token to Keychain, insert/upsert `Trip` row, then `photosForPost` → hydrate `Photo` rows into GRDB (map `PhotoResponse` → `Photo`, `placeNamePending = false`). On `.notFound` (404), show "That link isn't valid" and write nothing (native-ios.AC1.5, fully covered in Phase 7 but the no-write behavior starts here).

**Testing (ImportTripViewModelTests):**
- native-ios.AC1.3: stubbed API returns a trip + 2 photos → Keychain has the secret token, GRDB has the trip + 2 photo rows.
- Invalid token string (not a UUID) → validation error, no API call.

**Verification (Mac):** tests pass; on the simulator, pasting a real dev-slot trip's secret token hydrates it into the list with photos. Screenshot.

**Commit:** `feat(ios): PasteTokenView import via secret token (native-ios.AC1.3)`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-6) — MKMapView + annotations + fit-bounds -->

<!-- START_TASK_4 -->
### Task 4: `PhotoAnnotation` + thumbnail `MKAnnotationView` (pending/committed/failed states)

**Verifies:** native-ios.AC5.1 (annotation rendering portion)

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Map/PhotoAnnotation.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/Map/PhotoAnnotationView.swift`

**Implementation:**
- `final class PhotoAnnotation: NSObject, MKAnnotation` with `coordinate: CLLocationCoordinate2D`, `photoId: Int?` (committed) / `uploadId: UUID?` (optimistic), `state: PinState` (`.pending`/`.committed`/`.failed`), `thumbURL: URL?`, `title`/`subtitle` (place name / caption) for the callout. (Swift note: `MKAnnotation` requires `NSObject` and `@objc dynamic var coordinate` for KVO when the pin moves.)
- `final class PhotoAnnotationView: MKMarkerAnnotationView` (or a plain `MKAnnotationView` with a circular `UIImageView`) showing a circular thumbnail; border color by state: pending = yellow, committed = accent, failed = red (port `optimisticPins.js` CSS classes `.photo-pin--pending/committed/failed`). Set `clusteringIdentifier = "photo"` for built-in clustering. Load the thumbnail from `PhotoFileCache` first, else `AsyncImage`/`URLSession` from `thumbURL`. Provide `canShowCallout = true` with a custom callout (thumbnail + place name + caption + date) for native-ios.AC9.4.

**Verification (Mac):** builds; visual check happens in Task 5/6 on the simulator.

**Commit:** grouped with Task 5.
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: `TripMapView: UIViewRepresentable` + `Coordinator` + fit-bounds + controls

**Verifies:** native-ios.AC5.1, native-ios.AC5.3, native-ios.AC5.4

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Map/TripMapView.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/Map/MapBounds.swift` (pure helper: compute `MKMapRect` union from coordinates)
- Test: `ios-swift/RoadTrip/RoadTripTests/MapBoundsTests.swift`

**Implementation:**
```swift
struct TripMapView: UIViewRepresentable {
    let photos: [Photo]
    @Binding var selectedPhotoId: Int?
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> MKMapView {
        let m = MKMapView()
        m.delegate = context.coordinator
        m.showsCompass = true; m.showsUserLocation = true; m.showsScale = true
        m.register(PhotoAnnotationView.self, forAnnotationViewWithReuseIdentifier: "photo")
        return m
    }
    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.sync(annotationsFor: photos, on: map)   // diff add/remove
        context.coordinator.applySelection(selectedPhotoId, on: map) // one-way model→map
        context.coordinator.fitBoundsIfNeeded(photos, on: map)       // first non-empty render only
    }
    final class Coordinator: NSObject, MKMapViewDelegate { /* ... */ }
}
```
- `Coordinator.fitBoundsIfNeeded`: compute the `MKMapRect` union of all photo coords via `MapBounds.union(of:)` and call `map.setVisibleMapRect(_, edgePadding: .init(top:40,left:40,bottom:40,right:40), animated: false)` ONCE (track a `didFitBounds` flag; don't re-fit on every `updateUIView` or the map fights the user). native-ios.AC5.4: if `photos` is empty, do not fit — leave the map centered on user location (default MapKit behavior with `showsUserLocation`).
- `viewFor annotation`: dequeue `PhotoAnnotationView`; skip `MKUserLocation`.
- Pure `MapBounds.union(of coords:) -> MKMapRect?` is unit-tested (returns nil for empty; correct rect for known coords).

**Testing (MapBoundsTests):** union of empty == nil; union of two known coords contains both points.

**Verification (Mac, simulator screenshot):** open a trip with several GPS photos → all thumbnail pins visible and fit within the viewport on first render (native-ios.AC5.1); compass/scale/user-location controls present (native-ios.AC5.3); a 0-photo trip shows the empty state centered on user location (native-ios.AC5.4).

**Commit:** `feat(ios): TripMapView UIViewRepresentable + fit-bounds + controls + PhotoAnnotation (native-ios.AC5.1/5.3/5.4)`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: `TripDetailView` + `TripDetailViewModel` (observation + revalidation + ShareLink)

**Verifies:** native-ios.AC5.2 (selection→navigation portion), foundation for AC9 sync

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/ViewModels/TripDetailViewModel.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/Views/Trips/TripDetailView.swift`
- Test: `ios-swift/RoadTrip/RoadTripTests/TripDetailViewModelTests.swift`

**Implementation:**
- `@Observable @MainActor TripDetailViewModel(trip:)` with `var photos: [Photo] = []`, `var selectedPhotoId: Int?`. `start()`: `ValueObservation` over `Photo.filter(tripId == trip.id).order(by COALESCE(takenAt, createdAt) asc)` → `photos` (native-ios.AC9.1 ordering; GRDB SQL `ORDER BY COALESCE(takenAt, createdAt) ASC`). On appear, fire `photosForPost` revalidation → upsert rows (stale-while-revalidate). Idempotent `start()`.
- `TripDetailView`: vertical split — `TripMapView(photos:, selectedPhotoId:)` on top, `PhotoCarouselView(photos:, selectedPhotoId:)` below (Task 8). `ShareLink` for the view-link URL (`AppConfig.apiBaseURL + "/trips/{viewToken}"`, viewToken from Keychain). When `selectedPhotoId` is set by a tap that should navigate (native-ios.AC5.2), push `PhotoDetailView` via the `NavigationStack` path. Distinguish "select" (highlight + pan, native-ios.AC9.2) from "open detail" (native-ios.AC5.2): selecting highlights; tapping the callout/detail-disclosure opens `PhotoDetailView`. Document this UX split (matches the web: marker tap selects + popup; popup → fullscreen).

**Testing (TripDetailViewModelTests, in-memory GRDB):**
- native-ios.AC9.1 ordering: insert photos with mixed `takenAt`/null `takenAt` (createdAt fallback); assert `photos` order is `COALESCE(takenAt, createdAt)` ascending.
- Revalidation: stubbed API returns an extra photo → after revalidate, GRDB has it and `photos` includes it.

**Verification (Mac, screenshot):** opening a trip shows map + carousel; tapping a thumbnail annotation opens `PhotoDetailView` (native-ios.AC5.2). (Full two-way sync is Task 9.)

**Commit:** `feat(ios): TripDetailView + TripDetailViewModel (observation, revalidation, ShareLink, native-ios.AC5.2/native-ios.AC9.1)`
<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 7-9) — carousel, fullscreen, two-way sync -->

<!-- START_TASK_7 -->
### Task 7: `PhotoCarouselView` (scroll-snap strip + place-name labels)

**Verifies:** native-ios.AC9.1

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Views/Photos/PhotoCarouselView.swift`

**Implementation:**
- Port `photoCarousel.js`'s strip: a horizontal `ScrollView(.horizontal)` with `LazyHStack` of thumbnail cards, each showing the thumbnail (`PhotoFileCache` → `AsyncImage` fallback) + a place-name label (show "Locating…" when `placeNamePending`). iOS 17: use `.scrollTargetBehavior(.viewAligned)` + `.scrollTargetLayout()` for scroll-snap, and `.scrollPosition(id:)` bound to the selected id for programmatic scroll. Order is the VM's `photos` (already `COALESCE(takenAt, createdAt)` asc).
- Tapping a card sets `selectedPhotoId` (binding). Tapping again (or a dedicated control) opens the fullscreen viewer (Task 8).

**Verification (Mac, screenshot):** carousel renders ordered thumbnails with place-name labels; horizontal scroll-snaps.

**Commit:** grouped with Task 9.
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: `FullscreenViewer` (prev/next/swipe/keyboard/tap-chrome)

**Verifies:** native-ios.AC9.3

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Views/Photos/FullscreenViewer.swift`

**Implementation:**
- Port `photoCarousel.js` fullscreen behavior. A full-screen cover (`.fullScreenCover`) with a `TabView(selection:).tabViewStyle(.page(indexDisplayMode: .never))` over the `photos` array for horizontal-swipe + prev/next; bind selection to the current index. Load `display` tier (`PhotoFileCache` → `AsyncImage`).
- **Tap-to-toggle-chrome:** tapping the image toggles a `chromeHidden` state that hides the close button + actions (port `.chrome-hidden`).
- **Keyboard arrows:** iOS 17 — add `.onKeyPress(.leftArrow)`/`.onKeyPress(.rightArrow)` to move prev/next (works with a hardware keyboard / simulator).
- Close via an explicit close button and swipe-down-to-dismiss (a `DragGesture` threshold dy>100 — port the web's threshold; native-only is fine since this app is native).
- Native polish (haptics, immersive status bar) is explicitly OUT of MVP scope (design exclusions) — keep it functional, not fancy.

**Verification (Mac, screenshot):** open fullscreen from a thumbnail; swipe and arrow keys navigate; tap toggles chrome; close returns to detail.

**Commit:** grouped with Task 9.
<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: Two-way popup↔carousel sync (single `selectedPhotoId`, loop-guarded)

**Verifies:** native-ios.AC9.2, native-ios.AC9.4

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Map/TripMapView.swift` (Coordinator selection write-back + guard)
- Modify: `ios-swift/RoadTrip/RoadTrip/Views/Photos/PhotoCarouselView.swift` (scroll to selection)
- Modify: `ios-swift/RoadTrip/RoadTrip/ViewModels/TripDetailViewModel.swift` (owns `selectedPhotoId`)
- Test: `ios-swift/RoadTrip/RoadTripTests/SelectionSyncTests.swift`

**Implementation:** (port `postUI.js` single-source-of-truth sync)
- `selectedPhotoId: Int?` lives only on `TripDetailViewModel`. Both the map and the carousel are **read-only views of it** plus write-on-user-action:
  - **Carousel → state:** tapping a card sets `selectedPhotoId`.
  - **state → carousel:** `.scrollPosition` scrolls to `selectedPhotoId` (and highlights it).
  - **Map → state:** `Coordinator.mapView(_:didSelect:)` sets `selectedPhotoId` (on the main actor) AND opens the callout/popup (native-ios.AC9.4: popup shows thumbnail + place name + caption + date; opening it selects the photo).
  - **state → Map:** `updateUIView` calls `applySelection` which sets `mapView.selectedAnnotations` and pans to it.
- **Feedback-loop guard:** when `applySelection` programmatically selects an annotation, set a `coordinator.isApplyingSelection = true` flag so the resulting `didSelect` delegate callback is ignored (doesn't re-write state). Clear the flag after. Symmetric guard for deselection. This is the native analog of the web's "each path updates a different component" guard.

**Testing (SelectionSyncTests):**
- Setting `viewModel.selectedPhotoId` does not cause a second mutation when the map applies it (assert the model write happens once — test the Coordinator's guard logic by simulating `didSelect` while `isApplyingSelection` is true → no model write).
- Tapping (simulated `didSelect` while flag false) writes `selectedPhotoId`.

**Verification (Mac, screenshot — the signature parity check):** tap a map annotation → carousel scrolls/highlights the matching item AND the popup shows thumbnail/place/caption/date; tap a carousel item → map selects + pans to the matching annotation. No flicker/loop.

**Commit:** `feat(ios): PhotoCarousel + FullscreenViewer + two-way map↔carousel sync (native-ios.AC9.1-9.4)`
<!-- END_TASK_9 -->

<!-- END_SUBCOMPONENT_C -->

---

## Phase Done When
Create-trip ends with a new trip in the list (native-ios.AC1.1); paste-token hydrates a dev-slot trip + photos into GRDB (native-ios.AC1.3); the list is `created_at desc` (native-ios.AC1.2); the map shows thumbnail annotations for all GPS photos and fits bounds on first render with compass/scale/user-location controls (native-ios.AC5.1/5.3), 0-photo empty state centered on user (native-ios.AC5.4); tapping an annotation opens `PhotoDetailView` (native-ios.AC5.2); the carousel is ordered `COALESCE(takenAt, createdAt)` asc with place-name labels (native-ios.AC9.1); two-way map↔carousel selection works with no loop and the popup shows thumbnail/place/caption/date (native-ios.AC9.2/9.4); fullscreen slideshow supports swipe/arrows/tap-chrome (native-ios.AC9.3). **All verified on the simulator with screenshots** (Mac).
