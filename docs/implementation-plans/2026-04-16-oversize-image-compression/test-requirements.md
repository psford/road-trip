# Test Requirements: Client-Side Image Processing + Phase 4 Closeout

Maps every acceptance criterion from the design plan to either an automated test or a documented human verification step.

---

## Automated Tests

### AC1: Oversize upload success path

| Criterion | Description | Test Type | Test File Path |
|-----------|-------------|-----------|----------------|
| AC1.1 | Oversize JPEG (>14 MB) re-encoded to <=14 MB before upload, EXIF GPS and TakenAt preserved | Unit | `tests/js/imageProcessor.test.js` |
| AC1.2 | Oversize PNG re-encoded to JPEG, compressed to <=14 MB, committed | Unit | `tests/js/imageProcessor.test.js` |
| AC1.3 | HEIC on iOS Safari converted to JPEG, EXIF extracted via exifr before conversion, reinjected, committed with correct GPS | Unit | `tests/js/imageProcessor.test.js` |
| AC1.4 | Sub-threshold photo (e.g. 3 MB JPEG) uploaded as-is for original tier, byte-for-byte identical | Unit | `tests/js/imageProcessor.test.js` |

### AC2: EXIF preservation

| Criterion | Description | Test Type | Test File Path |
|-----------|-------------|-----------|----------------|
| AC2.1 | Compressed output EXIF GPS matches input within 6 decimal places | Unit | `tests/js/imageProcessor.test.js` |
| AC2.2 | TakenAt (DateTimeOriginal) in compressed output matches input exactly | Unit | `tests/js/imageProcessor.test.js` |
| AC2.3 | Compressed output is a decodable JPEG that the server photo proxy can serve | Unit | `tests/js/imageProcessor.test.js` |
| AC2.4 | Photo that cannot compress below threshold even at q=0.3 surfaces clear user-facing error | Unit | `tests/js/imageProcessor.test.js` |

### AC3: Progress panel integration

| Criterion | Description | Test Type | Test File Path |
|-----------|-------------|-----------|----------------|
| AC3.1 | Progress panel shows "Processing..." status during processing before upload lifecycle | Integration | `tests/js/postUI-processing.test.js` |
| AC3.1 | (E2E) "Processing..." row visible in browser during large file upload | E2E | `tests/playwright/resilient-uploads.spec.js` |
| AC3.2 | `upload:created` fires after processing completes, not before | Integration | `tests/js/postUI-processing.test.js` |
| AC3.3 | Processing failure (OOM, invalid input) transitions per-file row to `failed` with error visible; does not block batch | Integration | `tests/js/postUI-processing.test.js` |

### AC4: Bundle and performance

| Criterion | Description | Test Type | Test File Path |
|-----------|-------------|-----------|----------------|
| AC4.1 | Processing dependencies lazy-loaded via dynamic import from jsDelivr on first upload, zero bytes on initial page load | Unit | `tests/js/imageProcessor.test.js` |
| AC4.2 | Processing a single 5 MB iPhone JPEG (display + thumb + optional compression) completes in <3s on modern mobile browser | E2E | `tests/playwright/resilient-uploads.spec.js` |
| AC4.3 | Compressing a single 18 MB PNG completes in <8s | E2E | `tests/playwright/resilient-uploads.spec.js` |

### AC5: Client-side tier generation

