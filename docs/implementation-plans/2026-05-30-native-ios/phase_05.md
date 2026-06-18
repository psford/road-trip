# Native iOS — Phase 5: Photo Capture Pipeline (PhotosPicker, EXIF Ladder, HEIC, Offline Enqueue) Implementation Plan

**Goal:** A user can pick a photo, the app extracts EXIF GPS + capture timestamp, resolves coordinates through the offline fallback ladder (EXIF → live `CLLocation` → pin-drop), transcodes HEIC→JPEG when needed, writes the bytes to the durable staging cache, and inserts an `UploadQueueItem` at stage **`queued`** — **with no network required**. An optimistic `pending` pin appears immediately. (Upload execution is Phase 6.)

**Architecture:** `PhotoCaptureCoordinator` orchestrates: `PhotosPicker` (configured with `photoLibrary: .shared()` so `itemIdentifier` is populated) → `PHAsset` → `PHImageManager.requestImageDataAndOrientation` (raw bytes incl. EXIF) → `CGImageSource` EXIF walk → coordinate ladder → HEIC transcode → `StagingFileStore` (Phase 1, non-purgeable) → GRDB `UploadQueueItem(stage: .queued)` → optimistic pin. Pure metadata/coordinate logic is FCIS-separated and golden-file tested; the picker/PHAsset/location I/O is the shell.

**Tech Stack:** PhotosUI (`PhotosPicker`), Photos (`PHAsset`, `PHImageManager`, `PHPhotoLibrary` `.readWrite`), ImageIO (`CGImageSource`, `kCGImagePropertyGPSDictionary`, `kCGImagePropertyExifDateTimeOriginal`), CoreLocation (`CLLocationManager` one-shot fix), UIKit (`UIImage.jpegData`), GRDB, MapKit (pin-drop reuses the Phase-3 map).

**Scope:** Phase 5 of 8.

**Codebase verified:** 2026-06-18.

---

## Verified facts grounding this phase

