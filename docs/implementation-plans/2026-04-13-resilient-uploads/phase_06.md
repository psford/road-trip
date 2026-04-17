# Resilient Photo Uploads — Phase 6: Custom Swift Plugins (Background Upload + Native EXIF)

**Goal:** Replace the iOS client's transport and EXIF layers with native Swift implementations. Uploads continue while the app is backgrounded or force-quit. EXIF extraction uses `ImageIO` for accurate HEIC/JPEG support.

**Architecture:** Two Capacitor plugins land in `ios/App/App/Plugins/`. JS-side adapters (added in Phase 5 as seams) are filled in to delegate to the plugins when `platform === 'ios'`. Web path is untouched.

**Cross-machine sequencing:** Tasks 1–4 on WSL (JS adapters, Swift skeleton, docs). Tasks 5–8 on Mac (Swift implementation + device matrix). Task 9 on WSL (runbook).

**Tech Stack:** Swift 5.5+, Capacitor 7.x, URLSession background, ImageIO, @capacitor/camera, @capacitor-community/sqlite, XCTest.

**Scope:** Phase 6 of 7.

**Codebase verified:** 2026-04-13. Phase 5 scaffold in place. Note: `exifUtil.js` uses `exifr` (not piexifjs per design); iOS native plugin justification is "accuracy, HEIC support, main-thread offload."

---

## Acceptance Criteria Coverage

### resilient-uploads.AC11: Native background uploads

- **resilient-uploads.AC11.1 Success:** Start upload batch, background the app, all photos commit.
- **resilient-uploads.AC11.2 Success:** Force-quit mid-batch and relaunch resumes uncommitted uploads.
- **resilient-uploads.AC11.3 Failure:** Upload exceeding Azure's 7-day uncommitted retention gracefully restarts from block 1.
- **resilient-uploads.AC11.4 Edge:** Uploads queued while offline drain automatically when connectivity returns.

### resilient-uploads.AC12: Native EXIF via ImageIO

- **resilient-uploads.AC12.1 Success:** HEIC via PHPicker yields correct GPS + taken_at.
- **resilient-uploads.AC12.2 Success:** JPEG GPS matches piexif/exifr on the equivalent file (within precision).
- **resilient-uploads.AC12.3 Failure:** Photo without EXIF GPS yields null → manual pin-drop flow.
- **resilient-uploads.AC12.4 Edge:** Malformed EXIF does not crash the plugin — returns null + logged warning.

---

## Notes for Implementers

- **Swift skeleton before Swift logic.** Task 4 commits plugin files from WSL as empty `@objc` shells. Tasks 5–6 fill them on the Mac. This keeps plugin registration reviewable on WSL and lets CI validate JS/plugin-interface sanity even without a Mac build.
- **Plugin method contracts.** Document in both the JS side (`storageAdapter.js`, `uploadTransport.js`, `exifUtil.js` comments) and the Swift side (header doc comments). Contract changes require a Mac session.
- **XCTest.** Swift unit tests live in `ios/App/AppTests/`. Running them requires Xcode.
- **Background Modes capability** must be enabled in `ios/App/App.xcodeproj` (Task 5 Xcode step) — Background fetch + Background processing.
- **User permissions.** `NSPhotoLibraryUsageDescription` (Phase 5 Task 9) already in place. Add `NSPhotoLibraryAddUsageDescription` if we ever save to library (not currently required).

---

<!-- START_SUBCOMPONENT_A (tasks 1-4) -->
## Subcomponent A: WSL preparation

<!-- START_TASK_1 -->
### Task 1: Extend ios-mac-handoff.md with Phase 6 prerequisites

**Shell:** `[WSL]`

**Verifies:** Enables Mac session for Tasks 5–8.

**Files:**
- Modify: `docs/implementation-plans/2026-04-13-resilient-uploads/ios-mac-handoff.md`

**Implementation:**

Append a `## Phase 6` section:

1. Install new npm deps:
   ```bash
   git pull
   npm install --save @capacitor-community/sqlite @capacitor/camera
   npx cap sync ios
   cd ios/App && pod install && cd ../..
   ```
