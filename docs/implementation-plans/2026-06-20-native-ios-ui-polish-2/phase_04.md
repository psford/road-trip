# Native iOS UI Polish (Round 2) — Phase 4: Camera capture from the + control

**Goal:** Turn the `+` Add-Photo control into a menu offering **Take Photo** (camera) and **Choose from Library**. A captured photo is staged through the existing pipeline, tagged with a one-shot device location when available, or routed to the existing pin-drop sheet when not.

**Architecture:** A `UIViewControllerRepresentable` bridge wraps `UIImagePickerController(sourceType: .camera)` (SwiftUI has no native camera-capture view). A small one-shot `CLLocationManager` provider (async, with a timeout) supplies the coordinate. **The staging core already accepts raw image `Data` + an optional coordinate** (`PhotoCaptureCoordinator.stagePhoto(imageData:filename:tripId:overrideCoordinate:)`), so the camera path reuses it directly — no coordinator refactor needed. When no fix is available, the captured photo stages with no coordinate and the existing no-GPS pin-drop flow takes over.

**Tech Stack:** UIKit bridge (`UIImagePickerController`, `UIViewControllerRepresentable`, `Coordinator`), CoreLocation (`CLLocationManager`, `requestLocation()`, async continuation + timeout), SwiftUI `Menu`/`.photosPicker`/`.sheet`, existing `PhotoCaptureCoordinator` + `PinDropView`, XcodeGen `project.yml`, XCTest.

**Scope:** Phase 4 of 5. Independent of Phases 1-3, but edits `TripDetailView` like Phase 5 (sequence Phase 5 after).

**Codebase verified:** 2026-06-20 via codebase-investigator + internet-researcher.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### native-ios-ui-polish-2.AC3: Camera capture
- **native-ios-ui-polish-2.AC3.1 Success:** The + control presents a choice of "Take Photo" (camera) and "Choose from Library".
- **native-ios-ui-polish-2.AC3.2 Success:** A camera-captured photo is staged through the existing pipeline (transcoded to JPEG and queued for upload).
- **native-ios-ui-polish-2.AC3.3 Success:** When a location fix is available at capture, the staged photo is tagged with the current device coordinate.
- **native-ios-ui-polish-2.AC3.4 Failure:** When location permission is denied or no fix is available, the pin-drop sheet is shown so the user can set the location; the capture is not lost and the app does not crash.
- **native-ios-ui-polish-2.AC3.5 Success:** "Choose from Library" still stages a photo as before (regression guard).

> **Device-verified:** AC3.2/AC3.3/AC3.4 end-to-end require a real camera (the simulator has none — `UIImagePickerController.isSourceTypeAvailable(.camera)` is false). The unit-testable contract is the data-based staging path (coordinate honored, transcode invoked); device steps go to `docs/device-test-checklist.md` (Task 6).

---

## Findings that shape this phase (from investigation)

- **The "refactor" the design calls for is already done.** `Photos/PhotoCaptureCoordinator.swift`:
  - `:42-48` `stagePhoto(from item: PhotosPickerItem, tripId:, overrideCoordinate:) async throws -> UploadQueueItem` loads data then delegates to →
  - `:54-78` `stagePhoto(imageData: Data, filename: String, tripId:, overrideCoordinate: CLLocationCoordinate2D? = nil) async throws -> UploadQueueItem` — the testable core: `EXIFExtractor.extract` → coordinate precedence (`overrideCoordinate ?? meta`) → `normalizedImage` (HEIC→JPEG via `HEICTranscoder`, orientation bake) → write staging file → insert `UploadQueueItem`.
  - **The camera path calls this core directly** with JPEG `Data` + the one-shot coordinate. No change to the coordinator.
- `Photos/HEICTranscoder.swift:13-26` operates on `Data` (`isHEIC`, `transcodedToJPEG`). A camera `UIImage` → `jpegData(compressionQuality:)` produces JPEG `Data` we pass in.
- `Views/Trips/TripDetailView.swift`:
  - Current `+` is a `PhotosPicker` toolbar item (`:105-111`) with `Label("Add Photo", systemImage: "plus")`, state `@State private var pickedItem: PhotosPickerItem?` (`:27`), `.onChange(of: pickedItem)` → `stage(newItem)` (`:121-124`).
  - No-GPS pin-drop already wired: staged items with `exifLat == nil, exifLon == nil` set `stagedNeedingLocation` (`~:285`) which presents `PinDropView` (`:153-158`) → `startUploadWithLocation(item, coordinate:)`. **Reuse this exact path for camera no-fix.**