- `UploadQueueItem` (scaffold) already has the fields this phase writes: `uploadId`, `tripId`, `localFilePath`, `filename`, `contentType`, `sizeBytes`, `exifLat?`, `exifLon?`, `takenAt?`, `stage`, `bytesUploaded`, `blockIds`, SAS fields (null at `queued`), `createdAt`, `updatedAt`. Phase 1 added `.queued`/`.requesting` to `UploadStage` and `StagingFileStore` (non-purgeable, Application Support).
- `Photo` has `placeNamePending` (Phase 1). For an offline-captured photo, the optimistic pin's place name is "Locating…" until reconnect backfills it (Phase 6/7).
- **PhotosPicker strips EXIF by design** (research). The canonical workaround: request `PHPhotoLibrary.requestAuthorization(for: .readWrite)`, build the picker as `PhotosPicker(selection:, photoLibrary: .shared())` (the `.shared()` is MANDATORY or `PhotosPickerItem.itemIdentifier` is nil), then `PHAsset.fetchAssets(withLocalIdentifiers: [itemIdentifier], options: nil)`.
- **Raw bytes incl. EXIF:** `PHImageManager.default().requestImageDataAndOrientation(for: asset, options:)` with `options.isNetworkAccessAllowed = true` (iCloud) and `options.version = .current`.
- **EXIF walk:** `CGImageSourceCreateWithData` → `CGImageSourceCopyPropertiesAtIndex(0)` → `kCGImagePropertyGPSDictionary` → `kCGImagePropertyGPSLatitude`/`Longitude` (+ `…Ref` "N"/"S"/"E"/"W" → sign) ; `kCGImagePropertyExifDictionary` → `kCGImagePropertyExifDateTimeOriginal` (format `"yyyy:MM:dd HH:mm:ss"`, naive/no TZ; optional `kCGImagePropertyExifOffsetTimeOriginal`).
- **Limited Photo Library auth (`.limited`):** `fetchAssets(withLocalIdentifiers:)` works for user-selected items and EXIF is readable for those; returns empty for non-selected (privacy). The flow must work identically for the selected subset (native-ios.AC2.5).
- **HEIC:** detect via `PhotosPickerItem.supportedContentTypes.contains(.heic)` (or UTI of the data); transcode `UIImage(data:)?.jpegData(compressionQuality: 1.0)` — bakes in orientation, drops EXIF (fine: we read EXIF from the original bytes BEFORE transcoding). Uploaded blob is `image/jpeg` (native-ios.AC2.2).
- **Coordinate ladder:** (1) EXIF GPS (no network); (2) live `CLLocationManager` fix (`requestWhenInUseAuthorization`; iOS 17 one-shot — `CLLocationManager` delegate `requestLocation()` or `CLLocationUpdate.liveUpdates()` first value); (3) pin-drop on the last-cached map region. Place name via `CLGeocoder.reverseGeocodeLocation` backfills on reconnect (Phase 6/7), NOT at capture (`placeNamePending = true`).
- **No GPS → must pin-drop before queueing** (native-ios.AC2.6 / native-ios.AC8.5): a photo with neither EXIF GPS nor a device fix forces the pin-drop UI; an item is never queued without coordinates.
- Required Info.plist usage strings (add in Phase 1's config or here): `NSPhotoLibraryUsageDescription`, `NSLocationWhenInUseUsageDescription` (Phase 8 also needs these for `PrivacyInfo.xcprivacy`).

---

## Acceptance Criteria Coverage

### native-ios.AC2: Photo capture preserves EXIF + handles HEIC
- **native-ios.AC2.1 Success:** Photo picked via PhotosPicker (with `.readWrite`) → EXIF lat/lng + `takenAt` via PHAsset + CGImageSource; values match iOS Photos
- **native-ios.AC2.2 Success:** HEIC source → transcoded to JPEG client-side; uploaded blob is `image/jpeg`
- **native-ios.AC2.3 Success:** Photo with EXIF GPS → coordinates from EXIF; no pin-drop shown (place name backfills via `CLGeocoder` on reconnect)
- **native-ios.AC2.5 Edge:** Limited Photo Library access → only user-selected photos accessible; EXIF still extractable; flow works identically
- **native-ios.AC2.6 Success:** Photo without EXIF GPS → tries a live `CLLocationManager` fix; if none, shows pin-drop UI before allowing queue

### native-ios.AC8 (capture-side cases)
- **native-ios.AC8.4 Success:** Photo captured offline with EXIF GPS → pinned at EXIF coords with no pin-drop; place name "Locating…" then backfills on reconnect
- **native-ios.AC8.5 Success:** Photo captured offline without EXIF GPS → device `CLLocation` fix if available, else pin-drop required before queueing

(The "no network call at capture" assertion native-ios.AC8.1 is fully verified in Phase 6 where the transport is stubbed; this phase establishes the no-network enqueue path.)

**Environment:** **Mac** (Swift build + simulator; photo-library + CLLocation need device/sim).

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) — EXIF + HEIC pure core (golden-file tested) -->

<!-- START_TASK_1 -->
### Task 1: `EXIFExtractor` (pure CGImageSource walk)