2. Xcode capabilities:
   - Target "App" → Signing & Capabilities → `+ Capability` → Background Modes.
   - Enable: Background fetch, Background processing.
3. Info.plist keys (added in Task 5 from Mac):
   - `NSPhotoLibraryUsageDescription` already present.
   - `NSCameraUsageDescription`: "Road Trip uses your camera to capture trip photos."
   - `BGTaskSchedulerPermittedIdentifiers`: `["com.psford.roadtripmap.upload.refresh"]` (if using BGTaskScheduler; not required for URLSession background).
4. How to verify plugin registration:
   - Launch app; Xcode console shows `Loaded plugin: BackgroundUploadPlugin` and `Loaded plugin: NativeExifPlugin`.
   - In JS: `window.Capacitor.isPluginAvailable('BackgroundUpload')` → `true`.
5. How to simulate background/force-quit:
   - Background: Cmd+Shift+H on simulator; swipe up on device.
   - Force-quit: `xcrun simctl terminate booted <bundle-id>` on simulator; swipe up from app switcher on device.

**Verification:** Doc reviewed before Mac session.

**Commit:** `docs(ios): ios-mac-handoff Phase 6 section`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: JS deps + iOS SQLite storage adapter

**Shell:** `[WSL]`

**Verifies:** Precondition for AC11.2 (durable queue on iOS).

**Files:**
- Modify: `package.json` (add `@capacitor-community/sqlite`, `@capacitor/camera`)
- Modify: `src/RoadTripMap/wwwroot/js/storageAdapter.js`
- Create: `tests/js/storageAdapter.ios.test.js`

**Implementation:**

Extend `StorageAdapter` factory (seam from Phase 5) so when `platform === 'ios'` and `window.Capacitor?.Plugins?.CapacitorSQLite` is available, the adapter calls the plugin's `execute`/`query` APIs:
- On init: `createConnection` + `open` + `CREATE TABLE IF NOT EXISTS upload_items (...)` matching the IndexedDB schema.
- `putItem` → `INSERT OR REPLACE`.
- `listNonTerminal` → `SELECT ... WHERE status IN (...)` with parameterized query.
- `putBlock` / `listBlocks` / `updateBlock` → similar.

Plugin bridge calls use the documented `@capacitor-community/sqlite` API. Surface any SQL error as a rejected promise — never swallow.

If plugin missing (web or pre-Phase-6 iOS), fallback to IndexedDB adapter.

Tests (jsdom, Capacitor mock): stub `window.Capacitor.Plugins.CapacitorSQLite` with a Map-backed fake. Verify the adapter maps to the SQL operations for each method and results round-trip correctly.

**Verification:**

Run: `npm test tests/js/storageAdapter.ios.test.js` — green.

**Commit:** `feat(web): iOS SQLite branch of storageAdapter`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: JS transport branch and exifUtil branch for iOS

**Shell:** `[WSL]`

**Verifies:** Precondition for AC11.1, AC12.1–AC12.4.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/uploadTransport.js`
- Modify: `src/RoadTripMap/wwwroot/js/exifUtil.js`
- Create: `tests/js/uploadTransport.ios.test.js`
- Create: `tests/js/exifUtil.ios.test.js`

**Implementation:**

`uploadTransport.js` iOS branch:
- `putBlock` → `window.Capacitor.Plugins.BackgroundUpload.enqueue({ uploadId, blockId, sasUrl, filePath })` where `filePath` is a native-accessible file URI (from PHPicker).
- Subscribes once per session to plugin events `blockCompleted`, `blockFailed`, translates them to the same `RetryableError` / `PermanentError` / `SasExpiredError` contract web uses.
- Tracks per-`{uploadId, blockId}` pending promises keyed by an in-memory map; `blockCompleted` event resolves matching promise.

`exifUtil.js` iOS branch:
- `ExifUtil.extractAll(file)` → if `file.nativeAssetId` present, `window.Capacitor.Plugins.NativeExif.extract({ assetLocalIdentifier })` → returns `{ gps, taken_at }`. Fallback to `exifr` if plugin missing or error.

Tests stub the Capacitor plugins and verify:
- Transport resolves on `blockCompleted` event.
- Transport rejects with the right error type on `blockFailed` (statusCode 403 → `SasExpiredError`, 5xx → `RetryableError`, etc.).
- ExifUtil calls native plugin when assetId present; falls back to exifr otherwise.

**Verification:**

Run: `npm test tests/js/uploadTransport.ios.test.js tests/js/exifUtil.ios.test.js`.

**Commit:** `feat(web): iOS transport + exifUtil branches calling native plugins`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Swift plugin skeletons

**Shell:** `[WSL]`

**Verifies:** Scaffold for Mac session.

**Files:**
- Create: `ios/App/App/Plugins/BackgroundUploadPlugin.swift`
- Create: `ios/App/App/Plugins/BackgroundUploadPlugin.m`
- Create: `ios/App/App/Plugins/NativeExifPlugin.swift`
- Create: `ios/App/App/Plugins/NativeExifPlugin.m`

**Implementation:**

`BackgroundUploadPlugin.swift` skeleton (full file):
```swift
import Capacitor
import Foundation