| Criterion | Description | Test Type | Test File Path |
|-----------|-------------|-----------|----------------|
| AC5.1 | Every uploaded photo produces three blobs: `{uploadId}_original.jpg`, `{uploadId}_display.jpg`, `{uploadId}_thumb.jpg`, all uploaded before commit | Unit | `tests/js/imageProcessor.test.js` |
| AC5.1 | (Contract) request-upload response includes displaySasUrl and thumbSasUrl | Unit | `tests/js/api-contract.test.js` |
| AC5.1 | (Queue) Upload queue uploads tier blobs via SAS URLs alongside original | Unit | `tests/js/uploadQueue.test.js` (existing, extended) |
| AC5.1 | (Integration) Display and thumb blobs passed to UploadQueue.start items | Integration | `tests/js/postUI-processing.test.js` |
| AC5.1 | (E2E) Committed photo has all three blob tiers accessible via proxy | E2E | `tests/playwright/resilient-uploads.spec.js` |
| AC5.2 | Display tier <=1920px on longest edge, JPEG at quality 85 | Unit | `tests/js/imageProcessor.test.js` |
| AC5.3 | Thumb tier <=300px on longest edge, JPEG at quality 75 | Unit | `tests/js/imageProcessor.test.js` |
| AC5.4 | CommitAsync completes in <500ms for any photo size (no server-side blob download or image decoding) | Integration | `tests/RoadTripMap.Tests/Endpoints/UploadEndpointTests.cs` |
| AC5.5 | If client fails to upload display/thumb tiers, commit still succeeds; server logs warning and falls back to original | Integration | `tests/RoadTripMap.Tests/Endpoints/UploadEndpointTests.cs` |
| AC5.6 | Sub-threshold JPEG still gets client-generated display and thumb tiers (original unchanged, tiers resized) | Unit | `tests/js/imageProcessor.test.js` |

### ACX: Cross-cutting

| Criterion | Description | Test Type | Test File Path |
|-----------|-------------|-----------|----------------|
| ACX.1 | No raw image bytes, EXIF GPS, or SAS URLs written to persistent server-side logs | Integration | `tests/RoadTripMap.Tests/Endpoints/UploadEndpointTests.cs` |
| ACX.1 | (Client) No raw bytes or GPS logged in imageProcessor.js (verified by absence of console.log calls with sensitive data) | Unit | `tests/js/imageProcessor.test.js` |
| ACX.2 | Every processing failure surfaces user-visible message and structured telemetry event | Integration | `tests/js/postUI-processing.test.js` |
| ACX.3 | Server-side GenerateDerivedTiersAsync remains as fallback; if legacy client commits without tiers, server generates them | Integration | `tests/RoadTripMap.Tests/Endpoints/UploadEndpointTests.cs` |

---

## Human Verification

### AC1.3 (partial): HEIC conversion on real iOS Safari

**Justification:** Unit tests mock `heic2any` and cannot verify actual HEIC decoding behavior in iOS Safari, where MIME type detection is inconsistent and the WASM decoder must handle real HEIC containers from the iPhone camera. Automated E2E tests run in Chromium/Firefox via Playwright, which do not produce real HEIC files.

**Verification approach:**
1. Open the post page on a real iPhone running iOS Safari.
2. Select a HEIC photo from the camera roll.
3. Verify the photo commits successfully with GPS and TakenAt preserved (check the map pin location and photo metadata in the trip view).
4. Record the result in `phase-4-acceptance.md`.

### AC4.2 / AC4.3 (partial): Performance on real mobile hardware

**Justification:** Playwright E2E tests run on CI servers with synthetic images and generous timeout budgets (2-3x the AC budget) because CI hardware differs from real mobile devices. The AC specifies "modern mobile browser" performance, which can only be verified on actual mobile hardware with real photo files.

**Verification approach:**
1. On an iPhone (Safari) and an Android device (Chrome), upload a 5 MB JPEG and time the processing phase (from "Processing..." to upload start). Verify <3 seconds (AC4.2).
2. Upload an 18 MB PNG screenshot and time the processing phase. Verify <8 seconds (AC4.3).
3. Record timings in the deployment runbook smoke test checklist.

### AC5.4 (partial): Commit latency under real production load

**Justification:** The .NET integration test verifies commit skips server-side tier generation, but the <500ms budget depends on Azure SQL and Azure Blob Storage latency in the production environment, which cannot be replicated in a unit test with Azurite.

**Verification approach:**
1. After enabling `ClientSideProcessingEnabled=true` in production, upload 10 photos and measure server-side commit duration from application logs.
2. Verify average commit time is <500ms.
3. Record results in the deployment runbook sign-off section.

### Definition of Done: 20-photo batch on fast WiFi with zero failures