**Verifies:** native-ios.AC2.1 (extraction), native-ios.AC2.3 (EXIF presence path)

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Photos/EXIFExtractor.swift`
- Create: `ios-swift/RoadTrip/RoadTripTests/Fixtures/` (golden JPEGs — see below)
- Test: `ios-swift/RoadTrip/RoadTripTests/EXIFExtractorTests.swift`

**Implementation:**
- Pure function `EXIFExtractor.metadata(from data: Data) -> PhotoMetadata` where `PhotoMetadata { lat: Double?; lon: Double?; takenAt: Date? }`. Walk: `CGImageSourceCreateWithData(data as CFData, nil)` → `CGImageSourceCopyPropertiesAtIndex(src, 0, nil)` → GPS dict (apply hemisphere ref sign: `S`/`W` negate) and EXIF `DateTimeOriginal` (parse `"yyyy:MM:dd HH:mm:ss"`; if `OffsetTimeOriginal` present, apply it, else treat as device-local). Returns nils when keys absent. No side effects — fully testable.
- **Golden fixtures:** add two small JPEGs to `Fixtures/`: one with known EXIF GPS + DateTimeOriginal, one with no GPS. (Generate them offline with `exiftool`/ImageIO; document the embedded values in a `Fixtures/README.md` so the test asserts exact lat/lng/date.)

**Testing (EXIFExtractorTests):**
- native-ios.AC2.1: golden-with-GPS → `lat`/`lon` equal the documented values (within 1e-5), `takenAt` equals the documented timestamp.
- golden-without-GPS → `lat`/`lon` nil, `takenAt` present (or nil per the fixture).

**Verification (Mac):** `xcodebuild test -only-testing:RoadTripTests/EXIFExtractorTests` passes.

**Commit:** `feat(ios): EXIFExtractor CGImageSource walk + golden-file tests (native-ios.AC2.1)`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: `HEICTranscoder`

**Verifies:** native-ios.AC2.2

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Photos/HEICTranscoder.swift`
- Test: `ios-swift/RoadTrip/RoadTripTests/HEICTranscoderTests.swift` (+ a HEIC fixture if a small one is available; else test the JPEG passthrough + UTI detection logic)

**Implementation:**
- `HEICTranscoder.isHEIC(uti: UTType) -> Bool` (pure) and `transcodeToJPEG(_ data: Data) -> (data: Data, contentType: String)?` returning JPEG bytes + `"image/jpeg"` via `UIImage(data:)?.jpegData(compressionQuality: 1.0)`. For non-HEIC input, callers pass through unchanged with the original content type. (Swift note: `jpegData` bakes orientation and strips EXIF — acceptable because EXIF is read upstream in Task 1 from the ORIGINAL bytes.)
- Contract: a HEIC source yields `contentType == "image/jpeg"` so the server (SkiaSharp, no reliable HEIC) only ever sees JPEG.

**Testing:**
- `isHEIC(.heic) == true`, `isHEIC(.jpeg) == false`.
- If a HEIC fixture is present: transcode → output decodes as a valid JPEG (`UIImage(data:)` non-nil), content type `image/jpeg`. Otherwise assert the JPEG-passthrough branch and document the device-only verification of true HEIC transcode.

**Verification (Mac):** tests pass.

**Commit:** `feat(ios): HEICTranscoder → JPEG (native-ios.AC2.2)`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: `CoordinateLadder` (pure resolution policy)

**Verifies:** native-ios.AC2.6, native-ios.AC8.5 (the decision logic)

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Photos/CoordinateLadder.swift`
- Test: `ios-swift/RoadTrip/RoadTripTests/CoordinateLadderTests.swift`

**Implementation:**
- Pure policy `enum CoordinateSource { case exif(lat,lon); case deviceFix(lat,lon); case needsPinDrop }`. `CoordinateLadder.resolve(exif: PhotoMetadata, deviceFix: CLLocationCoordinate2D?) -> CoordinateSource`: EXIF GPS present → `.exif`; else device fix present → `.deviceFix`; else `.needsPinDrop`. This isolates the ladder ordering from the I/O of actually getting a device fix, so it's unit-testable without CoreLocation.

**Testing (CoordinateLadderTests):**
- EXIF present (with or without device fix) → `.exif` (native-ios.AC2.3: no pin-drop).
- No EXIF, device fix present → `.deviceFix` (native-ios.AC2.6/native-ios.AC8.5 rung 2).
- No EXIF, no fix → `.needsPinDrop` (native-ios.AC2.6/native-ios.AC8.5 rung 3).

**Verification (Mac):** tests pass.

**Commit:** `feat(ios): CoordinateLadder resolution policy +tests (native-ios.AC2.6/native-ios.AC8.5)`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-6) — picker + location shells + capture coordinator -->

<!-- START_TASK_4 -->
### Task 4: `PhotoLibraryService` (PhotosPicker → PHAsset → raw bytes)

**Verifies:** native-ios.AC2.1, native-ios.AC2.5 (the I/O path)

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Photos/PhotoLibraryService.swift`