@objc(BackgroundUploadPlugin)
public class BackgroundUploadPlugin: CAPPlugin {
    // TODO(Mac/Task5): implement URLSessionConfiguration.background
    @objc func enqueue(_ call: CAPPluginCall) {
        call.reject("Not implemented")
    }
    // Other methods: cancelAll, status, etc.
}
```

`BackgroundUploadPlugin.m` (Objective-C bridge required by Capacitor):
```objc
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(BackgroundUploadPlugin, "BackgroundUpload",
    CAP_PLUGIN_METHOD(enqueue, CAPPluginReturnPromise);
)
```

Same pattern for `NativeExifPlugin.swift`/`.m`:
```swift
@objc(NativeExifPlugin)
public class NativeExifPlugin: CAPPlugin {
    @objc func extract(_ call: CAPPluginCall) {
        call.reject("Not implemented")
    }
}
```

Commit ensures plugin registration is reviewable and `npx cap sync ios` on Mac picks up the files.

**Verification:** Files present; JS side imports don't error in web mode (fallback path used).

**Commit:** `feat(ios): Swift plugin skeletons for BackgroundUpload and NativeExif`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 5-8) -->
## Subcomponent B: Mac — Swift implementation + device matrix

<!-- START_TASK_5 -->
### Task 5: BackgroundUploadPlugin.swift implementation

**Shell:** `[Mac — Xcode]`

**Prerequisite:** Tasks 1–4 committed + pushed; Mac has pulled.

**Verifies:** AC11.1, AC11.2, AC11.3, AC11.4.

**Files:**
- Modify: `ios/App/App/Plugins/BackgroundUploadPlugin.swift`
- Modify: `ios/App/App/AppDelegate.swift`
- Modify: `ios/App/App/App.xcodeproj/project.pbxproj` (enable Background Modes capability)
- Create: `ios/App/AppTests/BackgroundUploadPluginTests.swift`

**Implementation:**

`BackgroundUploadPlugin.swift`:
- Singleton `URLSession(configuration: URLSessionConfiguration.background(withIdentifier: "com.psford.roadtripmap.upload"), delegate: self, delegateQueue: nil)`.
- `enqueue(call:)`: reads `uploadId`, `blockId`, `sasUrl`, `filePath` from `call.options`. Creates `URLSessionUploadTask` with PUT + `Content-Length`. Stores `taskIdentifier → {uploadId, blockId}` in `UserDefaults` (suite name `"com.psford.roadtripmap.upload.tasks"`). Call `task.resume()`, then `call.resolve()`.
- `URLSessionDataDelegate` callbacks:
  - `didReceive response:` check HTTP status; if 201, note success.
  - `didCompleteWithError:` on success `notifyListeners("blockCompleted", {uploadId, blockId})`; on error check status — 403 → `notifyListeners("blockFailed", {uploadId, blockId, statusCode: 403, kind: "sasExpired"})`; 5xx → `blockFailed kind: "retryable"`; other → `kind: "permanent"`.
  - Remove mapping from `UserDefaults`.
- On init, check `UserDefaults` for any orphaned mappings — these are tasks whose delegate callbacks were missed (rare). Ask `URLSession.getTasksWithCompletionHandler` for pending tasks; for missing ones, emit `blockFailed kind: "retryable"` so the JS queue resumes (AC11.2).

`AppDelegate.swift`:
- Add:
```swift
var backgroundCompletionHandler: (() -> Void)?
func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
    self.backgroundCompletionHandler = completionHandler
}
```
- And `URLSession` delegate `urlSessionDidFinishEvents(forBackgroundURLSession:)` calls the stashed `backgroundCompletionHandler()`.

`project.pbxproj`: Xcode UI → Signing & Capabilities → + Capability → Background Modes → check "Background fetch" and "Background processing". (UI change commits `project.pbxproj`.)

XCTest (`BackgroundUploadPluginTests.swift`):
- Unit test: `enqueue` stores the task-mapping; stub URLSession via protocol injection; verify `blockCompleted` notification fires on 201.
- Integration: drive a real `URLSession` against an Azurite endpoint spun up on the Mac (optional; skip on CI).

**Verification:**

On simulator: `Cmd+R` to run. JS console: `window.Capacitor.Plugins.BackgroundUpload.enqueue({...})` resolves. Background the app; upload completes; blockCompleted event logged.

AC11.4 verified by toggling simulator Network Link Conditioner to Offline, enqueuing, then back to online — uploads drain.

**Commit:** `feat(ios): BackgroundUploadPlugin native URLSession implementation`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: NativeExifPlugin.swift implementation

**Shell:** `[Mac — Xcode]`

**Verifies:** AC12.1, AC12.2, AC12.3, AC12.4.

**Files:**
- Modify: `ios/App/App/Plugins/NativeExifPlugin.swift`
- Create: `ios/App/AppTests/NativeExifPluginTests.swift`
- Create: `ios/App/AppTests/Fixtures/` (HEIC + JPEG + no-EXIF + malformed samples)

**Implementation:**

`NativeExifPlugin.swift`:
- `extract(call:)` reads `assetLocalIdentifier` from options.
- `PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil)` → first asset.
- `PHImageManager.default().requestImageDataAndOrientation(for: asset, options: ...)` → receives `Data`.
- `CGImageSourceCreateWithData(data, nil)` → `CGImageSource`.
- `CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]` → props dict.
- Extract `kCGImagePropertyGPSDictionary` → latitude + `kCGImagePropertyGPSLatitudeRef` ("S" negates) + longitude + `kCGImagePropertyGPSLongitudeRef` ("W" negates).
- Extract `kCGImagePropertyExifDictionary[kCGImagePropertyExifDateTimeOriginal]` → parse `yyyy:MM:dd HH:mm:ss` → ISO 8601.
- Resolve with `{ gps: {lat, lon} | null, takenAt: String | null }`.
- Wrap ALL errors: if any step throws or returns nil, resolve with `{ gps: null, takenAt: null, warning: "<reason>" }` and log (AC12.4).

Alternative for pure-file path (no PHAsset): accept a file URL; same ImageIO flow.

XCTest:
- AC12.1: load HEIC fixture with known GPS → extract returns the expected coords within floating-point tolerance.
- AC12.2: load JPEG fixture; compare to expected reference (precomputed via exifr in the fixture generation).
- AC12.3: no-EXIF fixture → `{ gps: null, takenAt: null }`.
- AC12.4: corrupted header fixture → no crash; warning logged; nulls returned.

**Verification:**

`⌘U` in Xcode → all NativeExif tests pass.

**Commit:** `feat(ios): NativeExifPlugin via ImageIO with HEIC + JPEG support`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Wire @capacitor/camera PHPicker

**Shell:** `[Mac — Xcode]` + `[WSL]` for JS commits if needed.

**Verifies:** AC12.1, AC12.2 (PHPicker yields full-res originals).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js` (iOS branch of photo picker)

