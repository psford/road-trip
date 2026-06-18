# Native iOS Rewrite Design

> **Revision history**
> - **2026-06-18** — Major revision (in place, `native-ios` AC prefix preserved). Reconciled against `docs/handoff-2026-06-17.md` and the actual web/iOS code. Key changes: (1) **offline-first optimistic capture** promoted to a headline, gating feature in the first TestFlight cut — the upload state machine gains a pre-SAS "queued offline" state, since `request-upload` cannot run offline; (2) website-parity (no regression) made an explicit functional floor; (3) testers reframed to "≥1 internal, Patrick primary, dad optional"; (4) added an explicit process constraint — design/porting in the Linux container, all build/run/see-on-simulator verification on the Mac; (5) PR #108 facade discarded, storage layer (Phases 1–2 equivalents) reused. Dev slot **retained** (Patrick upgraded Azure for it). Architecture, Acceptance Criteria, and Implementation Phases below are being reworked in this revision.

## Summary

Road Trip is a privacy-first road trip photo sharing app — users create a trip, get a secret link, and pin geotagged photos on an interactive map with no accounts and no tracking. The current iOS client is a Capacitor shell that loads live web pages from an Azure App Service backend into a `WKWebView`. This rewrite replaces that hybrid shell with a fully native SwiftUI app (iOS 17+, `@Observable`, `NavigationStack`) built in a parallel `ios-swift/` directory, leaving the .NET API and its resilient SAS upload protocol completely unchanged. Local persistence uses GRDB.swift with schema-versioned migrations; trip tokens live in the iOS Keychain. The map is the one deliberate UIKit component in an otherwise all-SwiftUI app: an `MKMapView` wrapped in `UIViewRepresentable` with a `Coordinator` as `MKMapViewDelegate`, chosen because the pure SwiftUI `Map` view cannot deliver the interactive thumbnail callouts and tight two-way carousel synchronization that website parity requires. Photo metadata (EXIF GPS, capture timestamp) is recovered through the `PHAsset` / `CGImageSource` stack, and HEIC sources are transcoded to JPEG client-side before upload. An Azure `dev` App Service slot sits alongside the rewrite for backend iteration without touching prod trips.

The headline new capability is offline-first optimistic photo capture. Adding a photo to an existing trip requires no network at capture time: image bytes are written to a non-purgeable on-device cache and an `UploadQueueItem` is persisted to GRDB at the new front stage `queued`, placing an optimistic `pending` pin on the map immediately. A foreground `UploadCoordinator` driven by `NWPathMonitor` makes the JSON API calls (`request-upload`, `commit`) once connectivity returns; the actual block PUTs run on a single background `URLSession` (`waitsForConnectivity = true`, delegate pattern) so transfers survive the app being backgrounded. Force-quit is handled honestly: iOS cancels background tasks on a user force-quit, so the design commits to resuming on next launch via an `UploadReconciler` rather than promising an OS background wake. A photo is never silently lost — permanent commit failures surface a red `failed` pin with manual Retry and Discard actions. The first TestFlight cut targets Patrick as primary internal tester, with the pipeline structured to support adding at least one more tester (his dad, optionally).

## Definition of Done

### Primary Deliverable
New native iOS app (SwiftUI + iOS 17+, MapKit, GRDB.swift for local cache, bare `URLSession` background uploads) at `ios-swift/`. Bundle ID `com.psford.roadtripmap.native` — installs side-by-side with the existing Capacitor app during transition. Reuses the already-merged storage layer (GRDB records, migrator, Keychain, file cache); the PR #108 facade UI is discarded and rebuilt for real. Distributes via TestFlight to **≥1 internal tester (Patrick primary; dad optional)** — the pipeline must support provisioning more than one tester.

### Functional Floor — No Regression vs. the Website
Every behavior the current web owner/viewer experience has today is rebuilt natively, for real (not a facade). Source of truth for behavior is `src/RoadTripMap/wwwroot/js/` — port it, don't reinvent:
- Trip CRUD + paste-token import; "My Trips" list backed by Keychain tokens
- Photo map with **tappable thumbnail popups ↔ carousel two-way sync**, fit-bounds, fullscreen swipe/arrow/tap-chrome slideshow
- Dotted, smoothed, toggleable route line
- POI layer + state-park boundary overlays (MapKit-native overlays replacing MapLibre layers)
- Delete photo, edit photo location (pin-drop + reverse geocode)
- Read-only viewer variant (`/trips/{viewToken}`): same map/carousel, but **save/share** instead of edit/delete

### Headline New Feature — Offline-First Optimistic Capture (in this cut, gating)
Adding a photo to an **already-created** trip works fully offline:
- The pin appears immediately on the owner's map (optimistic, `pending` state) and the image bytes are cached on-device — **no network required at capture time** (this is net-new; the web requires connectivity to call `request-upload`)
- The upload fires automatically when connectivity returns **while the app is in memory**, and **resumes on next app launch** after a force-quit (background `URLSession` may relaunch the app to finish sooner — bonus, not required)
- Permanent failure (commit still failing after retries) → **red `failed` pin with manual Retry / Discard** (porting the web `optimisticPins` model); a photo is never silently lost
- Photo *coordinates* are captured offline (EXIF, or pin-drop on the last-cached map region); the human-readable *place name* backfills on reconnect via `CLGeocoder`. A no-GPS photo requires a pin-drop before it can be queued
- A queued-but-unsent photo is visible only to the owner on-device; view-link viewers see it only after it reaches the server (server is the source of truth for viewers)
- **Trip creation stays online** (the `SecretToken` is server-minted) — offline scope is photos-only

### Backend — Azure Dev Slot (retained)
.NET API stays as-is. Stand up an Azure `dev` App Service slot + dev SQL (Basic DTU 5) + `kv-roadtripmap-dev` + `road-trip-photos-dev` container + `deploy-dev.yml` (manual dispatch), so mutating flows (upload/delete) are tested against **dev infra, not live prod trips**. Read-only `/trips/{viewToken}` web page stays in .NET unchanged. POI / park-boundary / Nominatim / legacy form-POST endpoints remain operational; their deletion is a deferred post-cutover cleanup, not blocking DoD.

### Process Constraint (verification environment)
Design, planning, and reference-porting happen in the Linux dev-container. **All Swift build/run/see-on-simulator verification happens on the Mac** (the container has no Xcode/iOS SDK and cannot compile SwiftUI/MapKit/PhotosUI or run a simulator). Nothing is called "done" until seen running on a simulator/device (screenshot). Each implementation phase below names its verification environment.

### Explicit Exclusions (NOT in DoD)
- App Store public submission / review (TestFlight internal only)
- Android (iOS-only user base)
- Watch / iPad / split-screen polish
- Post-MVP polish: haptics, custom page transitions, immersive fullscreen viewer, skeleton placeholders
- Backend rewrite (.NET stays)
- New backend features (e.g., "list my trips" account-style endpoint)
- **Offline trip *creation*** (photos-only offline; trip creation requires network)
- Scroll-fade work — stays merged-but-undeployed on develop, treated as defunct
- POI / boundary / Nominatim endpoint *deletion* — deferred cleanup, not blocking

## Acceptance Criteria

### native-ios.AC1: Trip CRUD via native client
- **native-ios.AC1.1 Success:** User taps "+ New Trip", fills form, submits → trip appears in TripListView from GRDB; SecretToken stored in Keychain
- **native-ios.AC1.2 Success:** TripListView shows all trips for which a SecretToken is in Keychain, sorted by `created_at` descending
- **native-ios.AC1.3 Success:** User taps "Import via Token", pastes a SecretToken Guid → app calls `/api/post/{token}`, hydrates Trip + photos into GRDB, trip appears in list
- **native-ios.AC1.4 Success:** User deletes a trip → server `DELETE /api/trips/{token}` called, local Trip + photos rows cascade-deleted, Keychain entry removed
- **native-ios.AC1.5 Failure:** Invalid pasted token (404 from server) → user-visible error, no GRDB write, no Keychain write
- **native-ios.AC1.6 Edge:** App killed mid-create → on relaunch, either trip exists in GRDB AND server has it, OR neither has it (no orphan rows on either side)