- `Views/Photos/PinDropView.swift:17-26` init: `(initialCoordinate:title:confirmTitle:onConfirm:)`.
- `Views/Photos/LocationPickerMap.swift:9-110` is the existing `UIViewRepresentable` + `Coordinator` pattern to mirror for the camera bridge.
- `project.yml:48-57` `settings.base` already has `INFOPLIST_KEY_NSLocationWhenInUseUsageDescription` (`:54`) and `INFOPLIST_KEY_NSPhotoLibraryUsageDescription`. **Only `NSCameraUsageDescription` is missing.** Plist is synthesized (`GENERATE_INFOPLIST_FILE: YES`).
- **No `CLLocationManager` exists anywhere yet** — this is the new pattern the design flagged. Encapsulate it in a small provider, not scattered in the view.

**Important sequencing note for the executor:** Build the `+` menu in this phase as a small reusable piece (a computed `@ViewBuilder var addPhotoMenu` or a tiny subview) placed in the **current toolbar location**. Phase 5 RELOCATES the same menu into the floating bar. Keeping it as one reusable unit avoids rework. Preserve the `Label("Add Photo", systemImage: "plus")` / accessibility identifier `"Add Photo"` so `testSampleDataTripHidesShareButton` keeps passing.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Camera bridge (`CameraPicker`)

**Verifies:** native-ios-ui-polish-2.AC3.1 (implementation), native-ios-ui-polish-2.AC3.2 (implementation)

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Views/Photos/CameraPicker.swift`

**Implementation:**
A `UIViewControllerRepresentable` wrapping `UIImagePickerController(sourceType: .camera)`, mirroring the `LocationPickerMap` Coordinator style. Complete implementation:
```swift
import SwiftUI
import UIKit

/// SwiftUI bridge to `UIImagePickerController` for camera capture.
/// SwiftUI's `PhotosPicker` only covers the photo library; capturing a NEW photo
/// still requires this UIKit controller (iOS 17/18). Mirrors the
/// `UIViewControllerRepresentable`/`Coordinator` pattern used by `LocationPickerMap`.
struct CameraPicker: UIViewControllerRepresentable {
    @Environment(\.dismiss) private var dismiss
    /// Called with the captured image, or `nil` if the user cancelled.
    let onCapture: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        picker.allowsEditing = false
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            let image = info[.originalImage] as? UIImage
            parent.onCapture(image)
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.onCapture(nil)
            parent.dismiss()
        }
    }
}
```

**Verification:** `xcodegen generate && xcodebuild ... build` → builds.

**Commit:** `feat(ios): CameraPicker UIImagePickerController bridge`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: One-shot location provider (`OneShotLocationProvider`)

**Verifies:** native-ios-ui-polish-2.AC3.3 (implementation), native-ios-ui-polish-2.AC3.4 (implementation)

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Photos/OneShotLocationProvider.swift`

