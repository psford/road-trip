# Native iOS Rewrite Design

## Summary

Road Trip is a privacy-first road trip photo sharing app: users create a trip, get a secret link, and pin geotagged photos on an interactive map — no accounts, no tracking. The current mobile experience runs as a Capacitor iOS shell wrapping a WKWebView that fetches and caches live HTML from an Azure App Service backend. This rewrite replaces that hybrid shell with a fully native SwiftUI app while leaving the .NET API and its resilient upload protocol completely unchanged.

The technical approach builds the new iOS client from scratch in a parallel `ios-swift/` directory, isolated from the existing Capacitor project. The UI layer is 100% SwiftUI (iOS 17+, `@Observable`, `NavigationStack`), local persistence uses GRDB.swift with schema-versioned migrations, photo metadata extraction goes through the `PHAsset` / `CGImageSource` stack to recover EXIF GPS and capture date that `PhotosPicker` alone would strip, and uploads use a bare `URLSession` background session — the only client-side API capable of continuing large block PUTs after the app is backgrounded or force-quit. Two constraints shape the design: offline-first behavior is non-negotiable (mutations queue locally in GRDB and apply optimistically, uploads survive app termination via persisted state), and the Mac development loop bypasses the longstanding local-SQL-Server gap by pointing the native client at a new Azure dev App Service slot provisioned alongside the rewrite.

## Definition of Done

### Primary Deliverable
New native iOS app (SwiftUI + iOS 17+, MapKit, GRDB.swift for local cache, bare URLSession background uploads) at `ios-swift/`. Bundle ID `com.psford.roadtripmap.native` — installs side-by-side with the existing Capacitor app during transition. Distributes via TestFlight internal testers (Patrick + dad).

### Backend
.NET API stays as-is. Stand up an Azure dev App Service slot + dev SQL (small DTUs) so backend tweaks during the rewrite can be tested in cloud-dev without local SQL Server on Mac. POI / park-boundary / Nominatim geocoder / legacy form-POST endpoints become droppable after native cutover, but their deletion is a cleanup phase — not blocking DoD. Read-only `/trips/{viewToken}` web page stays in .NET unchanged.

### 48h Prototype — Working Loop
- Create trip → pick photo from PHPhotoLibrary → upload via existing resilient SAS flow (`/photos/request-upload` → PUT to Azure → `/commit`) → photo pins on MapKit map with EXIF coords
- Paste-existing-token UI for accessing trips already in prod
- Copy share link button
- Local cache (GRDB.swift) backing trip list + photo metadata
- Default SwiftUI chrome (no polish)

### 1-Week Shippable to TestFlight
Prototype + parity for core flows currently in the Capacitor app:
- Delete trip / delete photo
- Edit photo location (pin-drop)
- Offline-first: queued mutations via URLSession background tasks
- TestFlight build uploaded to App Store Connect, Patrick + dad enrolled

### Explicit Exclusions (NOT in DoD)
- App Store submission / review (TestFlight only — App Store is eventually, not in this scope)
- Android (iOS-only user base)
- Watch / iPad / split-screen polish
- Polish details: haptics, custom page transitions, immersive fullscreen viewer, skeleton placeholders (defer to post-MVP)
- Backend rewrite (.NET stays)
- New backend features (e.g., "list my trips" account-style endpoint)
- Scroll-fade work — stays merged-but-undeployed on develop, treated as defunct
- POI / boundary / Nominatim endpoint deletion — deferred cleanup, not blocking

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
- **native-ios.AC2.3 Success:** Photo without EXIF GPS → app shows pin-drop UI before allowing upload (forces user to choose location)
- **native-ios.AC2.5 Edge:** Limited Photo Library access state → only user-selected photos accessible; EXIF still extractable for those; rest of flow works identically

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
- **native-ios.AC5.1 Success:** TripDetailView renders `Map { Annotation }` for each photo with non-null GPS; `MapCameraPosition.rect` fits all pins on first render
- **native-ios.AC5.2 Success:** Tap on map annotation → `PhotoDetailView` opens via `NavigationStack`
- **native-ios.AC5.3 Success:** Map controls (compass, user location button, scale view) visible and functional via `.mapControls` modifier
- **native-ios.AC5.4 Success:** Trip with 0 photos → map renders centered on user location with "no photos yet" empty state
- **native-ios.AC5.5 Edge:** Trip with 50+ photos → no perceptible lag, tap latency on annotations < 200ms

