# Client-Side Image Processing + Phase 4 Closeout Design

## Summary

The resilient upload pipeline uploads photo originals directly to Azure Blob Storage, but two problems remain: (1) photos larger than 15 MB are rejected by the server-side size cap, and (2) every commit triggers server-side tier generation (download original, SkiaSharp decode, resize twice, re-upload), which takes 2–6 seconds per photo and causes 20-photo batches to choke the App Service.

This design solves both problems with a single client-side image processing module. **Every photo** — not just oversize ones — gets client-side processing before upload. The client generates the original, display (1920px), and thumb (300px) tiers locally using `browser-image-compression` + Canvas, then uploads all three blobs via SAS URLs. Oversize photos (>14 MB) are additionally compressed to fit under the server cap. HEIC photos from iOS are converted to JPEG. EXIF metadata (GPS, timestamp) is preserved through the processing cycle via `exifr` + `piexifjs`.

The server's `CommitAsync` becomes a lightweight operation — just `CommitBlockListAsync` on the original + verify the display/thumb blobs exist + DB update. No SkiaSharp decode, no blob download. Commit time drops from 2–6 seconds to ~200ms, and the 20-photo batch that currently chokes the server completes smoothly.

This design also closes out the four outstanding Phase 4 tasks (acceptance session, legacy-trip audit, feature flag removal, runbook finalization) and establishes the client-side processing pattern that iOS native (Phases 5–7) will reuse with `UIImage` instead of Canvas.

## Definition of Done

- Uploading a photo larger than 15 MB from the web UI results in a successfully committed photo in the trip, not a failed upload with a size error.
- Compression happens client-side before any block upload network traffic begins — the 18 MB iPhone screenshot that was previously rejected now produces a ≤14 MB JPEG upload containing the original EXIF GPS + timestamp.
- HEIC photos from iOS Safari are converted to JPEG and compressed before upload; non-HEIC photos under the threshold are not re-encoded for the original tier (zero quality loss for the common case).
- **Every upload** — regardless of size — includes client-generated display (1920px max) and thumb (300px max) tiers alongside the original. The commit endpoint no longer performs server-side tier generation.
- A 20-photo batch upload on a fast WiFi connection completes in under 3 minutes with zero failed uploads (compared to the current ~5+ minutes with 6/20 failures).
- Patrick's acceptance session on the resilient upload pipeline is recorded in `phase-4-acceptance.md` with a real-device trip.
- Legacy-trip audit (`scripts/audit-failed-uploads.sh`) has been run against prod and every flagged row has a resolution annotated.
- The `FeatureFlags:ResilientUploadsUI` feature flag has been removed from code and the prod App Service config, leaving only the new UI path.
- The deployment runbook's Phase 4 section is finalized with all sign-off checkboxes ticked.
- All existing tests continue to pass; new client-side processing logic has Vitest coverage for success, failure, and edge cases.

## Acceptance Criteria

### client-image-processing.AC1: Oversize upload success path

- **client-image-processing.AC1.1 Success:** A JPEG larger than the client-side threshold (default 14 MB) is re-encoded to ≤14 MB before `request-upload` fires, and the resulting upload commits with EXIF GPS and TakenAt preserved.
- **client-image-processing.AC1.2 Success:** A PNG larger than the threshold (e.g. 18 MB iPhone screenshot) is re-encoded to JPEG, compressed to ≤14 MB, and committed.
- **client-image-processing.AC1.3 Success:** A HEIC photo on iOS Safari is converted to JPEG, EXIF extracted via exifr before conversion, compressed if needed, EXIF reinjected, and committed with correct GPS.
- **client-image-processing.AC1.4 Edge:** A photo under the threshold (e.g. 3 MB JPEG) is uploaded as-is for the original tier — no re-encode of the original, byte-for-byte identical.

### client-image-processing.AC2: EXIF preservation