**Implementation:**
An async one-shot provider that returns a coordinate or `nil` (never throws to the caller — denial/timeout/failure all resolve to `nil` so the caller falls back to pin-drop). It must NOT hang indefinitely (cold fix can take 1-5s) — wrap `requestLocation()` in a continuation guarded by a timeout. Reference pattern from research (`withCheckedContinuation` + a timeout via `withThrowingTaskGroup`/`Task.sleep`). Complete implementation:
```swift
import CoreLocation

/// One-shot CoreLocation fetch for camera captures (no continuous location use).
/// Returns `nil` on denial, restriction, error, or timeout — the caller then
/// falls back to the manual pin-drop. Never blocks indefinitely.
@MainActor
final class OneShotLocationProvider: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocationCoordinate2D?, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    /// Returns a coordinate, or nil if unavailable within `timeout` seconds.
    func currentCoordinate(timeout: TimeInterval = 4) async -> CLLocationCoordinate2D? {
        switch manager.authorizationStatus {
        case .denied, .restricted:
            return nil
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
            // requestLocation() below will deliver once authorization resolves, or
            // the timeout fires; either way we return a value.
        case .authorizedWhenInUse, .authorizedAlways:
            break
        @unknown default:
            return nil
        }

        let fix = await withCheckedContinuation { (cont: CheckedContinuation<CLLocationCoordinate2D?, Never>) in
            self.continuation = cont
            self.manager.requestLocation()
        }
        // (Timeout handled by the caller-side race below; see note.)
        return fix
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in self.resume(with: locations.last?.coordinate) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.resume(with: nil) }
    }

    private func resume(with coordinate: CLLocationCoordinate2D?) {
        continuation?.resume(returning: coordinate)
        continuation = nil
    }
}
```
**Timeout:** implement the timeout at the call site (Task 3) using a task race so a never-arriving fix can't hang the capture, e.g.:
```swift
func locationWithTimeout(_ provider: OneShotLocationProvider, seconds: TimeInterval = 4) async -> CLLocationCoordinate2D? {
    await withTaskGroup(of: CLLocationCoordinate2D?.self) { group in
        group.addTask { await provider.currentCoordinate() }
        group.addTask { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)); return nil }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first
    }
}
```
(Executor: place `locationWithTimeout` wherever it reads cleanest — a free function near the view or a static on the provider. Keep the provider instance retained for the duration of the await so the continuation isn't deallocated.)

**Verification:** `xcodebuild ... build` → builds.

**Commit:** `feat(ios): one-shot CoreLocation provider with timeout for camera capture`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Wire the `+` menu (Take Photo / Choose from Library) and camera → location → staging

**Verifies:** native-ios-ui-polish-2.AC3.1, native-ios-ui-polish-2.AC3.2, native-ios-ui-polish-2.AC3.3, native-ios-ui-polish-2.AC3.4, native-ios-ui-polish-2.AC3.5

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Views/Trips/TripDetailView.swift` (Add-Photo control `:105-111`, staging `stage(_:)`/`:121-124`, pin-drop reuse `:153-158`/`~:285`, add state near `:21-37`)
- Modify: `ios-swift/RoadTrip/RoadTrip/project.yml:48-57` (add camera usage key)

**Implementation:**

1. **Info.plist key** — add under `settings.base` (location key already present at `:54`):
   ```yaml
   INFOPLIST_KEY_NSCameraUsageDescription: "Road Trip uses your camera to capture photos straight onto your trip map."
   ```

2. **Replace the `PhotosPicker` toolbar item with a reusable Add-Photo menu.** Add state:
   ```swift
   @State private var showCamera = false
   @State private var showLibraryPicker = false
   @State private var locationProvider = OneShotLocationProvider()
   // (pickedItem already exists at :27)
   ```
   Build the menu (keep "Add Photo" accessibility intact — UI test depends on it). Make it a reusable `@ViewBuilder` so Phase 5 can move it into the floating bar:
   ```swift
   @ViewBuilder private var addPhotoMenu: some View {
       Menu {
           Button {
               showCamera = true
           } label: { Label("Take Photo", systemImage: "camera") }
               .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))   // off on simulator
           Button {
               showLibraryPicker = true
           } label: { Label("Choose from Library", systemImage: "photo.on.rectangle") }
       } label: {
           Label("Add Photo", systemImage: "plus")
       }
       .accessibilityLabel(Text("Add Photo"))
       .accessibilityIdentifier("Add Photo")
       .disabled(isStaging)
   }
   ```
   Put `addPhotoMenu` where the old `PhotosPicker` ToolbarItem was (`:105-111`).

3. **Library path (AC3.5 regression):** keep the existing selection→stage flow, presented via the `.photosPicker` modifier instead of an inline picker:
   ```swift
   .photosPicker(isPresented: $showLibraryPicker, selection: $pickedItem, matching: .images,
                 preferredItemEncoding: .current)
   ```
   The existing `.onChange(of: pickedItem) { ... stage(newItem) }` (`:121-124`) stays unchanged — library staging behavior is preserved.

4. **Camera path:** present the bridge and run capture → one-shot location → stage:
   ```swift
   .sheet(isPresented: $showCamera) {
       CameraPicker { image in
           guard let image else { return }   // cancelled
           Task { await stageCameraImage(image) }
       }
       .ignoresSafeArea()
   }
   ```
   Add the staging helper that reuses the existing data-based core and the existing no-GPS pin-drop path:
   ```swift
   private func stageCameraImage(_ image: UIImage) async {
       guard let data = image.jpegData(compressionQuality: 0.9) else { return }
       let coordinate = await locationWithTimeout(locationProvider)   // nil if denied/timeout (AC3.4)
       let filename = "camera-\(UUID().uuidString).jpg"
       do {
           let item = try await coordinator.stagePhoto(imageData: data, filename: filename,
                                                        tripId: trip.id, overrideCoordinate: coordinate)
           // AC3.4: if no coordinate was attached, reuse the existing no-GPS pin-drop flow.
           if item.exifLat == nil || item.exifLon == nil {
               stagedNeedingLocation = item
           }
       } catch {
           // surface via the existing staging-error path used by the library flow
       }
   }
   ```
   - `coordinator` is the existing `PhotoCaptureCoordinator` instance the view already uses for library staging — reuse it (confirm its name in the view; do not create a second one).
   - `stagedNeedingLocation` + the `PinDropView` sheet (`:153-158`) already exist; do not duplicate them.
   - Match the view's existing error-surfacing mechanism for the catch (same as `stage(_:)` uses).

**Testing:** Task 4 unit-tests the staging core's coordinate/transcode contract; Task 5 keeps the library regression UI test green; device steps in Task 6.

**Verification:**
Run: `xcodegen generate && xcodebuild ... build`
Expected: builds; the `+` shows a menu with Take Photo / Choose from Library; library path still stages.

**Commit:** `feat(ios): + menu with camera capture, one-shot location, pin-drop fallback`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Unit tests for the data-based staging core (coordinate honored + transcode)

**Verifies:** native-ios-ui-polish-2.AC3.2, native-ios-ui-polish-2.AC3.3

**Files:**
- Modify/Create: `ios-swift/RoadTrip/RoadTripTests/PhotoCaptureCoordinatorTests.swift` (extend if it exists; otherwise create) — `AppDatabase.makeInMemory()` style.

**Testing:**
The camera path's correctness reduces to the data-based core that it calls. Test `PhotoCaptureCoordinator.stagePhoto(imageData:filename:tripId:overrideCoordinate:)` directly:
- **AC3.3 — coordinate honored:** stage with an explicit `overrideCoordinate` and assert the resulting `UploadQueueItem.exifLat/exifLon` equal that coordinate (the override must win over/stand in for absent EXIF — a camera JPEG has no GPS).
- **AC3.2 — transcode + queue:** stage with sample image `Data` (a small JPEG/PNG fixture; if a HEIC fixture is feasible, prefer it to prove HEIC→JPEG) and assert: the staged file exists, its `contentType` is JPEG, and the `UploadQueueItem` was inserted with `stage == .staged`. (Mirror how existing `PhotoCaptureCoordinator`/`Upload` tests construct fixtures — check `RoadTripTests` for an existing image fixture helper before inventing one.)
- **AC3.4 (unit slice) — no coordinate:** stage with `overrideCoordinate: nil` and an image without EXIF GPS; assert the resulting item has `exifLat == nil`/`exifLon == nil` (this is the signal `stageCameraImage` uses to trigger pin-drop).

If `PhotoCaptureCoordinator` needs a real `AppDatabase`, use `makeInMemory()`. Do not mock the DB.

**Verification:**
Run: `xcodebuild ... -only-testing:RoadTripTests/PhotoCaptureCoordinatorTests test`
Expected: pass.

**Commit:** `test(ios): staging core honors override coordinate and transcodes to JPEG`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Keep the library-path UI regression and Add-Photo presence green

**Verifies:** native-ios-ui-polish-2.AC3.1, native-ios-ui-polish-2.AC3.5

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTripUITests/RoadTripUITests.swift` (verify existing tests; add menu-presence assertion)

