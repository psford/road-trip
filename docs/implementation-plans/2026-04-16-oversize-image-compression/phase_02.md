# Phase 2: Server Contract + Upload Queue Changes

## Goal

Modify the server to return 3 SAS URLs per upload request (original, display, thumb). Modify `CommitAsync` to skip server-side tier generation when client-uploaded tiers are present. Modify the client upload queue to upload all three blobs. Integrate `ImageProcessor` into the `postUI.js` file-selection flow. Add progress panel and telemetry support.

## Architecture

```
postUI.js (file selected)
    |
    v
ImageProcessor.processForUpload(file, exifData) --> { original, display, thumb }
    |
    v
UploadQueue.start(tripToken, items, callbacks)
    |  items now include: { file, metadata, uploadId, display, thumb }
    v
_doRequestUpload() --> server returns { SasUrl, DisplaySasUrl, ThumbSasUrl, ... }
    |
    |-- Block-upload original to SasUrl (existing flow)
    |-- PUT display blob to DisplaySasUrl (new, simple PUT)
    |-- PUT thumb blob to ThumbSasUrl (new, simple PUT)
    |
    v
commit --> server checks for tier blobs, skips GenerateDerivedTiersAsync if present
```

## Tech Stack

- ASP.NET Core 8.0 Minimal API (C#)
- Azure Blob Storage SAS tokens via `ISasTokenIssuer`
- Vanilla JavaScript (window-global modules)
- xUnit + FluentAssertions + Azurite for .NET tests
- Vitest for JS contract tests

## Scope

### In Scope
- Modified file: `src/RoadTripMap/Models/UploadDtos.cs` (add `DisplaySasUrl`, `ThumbSasUrl`)
- Modified file: `src/RoadTripMap/Services/UploadService.cs` (3 SAS URLs, conditional tier gen)
- Modified file: `src/RoadTripMap/wwwroot/js/uploadQueue.js` (store + upload tier blobs)
- Modified file: `src/RoadTripMap/wwwroot/js/postUI.js` (call ImageProcessor, pass results to queue)
- Modified file: `src/RoadTripMap/wwwroot/js/progressPanel.js` (handle `upload:preparing` event)
- Modified file: `src/RoadTripMap/wwwroot/js/uploadTelemetry.js` (new event recorders)
- Modified file: `tests/js/api-contract.test.js` (validate new response fields)
- New/modified files in `tests/RoadTripMap.Tests/` (.NET tests for commit optimization + 3-SAS)

### Out of Scope
- `imageProcessor.js` creation (Phase 1, already done)
- Playwright E2E tests (Phase 3)
- Feature flag / dark release (Phase 4)

## Codebase Verified

2026-04-15

## AC Coverage

| AC | Description | Covered By |
|----|-------------|------------|
| client-image-processing.AC3.1 | Progress panel shows "Processing..." before upload | Task 4 |
| client-image-processing.AC3.2 | `upload:created` fires after processing completes | Task 3 |
| client-image-processing.AC3.3 | Processing failure transitions to `failed` with visible error | Task 3, Task 5 |
| client-image-processing.AC5.1 | Every upload produces original + display + thumb blobs | Task 2, Task 3 |
| client-image-processing.AC5.4 | CommitAsync completes in <500ms | Task 1 |
| client-image-processing.AC5.5 | Missing tiers: commit succeeds, server falls back | Task 1 |
| client-image-processing.ACX.2 | Every failure path surfaces user-visible message + telemetry | Task 5 |
| client-image-processing.ACX.3 | Server-side GenerateDerivedTiersAsync remains as fallback | Task 1 |

---

<!-- START_TASK_1 -->
## Task 1: Modify server DTOs and UploadService for 3-SAS and conditional tier generation

**Verifies:** client-image-processing.AC5.4, client-image-processing.AC5.5, client-image-processing.ACX.3

### 1A: Modify `RequestUploadResponse` DTO

**File:** `src/RoadTripMap/Models/UploadDtos.cs`

The `RequestUploadResponse` record currently has these properties:
- `PhotoId` (Guid)
- `SasUrl` (string)
- `BlobPath` (string)
- `MaxBlockSizeBytes` (int)
- `ServerVersion` (string)
- `ClientMinVersion` (string)

Add two new required properties after `SasUrl`:

```csharp
[JsonPropertyName("displaySasUrl")]
public required string DisplaySasUrl { get; init; }

[JsonPropertyName("thumbSasUrl")]
public required string ThumbSasUrl { get; init; }
```

The `[JsonPropertyName]` attributes ensure the JSON wire format uses camelCase, matching the existing convention (e.g., `sasUrl`, `blobPath`).

### 1B: Modify `UploadService.RequestUploadAsync` to issue 3 SAS URLs

**File:** `src/RoadTripMap/Services/UploadService.cs`

Find the `RequestUploadAsync` method. It currently calls `_sasTokenIssuer.IssueWriteSasAsync` once to generate the original blob's SAS URL. The existing call looks approximately like:

```csharp
var sasUrl = await _sasTokenIssuer.IssueWriteSasAsync(containerName, blobPath, ttl, ct);
```

After this existing call, add two more SAS issuance calls for the tier blobs:

```csharp
// Issue SAS URLs for client-side tier uploads
var displayBlobPath = $"{request.UploadId}_display.jpg";
var thumbBlobPath = $"{request.UploadId}_thumb.jpg";

var displaySasUrl = await _sasTokenIssuer.IssueWriteSasAsync(containerName, displayBlobPath, ttl, ct);
var thumbSasUrl = await _sasTokenIssuer.IssueWriteSasAsync(containerName, thumbBlobPath, ttl, ct);
```

Where `ttl` is the same `SasTokenTtl` value from `UploadOptions` used for the original SAS URL.

Then modify the `return new RequestUploadResponse { ... }` to include the new properties:

```csharp
return new RequestUploadResponse
{
    PhotoId = photoId,
    SasUrl = sasUrl,
    DisplaySasUrl = displaySasUrl,     // NEW
    ThumbSasUrl = thumbSasUrl,         // NEW
    BlobPath = blobPath,
    MaxBlockSizeBytes = _options.MaxBlockSizeBytes,
    ServerVersion = ServerVersion.Current,
    ClientMinVersion = ServerVersion.MinimumClient,
};
```

**Important:** The `ISasTokenIssuer.IssueWriteSasAsync(containerName, blobPath, ttl, ct)` method signature already exists and works for any blob path within a container. No changes to the SAS issuer interface are needed.

### 1C: Modify `UploadService.CommitAsync` for conditional tier generation

**File:** `src/RoadTripMap/Services/UploadService.cs`

Find the `CommitAsync` method. It currently calls `GenerateDerivedTiersAsync` unconditionally after committing the block list. This is the expensive operation (downloads original, decodes with SkiaSharp, resizes twice, re-uploads).

Replace the unconditional call with a conditional check:

**Before (existing code, approximately):**
```csharp
await _photoService.GenerateDerivedTiersAsync(containerName, photo.UploadId!.Value, ct);
```

**After (new code):**
```csharp
// Check if client already uploaded tier blobs
var containerClient = _blobServiceClient.GetBlobContainerClient(containerName);
var displayBlobClient = containerClient.GetBlobClient($"{photo.UploadId}_display.jpg");
var thumbBlobClient = containerClient.GetBlobClient($"{photo.UploadId}_thumb.jpg");

var displayExists = await displayBlobClient.ExistsAsync(ct);
var thumbExists = await thumbBlobClient.ExistsAsync(ct);

if (!displayExists.Value || !thumbExists.Value)
{
    // Fallback: client didn't upload tiers (legacy client, failed upload, iOS dev builds)
    _logger.LogWarning(
        "Client did not upload tier blobs for photo {PhotoId}. Falling back to server-side generation.",
        LogSanitizer.SanitizeGuid(photo.UploadId!.Value));
    await _photoService.GenerateDerivedTiersAsync(containerName, photo.UploadId!.Value, ct);
}
```

**Key details:**
- `ExistsAsync` is a lightweight HEAD request -- no blob download, no decoding.
- The log message uses `LogSanitizer.SanitizeGuid` for the upload ID (following the project's log sanitization invariant from `CLAUDE.md`).
- `GenerateDerivedTiersAsync` is NOT removed from the codebase -- it remains as a fallback (ACX.3).
- If both blobs exist, the entire `GenerateDerivedTiersAsync` call is skipped, making commit ~200ms instead of 2-6 seconds (AC5.4).

### 1D: .NET tests for commit optimization

**File:** `tests/RoadTripMap.Tests/` (find the existing upload endpoint test file and extend it, or create a new test class in the same directory)

The .NET tests use xUnit + FluentAssertions + Azurite. Add tests for:

**Test 1: CommitAsync with client tiers present skips server-side generation**
- Arrange: Upload an original blob. Also upload `{uploadId}_display.jpg` and `{uploadId}_thumb.jpg` blobs to the same container.
- Act: Call commit endpoint.
- Assert: Commit succeeds. Verify that `GenerateDerivedTiersAsync` was NOT called (use a mock/spy on `PhotoService` or verify by timing -- commit completes in under 500ms).

**Test 2: CommitAsync without client tiers falls back to server-side generation (ACX.3)**
- Arrange: Upload only the original blob. Do NOT upload display or thumb blobs.
- Act: Call commit endpoint.
- Assert: Commit succeeds. The three blob tiers exist after commit (server generated them).

**Test 3: RequestUploadAsync returns 3 SAS URLs**
- Act: Call `request-upload` endpoint.
- Assert: Response contains `sasUrl`, `displaySasUrl`, and `thumbSasUrl`. All are non-empty strings. `displaySasUrl` contains `_display.jpg`. `thumbSasUrl` contains `_thumb.jpg`.

**Test 4: No SAS URLs appear in log output (ACX.1)**

Follow the existing captured-log assertion pattern in `UploadEndpointHttpTests.cs`. That file already captures log output via a test sink and asserts sensitive values do not appear in logs. Add the same assertion for this endpoint:

- Arrange: Capture log output using the existing log sink pattern from `UploadEndpointHttpTests.cs`.
- Act: Call `request-upload` endpoint.
- Assert: No captured log line contains `sig=` (the SAS signature query parameter). SAS URLs contain `sig=<signature>` in the query string; if any log line contains this substring, the SAS URL has been logged raw and the invariant is violated.

```csharp
// Pattern: follow UploadEndpointHttpTests.cs log capture convention
// Then assert:
capturedLogs.Should().NotContain(line => line.Contains("sig="),
    because: "SAS URLs must never appear in logs (ACX.1 / LogSanitizer invariant)");
```

### Commit Message

```
feat: issue 3 SAS URLs per upload and skip server-side tier gen when client tiers present

RequestUploadAsync now returns displaySasUrl and thumbSasUrl alongside
the original SAS. CommitAsync checks for client-uploaded tier blobs and
skips GenerateDerivedTiersAsync if both exist, reducing commit time
from 2-6s to ~200ms.
```

### Verification

```bash
cd /workspaces/road-trip && dotnet build RoadTripMap.sln && dotnet test RoadTripMap.sln
```

All existing and new .NET tests must pass.

<!-- END_TASK_1 -->

---

<!-- START_TASK_2 -->
## Task 2: Modify `uploadQueue.js` to upload tier blobs

**Verifies:** client-image-processing.AC5.1

**File:** `src/RoadTripMap/wwwroot/js/uploadQueue.js`

### Context

The upload queue manages a state machine for each file: `request-upload` -> `uploading` -> `commit` -> `committed`. The `start` method currently accepts:

```js
UploadQueue.start(tripToken, [{file, metadata, uploadId}], callbacks)
```

The queue calls `_doRequestUpload` which POSTs to `/api/trips/{token}/photos/request-upload` and receives a response with `SasUrl`, `BlobPath`, `MaxBlockSizeBytes`, etc. It then block-uploads the original file using `UploadTransport`, and finally calls the commit endpoint.

### Changes

<!-- START_SUBCOMPONENT_A -->
#### Subcomponent A: Extend item shape to include tier blobs

Modify the `start` method (or the internal item construction) to accept and store `display` and `thumb` Blobs alongside the existing `file`:

The items array entries change from:
```js
{ file, metadata, uploadId }
```
to:
```js
{ file, metadata, uploadId, display, thumb }
```

Where `display` and `thumb` are Blob objects from `ImageProcessor.processForUpload()`. These may be `null` or `undefined` if processing was skipped (feature flag off -- handled in Phase 4).

When constructing the internal storage adapter item, store these blobs:
```js
item.display = entry.display || null;
item.thumb = entry.thumb || null;
```
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B -->
#### Subcomponent B: Store tier SAS URLs from server response

In the `_doRequestUpload` handler (the function that processes the server's `request-upload` response), extract and store the new SAS URLs:

```js
// Existing:
item.sasUrl = response.sasUrl;
item.blobPath = response.blobPath;
item.maxBlockSizeBytes = response.maxBlockSizeBytes;

// Add:
item.displaySasUrl = response.displaySasUrl || null;
item.thumbSasUrl = response.thumbSasUrl || null;
```

The `|| null` fallback handles backward compatibility if the server hasn't been updated yet (shouldn't happen in practice but defensive coding).
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C -->
#### Subcomponent C: New `_uploadTiers` method

Add a new internal method that uploads the display and thumb blobs via simple PUT requests (not block upload -- these blobs are small, typically <1MB). Each tier is uploaded independently so a failure of one does not prevent the other from uploading. The function logs warnings for individual failures but only throws if **both** tiers fail.

```js
async function _uploadTiers(item) {
    const uploadOneTier = async (blob, sasUrl, tierName) => {
        if (!blob || !sasUrl) return { ok: false, skipped: true, tier: tierName };
        try {
            const resp = await fetch(sasUrl, {
                method: 'PUT',
                headers: {
                    'x-ms-blob-type': 'BlockBlob',
                    'Content-Type': 'image/jpeg',
                },
                body: blob,
            });
            if (!resp.ok) {
                throw new Error(`HTTP ${resp.status}`);
            }
            return { ok: true, tier: tierName };
        } catch (err) {
            console.warn(`Tier upload warning: ${tierName} failed (${err.message}). Server will fall back to server-side generation.`);
            return { ok: false, tier: tierName, error: err.message };
        }
    };

    const [displayResult, thumbResult] = await Promise.all([
        uploadOneTier(item.display, item.displaySasUrl, 'display'),
        uploadOneTier(item.thumb, item.thumbSasUrl, 'thumb'),
    ]);

    const bothFailed = !displayResult.ok && !displayResult.skipped
                    && !thumbResult.ok && !thumbResult.skipped;

    if (bothFailed) {
        // Both uploads failed -- caller's catch will log and fall back to server-side generation
        throw new Error(
            `Both tier uploads failed: display=${displayResult.error}, thumb=${thumbResult.error}`
        );
    }
    // One or both succeeded (or were skipped due to missing SAS URL).
    // The server CommitAsync will detect any missing tier blob and regenerate it.
}
```

Key details:
- Azure Blob Storage accepts a simple PUT with `x-ms-blob-type: BlockBlob` header for small blobs (under the block size limit). This is simpler and faster than the multi-block upload used for the original.
- Content-Type is `image/jpeg` because both tiers are always JPEG (even if the original was PNG or HEIC).
- `Promise.all` runs both uploads concurrently for efficiency.
- Each tier failure is caught independently. A warning is logged but execution continues.
- The function only throws (and lets the Subcomponent D `catch` propagate to the server fallback) when **both** tiers fail. A single failed tier is handled by the server's `CommitAsync` blob-existence check.
- If a SAS URL is missing entirely (server didn't provide it), that tier is skipped silently; the server fallback handles it.
<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D -->
#### Subcomponent D: Integrate `_uploadTiers` into the state machine

Find the state machine's upload-complete handler -- the code that runs after the block upload of the original file succeeds, before calling the commit endpoint. Insert the tier upload call:

```js
// After block upload of original completes:
try {
    await _uploadTiers(item);
} catch (tierError) {
    // Tier upload failure is non-fatal -- server will fall back to server-side generation
    // Log for telemetry but continue to commit
    console.warn('Tier upload failed, server will generate tiers:', tierError.message);
}

// Then proceed to commit as before:
await _doCommit(item);
```

The `try/catch` ensures that a tier upload failure does NOT prevent the commit from proceeding. The server's `CommitAsync` will detect missing tiers and generate them (AC5.5, ACX.3).
<!-- END_SUBCOMPONENT_D -->

### Commit Message

```
feat: upload display and thumb tier blobs via SAS URLs in upload queue

Store displaySasUrl/thumbSasUrl from request-upload response. After
block-uploading original, PUT display and thumb blobs. Tier upload
failure is non-fatal -- server falls back to server-side generation.
```

### Verification

```bash
cd /workspaces/road-trip && npm test
```

Existing upload queue tests must still pass.

<!-- END_TASK_2 -->

---

<!-- START_TASK_3 -->
## Task 3: Integrate `ImageProcessor` into `postUI.js`

**Verifies:** client-image-processing.AC3.2, client-image-processing.AC3.3, client-image-processing.AC5.1

**File:** `src/RoadTripMap/wwwroot/js/postUI.js`

### Context

The file-selection flow in `postUI.js` is at lines 353-381. This is the code path from when the user selects files through the file input to when `UploadQueue.start()` is called. The current flow:

1. User selects files via `<input type="file">`.
2. For each file, call `postService.extractPhotoMetadata(file)` which uses `ExifUtil.extractAll(file)` internally to get `{ gps: {latitude, longitude} | null, timestamp: Date | null }` plus `placeName`.
3. Build an items array: `[{file, metadata, uploadId}]`.
4. Call `UploadQueue.start(tripToken, items, callbacks)`.

### Changes

<!-- START_SUBCOMPONENT_A -->
#### Subcomponent A: Add processing step between metadata extraction and queue start

Modify the file-selection handler (lines 353-381) to insert `ImageProcessor.processForUpload()` between EXIF extraction and queue start:

**Before (existing flow, approximately):**
```js
const items = [];
for (const file of selectedFiles) {
    const metadata = await postService.extractPhotoMetadata(file);
    const uploadId = crypto.randomUUID();
    items.push({ file, metadata, uploadId });
}
UploadQueue.start(tripToken, items, callbacks);
```

**After (modified flow):**
```js
const items = [];
for (const file of selectedFiles) {
    const metadata = await postService.extractPhotoMetadata(file);
    const uploadId = crypto.randomUUID();

    // Emit preparing event for progress panel
    document.dispatchEvent(new CustomEvent('upload:preparing', {
        detail: { uploadId, fileName: file.name }
    }));

    let processResult;
    try {
        processResult = await ImageProcessor.processForUpload(file, metadata);
    } catch (processingError) {
        // Processing failed -- surface error, record telemetry, skip this file
        document.dispatchEvent(new CustomEvent('upload:failed', {
            detail: {
                uploadId,
                fileName: file.name,
                error: processingError.message,
                phase: 'processing',
            }
        }));
        if (typeof UploadTelemetry !== 'undefined') {
            UploadTelemetry.recordProcessingFailed(uploadId, processingError.message);
        }
        continue; // Skip to next file
    }

    items.push({
        file: processResult.original,
        metadata,
        uploadId,
        display: processResult.display,
        thumb: processResult.thumb,
    });

    // Record telemetry
    if (typeof UploadTelemetry !== 'undefined') {
        UploadTelemetry.recordProcessingApplied(uploadId, {
            compressionApplied: processResult.compressionApplied,
            heicConverted: processResult.heicConverted,
            originalBytes: processResult.originalBytes,
            outputBytes: processResult.outputBytes,
            durationMs: processResult.durationMs,
        });
    }
}

if (items.length > 0) {
    UploadQueue.start(tripToken, items, callbacks);
}
```

Key details:
- The `upload:preparing` event is dispatched BEFORE processing starts, so the progress panel can show "Processing..." immediately.
- Processing errors are caught per-file. A failed file does NOT block other files in the batch (AC3.3).
- The `upload:failed` event with `phase: 'processing'` lets the progress panel show a processing-specific error.
- The `file` passed to `UploadQueue.start` is now `processResult.original` -- which is either the unchanged input file (sub-threshold) or the compressed/converted File.
- `upload:created` (dispatched by the upload queue internals) now fires AFTER processing completes, since items are only added to the queue post-processing (AC3.2).
- Telemetry is guarded with `typeof UploadTelemetry !== 'undefined'` for defensive coding.
<!-- END_SUBCOMPONENT_A -->

### Commit Message

```
feat: integrate ImageProcessor into postUI.js file-selection flow

Call processForUpload() after metadata extraction, before queue start.
Emit upload:preparing event, handle processing errors per-file, pass
tier blobs to upload queue items.
```

### Verification

```bash
cd /workspaces/road-trip && npm test
```

<!-- END_TASK_3 -->

---

<!-- START_TASK_4 -->
## Task 4: Add `upload:preparing` handler to `progressPanel.js`

**Verifies:** client-image-processing.AC3.1

**File:** `src/RoadTripMap/wwwroot/js/progressPanel.js`

### Context

The progress panel listens for upload lifecycle events on `document` and updates the UI. It currently handles events like `upload:created`, `upload:progress`, `upload:committed`, `upload:failed`.

### Changes

Add a listener for the new `upload:preparing` event. This event fires before processing begins for each file.

```js
document.addEventListener('upload:preparing', (e) => {
    const { uploadId, fileName } = e.detail;
    // Create or update the progress row for this file
    _createOrUpdateRow(uploadId, {
        fileName,
        status: 'processing',
        statusText: 'Processing\u2026', // "Processing..." with ellipsis character
    });
});
```

The implementation depends on how `_createOrUpdateRow` (or equivalent) works in the existing progress panel. The key requirement is:

1. A row appears in the progress panel with the file name and a "Processing..." status.
2. This row transitions to the normal upload lifecycle states (`uploading`, `committed`, etc.) when subsequent events fire.
3. If processing fails, the `upload:failed` event with `phase: 'processing'` transitions the row to the error state.

Also handle the `upload:failed` event's new `phase: 'processing'` detail to show a processing-specific error message:

```js
// In the existing upload:failed handler, add a check:
if (detail.phase === 'processing') {
    statusText = `Processing failed: ${detail.error}`;
}
```

### Commit Message

```
feat: show "Processing..." status in progress panel during image processing

Handle upload:preparing event to show processing status before upload
lifecycle begins. Show processing-specific error message on failure.
```

### Verification

```bash
cd /workspaces/road-trip && npm test
```

<!-- END_TASK_4 -->

---

<!-- START_TASK_5 -->
## Task 5: Add telemetry event recorders to `uploadTelemetry.js`

**Verifies:** client-image-processing.ACX.2

**File:** `src/RoadTripMap/wwwroot/js/uploadTelemetry.js`

### Context

This file exports an `UploadTelemetry` object with methods like `recordUploadStarted`, `recordUploadCommitted`, etc. Each method follows a structured-event pattern. The exact pattern may vary -- read the file to see the existing convention.

### Changes

Add two new methods:

```js
recordProcessingApplied(uploadId, details) {
    // details: { compressionApplied, heicConverted, originalBytes, outputBytes, durationMs }
    _record('processing:applied', {
        uploadId,
        compressionApplied: details.compressionApplied,
        heicConverted: details.heicConverted,
        originalBytes: details.originalBytes,
        outputBytes: details.outputBytes,
        durationMs: details.durationMs,
        reductionPercent: details.originalBytes > 0
            ? Math.round((1 - details.outputBytes / details.originalBytes) * 100)
            : 0,
    });
},

recordProcessingFailed(uploadId, errorMessage) {
    _record('processing:failed', {
        uploadId,
        error: errorMessage,
    });
},
```

Where `_record` is the existing internal function for emitting structured telemetry events (the exact name may differ -- match the existing pattern in the file).

**ACX.1 compliance:** These telemetry events do NOT include raw image bytes, GPS coordinates, or SAS URLs. Only aggregate metadata (byte counts, flags, duration, error messages).

### Commit Message

```
feat: add processing telemetry events for image compression tracking

Record processing:applied with compression stats and processing:failed
with error message. No raw bytes or GPS data in telemetry (ACX.1).
```

### Verification

```bash
cd /workspaces/road-trip && npm test
```

<!-- END_TASK_5 -->

---

<!-- START_TASK_6 -->
## Task 6: Update `api-contract.test.js` for new response fields

**Verifies:** client-image-processing.AC5.1

**File:** `tests/js/api-contract.test.js`

### Context

This file validates the wire format of API responses. It likely has a test for the `request-upload` response shape that currently checks for `photoId`, `sasUrl`, `blobPath`, `maxBlockSizeBytes`, `serverVersion`, `clientMinVersion`.

### Changes

Find the test that validates the `request-upload` response shape. Add assertions for the two new fields:

```js
it('request-upload response includes tier SAS URLs', () => {
    const response = {
        photoId: 'some-guid',
        sasUrl: 'https://storage.blob.core.windows.net/...',
        displaySasUrl: 'https://storage.blob.core.windows.net/..._display.jpg?...',
        thumbSasUrl: 'https://storage.blob.core.windows.net/..._thumb.jpg?...',
        blobPath: 'some-path',
        maxBlockSizeBytes: 4194304,
        serverVersion: '1.0.0',
        clientMinVersion: '1.0.0',
    };

    // Validate shape includes new fields
    expect(response).toHaveProperty('displaySasUrl');
    expect(response).toHaveProperty('thumbSasUrl');
    expect(typeof response.displaySasUrl).toBe('string');
    expect(typeof response.thumbSasUrl).toBe('string');
    expect(response.displaySasUrl.length).toBeGreaterThan(0);
    expect(response.thumbSasUrl.length).toBeGreaterThan(0);
});
```

If the existing test uses a schema validation approach, add the new fields to the expected schema. Match the existing pattern -- read the file first to understand the convention.

### Commit Message

```
test: add displaySasUrl and thumbSasUrl to API contract test

Validate that request-upload response includes tier SAS URL fields
in the expected wire format.
```

### Verification

```bash
cd /workspaces/road-trip && npm test
```

All existing and new contract tests must pass. All previously passing tests from Phase 1 must still pass.

<!-- END_TASK_6 -->