### native-ios.AC2: Photo capture preserves EXIF + handles HEIC
- **native-ios.AC2.1 Success:** Photo picked via PhotosPicker (with `.readWrite` permission) → app extracts EXIF lat/lng + `takenAt` via PHAsset + CGImageSource; values match what iOS Photos app shows for the same photo
- **native-ios.AC2.2 Success:** HEIC source photo → app transcodes to JPEG client-side; uploaded blob is `image/jpeg` Content-Type, server doesn't see HEIC
- **native-ios.AC2.3 Success:** Photo with EXIF GPS → coordinates come from EXIF; no pin-drop shown (place name backfills via `CLGeocoder` on reconnect)
- **native-ios.AC2.5 Edge:** Limited Photo Library access state → only user-selected photos accessible; EXIF still extractable for those; rest of flow works identically
- **native-ios.AC2.6 Success:** Photo without EXIF GPS → app tries a live `CLLocationManager` fix; if none available, shows pin-drop UI before allowing the photo to be queued (forces a location)

### native-ios.AC3: Background upload survives app lifecycle
- **native-ios.AC3.1 Success:** User starts upload, backgrounds app → upload continues; progress visible on next foreground (from persisted state)
- **native-ios.AC3.2 Success:** User starts upload, force-quits app → on relaunch, in-flight task resumes from last-completed-block
- **native-ios.AC3.3 Success:** SAS URL expires mid-upload (>2h, e.g. queued overnight) → coordinator detects on next block, calls `/request-upload` again, refreshes SAS, resumes from current block
- **native-ios.AC3.4 Success:** Block PUT fails transiently (network drop, 503) → coordinator retries that block with exponential backoff; succeeds on retry
- **native-ios.AC3.5 Failure:** Upload commit fails permanently (server 500 after retries exhausted) → UploadQueueItem stays in `failed` state with error message; user can manually retry from UI
- **native-ios.AC3.6 Edge:** All 3 tiers (original + display + thumb) must commit successfully before Photo row is added to GRDB (no half-uploaded photos visible)

### native-ios.AC4: Mutations are optimistic + revertible
- **native-ios.AC4.1 Success:** User deletes a photo → photo disappears from UI immediately (GRDB row removed), server DELETE called; on success no further UI change
- **native-ios.AC4.2 Failure:** Delete-photo server call fails → photo reappears in UI, error toast shown, GRDB restored
- **native-ios.AC4.3 Success:** User pin-drops a photo to new location → map pin moves immediately, server `/pin-drop` called; on failure pin reverts + error toast
- **native-ios.AC4.4 Success:** User deletes a trip → confirmation prompt, then trip removed from list immediately, GRDB cascade-delete, server DELETE called; revert + toast on failure

### native-ios.AC5: MapKit display for road-trip use case
- **native-ios.AC5.1 Success:** TripDetailView's `MKMapView` (via `UIViewRepresentable`) renders a thumbnail annotation for each photo with non-null GPS; `setVisibleMapRect` fits all pins on first render
- **native-ios.AC5.2 Success:** Tap on a map annotation selects it (drives `selectedPhotoId`) and opens `PhotoDetailView` via `NavigationStack`
- **native-ios.AC5.3 Success:** Map controls (compass, user-location, scale) visible and functional via `showsCompass` / `showsUserLocation` / `showsScale`
- **native-ios.AC5.4 Success:** Trip with 0 photos → map renders centered on user location with "no photos yet" empty state
- **native-ios.AC5.5 Edge:** Trip with 50+ photos → no perceptible lag (built-in marker clustering), tap latency on annotations < 200ms

### native-ios.AC6: TestFlight distribution
- **native-ios.AC6.1 Success:** Archive uploaded via `xcrun altool` is processed by App Store Connect without rejection
- **native-ios.AC6.2 Success:** Patrick added as internal tester, receives install link, build installs on his iPhone; the tester group supports adding ≥1 more (dad optional)
- **native-ios.AC6.3 Success:** `PrivacyInfo.xcprivacy` declares Photo Library access, network access, no tracking, no third-party SDKs
- **native-ios.AC6.4 Failure:** App Store Connect rejection → error documented, fix iterated, not blocked on full App Store review (internal testing only)