**Testing:**
- Confirm `testSampleDataTripHidesShareButton` still finds `app.buttons["Add Photo"]` (the menu's label must keep that identifier). Run it.
- Add/extend a UI test asserting AC3.1: open a trip, tap `app.buttons["Add Photo"]`, and assert the menu surfaces `app.buttons["Take Photo"]` and `app.buttons["Choose from Library"]` (menu items appear as buttons). "Take Photo" may be disabled on the simulator (no camera) — assert it `exists` rather than `isHittable`. Attach screenshot `AC3.1-add-photo-menu`.
- Do NOT attempt to drive the camera in XCUITest (simulator has none) — that is device-only (Task 6).

**Verification:**
Run: `xcodebuild ... -only-testing:RoadTripUITests/RoadTripUITests/testSampleDataTripHidesShareButton -only-testing:RoadTripUITests/RoadTripUITests/testAddPhotoMenuOffersCameraAndLibrary test`
Expected: pass.

**Commit:** `test(ios): Add-Photo menu offers camera + library; library regression guard`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Device checklist for camera capture

**Verifies:** native-ios-ui-polish-2.AC3.2, AC3.3, AC3.4 (device verification)

**Files:**
- Modify: the project's device checklist (`docs/device-test-checklist.md` — use the same path resolved in Phase 1 Task 5).

**Implementation:** Add items:
- [ ] **AC3.2/AC3.3 (device):** Take Photo → with Location allowed, the photo stages and uploads tagged with the current coordinate (pin appears at your location).
- [ ] **AC3.4 (device):** Take Photo with Location denied (or no fix) → the pin-drop sheet appears; setting a pin stages/uploads the capture; nothing is lost; no crash.
- [ ] **AC3.1/AC3.5 (device):** The `+` menu shows Take Photo + Choose from Library; library selection still stages as before.

**Verification:** Markdown only.

**Commit:** `docs(ios): device checklist for camera capture (AC3.2-AC3.4)`
<!-- END_TASK_6 -->

---

## Phase 4 Done When
- The `+` is a menu offering Take Photo / Choose from Library, with the "Add Photo" accessibility identifier preserved (AC3.1, AC3.5; `testSampleDataTripHidesShareButton` still passes).
- The data-based staging core is unit-tested: override coordinate honored, image transcoded to JPEG and queued, no-coordinate case flagged (AC3.2, AC3.3).
- Camera capture wires through one-shot location (with timeout) to staging, falling back to pin-drop when no fix (AC3.4) — device-verified per checklist.
- `NSCameraUsageDescription` added; `NSLocationWhenInUseUsageDescription` already present.
- Full build succeeds; existing suite stays green.