### native-ios.AC6: TestFlight distribution
- **native-ios.AC6.1 Success:** Archive uploaded via `xcrun altool` is processed by App Store Connect without rejection
- **native-ios.AC6.2 Success:** Patrick + dad both added as internal testers, receive install link, build installs on their iPhones
- **native-ios.AC6.3 Success:** `PrivacyInfo.xcprivacy` declares Photo Library access, network access, no tracking, no third-party SDKs
- **native-ios.AC6.4 Failure:** App Store Connect rejection → error documented, fix iterated, not blocked on full App Store review (internal testing only)

### native-ios.AC7: Backend dev slot supports rewrite iteration
- **native-ios.AC7.1 Success:** Bicep deploys `dev` slot to existing `app-roadtripmap-prod` App Service; slot accessible at its slot URL
- **native-ios.AC7.2 Success:** Dev slot connects to `roadtripmap-db-dev` (Basic DTU 5 on same SQL server); EF migrations applied; `/api/version` returns successfully
- **native-ios.AC7.3 Success:** `deploy-dev.yml` GitHub Actions workflow dispatches manually, builds + deploys to dev slot
- **native-ios.AC7.4 Success:** Native client app configured to point at dev slot URL completes full Create→Upload→Pin loop end-to-end against dev infra
- **native-ios.AC7.5 Edge:** Slot-swap from `dev` → prod NOT automated (stays manual via Azure portal per Patrick's directive)

## Glossary

- **Capacitor**: Cross-platform framework from Ionic that wraps a web app (HTML/JS/CSS) in a thin native shell. The current Road Trip iOS app is a Capacitor shell that loads live pages from App Service into a WKWebView. This rewrite replaces it entirely.
- **WKWebView**: Apple's embedded web browser component used inside iOS apps. The Capacitor shell renders the Road Trip web UI inside a WKWebView; the native rewrite eliminates it.
- **SwiftUI**: Apple's declarative UI framework (iOS 13+). Views are written as Swift structs that describe what to render; the framework handles diffing and updates. This rewrite uses SwiftUI exclusively (no UIKit).
- **`@Observable` macro**: Swift 5.9 macro (iOS 17+) that makes a class's stored properties automatically observable by SwiftUI views, replacing the older `ObservableObject` / `@Published` pattern. View models in this project use `@Observable`.
- **NavigationStack**: SwiftUI navigation container (iOS 16+) that manages a push/pop stack of views. Used here for Trip List → Trip Detail → Photo Detail drill-down.
- **GRDB.swift**: Swift library providing a type-safe SQLite API. Used as the local cache for trips, photos, and upload queue state. Chosen over SwiftData for production stability.
- **SwiftData**: Apple's first-party persistence framework (iOS 17+), built on Core Data. Considered and rejected here based on 2026 community consensus that iOS 18 introduced breaking bugs (memory exhaustion on relationship `.count`, `ModelContext.reset` crashes, ambiguous `@ModelActor` thread affinity) that push real apps back to Core Data or GRDB.
- **ValueObservation**: GRDB mechanism that observes a SQL query and fires a new value whenever the underlying rows change. Used here to drive SwiftUI list and map updates whenever the local GRDB cache is modified (analogous to SwiftData's `@Query`).
- **MapKit**: Apple's native mapping framework. Used for the trip map view (`Map { Annotation }` with custom thumbnail-circle annotations). Replaces MapLibre GL JS from the web client.
- **MapCameraPosition**: SwiftUI MapKit type that controls what region the map displays. `MapCameraPosition.rect(...)` is used here to fit all photo pins within the visible viewport on first render.
- **`.mapControls` modifier**: SwiftUI MapKit modifier (iOS 17+) that declares which standard controls appear on the map surface — compass, user location button, scale view. Replaces manually positioned HTML overlay buttons.
- **ClusterMap**: Third-party Swift Package Manager library that adds annotation clustering to MapKit. Not used by default; identified as the fallback if trips routinely exceed 200 pins.
- **PhotosPicker**: SwiftUI component (iOS 16+, `PhotosUI` framework) for browsing and selecting photos from the device library. It intentionally strips EXIF metadata for privacy, which is why the PHAsset bridge below is needed.
- **PHAsset**: Represents a photo or video in the user's Photos library (`Photos` framework). Used here to fetch the raw image data (including EXIF) for a photo the user selected through `PhotosPicker`.
- **PHImageManager**: Photos framework class that fetches image data for a `PHAsset`. `requestImageDataAndOrientation` returns the raw bytes including embedded EXIF, bypassing `PhotosPicker`'s EXIF stripping.
- **CGImageSource**: Core Graphics type that parses image file data and exposes metadata dictionaries. Used here to extract GPS coordinates and `kCGImagePropertyExifDateTimeOriginal` from the raw bytes returned by `PHImageManager`.
- **`kCGImagePropertyExifDateTimeOriginal`**: Core Graphics constant — the EXIF tag for the camera's capture timestamp. Road Trip reads this to populate `takenAt` on each photo.
- **HEIC**: Apple's default photo format (High Efficiency Image Container). SkiaSharp on the .NET server does not process HEIC reliably, so the native client detects HEIC sources and transcodes them to JPEG client-side before upload.
- **EXIF**: Metadata embedded in image files by cameras and phones — includes GPS coordinates, capture timestamp, orientation, and camera settings. Road Trip uses GPS and timestamp; all other EXIF is stripped by the server.
- **URLSession background configuration**: A `URLSession` configured with `URLSessionConfiguration.background(withIdentifier:)` that allows upload and download tasks to continue executing after the app is backgrounded or force-quit. Mandatory for the upload coordinator; background sessions do not support `async/await` delegates — they require the delegate pattern.
- **SAS (Shared Access Signature)**: Azure Storage token that grants time-limited, scoped access to a blob resource without exposing the storage account key. The server mints SAS URLs that the client uses to PUT blocks directly to Azure Blob Storage. SAS tokens expire (2-hour TTL here); the upload coordinator refreshes them if they age past 1.75 hours.
- **Azure App Service deployment slot**: A parallel hosting environment ("slot") within the same App Service, reachable at its own URL. Used here to run a `dev` instance of the .NET API so backend changes during the rewrite can be tested in the cloud without touching prod. Slot-swap to prod remains a manual Patrick-only action.
- **Bicep**: Microsoft's declarative infrastructure-as-code language for Azure, compiled to ARM templates. `infrastructure/azure/main.bicep` is the source of truth for all Road Trip Azure resources; the dev slot and dev database are added as an additive change to this file.
- **TestFlight**: Apple's beta distribution platform. Internal testers (Patrick + his dad) install builds through TestFlight; this is the target distribution channel for the rewrite's MVP, not the public App Store.
- **App Store Connect**: Apple's web portal for managing apps, builds, testers, and App Store submissions. TestFlight builds are uploaded here via `xcrun altool` and must pass Apple's automated processing before testers can install them.
- **`PrivacyInfo.xcprivacy`**: Required Apple privacy manifest file (enforced for TestFlight and App Store since iOS 17 / Xcode 15). Declares what data the app accesses (photo library, network), whether it tracks users, and which third-party SDKs are included. Missing or incorrect manifests cause App Store Connect to reject uploads.
- **Bundle identifier**: Reverse-DNS string that uniquely identifies an app to Apple and the App Store (`com.psford.roadtripmap.native` for the native rewrite, distinct from the existing Capacitor app's `com.psford.roadtripmap`).
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
    Upload/                               # UploadCoordinator (background URLSession singleton + state machine)
    Photos/                               # PhotosPicker integration, PHAsset bridge, EXIF extraction, HEIC transcode
    Views/                                # SwiftUI views grouped by screen
      Trips/                              #   TripListView, TripDetailView, CreateTripView, PasteTokenView
      Photos/                             #   PhotoDetailView, PinDropView
      Shared/                             #   Empty states, error toasts, progress badges
    ViewModels/                           # @Observable view models, one per screen
    Resources/                            # Asset catalog, Info.plist, PrivacyInfo.xcprivacy
  RoadTripTests/                          # Unit tests (XCTest)
  RoadTripUITests/                        # UI tests (XCUITest)
```

### Cross-Cutting Architecture Decisions

- **UI: 100% SwiftUI, iOS 17+ minimum.** `@Observable` macro for view-model state (not Combine). `async/await` for foreground HTTP. `NavigationStack` + native large-title chrome.
- **Local storage: GRDB.swift.** Schema-versioned migrations via `DatabaseMigrator`. Records mirror server contract for read speed. `ValueObservation` drives SwiftUI updates (analog to `@Query`).
- **Keychain: tokens only.** One `kSecClassGenericPassword` entry per trip, service `com.psford.roadtripmap.native`, account `trip-secret-{tripId}`, value is the SecretToken Guid.
- **File cache: `~/Library/Caches/Photos/{tripId}/{photoId}_{tier}.jpg`.** Eviction is LRU with a ~1 GB ceiling. Cache directory is purgeable by iOS under storage pressure — acceptable.
- **Remote API: `actor RoadTripAPI` wrapping `URLSession.shared`.** Codable DTOs. Two-token URL-path auth unchanged from server. Version-header gate (`x-server-version` / `x-client-min-version`) throws `versionMismatch` if client < min.
- **Photo upload: bare URLSession background session, one singleton for app lifetime.** Forced delegate pattern (not async/await — background sessions don't support async delegates). State machine in GRDB-persisted `UploadQueueItem` (stages: `staged` → `uploading_original` → `uploading_display` → `uploading_thumb` → `committing` → `done` | `failed`). Block-based PUT via `uploadTask(with:fromFile:)` (file-based is mandatory for background). SAS-expiry refresh: re-call `/request-upload` when SAS > 1.75h old. App-relaunch resume via `handleEventsForBackgroundURLSession`.
- **Photo capture: `PhotosPicker` UI, `PHAsset` for EXIF.** PhotosPicker strips EXIF for privacy; the canonical workaround is `.readWrite` Photo Library permission → `PHAsset.fetchAssets(withLocalIdentifiers:)` → `PHImageManager.requestImageDataAndOrientation` → `CGImageSource` to extract GPS + `kCGImagePropertyExifDateTimeOriginal`. Limited Photo Library auth state is supported (gives EXIF for the user-selected subset).
- **HEIC → JPEG client-side transcode** before upload (server's SkiaSharp doesn't support HEIC reliably). `UIImage(data:).jpegData(compressionQuality: 1.0)` is the conversion.
- **Map: SwiftUI `Map { ForEach { Annotation { ... } } }`.** Custom thumbnail-circle annotation views. `MapCameraPosition.rect(...)` for fit-all-pins. `.mapControls { MapUserLocationButton(); MapCompass(); MapScaleView() }`. No clustering yet; `ClusterMap` (3rd-party SPM) is the fallback if 200+ pins per trip becomes routine.
- **Sync architecture:** Reads are stale-while-revalidate (`ValueObservation` renders cached, background fetch updates GRDB, observation re-fires). Mutations are optimistic (apply to GRDB first, queue server call, revert on failure). Photo uploads use the background queue (offline-first by construction).
- **Identity:** No accounts. SecretTokens in Keychain define which trips the device "owns". ViewToken used only for share-link generation. Adding device-attested trip-list endpoints is explicitly out of scope.

### Data Flow Highlights

1. **App launch:** GRDB opens, ValueObservation fires for any existing trips → TripListView renders. Background URLSession coordinator reconciles with persisted `UploadQueueItem`s; any in-flight tasks continue.
2. **Create trip:** `CreateTripView` form → `RoadTripAPI.createTrip` → SecretToken to Keychain, Trip row to GRDB → TripListView updates via ValueObservation.
3. **Add photo:** `PhotosPicker` → PHAsset → EXIF → HEIC transcode → `UploadQueueItem` inserted (stage `staged`) → coordinator picks it up. Server hands back 3 SAS URLs → block PUTs run in background → commit POST → Photo row inserted in GRDB → TripDetailView pin appears.
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

This is greenfield Swift work — there is no Swift code in the repo to follow. The relevant existing patterns the design conforms to are server-side and cross-cutting:

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
### Phase 1: Project Scaffold + Backend Dev Slot

**Goal:** Standing iOS Xcode project that builds + runs empty, and a deployed Azure dev slot the future client can target.

**Components:**
- New Xcode project at `ios-swift/RoadTrip/` (SwiftUI App template, iOS 17 deployment target, bundle ID `com.psford.roadtripmap.native`)
- SPM dependency on `GRDB.swift` (latest stable) added via `Package.swift`
- Code signing configured under existing Apple Developer team `GP2M7H6R3U`
- Bicep mod in `infrastructure/azure/main.bicep`: adds `dev` deployment slot on `app-roadtripmap-prod`, `roadtripmap-db-dev` database on existing SQL server, `road-trip-photos-dev` container, `kv-roadtripmap-dev` Key Vault, slot-sticky connection strings
- New GitHub Actions workflow `.github/workflows/deploy-dev.yml` (workflow_dispatch only)

**Dependencies:** None (first phase).

**Covers ACs:** `native-ios.AC7.1`, `native-ios.AC7.2`, `native-ios.AC7.3`.

**Done when:** Xcode project builds and runs on simulator (empty white screen acceptable). Bicep `what-if` against prod shows only the additive dev resources. After Patrick dispatches `deploy-dev.yml`, the dev slot returns `/api/version` successfully and the dev DB has migrations applied.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Storage Foundation — GRDB Schema, Keychain, File Cache

**Goal:** All on-device persistence primitives ready for the API client + view layer.

**Components:**
- GRDB record types in `ios-swift/RoadTrip/Models/`: `Trip`, `Photo`, `UploadQueueItem` (see Architecture section for fields)
- `DatabaseMigrator` v1 in `ios-swift/RoadTrip/Storage/Migrator.swift` registering schema for all three tables with appropriate indexes (Trip.secret_token unique, Photo.trip_id, UploadQueueItem.upload_id unique)
- `DatabaseQueue` lifecycle in `ios-swift/RoadTrip/Storage/Database.swift` (single shared queue, app-lifetime)
- `KeychainStore` wrapper in `ios-swift/RoadTrip/Storage/KeychainStore.swift` exposing `setSecretToken(_:for:)`, `secretToken(for:)`, `removeSecretToken(for:)`
- `PhotoFileCache` in `ios-swift/RoadTrip/Storage/PhotoFileCache.swift` for the `~/Library/Caches/Photos/` layout + LRU eviction

**Dependencies:** Phase 1.

**Covers ACs:** None directly (infrastructure layer). Unit tests verify schema migration, Keychain round-trip, file-cache LRU eviction.

**Done when:** Unit tests pass for: migration creates expected schema, Trip/Photo/UploadQueueItem records insert + query, KeychainStore round-trips a Guid, file cache evicts oldest when > capacity.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Typed API Client — `RoadTripAPI`

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

**Covers ACs:** None directly (infrastructure layer). Integration tests against dev slot cover happy paths + typed errors for each endpoint.

**Done when:** Each public method has a passing test that hits dev slot (success path) and a unit test with stubbed `URLProtocol` that exercises each error case (401 → `unauthorized`, 404 → `notFound`, 500 → `serverError`, network down → `networkUnavailable`, version mismatch → `versionMismatch`).
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Trip Browse + Detail Screens

**Goal:** All read flows for trips and photos — list, detail, create, paste-token, share link, map rendering.

**Components:**
- `TripListView` in `ios-swift/RoadTrip/Views/Trips/` — root of NavigationStack, GRDB ValueObservation over Trip rows sorted by created_at desc, `+` and `⇩ Import` toolbar items
- `TripListViewModel` (`@Observable`) handling create / paste-token actions and background revalidation
- `CreateTripView` (modal sheet) — form, server POST, Keychain + GRDB write on success
- `PasteTokenView` (modal sheet) — token input, `tripForPost` call, hydration into GRDB
- `TripDetailView` — SwiftUI `Map { ForEach { Annotation { ... } } }` with thumbnail-circle annotations, photo list scroll-strip below, share-link button (uses `ShareLink` standard SwiftUI sheet)
- `TripDetailViewModel` (`@Observable`) — owns the trip + photos observation, kicks background `photosForPost` revalidation on appear
- `PhotoDetailView` — fullscreen image (`AsyncImage` with file-cache fallback), caption, navigation entry for pin-drop / delete (Phase 7)
- `MapAnnotationCircle` reusable view for thumbnail-styled annotations

**Dependencies:** Phases 2 (GRDB + Keychain), 3 (API client).

**Covers ACs:** `native-ios.AC1.1`, `native-ios.AC1.2`, `native-ios.AC1.3`, `native-ios.AC5.1`, `native-ios.AC5.2`, `native-ios.AC5.3`, `native-ios.AC5.4`.

**Done when:** SwiftUI previews render each view with stub data. UI tests verify: create trip flow ends with new trip in list; paste-token flow hydrates a prod trip into GRDB; map shows annotations for all photos with non-null GPS; tap on annotation navigates to PhotoDetailView; map controls visible.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Photo Capture Pipeline — PhotosPicker, EXIF, HEIC Transcode

**Goal:** User can pick a photo from their library, the app extracts EXIF GPS + capture date intact, transcodes HEIC if needed, and enqueues an `UploadQueueItem`. (Upload execution is Phase 6.)

**Components:**
- `PhotoCaptureCoordinator` in `ios-swift/RoadTrip/Photos/` — entry point invoked from TripDetailView's `+ Add Photo` action
- `PhotosPicker` integration (`PhotosUI`) for the picker UI
- Photo Library authorization flow: request `.readWrite`, handle `.limited` state
- `PHAsset` bridge: convert `PhotosPickerItem.itemIdentifier` → `PHAsset` → `PHImageManager.requestImageDataAndOrientation`
- `EXIFExtractor` in `ios-swift/RoadTrip/Photos/` — `CGImageSource` walker that pulls GPS lat/lng (with hemisphere ref) and `kCGImagePropertyExifDateTimeOriginal`
- `HEICTranscoder` in `ios-swift/RoadTrip/Photos/` — detects HEIC source via UTI, transcodes to JPEG via `UIImage(data:).jpegData(compressionQuality: 1.0)`, writes to temp file in `FileManager.default.temporaryDirectory`
- `UploadQueueItem` insertion: persisted with source file path, EXIF metadata, stage = `staged`

**Dependencies:** Phase 2 (GRDB for queue), Phase 4 (TripDetailView entry point).

**Covers ACs:** `native-ios.AC2.1`, `native-ios.AC2.2`, `native-ios.AC2.3`, `native-ios.AC2.5`.

**Done when:** Picking a photo from the simulator's photo library produces a queue item in GRDB with correct EXIF lat/lng matching the photo's metadata; HEIC source produces a `.jpg` temp file. Tests cover EXIF extraction (golden-file JPEG + golden-file HEIC), HEIC transcode round-trip, and Limited Photo Library auth path.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Upload Coordinator — Background URLSession + State Machine

**Goal:** Queued `UploadQueueItem`s execute end-to-end: 3-tier block PUTs to Azure + commit, surviving backgrounding, app-kill, network drops, and SAS expiry. Resulting Photo row appears in GRDB and pin renders on the map.

**Components:**
- `UploadCoordinator` singleton in `ios-swift/RoadTrip/Upload/UploadCoordinator.swift` — one `URLSession.background(withIdentifier: "com.psford.roadtripmap.native.uploads")`, delegate-based
- `UploadStateMachine` in `ios-swift/RoadTrip/Upload/UploadStateMachine.swift` — transitions: `staged` → `uploading_original` → `uploading_display` → `uploading_thumb` → `committing` → `done`/`failed`. Each transition is a GRDB write to the persisted `UploadQueueItem`
- `BlockPutter` in `ios-swift/RoadTrip/Upload/BlockPutter.swift` — splits a tier's source file into 4 MB blocks, generates base64 block IDs, kicks one `uploadTask(with:fromFile:)` per block (file-based mandatory for background)
- `SASRefresher` in `ios-swift/RoadTrip/Upload/SASRefresher.swift` — checks `sas_url_issued_at` before each block PUT; if > 1.75h, calls `RoadTripAPI.requestUpload` again (server-idempotent on the Guid), replaces stored SAS URLs
- `URLSessionTaskDelegate` implementation: `didSendBodyData` updates `bytes_uploaded`; `didCompleteWithError` advances state machine or persists failure for retry
- `UploadProgressStore` (`@Observable`, MainActor) — bridges background callbacks to SwiftUI via `Task { @MainActor in ... }`
- `AppDelegate` adapter (`@UIApplicationDelegateAdaptor`) handling `handleEventsForBackgroundURLSession` for app-relaunch reconciliation

**Dependencies:** Phases 2 (queue persistence), 3 (API client for request-upload/commit/abort), 5 (queue items get produced).

**Covers ACs:** `native-ios.AC2.4`, `native-ios.AC3.1`, `native-ios.AC3.2`, `native-ios.AC3.3`, `native-ios.AC3.4`, `native-ios.AC3.5`, `native-ios.AC3.6`.

**Done when:** A photo picked through Phase 5 uploads end-to-end against the dev slot, all 3 tiers commit, Photo row appears in GRDB, pin renders on TripDetailView. Tests cover: backgrounded upload completes; force-quit + relaunch resumes; mocked SAS-expiry triggers refresh path; mocked block-PUT 503 triggers retry; commit failure leaves queue item in `failed` state with surfaced error.
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Mutations + Offline-First Robustness

**Goal:** Delete trip, delete photo, pin-drop screens shipping with optimistic UI + revert on failure. Full app-lifecycle robustness for all mutations + reads.

**Components:**
- `DeleteTripAction` + confirmation alert in `TripDetailView` toolbar; calls GRDB cascade-delete + `RoadTripAPI.deleteTrip` + `KeychainStore.removeSecretToken`
- `DeletePhotoAction` in `PhotoDetailView`; optimistic GRDB delete + server DELETE + revert-on-failure
- `PinDropView` modal sheet — interactive `Map` with a draggable center pin; on confirm, optimistic GRDB update + `RoadTripAPI.pinDrop` + revert-on-failure
- `ErrorToastPresenter` (`@Observable`) — surfaces toast notifications on mutation failures
- Empty / loading / no-network states in TripListView, TripDetailView, PhotoDetailView
- Retry logic in `UploadCoordinator` for transient failures (exponential backoff up to N attempts, then mark `failed` and surface UI)

**Dependencies:** Phases 4 (UI scaffolding), 6 (upload coordinator running).

**Covers ACs:** `native-ios.AC1.4`, `native-ios.AC1.5`, `native-ios.AC1.6`, `native-ios.AC4.1`, `native-ios.AC4.2`, `native-ios.AC4.3`, `native-ios.AC4.4`, `native-ios.AC5.5`, `native-ios.AC7.4`.

**Done when:** Each mutation has tests covering happy + revert paths. UploadQueue survives force-quit + relaunch (manual test on real device). Slow-network test (Network Link Conditioner "3G") shows upload still completes with progress UI tracking. Native client app, configured to point at dev slot, completes the full Create→Upload→Pin loop end-to-end.
<!-- END_PHASE_7 -->

<!-- START_PHASE_8 -->
### Phase 8: TestFlight Release Pipeline

**Goal:** First TestFlight build accepted by Apple, installed on Patrick's + dad's iPhones, full loop works on real devices against the dev slot.

**Components:**
- App Store Connect app record for bundle `com.psford.roadtripmap.native` (created via App Store Connect web UI; Patrick action)
- `PrivacyInfo.xcprivacy` privacy manifest declaring: photo library access, network access, no tracking, no third-party SDKs
- App Store metadata stubs (placeholder name, description, icon) sufficient for TestFlight internal review
- Archive build configuration (Release scheme, dev-slot base URL for TestFlight builds — separate `.xcconfig` for `Debug` / `Release-TestFlight` / `Release-Prod`)
- Upload pipeline: `xcodebuild archive` + `xcrun altool --upload-app` (or `xcrun notarytool` for newer flow). Documented as a runbook in `docs/runbooks/testflight-release.md`
- TestFlight internal tester invites for Patrick + dad's Apple IDs

**Dependencies:** Phase 7 (full feature parity for shippable scope).

**Covers ACs:** `native-ios.AC6.1`, `native-ios.AC6.2`, `native-ios.AC6.3`, `native-ios.AC6.4`.

**Done when:** Build uploaded to App Store Connect is processed without rejection. Patrick + dad each install the TestFlight build on their physical iPhone. End-to-end: each creates a test trip, uploads a real photo, sees the pin on the map, opens the share link in Safari (verifying the .NET view page still serves).
<!-- END_PHASE_8 -->

## Additional Considerations

**Swift learning curve (Patrick's stated constraint).** Patrick has basic Swift syntax knowledge but is not fluent. The implementation plan should explicitly call out Swift-only concepts when they appear in code: optionals + optional chaining, value vs reference types (struct vs class), `@Observable` macro + property wrappers (`@State`, `@Binding`, `@Bindable`, `@Environment`), actor isolation + `Task { @MainActor in ... }`, `async/await` + `Task` lifecycle, protocols-as-types + `some` opaque returns, `Codable` decoding patterns, and the URLSession delegate model (necessary for background uploads — doesn't use async/await). One-line explanation comments are sufficient; long explanations belong in PR descriptions.

**iOS dev loop on Mac.** This rewrite sidesteps the existing local-Mac dev-loop gap (no SQL Server on macOS → `dotnet run` won't start locally) by having the native client point at the Azure dev slot for the iteration loop. Per-PR backend changes that need testing get deployed to dev slot via `deploy-dev.yml`. Local backend on Mac remains broken and is intentionally not solved by this design — that's a separate concern, deferred indefinitely.

**TestFlight first-build review.** Apple's first build for a new bundle ID typically takes 24–48h for "first build review" even for internal testing. Patrick should expect this on the first Phase 8 submission. Subsequent builds for the same bundle ID install immediately for internal testers. The 1-week shippable estimate includes this review window.

**Scroll-fade work.** The recently-merged scroll-fade feature on the develop branch becomes defunct under this rewrite (SwiftUI's NavigationStack handles the underlying intent natively). The merge is not reverted — it stays on develop as historical record. The scroll-fade design plan and test plan stay in `docs/`.

**Photo caching and disk pressure.** iOS may purge `~/Library/Caches/` under storage pressure. The native client must tolerate cache misses gracefully (re-fetch from server proxy URL via `AsyncImage`). The 1 GB LRU ceiling is a soft cap on what the app retains; iOS may evict regardless.

**Endpoint cleanup is its own future plan.** This design intentionally does NOT cover deletion of POI / boundary / Nominatim endpoints or their seeders. That's a post-cutover cleanup phase tracked separately, after the Capacitor app is decommissioned and prod traffic is exclusively native.

**Existing scroll-fade-era code coverage on the .NET side stays intact.** The PhotoReadService changes and the resilient-upload work landed on the scroll-fade branch are unrelated to the rewrite and remain functional. The native client uses the resilient-upload flow as-is.