- **client-image-processing.AC2.1 Success:** After compression, the output JPEG's EXIF GPS coordinates match the input within 6 decimal places of latitude/longitude (lossless EXIF reinjection).
- **client-image-processing.AC2.2 Success:** TakenAt (`DateTimeOriginal`) in the compressed output matches the input timestamp exactly.
- **client-image-processing.AC2.3 Success:** Compressed output is a decodable JPEG that the server's photo proxy endpoint can serve without error.
- **client-image-processing.AC2.4 Edge:** A photo that cannot be compressed below the threshold even at quality 0.3 surfaces a clear user-facing error rather than a silent failure or oversize upload attempt.

### client-image-processing.AC3: Progress panel integration

- **client-image-processing.AC3.1 Success:** During processing, the progress panel shows a "Processing…" status for each photo before transitioning to the normal upload lifecycle.
- **client-image-processing.AC3.2 Success:** The `upload:created` event fires after processing completes, not before, so optimistic pins appear with the correct final file size.
- **client-image-processing.AC3.3 Failure:** If processing throws (out-of-memory, invalid input), the per-file row transitions to `failed` with the error recorded and visible in the retry panel.

### client-image-processing.AC4: Bundle and performance

- **client-image-processing.AC4.1 Success:** Processing dependencies (`browser-image-compression`, `piexifjs`) are lazy-loaded via dynamic `import()` from jsDelivr on the first upload — adding zero bytes to the initial page load.
- **client-image-processing.AC4.2 Success:** Processing a single 5 MB iPhone JPEG (generate display + thumb + optional compression) completes in under 3 seconds on a modern mobile browser.
- **client-image-processing.AC4.3 Success:** Compressing a single 18 MB PNG completes in under 8 seconds.

### client-image-processing.AC5: Client-side tier generation

- **client-image-processing.AC5.1 Success:** Every uploaded photo produces three blobs in the per-trip container: `{uploadId}_original.jpg`, `{uploadId}_display.jpg`, `{uploadId}_thumb.jpg`. All three are uploaded by the client before calling `commit`.
- **client-image-processing.AC5.2 Success:** The display tier is ≤1920px on its longest edge, encoded as JPEG at quality 85.
- **client-image-processing.AC5.3 Success:** The thumb tier is ≤300px on its longest edge, encoded as JPEG at quality 75.
- **client-image-processing.AC5.4 Success:** `CommitAsync` completes in under 500ms for any photo size (no server-side blob download or image decoding during commit).
- **client-image-processing.AC5.5 Failure:** If the client fails to upload display or thumb tiers (network error, browser crash), commit still succeeds but the server logs a warning. The photo proxy falls back to the original for any missing tier.
- **client-image-processing.AC5.6 Edge:** A sub-threshold JPEG still gets client-generated display and thumb tiers (the original is uploaded unchanged, but display and thumb are resized from it client-side).

### client-image-processing.ACX: Cross-cutting

- **client-image-processing.ACX.1:** No raw image bytes, EXIF GPS coordinates, or SAS URLs are written to persistent server-side logs at any point in the processing or upload flow.
- **client-image-processing.ACX.2:** Every processing failure path surfaces a user-visible message and a structured telemetry event — no silent drops.
- **client-image-processing.ACX.3:** The server-side `GenerateDerivedTiersAsync` method remains in the codebase as a fallback — if a legacy client (or a future iOS native client during development) commits without uploading tiers, the server generates them on the fly. But the web client always uploads tiers, so this path is never hit in normal web operation.

## Glossary

- **Block upload**: Azure Blob Storage upload pattern where a client PUTs chunks ("blocks") individually then issues a single "commit block list" call to atomically compose the final blob.
- **EXIF**: Exchangeable Image File Format — metadata embedded in JPEG/HEIC files including GPS coordinates, capture timestamp, camera make/model, and orientation.
- **HEIC / HEIF**: High Efficiency Image Format — the default iPhone photo format since iOS 11. Not decodable to Canvas in any browser; must be converted to JPEG via a WASM library (`heic2any`).
- **SAS URL**: Shared Access Signature — a time-limited, permission-scoped URL granting write access to a specific Azure blob without exposing account keys.
- **Tier**: A size variant of a photo blob. Three tiers exist: original (full quality), display (1920px max, q=85), thumb (300px max, q=75). Previously generated server-side; this design moves generation client-side.
- **browser-image-compression**: npm package wrapping Canvas + OffscreenCanvas for size-targeted JPEG output with Web Worker offload. MIT, ~30 KB gzipped.
- **exifr**: Fast EXIF reader for JPEG and HEIC. Lite build ~10 KB gzipped. Already used by the codebase (via `exifUtil.js`).
- **piexifjs**: JPEG EXIF read/write library for reinjecting GPS/timestamp after compression. MIT, ~8 KB gzipped.
- **heic2any**: WASM-based HEIC→JPEG converter for browsers. MIT, ~100 KB, lazy-loaded.

