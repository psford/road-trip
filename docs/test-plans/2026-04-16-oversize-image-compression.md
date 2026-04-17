# Human Test Plan: Oversize Image Compression

## Prerequisites

- Development server running: `dotnet run --project src/RoadTripMap` (port 5100)
- Azurite running for local blob storage
- `Upload:ClientSideProcessingEnabled` set to `true` in appsettings or environment
- All automated tests passing:
  - `npm test`
  - `dotnet test RoadTripMap.sln`
- Real devices available: iPhone with iOS Safari, Android device with Chrome
- Access to production environment (for AC5.4 production validation)

## Phase 1: HEIC Conversion on Real iOS Safari (AC1.3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | On an iPhone running iOS 17+, open Safari and navigate to the app | Page loads, upload form visible |
| 2 | Navigate to an existing trip's `/post/{token}` page | Post page with file input visible |
| 3 | Tap the file input and select a HEIC photo from the Camera Roll | File picker opens showing Camera Roll photos |
| 4 | Observe the progress panel | "Processing..." status appears briefly, then transitions to "uploading" |
| 5 | Wait for the upload to complete (status shows "committed") | Photo commits successfully, no error messages |
| 6 | Navigate to the trip's view page and locate the uploaded photo on the map | Map pin appears at the correct GPS location |
| 7 | Tap the map pin and view the photo in the carousel | Photo renders correctly as JPEG; no corruption |
| 8 | Check photo metadata in the trip view | TakenAt date matches the original photo's capture date |

## Phase 2: Performance on Real Mobile Hardware (AC4.2, AC4.3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | On an iPhone (Safari), navigate to the trip's post page | Page loads |
| 2 | Select a single 5 MB JPEG photo from the camera roll | File picker accepts selection |
| 3 | Start a stopwatch when "Processing..." appears | Timer running |
| 4 | Stop the stopwatch when status transitions to "uploading" | Processing completes in under 3 seconds (AC4.2) |
| 5 | Record: device model, iOS version, processing duration | Documented |
| 6 | Repeat on an Android device (Chrome) with a similar 5 MB JPEG | Processing under 3 seconds on Android |
| 7 | Select an 18 MB PNG screenshot | File picker accepts selection |
| 8 | Start a stopwatch when "Processing..." appears | Timer running |
| 9 | Stop when status transitions to "uploading" | Processing completes in under 8 seconds (AC4.3) |

## Phase 3: Commit Latency Under Production Load (AC5.4)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Verify `Upload:ClientSideProcessingEnabled=true` in production | Setting confirmed |
| 2 | Upload 10 photos of varying sizes (2-10 MB JPEGs) | All 10 commit successfully |
| 3 | Check server logs for commit duration entries | Log entries for all 10 commits found |
| 4 | Calculate the average commit duration | Average commit time under 500 ms |

## Phase 4: 20-Photo Batch on Fast WiFi (Definition of Done)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Connect a real device to fast WiFi (>50 Mbps) | Connected |
| 2 | Navigate to a trip's post page | Page loads |
| 3 | Select 20 real photos, including at least one >14 MB | Accepted |
| 4 | Start timer when first "Processing..." appears | Timer running |
| 5 | Observe progress panel transitions | Processing -> uploading -> committed per file |
| 6 | Stop timer when all 20 show "committed" | Total time under 3 minutes |
| 7 | Verify zero failures in progress panel | No failed rows |
| 8 | Verify all 20 photos on the trip view map | All 20 pins at correct GPS positions |

## Phase 5: Patrick's Acceptance Session

| Step | Action | Expected |
|------|--------|----------|
| 1 | Patrick opens the app on a real device | App loads |
| 2 | Patrick creates a new trip | Trip created with upload and view links |
| 3 | Patrick uploads photos during a real trip | Photos process, upload, commit without errors |
| 4 | Patrick reviews trip view: map pins, carousel, GPS accuracy | All correct, no visual glitches |
| 5 | Patrick records session notes | Notes captured |
| 6 | Patrick adds sign-off | Sign-off with date |

## End-to-End: Oversize HEIC from iPhone through Production

1. On iPhone, take a photo in low light (produces larger HEIC, 8-12 MB)
2. Navigate to trip's post page in Safari
3. Select the HEIC photo
4. Observe: "Processing..." (HEIC conversion + tier generation)
5. Observe: "uploading" (three blobs: original JPEG, display, thumb)
6. Observe: "committed"
7. Trip view: map pin at correct GPS, photo loads in carousel, thumbnail in strip
8. Verify TakenAt date is correct (not upload time)

## End-to-End: Mixed Batch with Network Interruption

1. Prepare: 3 small JPEGs (2-3 MB), 1 large PNG (15+ MB), 1 HEIC (if on iPhone)
2. Select all 5 for upload
3. While "Processing..." or "uploading" visible, toggle WiFi off for 10 seconds
4. Toggle WiFi back on
5. Verify: uploads resume, all 5 eventually "committed"
6. Verify: no duplicate photos on trip view

## Human Verification Required

| Criterion | Why Manual |
|-----------|-----------|
| AC1.3 (HEIC on iOS Safari) | Unit tests mock heic2any; real iOS HEIC containers differ |
| AC4.2 (5 MB JPEG <3s) | CI runs on server hardware; AC specifies mobile browser |
| AC4.3 (18 MB PNG <8s) | Same -- real mobile timing needed |
| AC5.4 (Commit <500ms) | .NET test uses Azurite; prod Azure latency differs |
| 20-photo batch (DoD) | CI uses synthetic images; DoD requires real photos |
| Patrick acceptance (DoD) | Human sign-off activity |

## Traceability

| AC | Automated Test | Manual Step |
|----|---------------|-------------|
| AC1.1 | `imageProcessor.test.js` | -- |
| AC1.2 | `imageProcessor.test.js` | -- |
| AC1.3 | `imageProcessor.test.js` | Phase 1: HEIC on real iOS Safari |
| AC1.4 | `imageProcessor.test.js` | -- |
| AC2.1 | `imageProcessor.test.js` | -- |
| AC2.2 | `imageProcessor.test.js` | -- |
| AC2.3 | `imageProcessor.test.js` | -- |
| AC2.4 | `imageProcessor.test.js` | -- |
| AC3.1 | `postUI-processing.test.js` + `resilient-uploads.spec.js` | -- |
| AC3.2 | `postUI-processing.test.js` | -- |
| AC3.3 | `postUI-processing.test.js` | -- |
| AC4.1 | `imageProcessor.test.js` | -- |
| AC4.2 | `resilient-uploads.spec.js` | Phase 2: 5 MB on real mobile |
| AC4.3 | `resilient-uploads.spec.js` | Phase 2: 18 MB on real mobile |
| AC5.1 | Multiple test files | -- |
| AC5.2 | `imageProcessor.test.js` | -- |
| AC5.3 | `imageProcessor.test.js` | -- |
| AC5.4 | `UploadEndpointHttpTests.cs` | Phase 3: Production latency |
| AC5.5 | `UploadEndpointHttpTests.cs` | -- |
| AC5.6 | `imageProcessor.test.js` | -- |
| ACX.1 | `UploadEndpointHttpTests.cs` + `imageProcessor.test.js` | -- |
| ACX.2 | `postUI-processing.test.js` | -- |
| ACX.3 | `UploadEndpointHttpTests.cs` | -- |
| DoD: 20-photo | `resilient-uploads.spec.js` | Phase 4: Real photos on WiFi |
| DoD: Acceptance | -- | Phase 5: Patrick's session |