**Implementation:**

In `postUI.onMultipleFilesSelected`, when `platform === 'ios'`, use `Camera.pickImages({ source: 'PHOTOS', quality: 100, limit: 20 })` from `@capacitor/camera`. The returned array contains file paths + `assetId` (when available). Pass `assetId` to `ExifUtil.extractAll` so the native plugin path engages.

The rest of the upload pipeline is unchanged.

**Verification:**

`[Mac — Xcode]` simulator: tap "Add Photo" → system photo picker appears → pick HEIC → EXIF extraction succeeds via `NativeExif`. Observe logs.

**Commit:** `feat(ios): iOS photo picker uses @capacitor/camera PHPicker with assetId`
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Device matrix

**Shell:** `[Mac — Xcode]` + physical iPhone.

**Verifies:** AC11.1–AC11.4, AC12.1–AC12.4.

**Files:**
- Create: `docs/implementation-plans/2026-04-13-resilient-uploads/phase-6-device-matrix.md`

**Implementation:**

On real iPhone with a TestFlight build from this branch (built per `ios-mac-handoff.md`):

1. **AC11.1 Backgrounded upload:** 10 photos, tap Home mid-batch, lock screen, wait 2 min, check App Service logs for 10 commits.
2. **AC11.2 Force-quit resume:** 10 photos, force-quit mid-batch, relaunch — remaining items resume (plugin re-registers tasks via UserDefaults mapping).
3. **AC11.3 7-day expiry:** Synthetic: start upload, then `az storage blob delete` the uncommitted blocks, then resume — plugin restarts from block 0 and completes. (Real 7-day wait is impractical; the delete simulates it.)
4. **AC11.4 Offline drain:** Airplane Mode on, queue 5 photos (enqueue succeeds without network), Airplane Mode off, uploads complete without user action.
5. **AC12.1 HEIC PHPicker:** Pick HEIC from Photos; verify GPS displayed correctly.
6. **AC12.2 JPEG parity:** Pick JPEG also viewable on web; GPS matches exifr on web within tolerance.
7. **AC12.3 No-EXIF:** Pick screenshot or photo with location-stripping; routes to manual pin-drop.
8. **AC12.4 Malformed:** Not easily reproducible on device; verified via XCTest fixture in Task 6.