## Architecture

### Overall shape

Client-side image processing replaces server-side tier generation. Every photo goes through the processor before upload:

```
File selected
  │
  ▼
┌───────────────────┐
│ PostService       │  (existing)
│ .extractPhotoMeta │  exifr-based GPS/timestamp extraction, unchanged
└────────┬──────────┘
         │ { file, metadata }
         ▼
┌─────────────────────────────────────────────────┐
│ ImageProcessor.processForUpload                 │  NEW
│ 1. HEIC? → heic2any → JPEG                     │
│ 2. Oversize? → compress original to ≤14 MB      │
│ 3. Generate display tier (1920px, q=85)         │
│ 4. Generate thumb tier (300px, q=75)            │
│ 5. Reinject EXIF on compressed original         │
│ 6. Return { original, display, thumb, metadata } │
└────────┬────────────────────────────────────────┘
         │ { original: File, display: Blob, thumb: Blob, metadata }
         ▼
┌───────────────────────────────────────────────────┐
│ UploadQueue.start (MODIFIED)                      │
│ • request-upload → server returns 3 SAS URLs      │
│ • Block-upload original via existing transport     │
│ • PUT display blob (single PUT, not block upload)  │
│ • PUT thumb blob (single PUT, not block upload)    │
│ • commit → server verifies, updates DB, returns    │
└───────────────────────────────────────────────────┘
```

### Server contract changes

**`RequestUploadResponse`** adds two new fields:

```csharp
public record RequestUploadResponse
{
    public required Guid PhotoId { get; init; }
    public required string SasUrl { get; init; }         // original blob SAS (existing)
    public required string DisplaySasUrl { get; init; }  // NEW: display tier SAS
    public required string ThumbSasUrl { get; init; }    // NEW: thumb tier SAS
    public required string BlobPath { get; init; }
    public required int MaxBlockSizeBytes { get; init; }
    public required string ServerVersion { get; init; }
    public required string ClientMinVersion { get; init; }
}
```

**`UploadService.RequestUploadAsync`** issues 3 SAS URLs (all to the same per-trip container, different blob paths):
- `{uploadId}_original.jpg` (existing)
- `{uploadId}_display.jpg` (new)
- `{uploadId}_thumb.jpg` (new)

**`UploadService.CommitAsync`** changes:
- **Before:** Downloads original → SkiaSharp decode → resize → upload display + thumb (2–6 seconds)
- **After:** Checks if `{uploadId}_display.jpg` and `{uploadId}_thumb.jpg` exist in the container. If both exist, skip tier generation entirely. If either is missing, fall back to `GenerateDerivedTiersAsync` (backward compat for legacy clients or failed tier uploads). DB update + geocode only (~200ms).

### Module layout

- **New:** `src/RoadTripMap/wwwroot/js/imageProcessor.js` — window-global module. Handles:
  - HEIC detection and conversion (lazy `heic2any`)
  - Oversize compression (lazy `browser-image-compression` with `maxSizeMB: 14`)
  - Display tier generation via Canvas (resize to 1920px max, toBlob quality 0.85)
  - Thumb tier generation via Canvas (resize to 300px max, toBlob quality 0.75)
  - EXIF extraction (via `exifr`, already loaded) and reinjection (lazy `piexifjs`)
  - All three tiers returned as `{ original: File, display: Blob, thumb: Blob }`