**Implementation:**
- `requestAuthorization() async -> PHAuthorizationStatus` wrapping `PHPhotoLibrary.requestAuthorization(for: .readWrite)`.
- `rawImageData(for item: PhotosPickerItem) async throws -> (data: Data, uti: UTType, asset: PHAsset?)`: read `item.itemIdentifier`; `PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil)`; `PHImageManager.default().requestImageDataAndOrientation(for: asset, options:)` (options: `isNetworkAccessAllowed = true`, `version = .current`) → bytes + dataUTI. If `.limited` access yields no asset for the identifier (non-selected), throw a typed `.assetUnavailable` so the UI can prompt to re-select (native-ios.AC2.5).
- Document the `PhotosPicker(selection:, matching: .images, photoLibrary: .shared())` requirement for the View (Task 6) — `.shared()` is required for `itemIdentifier`.
- This is the shell (PhotoKit I/O); not unit-tested directly — verified on the simulator via the coordinator (Task 6).

**Verification (Mac):** builds; exercised in Task 6.

**Commit:** `feat(ios): PhotoLibraryService (PHAsset bridge for EXIF-bearing bytes)`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: `LocationService` (one-shot device fix)

**Verifies:** native-ios.AC2.6 / native-ios.AC8.5 (rung-2 device fix I/O)

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Photos/LocationService.swift`

**Implementation:**
- `requestWhenInUse() async` and `currentFix(timeout:) async -> CLLocationCoordinate2D?` — a one-shot fix. iOS 17: prefer `CLLocationManager().requestLocation()` via a delegate bridged to a continuation, OR the first value of `CLLocationUpdate.liveUpdates()`. Return nil on denial/timeout (so the ladder falls to pin-drop). Handle `.denied`/`.restricted` gracefully.
- Shell; verified via the coordinator on the simulator (the sim can simulate a location).

**Verification (Mac):** builds; exercised in Task 6.

**Commit:** `feat(ios): LocationService one-shot CLLocation fix`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: `PhotoCaptureCoordinator` + `+ Add Photo` UI + `PinDropView` + offline enqueue

**Verifies:** native-ios.AC2.1, native-ios.AC2.2, native-ios.AC2.3, native-ios.AC2.5, native-ios.AC2.6, native-ios.AC8.4, native-ios.AC8.5

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Photos/PhotoCaptureCoordinator.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/Views/Photos/PinDropView.swift`
- Modify: `ios-swift/RoadTrip/RoadTrip/Views/Trips/TripDetailView.swift` (`+ Add Photo` toolbar item + PhotosPicker)
- Modify: `ios-swift/RoadTrip/RoadTrip/ViewModels/TripDetailViewModel.swift` (expose `enqueue` + optimistic pin)
- Test: `ios-swift/RoadTrip/RoadTripTests/PhotoCaptureCoordinatorTests.swift`