**Justification:** The Playwright E2E test for 20-photo batch uses synthetic small images on CI, which does not replicate real-world conditions (mixed photo sizes, real WiFi latency, real server load). The Definition of Done specifies "fast WiFi connection" with real photos.

**Verification approach:**
1. On a real device connected to WiFi, select 20 real photos (mix of sizes, including at least one >14 MB) and upload as a single batch.
2. Verify all 20 commit successfully with zero failures and total time under 3 minutes.
3. Record the result in the deployment runbook smoke test checklist.

### Definition of Done: Patrick's acceptance session

**Justification:** This is a human sign-off activity that requires a real-device trip recorded by a specific person. Cannot be automated.

**Verification approach:**
1. Patrick conducts an acceptance session on a real device, creating a trip and uploading photos.
2. Session notes recorded in `docs/implementation-plans/2026-04-13-resilient-uploads/phase-4-acceptance.md`.
3. Sign-off line present in the document.

### Definition of Done: Legacy-trip audit

**Justification:** Running `scripts/audit-failed-uploads.sh` against production data and annotating resolutions requires human judgment about each flagged row.

**Verification approach:**
1. Run `scripts/audit-failed-uploads.sh` against the production database.
2. Annotate each flagged row with an explicit resolution.
3. Append results to `phase-4-acceptance.md`.

### Definition of Done: Feature flag removal from App Service config

**Justification:** Deleting `FeatureFlags__ResilientUploadsUI` from Azure App Service configuration is an operational action against the live environment.

**Verification approach:**
1. Verify via Azure Portal or CLI that the `FeatureFlags__ResilientUploadsUI` application setting no longer exists.
2. Confirm upload works with no console errors after removal.
3. Record in the deployment runbook.

### Definition of Done: Deployment runbook finalized

**Justification:** Runbook sign-off requires human review and checkbox completion.

**Verification approach:**
1. Review all sections of the deployment runbook for completeness.
2. Tick all sign-off checkboxes.
3. Record sign-off with date.

---

## Coverage Matrix

Every acceptance criterion is accounted for below. "A" = automated test exists, "H" = human verification required, "A+H" = automated test covers the logic but human verification needed for real-device/production confirmation.

| Criterion | Automated | Human | Notes |
|-----------|-----------|-------|-------|
| AC1.1 | A | | Unit test with mocked compression + EXIF |
| AC1.2 | A | | Unit test with mocked PNG-to-JPEG compression |
| AC1.3 | A+H | H | Unit test mocks heic2any; real iOS Safari verification needed |
| AC1.4 | A | | Unit test verifies same File reference returned |
| AC2.1 | A | | Unit test verifies piexif reinjection called with GPS data |
| AC2.2 | A | | Unit test verifies piexif reinjection called with DateTimeOriginal |
| AC2.3 | A | | Unit test verifies output is JPEG blob |
| AC2.4 | A | | Unit test verifies error thrown when compression fails to reach target |
| AC3.1 | A | | Integration + E2E tests verify "Processing..." status |
| AC3.2 | A | | Integration test verifies event ordering |
| AC3.3 | A | | Integration test verifies per-file failure handling |
| AC4.1 | A | | Unit test verifies no CDN loads for sub-threshold files |
| AC4.2 | A+H | H | E2E test with generous CI timeout; real mobile device timing needed |
| AC4.3 | A+H | H | E2E test with generous CI timeout; real mobile device timing needed |
| AC5.1 | A | | Unit + contract + integration + E2E tests |
| AC5.2 | A | | Unit test verifies canvas dimensions and JPEG quality |
| AC5.3 | A | | Unit test verifies canvas dimensions and JPEG quality |
| AC5.4 | A+H | H | .NET integration test verifies skip path; prod latency needs human check |
| AC5.5 | A | | .NET integration test verifies fallback when tiers missing |
| AC5.6 | A | | Unit test verifies sub-threshold file still gets display + thumb |
| ACX.1 | A | | .NET captured-log assertions + client unit test |
| ACX.2 | A | | Integration test verifies telemetry event on failure |
| ACX.3 | A | | .NET integration test verifies server fallback path |
