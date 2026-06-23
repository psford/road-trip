# Photos (native SwiftUI app)

Last verified: 2026-06-21

## Purpose
The capture/ingest core for adding photos to a trip: EXIF extraction, HEIC→JPEG
transcoding, one-shot location, and the `PhotoCaptureCoordinator` that stages a
data- or asset-based photo into an `UploadQueueItem` ready for the resilient uploader.
The SwiftUI capture bridges (camera/library pickers) live in `Views/Photos`.

## Contracts
- **`PhotoCaptureCoordinator(database:)`** — two staging entry points, both returning an
  `UploadQueueItem` (persisted to GRDB):
  - `stagePhoto(imageData:filename:tripId:overrideCoordinate:)` — data-based core (used by
    camera capture). EXIF GPS comes from `overrideCoordinate` when the image has none.
  - `stagePhoto(from:tripId:overrideCoordinate:)` — `PhotosPickerItem`/PHAsset path (library),
    preserves original EXIF; throws `CaptureError.noAsset` when the asset can't be resolved.
- **`OneShotLocationProvider`** (`@MainActor`) — `currentCoordinate(timeout:) async -> CLLocationCoordinate2D?`.
  One-shot CoreLocation; returns `nil` on denial/restriction/error/**timeout (hard 4s)**.
  Never blocks indefinitely; never starts continuous updates.
- **`EXIFExtractor` / `HEICTranscoder`** — pure-ish helpers for reading capture metadata and
  normalizing to upload-ready JPEG.
- **`CameraPicker`** (`Views/Photos`) — `UIViewControllerRepresentable` over
  `UIImagePickerController` (`.camera`). `onCapture(UIImage?)` — `nil` on cancel. Needed because
  SwiftUI `PhotosPicker` covers only the library, not new captures (iOS 17/18).

## Dependencies
- **Uses**: `Storage/AppDatabase` (UploadQueueItem persistence), CoreLocation, Photos /
  PhotosUI, ImageIO, UIKit (camera bridge).
- **Used by**: `Views/Trips/TripDetailView` (the add-photo Menu: Take Photo / Choose from Library),
  `Upload/*` (consumes the staged `UploadQueueItem`).
- **Boundary**: capture/staging only — does not perform the network upload (that's `Upload/*`).

## Key Decisions
- **Camera capture path (Phase 4)**: take-photo → `CameraPicker` → JPEG (`compressionQuality 0.9`)
  → one-shot location raced against a 4s timeout (`locationWithTimeout` in TripDetailView) →
  `stagePhoto(imageData:...)`. No fix → fall back to the existing pin-drop sheet
  (`PinDropView`) before the photo can upload.
- **One-shot, timeout-bounded location**: capture must never hang waiting on a GPS fix; a missing
  fix degrades to manual pin-drop rather than blocking. `NSCameraUsageDescription` is declared in
  `project.yml`.
- **Shared data-based staging core**: camera and library both funnel into `PhotoCaptureCoordinator`,
  so EXIF/no-GPS handling and the upload hand-off are identical regardless of source.

## Invariants
- A staged photo with no EXIF GPS and no override coordinate is parked
  (`stagedNeedingLocation`) and cannot upload until the user drops a pin.
- `OneShotLocationProvider` resumes its continuation exactly once (fix, error, cancel, or timeout).
- HEIC is transcoded to JPEG before upload; originals are not degraded beyond the staging encode.

## Key Files
- `PhotoCaptureCoordinator.swift` — staging core (data + asset entry points).
- `OneShotLocationProvider.swift` — one-shot CoreLocation with hard timeout.
- `EXIFExtractor.swift` / `HEICTranscoder.swift` — metadata + transcode helpers.
- `../Views/Photos/CameraPicker.swift` — UIImagePickerController camera bridge.
- `../Views/Photos/PinDropView.swift` — manual location fallback sheet.

## Gotchas
- Library staging requires `PHPhotoLibrary.requestAuthorization(.readWrite)` — the picker
  selection alone does NOT grant the access needed to read the PHAsset's EXIF.
- Adding a Photos file means editing sources + `project.yml`, then regenerating the (gitignored)
  `.xcodeproj` via XcodeGen on the Mac — never edit `.xcodeproj` directly.