Each entry documented in `phase-6-device-matrix.md` with screenshots/screen-recordings. Sign-off line.

**Verification:**

All 8 rows PASS; Patrick signs off.

**Commit:** `docs(ios): Phase 6 device matrix results`
<!-- END_TASK_8 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (task 9) -->
## Subcomponent C: Deployment runbook (WSL)

<!-- START_TASK_9 -->
### Task 9: Deployment runbook Phase 6 section

**Shell:** `[WSL]`

**Verifies:** Operational.

**Files:**
- Modify: `docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md`

**Implementation:**

Append `## Phase 6 — Native plugins (TestFlight only)`:

1. **Pre-flight**
   - Phase 5 device matrix PASS, TestFlight build healthy.
   - Phase 6 device matrix PASS and committed.
2. **New TestFlight build** (per `ios-mac-handoff.md`):
   - Mac: `git pull` includes Phase 6 changes.
   - Mac: `npm ci && npx cap sync ios && cd ios/App && pod install`.
   - Mac: Xcode Archive → Distribute → App Store Connect.
3. **Plugin registration verification**
   - Mac: run build on device; Xcode console shows `Loaded plugin: BackgroundUploadPlugin`.
4. **Device validation**
   - Tester (or Patrick) repeats key scenarios from `phase-6-device-matrix.md` on their own device with the TestFlight build.
5. **Rollback**
   - TestFlight: mark Phase 6 build inactive; tester reinstalls Phase 5 build.
   - No server rollback needed — plugins are client-only.
6. **Sign-off** — Patrick + Mac session initials.

**Verification:** Runbook reviewed.

**Commit:** `docs(uploads): deployment runbook — Phase 6 native plugins`
<!-- END_TASK_9 -->
<!-- END_SUBCOMPONENT_C -->

---

## Phase 6 Done When

- 9 tasks complete; WSL-originated commits pushed; Mac-originated commits pushed.
- XCTest green on Mac (`⌘U`).
- `phase-6-device-matrix.md` has PASS for all 8 rows + Patrick sign-off.
- TestFlight build available with plugins registered (verified in logs).
- Deployment runbook Phase 6 section signed off.