**Implementation:**
- `PhotoCaptureCoordinator.capture(item: PhotosPickerItem, tripId:) async throws -> UploadQueueItem`:
  1. `PhotoLibraryService.rawImageData` → raw bytes + UTI.
  2. `EXIFExtractor.metadata(from:)` → lat/lon/takenAt.
  3. Resolve coordinates **lazily down the ladder** — do NOT call `LocationService.currentFix()` up front. Rung 1: if `exif.lat != nil`, use EXIF GPS and STOP (no location request — avoids an unnecessary permission prompt / GPS spin on already-geotagged photos, native-ios.AC2.3). Rung 2: only when EXIF GPS is absent, `await LocationService.currentFix()`. Rung 3: if still none, return a `.needsPinDrop` signal so the UI presents `PinDropView`; the chosen coordinate re-enters the flow. (`CoordinateLadder.resolve(exif:, deviceFix:)` stays a pure function taking an optional `deviceFix`; the laziness is at this call site.)
  4. If HEIC (`HEICTranscoder.isHEIC`), transcode → JPEG bytes + `image/jpeg`; else pass through.
  5. `uploadId = UUID()`; write bytes to `StagingFileStore.store(data:tripId:uploadId:ext:)` (non-purgeable).
  6. Insert `UploadQueueItem(stage: .queued, localFilePath:, filename:, contentType:, sizeBytes:, exifLat:, exifLon:, takenAt:, blockIds: [], ...)` into GRDB. **No network call anywhere in this method.**
  7. Emit an optimistic `pending` `Photo`-like pin to the map (the design's "optimistic pin"): the `TripMapView` should render `pending` annotations sourced from `queued`/in-flight `UploadQueueItem` rows (coords from `exifLat/exifLon` or the pin-drop), with `placeName` shown as "Locating…". Implement by having `TripDetailViewModel` also observe `UploadQueueItem` rows for the trip and merge them as pending annotations alongside committed `Photo` annotations. (This optimistic-pin merge is consumed again in Phase 6 when the pin flips to `committed`.)
- `PinDropView`: reuse the Phase-3 `MKMapView` wrapper with a fixed center crosshair over the last-cached map region; "Drop pin here" confirms the center coordinate. Used both for native-ios.AC2.6 capture-time and Phase-7 edit-location.
- `TripDetailView`: a `PhotosPicker(selection:, matching:.images, photoLibrary:.shared())` behind a `+ Add Photo` toolbar item; on selection, call the coordinator; present `PinDropView` when `.needsPinDrop`.

**Testing (PhotoCaptureCoordinatorTests, in-memory GRDB + golden fixtures, no network):**
- native-ios.AC2.1/native-ios.AC2.3/native-ios.AC8.4: capture a golden-GPS JPEG (offline — no `RoadTripAPI` injected/used) → a `queued` `UploadQueueItem` row exists with `exifLat/exifLon == fixture`, bytes present in `StagingFileStore` and the row's `localFilePath` resolves **under Application Support, NOT `Library/Caches`** (assert the path string — guards the non-purgeable-staging invariant against a wrong-store regression), **zero network interaction** (the coordinator has no API dependency, structurally guaranteeing native-ios.AC8.1's precondition).
- native-ios.AC2.2: capture a HEIC source (fixture or injected transcoder) → stored `contentType == "image/jpeg"`.
- native-ios.AC2.6/native-ios.AC8.5: capture a no-GPS fixture with a nil device fix → coordinator returns `.needsPinDrop` and does NOT insert a row until a coordinate is supplied; with a coordinate supplied → row inserted with those coords.
- native-ios.AC2.5: with a stubbed `PhotoLibraryService` simulating `.limited` (asset available for the selected id) → flow completes identically.

**Verification (Mac, simulator screenshot):** in airplane mode, pick a geotagged photo → a yellow `pending` pin appears immediately on the map with "Locating…", and a `queued` row exists (inspect via a debug log/test); pick a no-GPS photo → pin-drop sheet appears and queueing only proceeds after dropping a pin. **Screenshot of the optimistic pending pin with airplane mode on.**

**Commit:** `feat(ios): PhotoCaptureCoordinator offline enqueue + PinDropView + optimistic pin (native-ios.AC2.1/2.2/2.3/2.5/2.6, native-ios.AC8.4/8.5)`
<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_B -->

---

## Phase Done When
Picking a photo with airplane mode on produces a `queued` `UploadQueueItem` with bytes in the non-purgeable staging cache and an optimistic `pending` pin, **with no network call made** (structurally — the coordinator has no API dependency); EXIF lat/lng matches the photo's metadata (golden-file) (native-ios.AC2.1); a no-EXIF photo falls to a device fix, then pin-drop (native-ios.AC2.6/native-ios.AC8.5); a HEIC source produces a JPEG (`image/jpeg`) (native-ios.AC2.2); EXIF-GPS photos pin without a pin-drop and show "Locating…" (native-ios.AC2.3/native-ios.AC8.4); Limited auth works for selected photos (native-ios.AC2.5). Tests cover the ladder, HEIC, Limited auth, and offline enqueue. **Verified on the simulator with a screenshot of the offline pending pin** (Mac).