### native-ios.AC7: Backend dev slot supports rewrite iteration
- **native-ios.AC7.1 Success:** Bicep deploys `dev` slot to existing `app-roadtripmap-prod` App Service; slot accessible at its slot URL
- **native-ios.AC7.2 Success:** Dev slot connects to `roadtripmap-db-dev` (Basic DTU 5 on same SQL server); EF migrations applied; `/api/version` returns successfully
- **native-ios.AC7.3 Success:** `deploy-dev.yml` GitHub Actions workflow dispatches manually, builds + deploys to dev slot
- **native-ios.AC7.4 Success:** Native client app configured to point at dev slot URL completes full Create→Upload→Pin loop end-to-end against dev infra
- **native-ios.AC7.5 Edge:** Slot-swap from `dev` → prod NOT automated (stays manual via Azure portal per Patrick's directive)

### native-ios.AC8: Offline-first optimistic capture (gating)
- **native-ios.AC8.1 Success:** Add a photo to an existing trip with the device offline (airplane mode) → optimistic `pending` pin appears immediately, image bytes cached on-device, `UploadQueueItem` at stage `queued`, and **no network request is made** (verified by a stubbed transport asserting zero calls)
- **native-ios.AC8.2 Success:** Connectivity returns while the app is in memory → `NWPathMonitor` fires; the coordinator runs `request-upload` → block PUTs → `commit`; pin flips `pending` → `committed` with no user action
- **native-ios.AC8.3 Success:** App force-quit with `queued`/in-flight items → on next launch the reconciler resumes and completes the upload (no OS background wake promised)
- **native-ios.AC8.4 Success:** Photo captured offline with EXIF GPS → pinned at EXIF coords with no pin-drop; place name shows "Locating…" then backfills on reconnect
- **native-ios.AC8.5 Success:** Photo captured offline without EXIF GPS → device `CLLocation` fix used if available, else pin-drop required before queueing
- **native-ios.AC8.6 Failure:** Upload permanently fails (commit 500s after retries exhausted) → red `failed` pin with manual Retry / Discard; the photo is never silently dropped from the queue
- **native-ios.AC8.7 Edge:** Item queued offline overnight (SAS would be >2h stale by upload time) → on reconnect `request-upload` is re-called to mint fresh SAS before any block PUT
- **native-ios.AC8.8 Edge:** A `queued`-but-unsent photo is visible only to the owner on-device; a view-link viewer does not see it until all tiers commit server-side

### native-ios.AC9: Owner-view parity — carousel, map sync, slideshow
- **native-ios.AC9.1 Success:** Carousel strip renders horizontal scroll-snap thumbnails with place-name labels, ordered by `COALESCE(takenAt, createdAt)` ascending
- **native-ios.AC9.2 Success:** Tapping a map annotation scrolls/highlights the matching carousel item; selecting a carousel item selects + pans to the matching map annotation (single `selectedPhotoId`, no feedback loop)
- **native-ios.AC9.3 Success:** Fullscreen slideshow opens from a thumbnail and supports prev/next, horizontal-swipe, keyboard arrows, and tap-to-toggle-chrome
- **native-ios.AC9.4 Success:** Map annotation popup shows thumbnail + place name + caption + date; opening a popup selects the photo

### native-ios.AC10: Map overlay parity — POI, boundaries, route
- **native-ios.AC10.1 Success:** POI markers fetch by viewport + zoom tier (`<7` national_park; `7–9` + state_park/natural; `10+` + historic/tourism), are category-colored, labeled at zoom ≥ 8, and tappable
- **native-ios.AC10.2 Success:** State-park boundaries render as `MKPolygon` overlays with fill + outline + centroid label, reloading on viewport change
- **native-ios.AC10.3 Success:** Dotted route line (`lineDashPattern [3,2]`, smoothed) draws through the trip's photos and toggles on/off
- **native-ios.AC10.4 Edge:** Offline with cached overlay data → overlays still render from the on-device cache
- **native-ios.AC10.5 Edge:** Empty POI/boundary response for a viewport → no overlay drawn, no error

### native-ios.AC11: Read-only viewer variant
- **native-ios.AC11.1 Success:** Trip opened via a `viewToken` shows the same map + carousel but exposes **save/share** actions, not edit/delete
- **native-ios.AC11.2 Failure:** Edit/delete/upload actions are unavailable (not merely hidden) in viewer mode — the API is never called even if a control is reached

## Glossary

- **Capacitor**: Cross-platform framework from Ionic that wraps a web app (HTML/JS/CSS) in a thin native shell. The current Road Trip iOS app is a Capacitor shell that loads live pages from App Service into a `WKWebView`. This rewrite replaces it entirely.
- **WKWebView**: Apple's embedded web browser component used inside iOS apps. The Capacitor shell renders the Road Trip web UI inside a `WKWebView`; the native rewrite eliminates it.
- **SwiftUI**: Apple's declarative UI framework (iOS 13+). Views are written as Swift structs that describe what to render; the framework handles diffing and updates. This rewrite uses SwiftUI for all screens except the map, which uses a UIKit bridge (see `UIViewRepresentable` and `MKMapView`).
- **UIViewRepresentable**: SwiftUI protocol for wrapping a UIKit `UIView` so it can be embedded in a SwiftUI view hierarchy. Used here to host `MKMapView` inside `TripDetailView`; the associated `Coordinator` acts as `MKMapViewDelegate` to handle annotation taps, callouts, and overlay rendering.
- **`@Observable` macro**: Swift 5.9 macro (iOS 17+) that makes a class's stored properties automatically observable by SwiftUI views, replacing the older `ObservableObject` / `@Published` pattern. View models in this project use `@Observable`.
- **NavigationStack**: SwiftUI navigation container (iOS 16+) that manages a push/pop stack of views. Used here for Trip List → Trip Detail → Photo Detail drill-down.
- **GRDB.swift**: Swift library providing a type-safe SQLite API. Used as the local cache for trips, photos, and upload queue state. Chosen over SwiftData for production stability.
- **SwiftData**: Apple's first-party persistence framework (iOS 17+), built on Core Data. Considered and rejected here based on 2026 community consensus that iOS 18 introduced breaking bugs (memory exhaustion on relationship `.count`, `ModelContext.reset` crashes, ambiguous `@ModelActor` thread affinity) that push real apps back to Core Data or GRDB.
- **ValueObservation**: GRDB mechanism that observes a SQL query and fires a new value whenever the underlying rows change. Used here to drive SwiftUI list and map updates whenever the local GRDB cache is modified (analogous to SwiftData's `@Query`).
- **MapKit**: Apple's native mapping framework. Used for the trip map via `MKMapView` (see below). Replaces MapLibre GL JS from the web client.
- **MKMapView**: UIKit class (from MapKit) that renders an interactive map. Wrapped in `UIViewRepresentable` here because it provides the delegate-based control over annotation callouts, overlay rendering, and programmatic camera positioning that the pure SwiftUI `Map` view lacks. The sole UIKit component in the app.
- **MKAnnotationView**: UIKit class used to render a single map annotation (pin). Subclassed here to display circular photo thumbnails in `pending`, `committed`, and `failed` visual states. Built-in `MKMarkerAnnotationView` clustering handles 50+ pins before `ClusterMap` SPM is needed.
- **MKPolygon / MKOverlayRenderer**: MapKit types for rendering polygon overlays on an `MKMapView`. Used here to draw state-park boundary fills and outlines from GeoJSON returned by `/api/park-boundaries`.
- **MKPolyline**: MapKit type for drawing a line overlay. Used for the trip route line drawn through photos ordered by `takenAt`, rendered dashed (`lineDashPattern [3,2]`) and toggleable.
- **`setVisibleMapRect`**: `MKMapView` method that programmatically adjusts the visible region to fit a given bounding rectangle. Used on first render to fit all photo pins within the viewport ("fit-bounds").
- **ClusterMap**: Third-party Swift Package Manager library that adds annotation clustering to MapKit. Not used by default; identified as the fallback if trips routinely exceed 200 pins.
- **PhotosPicker**: SwiftUI component (iOS 16+, `PhotosUI` framework) for browsing and selecting photos from the device library. It intentionally strips EXIF metadata for privacy, which is why the `PHAsset` bridge below is needed.
- **PHAsset**: Represents a photo or video in the user's Photos library (`Photos` framework). Used here to fetch the raw image data (including EXIF) for a photo the user selected through `PhotosPicker`.
- **PHAsset `.readWrite` permission**: The `PHAccessLevel.readWrite` Photo Library authorization level required to call `PHAsset.fetchAssets(withLocalIdentifiers:)`. Without it, `PhotosPicker` delivers a sandboxed copy that strips EXIF; with it, the app can reach the original asset and read GPS + capture date.
- **PHImageManager**: Photos framework class that fetches image data for a `PHAsset`. `requestImageDataAndOrientation` returns the raw bytes including embedded EXIF, bypassing `PhotosPicker`'s EXIF stripping.
- **CGImageSource**: Core Graphics type that parses image file data and exposes metadata dictionaries. Used here to extract GPS coordinates and `kCGImagePropertyExifDateTimeOriginal` from the raw bytes returned by `PHImageManager`.
- **`kCGImagePropertyExifDateTimeOriginal`**: Core Graphics constant — the EXIF tag for the camera's capture timestamp. Road Trip reads this to populate `takenAt` on each photo.
- **HEIC**: Apple's default photo format (High Efficiency Image Container). SkiaSharp on the .NET server does not process HEIC reliably, so the native client detects HEIC sources and transcodes them to JPEG client-side (`UIImage(data:).jpegData(compressionQuality: 1.0)`) before upload.
- **EXIF**: Metadata embedded in image files by cameras and phones — includes GPS coordinates, capture timestamp, orientation, and camera settings. Road Trip uses GPS and timestamp; all other EXIF is stripped by the server.
- **CLLocationManager**: iOS framework class for requesting and receiving the device's current GPS location. Used as the second rung in the coordinate fallback ladder — if a photo has no EXIF GPS, the app tries a live `CLLocationManager` fix before falling back to manual pin-drop.
- **CLGeocoder**: iOS framework class that converts coordinates to human-readable place names (reverse geocoding). Used here to backfill the `placeName` field on photos captured offline; the place name shows "Locating…" until connectivity returns.
- **optimistic pin / optimistic mutation**: A UI pattern where the local state (GRDB, map pin) is updated immediately as if the server call succeeded, and reverted if the call fails. Used for delete-photo, pin-drop, delete-trip, and the `pending` pin on photo capture.
- **`queued` upload stage**: The first stage of the `UploadQueueItem` state machine, added in this rewrite. A photo enters `queued` as soon as its bytes are cached on-device and its coordinates are known — no network is touched. This stage has no equivalent in the web client's `uploadQueue.js`, which requires a live `request-upload` call to begin. The full stage sequence is: `queued` → `requesting` → `uploadingOriginal` → `uploadingDisplay` → `uploadingThumb` → `committing` → `done` | `failed`.
- **NWPathMonitor**: Apple Network framework class that observes network path availability changes. Used in `UploadCoordinator` to trigger the upload pipeline automatically when connectivity is restored, without polling.
- **`waitsForConnectivity`**: A `URLSessionConfiguration` property that, when `true`, causes a URL task to wait for a satisfactory network path rather than failing immediately when offline. Set on the background upload session so block PUTs resume automatically on reconnect without requiring the coordinator to retry manually.
- **BGTaskScheduler / BGContinuedProcessingTask**: iOS background task APIs (`BackgroundTasks` framework) for scheduling work to run while the app is suspended. `BGContinuedProcessingTask` (iOS 26) could allow upload continuation after force-quit without a relaunch. Both are noted as future enhancements; the current design commits only to resume-on-next-launch for force-quit scenarios.
- **URLSession background configuration**: A `URLSession` configured with `URLSessionConfiguration.background(withIdentifier:)` that allows upload and download tasks to continue executing after the app is backgrounded. Mandatory for the upload coordinator; background sessions do not support `async/await` delegates — they require the delegate pattern.
- **SAS (Shared Access Signature)**: Azure Storage token that grants time-limited, scoped access to a blob resource without exposing the storage account key. The server mints SAS URLs via `request-upload` that the client uses to PUT blocks directly to Azure Blob Storage. SAS TTL is 2 hours; the upload coordinator re-calls `request-upload` if an item has been queued long enough that the SAS would be stale on first use.
- **SecretToken / ViewToken**: The two per-trip GUIDs that serve as the app's entire auth model. `SecretToken` grants upload and edit access (owner); `ViewToken` grants read-only access (share link). Both travel in the URL path; no cookies or accounts. The native app stores `SecretToken`s in Keychain.
- **Azure App Service deployment slot**: A parallel hosting environment ("slot") within the same App Service, reachable at its own URL. Used here to run a `dev` instance of the .NET API so mutating flows (upload/delete) can be tested against dev infra without touching prod trips. Slot-swap to prod remains a manual Patrick-only action.
- **Bicep**: Microsoft's declarative infrastructure-as-code language for Azure, compiled to ARM templates. `infrastructure/azure/main.bicep` is the source of truth for all Road Trip Azure resources; the dev slot and dev database are added as an additive change to this file.
- **TestFlight**: Apple's beta distribution platform. Internal testers (Patrick primary; dad optional) install builds through TestFlight; this is the target distribution channel for the rewrite's MVP, not the public App Store.
- **App Store Connect**: Apple's web portal for managing apps, builds, testers, and App Store submissions. TestFlight builds are uploaded here via `xcrun altool` and must pass Apple's automated processing before testers can install them.
- **`PrivacyInfo.xcprivacy`**: Required Apple privacy manifest file (enforced for TestFlight and App Store since iOS 17 / Xcode 15). Declares what data the app accesses (photo library, network), whether it tracks users, and which third-party SDKs are included. Missing or incorrect manifests cause App Store Connect to reject uploads.
- **Bundle identifier**: Reverse-DNS string that uniquely identifies an app to Apple and the App Store (`com.psford.roadtripmap.native` for the native rewrite, distinct from the existing Capacitor app's `com.psford.roadtripmap`). Allows the two apps to be installed side-by-side during transition.
- **Keychain**: iOS secure credential store. The native app stores each trip's `SecretToken` in the Keychain (one entry per trip), replacing the `TripStorage` IndexedDB approach used by the Capacitor shell.
- **EF Core**: Entity Framework Core — the ORM used by the .NET backend for schema migrations and database access. Referenced in the acceptance criteria to confirm dev-slot migrations apply correctly; the native Swift client does not use EF Core.
- **DTU (Database Transaction Units)**: Azure SQL pricing unit representing a bundled measure of CPU, memory, and I/O. The dev database uses Basic DTU 5 (~$5/mo), the smallest tier, sufficient for rewrite iteration traffic.

## Architecture

### Module / Directory Layout

```
ios-swift/RoadTrip/                       # Swift package + Xcode project, separate from existing ios/App/
  RoadTrip/                               # App target
    App/                                  # @main App, AppDelegate adapter, dependency wiring
    Models/                               # GRDB record types (Trip, Photo, UploadQueueItem)
    Storage/                              # GRDB DatabaseQueue, migrator, Keychain wrapper, file cache
    Networking/                           # RoadTripAPI actor, Codable DTOs, version-header gate
    Upload/                               # Offline-first upload: foreground UploadCoordinator + NWPathMonitor,
                                          #   background URLSession + delegate, state machine, reconciler, progress store
    Photos/                               # PhotosPicker integration, PHAsset bridge, EXIF extraction, coordinate
                                          #   fallback ladder (EXIF → CLLocation → pin-drop), HEIC transcode
    Map/                                  # TripMapView (UIViewRepresentable over MKMapView) + Coordinator
                                          #   (annotations/callouts, overlays, popup↔carousel sync)
    Views/                                # SwiftUI views grouped by screen
      Trips/                              #   TripListView, TripDetailView, CreateTripView, PasteTokenView
      Photos/                             #   PhotoDetailView, PinDropView, PhotoCarouselView
      Shared/                             #   Empty states, error toasts, progress badges
    ViewModels/                           # @Observable view models, one per screen
    Resources/                            # Asset catalog, Info.plist, PrivacyInfo.xcprivacy
  RoadTripTests/                          # Unit tests (XCTest)
  RoadTripUITests/                        # UI tests (XCUITest)
```

### Cross-Cutting Architecture Decisions

- **UI: SwiftUI, iOS 17+ minimum, with one deliberate UIKit bridge for the map.** `@Observable` macro for view-model state (not Combine). `async/await` for foreground HTTP. `NavigationStack` + native large-title chrome. The trip map is the sole UIKit component — an `MKMapView` wrapped in `UIViewRepresentable` (see Map decision below) — because pure SwiftUI `Map` cannot deliver the web's interactive-callout + two-way carousel-sync parity. Everything else is SwiftUI.
- **Verification environment (process constraint).** Design, planning, reference-porting from `wwwroot/js/`, and the dev-slot Bicep/workflow authoring happen in the Linux dev-container. **All Swift build/run/see-on-simulator verification happens on the Mac** (the container has no Xcode/iOS SDK). No Swift phase is "done" without a simulator/device screenshot. Each phase below names its environment.
- **Local storage: GRDB.swift.** Schema-versioned migrations via `DatabaseMigrator`. Records mirror server contract for read speed. `ValueObservation` drives SwiftUI updates (analog to `@Query`).
- **Keychain: tokens only.** One `kSecClassGenericPassword` entry per trip, service `com.psford.roadtripmap.native`, account `trip-secret-{tripId}`, value is the SecretToken Guid.
- **File cache: `~/Library/Caches/Photos/{tripId}/{photoId}_{tier}.jpg`.** Eviction is LRU with a ~1 GB ceiling. Cache directory is purgeable by iOS under storage pressure — acceptable.
- **Remote API: `actor RoadTripAPI` wrapping `URLSession.shared`.** Codable DTOs. Two-token URL-path auth unchanged from server. Version-header gate (`x-server-version` / `x-client-min-version`) throws `versionMismatch` if client < min.
- **Photo upload: offline-first, capture fully decoupled from network (headline feature).** The whole pipeline is deferrable; a photo is accepted and pinned with zero connectivity. See the dedicated subsection "Offline-First Upload State Machine" below. In brief: the GRDB-persisted `UploadQueueItem` gains a front `queued` stage (captured, bytes cached on disk, **no network touched**); a foreground `UploadCoordinator` (driven by `NWPathMonitor` + at-launch reconciliation) makes the JSON API calls (`request-upload`, `commit`) since background sessions can't; the block PUTs run on a single background `URLSession` (`waitsForConnectivity = true`, delegate pattern, `uploadTask(with:fromFile:)`). Idempotent `uploadId` makes every retry/refresh safe.
- **Photo capture: `PhotosPicker` UI, `PHAsset` for EXIF, with an offline coordinate fallback ladder.** PhotosPicker strips EXIF for privacy; the canonical workaround is `.readWrite` Photo Library permission → `PHAsset.fetchAssets(withLocalIdentifiers:)` → `PHImageManager.requestImageDataAndOrientation` → `CGImageSource` to read GPS + `kCGImagePropertyExifDateTimeOriginal`. Coordinates resolve via a ladder, all-offline except the last fallback's place name: (1) embedded **EXIF GPS** (primary; present on any geotagged photo, no connectivity needed); (2) live **`CLLocationManager` fix** for a fresh capture lacking EXIF GPS (GPS hardware, no cell); (3) **user pin-drop** only when neither yields coordinates. The human-readable place name comes from `CLGeocoder` and **backfills on reconnect** (shows "Locating…" until then). Limited Photo Library auth is supported (EXIF for the user-selected subset).
- **HEIC → JPEG client-side transcode** before upload (server's SkiaSharp doesn't support HEIC reliably). `UIImage(data:).jpegData(compressionQuality: 1.0)` is the conversion.
- **Map: `MKMapView` wrapped in `UIViewRepresentable`** (not SwiftUI `Map`), with a `Coordinator` as `MKMapViewDelegate`. Custom thumbnail-circle `MKAnnotationView`s carrying pending/committed/failed states; **two-way popup↔carousel sync** through a single `selectedPhotoId` source of truth on the `TripDetailViewModel` (guarded to avoid feedback loops); `MKPolygon` + `MKOverlayRenderer` for park boundaries; dashed `MKPolyline` (`lineDashPattern [3,2]`, smoothed, toggleable) for the route; POI markers from `/api/poi`. Fit-all-pins via `setVisibleMapRect`; controls via `showsCompass` / `showsUserLocation` / `showsScale`. Clustering via built-in `MKMarkerAnnotationView` clustering (handles 50+ pins; `ClusterMap` SPM remains a fallback only if 200+ becomes routine). Rationale: SwiftUI `Map` (iOS 17) can't deliver interactive thumbnail callouts + tight carousel sync without the regression risk the "no regression" floor forbids.
- **Sync architecture:** Reads are stale-while-revalidate (`ValueObservation` renders cached, background fetch updates GRDB, observation re-fires). Mutations are optimistic (apply to GRDB first, queue server call, revert on failure). Photo uploads use the offline-first background queue.
- **Identity:** No accounts. SecretTokens in Keychain define which trips the device "owns". ViewToken used only for share-link generation. Adding device-attested trip-list endpoints is explicitly out of scope.

### Offline-First Upload State Machine

The signature feature. Capture is fully decoupled from connectivity; the OS background session carries the bytes; force-quit is handled honestly (resume on next launch, since iOS cancels background tasks on user force-quit and will not relaunch the app for them).

**Persisted stages** (`UploadQueueItem.stage`, GRDB):

`queued` → `requesting` → `uploadingOriginal` → `uploadingDisplay` → `uploadingThumb` → `committing` → `done` | `failed`

- **`queued`** — captured offline: image bytes written to `PhotoFileCache`, EXIF/coords/`takenAt` persisted, optimistic `pending` pin shown. **No network touched.** Net-new state (the web has no equivalent — its `UploadQueue.start()` requires a live `request-upload`).
- **`requesting`** — a foreground `request-upload` call is in flight to mint/refresh the 3 SAS URLs.
- **`uploading*`** — per-tier block PUTs running on the background session.
- **`committing`** — foreground `commit` with block IDs; on success the Photo row is written to GRDB (all 3 tiers must commit first — no half-uploaded pins).
- **`failed`** — terminal after retries exhausted; surfaces a red pin + manual Retry/Discard.

**Components and the foreground/background split:**

- **`PhotoCaptureCoordinator`** (`Photos/`) — enqueues a `queued` item; returns instantly, offline-safe.
- **`UploadCoordinator`** (`Upload/`, foreground) — owns an `NWPathMonitor`; on connectivity restoration (and at launch) walks `queued` + retryable `failed` items, performs the JSON calls (`requestUpload`, `commit`), and enqueues the per-tier block PUTs. JSON calls live here because background sessions can't run them.
- **`BackgroundUploadSession`** (`Upload/`) — one `URLSession.background(withIdentifier: "com.psford.roadtripmap.native.uploads")`, `waitsForConnectivity = true`, delegate-based, one `uploadTask(with:fromFile:)` per 4 MB block. Carries transfers while the app is suspended.
- **`UploadReconciler`** (`Upload/`) — runs at launch and from `application(_:handleEventsForBackgroundURLSession:)`; re-attaches to the session, advances completed tiers, calls `commit`, and re-`requestUpload`s on a 403/SAS-expiry (the background task can't refresh its own SAS mid-flight).
- **`UploadProgressStore`** (`@Observable`, `@MainActor`) — bridges delegate callbacks to SwiftUI; drives pin pending→committed→failed via GRDB `ValueObservation`.

**Guarantees vs. best-effort** (honest per Apple's constraints): suspended-app uploads continue and complete automatically; force-quit uploads **resume on next launch**, not via OS background wake. `BGTaskScheduler` / iOS-26 `BGContinuedProcessingTask` are noted as future enhancements, out of MVP scope.

### Data Flow Highlights

1. **App launch:** GRDB opens, ValueObservation fires for existing trips → TripListView renders. `UploadReconciler` re-attaches to the background session and advances/`commit`s any finished transfers; `UploadCoordinator` re-drives `queued`/`failed` items if online.
2. **Create trip (online only):** `CreateTripView` form → `RoadTripAPI.createTrip` → SecretToken to Keychain, Trip row to GRDB → TripListView updates via ValueObservation.
3. **Add photo (offline-capable):** `PhotosPicker` → PHAsset → EXIF + coordinate ladder → HEIC transcode → bytes to `PhotoFileCache` → `UploadQueueItem` inserted at stage `queued` → optimistic `pending` pin appears immediately. When online (now, on reconnect via `NWPathMonitor`, or at next launch): `request-upload` → background block PUTs → `commit` → Photo row in GRDB → pin flips to `committed`.
4. **Background → foreground:** progress updates flow from URLSession delegate → `@MainActor` `UploadProgressStore` (`@Observable`) → SwiftUI views via `@Bindable`.

### Backend Changes (Bicep, Additive)

- New deployment slot `dev` on existing `app-roadtripmap-prod` App Service (free on Standard plan).
- New database `roadtripmap-db-dev` on existing `sql-roadtripmap-prod` SQL server (Basic DTU 5, ~$5/mo).
- New container `road-trip-photos-dev` in existing shared `stockanalyzerblob` storage.
- Separate `kv-roadtripmap-dev` Key Vault (~$0.60/mo).
- Slot-sticky connection strings via `Microsoft.Web/sites/slots/config` with `slotSetting: true`.
- New GitHub Actions workflow `deploy-dev.yml` (workflow_dispatch only), parallel to existing `deploy.yml`.
- Incremental cost: ~$11/mo.

### Endpoint Cleanup (Deferred, Post-Cutover Phase)

These remain operational during the transition. Deletion happens in a separate cleanup pass after the native app is the only client and the Capacitor app is decommissioned:

- `/api/geocode` (Nominatim cache) — replaced by `CLGeocoder` on device
- `/api/poi` — replaced by MapKit's built-in POI layer
- `/api/park-boundaries` — replaced by MapKit's native overlay rendering
- Legacy form-POST `/api/trips/{token}/photos` — fully superseded by the resilient SAS flow

Plus their seeder services (`NominatimGeocodingService`, `PadUsBoundaryImporter`, etc.) and the corresponding DB tables (POI, ParkBoundary). NOT in scope for the rewrite; cleanup is its own future plan.

## Existing Patterns

Two bodies of existing code anchor this design:

1. **The merged native storage layer** (`ios-swift/RoadTrip/`, on `develop`): the GRDB records (`Trip`, `Photo`, `UploadQueueItem`), `Migrator` v1, `AppDatabase`, `KeychainStore`, `PhotoFileCache` — built and tested green on the iPhone 17 sim. The rewrite **builds on these as-is** (with the small additive change of the `queued` stage + a place-name-pending field on `Photo`); it does not re-derive them. The PR #108 facade UI (`Views/*`, `SampleData.swift`) is **discarded** — it was built blind and is not a pattern to follow.
2. **The web `wwwroot/js/` modules are the behavioral source of truth to port** (not reinvent): `uploadQueue.js`/`uploadTransport.js` (the upload state machine + SAS/block protocol), `optimisticPins.js` (the pending/committed/failed pin states), `photoCarousel.js` (scroll-snap strip + fullscreen viewer + map sync), `postUI.renderPhotoMap` (popup↔carousel sync, fit-bounds, route toggle), `poiLayer.js` / `stateParkLayer.js` (overlay tiers). Port behavior; the client-side state machine moves from JS to Swift.

The remaining patterns the design conforms to are server-side and cross-cutting:

- **Two-token auth (SecretToken + ViewToken via URL path).** The native client preserves the model exactly. Tokens go in Keychain instead of `TripStorage` (IndexedDB) but are otherwise treated the same way.
- **Resilient SAS upload protocol** (`request-upload` → block PUTs to Azure SAS URLs → `commit` with block IDs). Native client implements the same protocol; only the client-side state machine changes from JS (`uploadQueue.js`) to Swift (`UploadCoordinator` + `UploadQueueItem` GRDB record).
- **Three-tier photo storage** (original + display + thumb). Native client uploads all three tiers (per-tier SAS URLs returned by `request-upload`). HEIC → JPEG transcode is added on the client side to keep server SkiaSharp processing unchanged.
- **Server contract: `x-server-version` / `x-client-min-version` headers on every response.** Native client honors the gate.
- **Photo serving via proxy endpoint `/api/photos/{tripId}/{photoId}/{size}`.** Native client uses these URLs directly in `Image(url:)` (with `URLSession`'s `URLCache` for HTTP-level caching) and the file cache layer (above) for persistent storage.
- **`LogSanitizer` convention** (server-side, raw tokens / SAS URLs / blob paths / GPS never logged). Native client must follow the same: don't log raw tokens or SAS URLs to OSLog. Documented as a code-review check; no helper class needed initially.
- **Bicep as IaC source of truth.** Dev slot mod is an additive change to `infrastructure/azure/main.bicep`; no parallel template.
- **GitHub Actions for deploys** with `workflow_dispatch` for prod-affecting actions. `deploy-dev.yml` follows the same pattern (manual dispatch, no auto-deploy on push).

The Capacitor iOS shell (`src/bootstrap/*`) and the wwwroot Capacitor-facing UI (`post.html`, `create.html`, `pinnedStack.js`, etc.) are NOT patterns the native app follows — they're the thing being replaced. The native app's directory layout (`ios-swift/`) is parallel to and isolated from `ios/App/`.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Backend Dev Slot + Scaffold Reconciliation

**Goal:** A deployed Azure dev slot the native client can target, and confirmation the existing scaffold still builds clean (facade removed).

**Already built (on `develop`, reuse):** the XcodeGen project (`ios-swift/RoadTrip/`, `project.yml`, GRDB 6.29.3, iOS 17, bundle ID `com.psford.roadtripmap.native`, signing under team `GP2M7H6R3U`). This phase does **not** recreate it.

**Components:**
- Bicep mod in `infrastructure/azure/main.bicep`: adds `dev` deployment slot on `app-roadtripmap-prod`, `roadtripmap-db-dev` database (Basic DTU 5) on existing SQL server, `road-trip-photos-dev` container, `kv-roadtripmap-dev` Key Vault, slot-sticky connection strings (`slotSetting: true`)
- New GitHub Actions workflow `.github/workflows/deploy-dev.yml` (workflow_dispatch only), parallel to `deploy.yml`
- Base-URL configuration in the native client (`.xcconfig`-driven) selecting prod vs dev-slot
- Delete the PR #108 facade (`Views/*`, `App/SampleData.swift`) so it can't be built on
- **Storage additive migration** (the existing `Models/` + `Storage/` layer is reused as-is): `Migrator` **v2** adds the `queued` + `requesting` front stages to `UploadQueueItem.stage` and a `placeName` + `placeNamePending` field to `Photo`; durable non-purgeable on-disk staging for `queued`-item bytes (the offline queue must survive display-cache eviction)

**Dependencies:** None (first phase). Reuses the merged scaffold + storage layer on `develop`.

**Environment:** Bicep + workflow authored **in-container** (Patrick dispatches the deploy); scaffold build check + migration test on **Mac**.

**Covers ACs:** `native-ios.AC7.1`, `native-ios.AC7.2`, `native-ios.AC7.3`.

**Done when:** Bicep `what-if` against prod shows only the additive dev resources. After Patrick dispatches `deploy-dev.yml`, the dev slot returns `/api/version` and the dev DB has migrations applied. The existing scaffold builds + runs empty on the simulator with the facade removed. The v1→v2 migration applies cleanly over a database with existing rows and round-trips the `queued` stage.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Typed API Client — `RoadTripAPI`

**Goal:** Single typed entrypoint to every server endpoint the native client consumes, with version-header gate and typed errors.

**Components:**
- `actor RoadTripAPI` in `ios-swift/RoadTrip/Networking/RoadTripAPI.swift` exposing:
  - `createTrip`, `tripForPost`, `tripForView`, `deleteTrip`
  - `photosForPost`, `photosForView`, `deletePhoto`, `pinDrop`
  - `requestUpload`, `commitUpload`, `abortUpload`
- Codable DTOs in `ios-swift/RoadTrip/Networking/DTOs/`: `CreateTripRequest`, `CreateTripResponse`, `TripResponse`, `PhotoResponse`, `RequestUploadRequest`, `RequestUploadResponse`, `CommitRequest`, `PinDropRequest`
- `enum RoadTripAPIError: Error { case unauthorized, notFound, networkUnavailable, serverError(String), versionMismatch }`
- Base URL configuration (compile-time or `Info.plist`-driven) for prod vs dev slot

**Contract for the network layer:**

```swift
actor RoadTripAPI {
    func createTrip(_ request: CreateTripRequest) async throws -> CreateTripResponse
    func tripForPost(secretToken: UUID) async throws -> TripResponse
    func tripForView(viewToken: UUID) async throws -> TripResponse
    func deleteTrip(secretToken: UUID) async throws
    func photosForPost(secretToken: UUID) async throws -> [PhotoResponse]
    func photosForView(viewToken: UUID) async throws -> [PhotoResponse]
    func deletePhoto(secretToken: UUID, photoId: Int) async throws
    func pinDrop(secretToken: UUID, photoId: Int, lat: Double, lng: Double) async throws -> PhotoResponse
    func requestUpload(_ request: RequestUploadRequest, secretToken: UUID) async throws -> RequestUploadResponse
    func commitUpload(secretToken: UUID, photoId: UUID, blockIds: [String]) async throws -> PhotoResponse
    func abortUpload(secretToken: UUID, photoId: UUID) async throws
}
```

**Dependencies:** Phase 1 (dev slot live for integration tests).

**Environment:** Codable DTOs + error mapping can be drafted/Linux-unit-tested **in-container** (Foundation compiles on Linux), but the authoritative build, the `URLProtocol`-stubbed tests, and the dev-slot integration tests run on **Mac**.

**Covers ACs:** None directly (infrastructure layer). Integration tests against dev slot cover happy paths + typed errors for each endpoint.

**Done when:** Each public method has a passing test that hits dev slot (success path) and a unit test with stubbed `URLProtocol` that exercises each error case (401 → `unauthorized`, 404 → `notFound`, 500 → `serverError`, network down → `networkUnavailable`, version mismatch → `versionMismatch`).
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Owner View Core — Trip List/Create/Import + MKMapView + Carousel Sync

**Goal:** The owner read experience at website parity: trip list/create/import, the `MKMapView` map with tappable thumbnail popups, the photo carousel, the **two-way popup↔carousel sync**, and the fullscreen slideshow.

**Components:**
- `TripListView` + `TripListViewModel` (`@Observable`) in `Views/Trips/` — NavigationStack root, GRDB ValueObservation over Trip rows sorted by `created_at` desc, `+` (create) and `⇩ Import` toolbar items, background revalidation
- `CreateTripView` (modal sheet) — form → `createTrip` → Keychain + GRDB write (online-only)
- `PasteTokenView` (modal sheet) — token input → `tripForPost` → hydrate Trip + photos into GRDB
- `TripMapView: UIViewRepresentable` + `Coordinator` (`Map/`) — wraps `MKMapView`; custom thumbnail-circle `MKAnnotationView` per photo with pending/committed/failed states; `setVisibleMapRect` fit-all-pins; `showsCompass`/`showsUserLocation`/`showsScale`; built-in marker clustering
- `PhotoCarouselView` (`Views/Photos/`) — horizontal scroll-snap thumbnail strip with place-name labels (ports `photoCarousel.js`)
- **Popup↔carousel sync**: single `selectedPhotoId` on `TripDetailViewModel` drives both map annotation selection and carousel scroll, with a guarded update to prevent feedback loops
- `FullscreenViewer` — paged slideshow (prev/next, swipe, keyboard arrows, tap-to-toggle-chrome) over `AsyncImage` with `PhotoFileCache` fallback
- `TripDetailView` + `TripDetailViewModel` — owns trip + photos observation, `photosForPost` revalidation on appear, `ShareLink` for the view-link

**Dependencies:** Phases 1 (storage/Keychain), 2 (API client).

**Environment:** Mac (Swift build + simulator; screenshot required — this is the signature parity surface).

**Covers ACs:** `native-ios.AC1.1`, `native-ios.AC1.2`, `native-ios.AC1.3`, `native-ios.AC5.1`, `native-ios.AC5.2`, `native-ios.AC5.3`, `native-ios.AC5.4`, `native-ios.AC9.1`, `native-ios.AC9.2`, `native-ios.AC9.3`, `native-ios.AC9.4`.

**Done when:** Create-trip ends with a new trip in the list; paste-token hydrates a prod trip into GRDB; map shows thumbnail annotations for all GPS photos and fits bounds; tapping an annotation selects it AND scrolls the carousel to it (and vice-versa); fullscreen slideshow opens with swipe/arrow nav. Verified on the simulator (screenshot).
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Map Overlays — POI, Park Boundaries, Route Line

**Goal:** Map overlay parity with the website: POI markers, state-park boundary polygons, and the toggleable dotted route line.

**Components:**
- POI layer in `Map/` — viewport+zoom-tier fetch of `/api/poi` (tiers: <7 national_park; 7–9 + state_park/natural; 10+ + historic/tourism), rendered as annotations colored by category with labels at zoom ≥ 8; tap → popup (ports `poiLayer.js`)
- Park-boundary overlay — `/api/park-boundaries` GeoJSON → `MKPolygon` + `MKOverlayRenderer` (fill + outline + centroid label), debounced viewport reload, detail tiers (ports `stateParkLayer.js`)
- Route line — `MKPolyline` through photos ordered by `takenAt`, dashed `lineDashPattern [3,2]`, smoothed, toggled via a map control (ports `postUI.setupRouteToggle`)
- On-device overlay cache (GRDB/file) so overlays render offline from last fetch (replaces `mapCache.js`)

**Dependencies:** Phase 3 (map module exists).

**Environment:** Mac (Swift build + simulator; screenshot).

**Covers ACs:** `native-ios.AC10.1`, `native-ios.AC10.2`, `native-ios.AC10.3`, `native-ios.AC10.4`.

**Done when:** POI markers appear/tier by zoom and are tappable; park-boundary polygons render with fill/outline/label; the dotted route line draws through photos and toggles on/off; overlays render from cache when offline. Verified on the simulator (screenshot).
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Photo Capture Pipeline — PhotosPicker, EXIF Ladder, HEIC, Offline Enqueue

**Goal:** User can pick a photo, the app extracts all available metadata, resolves coordinates via the offline fallback ladder, transcodes HEIC if needed, caches the bytes, and enqueues an `UploadQueueItem` at stage `queued` — **with no network required**. (Upload execution is Phase 6.)

**Components:**
- `PhotoCaptureCoordinator` (`Photos/`) — entry point from TripDetailView's `+ Add Photo`
- `PhotosPicker` (`PhotosUI`) + Photo Library auth flow (request `.readWrite`, handle `.limited`)
- `PHAsset` bridge: `PhotosPickerItem.itemIdentifier` → `PHAsset` → `PHImageManager.requestImageDataAndOrientation` (raw bytes incl. EXIF)
- `EXIFExtractor` (`Photos/`) — `CGImageSource` walker pulling GPS lat/lng (+ hemisphere ref), `kCGImagePropertyExifDateTimeOriginal`, orientation
- **Coordinate fallback ladder** — (1) EXIF GPS; (2) `CLLocationManager` fix for a fresh capture lacking EXIF GPS; (3) pin-drop on the last-cached map region. All offline-capable; place name deferred to `CLGeocoder` on reconnect (`placeNamePending = true`)
- `HEICTranscoder` (`Photos/`) — detects HEIC via UTI, transcodes to JPEG (`UIImage(data:).jpegData(compressionQuality: 1.0)`)
- Enqueue: bytes written to the non-purgeable `PhotoFileCache` path; `UploadQueueItem` persisted with file path, coords, `takenAt`, stage = **`queued`**; optimistic `pending` pin emitted

**Dependencies:** Phase 1 (GRDB for queue), Phase 3 (TripDetailView entry point + map for pin-drop).

**Environment:** Mac (Swift build + simulator; photo-library + CLLocation need device/sim).

**Covers ACs:** `native-ios.AC2.1`, `native-ios.AC2.2`, `native-ios.AC2.3`, `native-ios.AC2.5`, `native-ios.AC2.6`, `native-ios.AC8.4`, `native-ios.AC8.5`.

**Done when:** Picking a photo (airplane mode on) produces a `queued` GRDB item with bytes cached and an optimistic pin, **no network call made**; EXIF lat/lng matches the photo's metadata; a no-EXIF photo falls to a device fix, then pin-drop; HEIC source produces a JPEG. Tests cover the ladder (golden-file JPEG with GPS, golden-file without), HEIC round-trip, Limited auth, and offline enqueue. Verified on the simulator (screenshot).
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Offline-First Upload Coordinator

**Goal:** `queued` items drive end-to-end through the state machine: foreground `request-upload` (on connectivity/at-launch) → background 3-tier block PUTs → foreground `commit`. Survives offline-capture, backgrounding, force-quit, network drops, and SAS expiry. The Photo row lands in GRDB and the pin flips to `committed`.

**Components:**
- `UploadCoordinator` (`Upload/`, foreground) — owns an `NWPathMonitor`; on connectivity restoration and at launch, walks `queued` + retryable `failed` items, makes the JSON calls (`requestUpload`, `commit`), enqueues block PUTs
- `BackgroundUploadSession` (`Upload/`) — one `URLSession.background(withIdentifier: "com.psford.roadtripmap.native.uploads")`, `waitsForConnectivity = true`, delegate-based; `BlockPutter` splits each tier into 4 MB blocks (base64 block IDs) via `uploadTask(with:fromFile:)` (file-based mandatory for background)
- `UploadStateMachine` (`Upload/`) — `queued` → `requesting` → `uploadingOriginal` → `uploadingDisplay` → `uploadingThumb` → `committing` → `done`/`failed`; each transition a GRDB write
- `UploadReconciler` (`Upload/`) — at launch + `application(_:handleEventsForBackgroundURLSession:)`: re-attach to the session, advance finished tiers, call `commit`, and re-`requestUpload` on a 403/SAS-expiry (the background task can't refresh its own SAS)
- `URLSessionTaskDelegate`: `didSendBodyData` → `bytesUploaded`; `didCompleteWithError` advances or persists failure (detecting `NSURLErrorCancelledReasonUserForceQuitApplication`)
- `UploadProgressStore` (`@Observable`, `@MainActor`) — bridges callbacks to SwiftUI; drives pin pending→committed→failed
- `AppDelegate` adapter (`@UIApplicationDelegateAdaptor`) wiring the background-session completion handler

**Dependencies:** Phases 1 (queue persistence), 2 (API client), 5 (queue items produced).

**Environment:** Mac (Swift build + simulator; force-quit/background behavior needs a real device for final sign-off).

**Covers ACs:** `native-ios.AC3.1`, `native-ios.AC3.2`, `native-ios.AC3.3`, `native-ios.AC3.4`, `native-ios.AC3.5`, `native-ios.AC3.6`, `native-ios.AC8.1`, `native-ios.AC8.2`, `native-ios.AC8.3`, `native-ios.AC8.6`, `native-ios.AC8.7`.

**Done when:** A photo captured offline (Phase 5) auto-uploads end-to-end against the dev slot once connectivity returns, all 3 tiers commit, Photo row appears, pin flips to `committed`. Tests cover: offline capture makes no network call; reconnect (`NWPathMonitor`) fires the queue; backgrounded upload completes; force-quit + relaunch resumes; mocked SAS-expiry re-mints; mocked block 503 retries; commit failure → `failed` + surfaced error. Final force-quit/background sign-off on a real device (screenshot).
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Mutations, Read-Only Viewer + Offline Robustness

**Goal:** Delete trip/photo and edit-location with optimistic UI + revert; the failed-pin retry UX; the read-only viewer variant (save/share); full lifecycle robustness.

**Components:**
- `DeleteTripAction` + confirmation alert in `TripDetailView`; GRDB cascade-delete + `deleteTrip` + `KeychainStore.removeSecretToken`
- `DeletePhotoAction` in `PhotoDetailView`; optimistic GRDB delete + server DELETE + revert-on-failure
- `PinDropView` modal sheet — `MKMapView` (the Phase-3 wrapper) with a draggable center pin; on confirm, optimistic GRDB update + `pinDrop` + revert-on-failure + `CLGeocoder` place-name
- **Failed-pin retry UX** — red `failed` annotation surfaces a popup with Retry (re-enqueue via `UploadCoordinator`) / Discard (ports `optimisticPins` failure popup); a queued/failed photo is never silently lost
- **Read-only viewer variant** — when opened via `/trips/{viewToken}` (`canDelete:false`), the same map + carousel show **save/share** actions instead of edit/delete
- `ErrorToastPresenter` (`@Observable`) — mutation-failure toasts
- Empty / loading / no-network states across TripListView, TripDetailView, PhotoDetailView
- `UploadCoordinator` retry: exponential backoff to N attempts, then `failed` + surface UI

**Dependencies:** Phases 3 (UI + map), 6 (upload coordinator running).

**Environment:** Mac (Swift build + simulator; slow-network + force-quit on real device for sign-off).

**Covers ACs:** `native-ios.AC1.4`, `native-ios.AC1.5`, `native-ios.AC1.6`, `native-ios.AC4.1`, `native-ios.AC4.2`, `native-ios.AC4.3`, `native-ios.AC4.4`, `native-ios.AC5.5`, `native-ios.AC7.4`, `native-ios.AC11.1`, `native-ios.AC11.2`.

**Done when:** Each mutation has tests covering happy + revert paths; the failed-pin Retry/Discard works; the viewer variant shows save/share (no edit/delete) for a `viewToken`. Upload queue survives force-quit + relaunch (real device). Slow-network test (Network Link Conditioner "3G") completes with progress UI. The native client, pointed at the dev slot, completes the full offline-Capture→Reconnect→Upload→Pin loop end-to-end (screenshot).
<!-- END_PHASE_7 -->

<!-- START_PHASE_8 -->
### Phase 8: TestFlight Release Pipeline

**Goal:** First TestFlight build accepted by Apple, installed on Patrick's iPhone (primary tester), full loop works on a real device against the dev slot. Pipeline supports provisioning ≥1 internal tester (dad optional).

**Components:**
- App Store Connect app record for bundle `com.psford.roadtripmap.native` (created via App Store Connect web UI; Patrick action)
- `PrivacyInfo.xcprivacy` privacy manifest declaring: photo library access, network access, no tracking, no third-party SDKs
- App Store metadata stubs (placeholder name, description, icon) sufficient for TestFlight internal review
- Archive build configuration (Release scheme, dev-slot base URL for TestFlight builds — separate `.xcconfig` for `Debug` / `Release-TestFlight` / `Release-Prod`)
- Upload pipeline: `xcodebuild archive` + `xcrun altool --upload-app` (or `xcrun notarytool` for newer flow). Documented as a runbook in `docs/runbooks/testflight-release.md`
- TestFlight internal tester invites — Patrick (primary); the group supports adding dad/others

**Dependencies:** Phase 7 (full feature parity for shippable scope).

**Environment:** Mac (archive + upload via Xcode/`xcrun`; Patrick performs App Store Connect web steps).

**Covers ACs:** `native-ios.AC6.1`, `native-ios.AC6.2`, `native-ios.AC6.3`, `native-ios.AC6.4`.

**Done when:** Build uploaded to App Store Connect is processed without rejection. Patrick installs the TestFlight build on his physical iPhone (and can add dad as a second internal tester). End-to-end on device: create a test trip, capture a photo offline, watch it upload on reconnect, see the pin on the map, open the share link in Safari (verifying the .NET view page still serves).
<!-- END_PHASE_8 -->

## Additional Considerations

**Swift learning curve (Patrick's stated constraint).** Patrick has basic Swift syntax knowledge but is not fluent. The implementation plan should explicitly call out Swift-only concepts when they appear in code: optionals + optional chaining, value vs reference types (struct vs class), `@Observable` macro + property wrappers (`@State`, `@Binding`, `@Bindable`, `@Environment`), actor isolation + `Task { @MainActor in ... }`, `async/await` + `Task` lifecycle, protocols-as-types + `some` opaque returns, `Codable` decoding patterns, and the URLSession delegate model (necessary for background uploads — doesn't use async/await). One-line explanation comments are sufficient; long explanations belong in PR descriptions.

**iOS dev loop on Mac.** This rewrite sidesteps the existing local-Mac dev-loop gap (no SQL Server on macOS → `dotnet run` won't start locally) by having the native client point at the Azure dev slot for the iteration loop. Per-PR backend changes that need testing get deployed to dev slot via `deploy-dev.yml`. Local backend on Mac remains broken and is intentionally not solved by this design — that's a separate concern, deferred indefinitely.

**TestFlight first-build review.** Apple's first build for a new bundle ID typically takes 24–48h for "first build review" even for internal testing. Patrick should expect this on the first Phase 8 submission. Subsequent builds for the same bundle ID install immediately for internal testers. The 1-week shippable estimate includes this review window.

**Photo caching and disk pressure.** iOS may purge `~/Library/Caches/` under storage pressure. The native client must tolerate cache misses gracefully (re-fetch from server proxy URL via `AsyncImage`). The 1 GB LRU ceiling is a soft cap on what the app retains; iOS may evict regardless.

**Endpoint cleanup is its own future plan.** This design intentionally does NOT cover deletion of POI / boundary / Nominatim endpoints or their seeders. That's a post-cutover cleanup phase tracked separately, after the Capacitor app is decommissioned and prod traffic is exclusively native.