- **Modified:** `src/RoadTripMap/wwwroot/js/uploadQueue.js` — after `request-upload`, upload display + thumb blobs via simple PUT (not block upload — they're small) using the new SAS URLs, then proceed with block upload of original as before. On commit, the server no longer needs to generate tiers.

- **Modified:** `src/RoadTripMap/Services/UploadService.cs` — `RequestUploadAsync` issues 3 SAS URLs. `CommitAsync` checks for tier blobs; skips `GenerateDerivedTiersAsync` if present.

- **Modified:** `src/RoadTripMap/Models/UploadDtos.cs` — `RequestUploadResponse` adds `DisplaySasUrl`, `ThumbSasUrl`.

### Why client-side tiers for ALL photos, not just oversize

1. **Eliminates the commit bottleneck.** Perf test shows commit = 60–70% of upload time, scaling linearly with photo size. Moving to client makes commit O(1).
2. **Same library, same code path.** `browser-image-compression` + Canvas are already loaded for oversize compression. Generating 1920px and 300px variants is trivial additional work.
3. **iOS native parity.** Phases 5–7 add a Capacitor iOS app. iOS's `UIImage` will generate tiers natively using the same contract (upload 3 blobs, commit is lightweight). Establishing the 3-SAS-URL contract now means the server is ready.
4. **Bandwidth tradeoff is favorable.** A 5 MB original produces ~700 KB display + ~20 KB thumb = 15% more upload data. But commit drops from 5 seconds to 200ms. For 20 photos, that saves ~90 seconds of total time.

### Why no server-side compression

Sending 15 MB+ over the network only to have the server re-encode wastes the user's cellular data. Client-side compression happens before any upload bytes are sent.

## Existing Patterns

### Patterns followed

- **Window-global module shape**: `const ImageProcessor = { ... };` matches `UploadQueue`, `StorageAdapter`, `UploadTransport`, etc.
- **Event contract**: New `upload:preparing` event follows existing naming and emit-on-`document` pattern.
- **Telemetry**: New `recordProcessingApplied`, `recordProcessingFailed` follow the existing structured-event pattern.
- **SAS issuance**: Same `ISasTokenIssuer.IssueWriteSasAsync` call, just 3x per upload instead of 1x.

### New patterns introduced

- **Lazy CDN dependencies**: `import()` from jsDelivr for `browser-image-compression`, `heic2any`, `piexifjs`. Justified by bundle-size budget — these add ~50 KB gzipped that only loads when a photo is selected.
- **Multi-blob upload per photo**: Client uploads 3 blobs instead of 1. This is a new pattern for the upload pipeline but aligns with how the legacy `PhotoService.ProcessAndUploadAsync` worked (it uploaded 3 tiers server-side).
- **Conditional server-side fallback**: `CommitAsync` checks for tier blobs and generates only if missing. This is a graceful degradation pattern — the web client always provides them, but API consumers or future iOS clients during development may not.

### Divergence from prior assumptions

- `CLAUDE.md` says "Original media never degraded (re-encoded at quality 100, EXIF stripped)". This still holds for sub-threshold uploads — the original tier is byte-for-byte the user's file. For oversize uploads, the original is compressed to ≤14 MB, which is explicitly surfaced in telemetry and is the user's only alternative to "can't upload at all."
- `CLAUDE.md` says "Photos always have all 3 blob tiers." This remains true, but the source of tiers changes from server-side SkiaSharp to client-side Canvas. The proxy endpoint (`/api/photos/{tripId}/{photoId}/{size}`) is unchanged.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Phase 4 Acceptance + Legacy Audit

**Goal:** Close out Phase 4 outstanding work (Patrick acceptance, legacy-trip audit) so the baseline resilient upload pipeline is fully signed off before adding new processing logic.

**Components:**
- `docs/implementation-plans/2026-04-13-resilient-uploads/phase-4-acceptance.md` — filled in with real-device session notes.
- `scripts/audit-failed-uploads.sh` — executed against prod DB, each row annotated.
- Appendix to `phase-4-acceptance.md` — each audited row's resolution.

**Dependencies:** None.

**Done when:**
- `phase-4-acceptance.md` has Patrick's sign-off line.
- Every audit row has an explicit resolution.
- Test suites remain green.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Feature flag removal

**Goal:** Remove `FeatureFlags:ResilientUploadsUI` from code and App Service config.

**Components:**
- `src/RoadTripMap/wwwroot/js/postUI.js` — remove flag branches.
- `src/RoadTripMap/wwwroot/js/uploadQueue.js` — remove legacy stubs.
- `src/RoadTripMap/wwwroot/css/styles.css` — remove `.upload-status-bar*`.
- `src/RoadTripMap/appsettings*.json` — remove flag keys.
- `src/RoadTripMap/Program.cs` — remove flag injection middleware.
- App Service config: delete `FeatureFlags__ResilientUploadsUI`.

**Dependencies:** Phase 1.

**Done when:**
- All tests pass. Manual smoke: upload works, no console errors.
- App Service config no longer lists the flag.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Image processor module + client-side tier generation

**Goal:** Add `ImageProcessor` module that handles HEIC conversion, oversize compression, and display/thumb tier generation for every photo. Ship with Vitest coverage.

**Components:**
- `src/RoadTripMap/wwwroot/js/imageProcessor.js` — new module with `processForUpload(file, exifData)`. Returns `{ original, display, thumb, compressionApplied, ... }`. Lazy-loads `browser-image-compression`, `heic2any`, `piexifjs` from jsDelivr on first call.
- `tests/js/imageProcessor.test.js` — Vitest suite:
  - Sub-threshold JPEG: original unchanged, display ≤1920px, thumb ≤300px (AC1.4, AC5.1–AC5.3, AC5.6)
  - Oversize JPEG: compressed original + tiers + EXIF preserved (AC1.1, AC2.1, AC2.2)
  - PNG: converted to JPEG tiers (AC1.2)
  - HEIC: converted + tiers (AC1.3, mocked heic2any)
  - Unreachable target: throws error (AC2.4)
  - Lazy imports: cached, fire once (AC4.1)
- `tests/js/setup.js` — register new global
- `src/RoadTripMap/wwwroot/post.html` — script tag in load order

**Covers ACs:** AC1.1–AC1.4, AC2.1–AC2.4, AC4.1, AC5.1–AC5.3, AC5.6, ACX.1.

**Dependencies:** Phase 2.

**Done when:** All new tests pass; existing tests remain green.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Server contract + upload queue changes

**Goal:** Modify `request-upload` to return 3 SAS URLs. Modify `UploadQueue` to upload display + thumb blobs alongside original. Modify `CommitAsync` to skip server-side tier generation when client tiers are present.

**Components:**
- `src/RoadTripMap/Models/UploadDtos.cs` — add `DisplaySasUrl`, `ThumbSasUrl` to `RequestUploadResponse`.
- `src/RoadTripMap/Services/UploadService.cs`:
  - `RequestUploadAsync`: issue 3 SAS URLs.
  - `CommitAsync`: check if `{uploadId}_display.jpg` and `{uploadId}_thumb.jpg` exist. If yes, skip `GenerateDerivedTiersAsync`. If no, fall back (ACX.3).
- `src/RoadTripMap/wwwroot/js/uploadQueue.js`:
  - After `request-upload`, store `displaySasUrl` and `thumbSasUrl` in StorageAdapter item.
  - In `_doUpload`, after block-uploading original, PUT display and thumb blobs to their SAS URLs (simple PUT, not block upload).
- `src/RoadTripMap/wwwroot/js/postUI.js`:
  - `onMultipleFilesSelected` calls `ImageProcessor.processForUpload` for each file, passes result (with display + thumb Blobs) to `UploadQueue.start`.
  - Emits `upload:preparing` before processing, `upload:created` after.
- `src/RoadTripMap/wwwroot/js/progressPanel.js` — handle `upload:preparing` (show "Processing…" row).
- `src/RoadTripMap/wwwroot/js/uploadTelemetry.js` — `recordProcessingApplied`, `recordProcessingFailed`.
- `tests/js/api-contract.test.js` — update contract to include `displaySasUrl`, `thumbSasUrl` in response shape.
- `tests/RoadTripMap.Tests/Endpoints/UploadEndpointTests.cs` — update `CommitAsync` test to verify tiers-already-present path skips server gen; commit completes in <500ms.

**Covers ACs:** AC3.1–AC3.3, AC5.1, AC5.4, AC5.5, ACX.2, ACX.3.

**Dependencies:** Phase 3.

**Done when:**
- Contract test validates 3-SAS response shape.
- Upload perf test (20 photos sequential): average commit <500ms (vs current 3700ms).
- Server-side `GenerateDerivedTiersAsync` not called when tiers present (verified via log absence).
- Fallback works: if display/thumb missing, server generates them (verified by test with 1-SAS client mock).
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Integration testing + Playwright e2e

**Goal:** End-to-end verification of the full client-side processing pipeline.

**Components:**
- `tests/js/postUI-processing.test.js` — integration test: file selected → `upload:preparing` → processing → `upload:created` → queue → committed.
- `tests/playwright/resilient-uploads.spec.js` — new scenario: synthesize large PNG, upload, verify processing row appears, committed with display+thumb tiers, photo renders.
- Playwright budget check: processing a 5 MB JPEG completes in <3s (AC4.2).

**Covers ACs:** AC4.2, AC4.3, AC3.1, AC3.2.

**Dependencies:** Phase 4.

**Done when:** All Vitest + Playwright scenarios pass locally.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Deployment runbook + dark-release flag

**Goal:** Safe rollout with a config-only kill switch.

**Components:**
- `src/RoadTripMap/wwwroot/js/imageProcessor.js` — check `<meta>` tag for `data-client-processing-enabled`; if `false`, skip processing and upload original only (server falls back to tier gen).
- `src/RoadTripMap/Program.cs` — inject `data-client-processing-enabled` from config.
- `src/RoadTripMap/appsettings.Production.json` — `"Upload": { "ClientSideProcessingEnabled": false }` initially.
- `docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md` — Phase 5 section.

**Dependencies:** Phase 5.

**Done when:**
- Flag wired end-to-end. `npm test` covers both on/off.
- Runbook section reviewed.
- Rollback verified: flag OFF → oversize uploads fail with original error, sub-threshold uploads still work via server-side tier gen fallback.
<!-- END_PHASE_6 -->

## Additional Considerations

### Deployment order of operations

1. **Phase 1–2** (acceptance + flag removal): no new processing code deployed.
2. **Phase 3–5 code deployed** with `ClientSideProcessingEnabled=false`. Code is inert.
3. **Flip flag on staging**, smoke test with 20 photos. Verify commit times <500ms.
4. **Flip flag on prod**. Monitor telemetry for 24 hours.

### Rollback strategy

- **Client processing bug**: flip `ClientSideProcessingEnabled=false`. Server-side `GenerateDerivedTiersAsync` fallback activates automatically. Takes effect on next page load, no redeploy.
- **Library regression**: versions are pinned (`@2.0.2`, not `@latest`). Fix-forward via version bump.

### Canvas memory limits on iOS

iOS Safari has a 16 million pixel hard limit for Canvas. A 4032×3024 photo (12.2M pixels) is within budget. The `maxWidthOrHeight: 4032` cap in `browser-image-compression` ensures we never exceed this. Photos already at or below 4032px on their longest edge are not resized for the original tier.

### Backward compatibility

The server-side `GenerateDerivedTiersAsync` remains in the codebase (ACX.3). If any client (legacy web session before the flag is flipped, future iOS app during development, direct API call) commits without uploading tiers, the server generates them. This is NOT the happy path for the web client — it's the fallback. Web client always uploads all 3 tiers.

### Not in scope

- **PhotoEntity.Filename column**: future cleanup, not required for this feature.
- **Automated contract-test hooks**: separate design, tracked in memory.
- **Phases 5–7 (iOS)**: unchanged. They reuse the 3-SAS-URL contract with `UIImage` instead of Canvas.
