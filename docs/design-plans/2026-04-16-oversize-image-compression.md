# Oversize Image Compression + Phase 4 Closeout Design

## Summary

When users try to upload photos larger than 15 MB (iPhone screenshots, high-res iPad camera output, or aggressive HEIC-converted JPEGs), the resilient upload pipeline currently rejects them at `request-upload` with a size error. Rather than raise the server-side cap (which increases blob storage costs linearly), this design adds a browser-side compression step in front of the existing upload queue: the client measures each photo, and if it exceeds a safe threshold, it re-encodes the photo to fit under the limit while preserving EXIF metadata (GPS, timestamp) and visual quality. iOS HEIC photos are converted to JPEG before compression since no browser can decode HEIC to Canvas natively.

The compression layer is a new vanilla-JS module (`imageCompressor.js`) that slots into the existing pre-upload triage path in `postUI.onMultipleFilesSelected`. It uses `browser-image-compression` + `exifr` + `piexifjs` (MIT-licensed, ~50 KB gzipped combined), lazy-loaded from jsDelivr so the current page weight is unaffected for users on fast connections who upload small photos. This design also closes out the four outstanding Phase 4 tasks that are unblocked by tonight's stabilization work (Patrick's acceptance session, legacy-trip audit, feature flag removal, runbook finalization) and documents a clean order of operations for deploying the compression change without regressing the now-working baseline.

## Definition of Done

- Uploading a photo larger than 15 MB from the web UI results in a successfully committed photo in the trip, not a failed upload with a size error.
- Compression happens client-side before any block upload network traffic begins — the 18 MB iPhone screenshot that was previously rejected now produces a ≤14 MB JPEG upload containing the original EXIF GPS + timestamp.
- HEIC photos from iOS Safari are converted to JPEG and compressed before upload; non-HEIC photos under the threshold are not re-encoded (zero quality loss for the common case).
- Patrick's acceptance session on the resilient upload pipeline is recorded in `phase-4-acceptance.md` with a real-device trip.
- Legacy-trip audit (`scripts/audit-failed-uploads.sh`) has been run against prod and every flagged row has a resolution annotated.
- The `FeatureFlags:ResilientUploadsUI` feature flag has been removed from code and the prod App Service config, leaving only the new UI path.
- The deployment runbook's Phase 4 section is finalized with all sign-off checkboxes ticked.
- All existing tests continue to pass; new compression logic has Vitest coverage for success, failure, and edge cases.

## Acceptance Criteria

### oversize-image-compression.AC1: Oversize upload success path

- **oversize-image-compression.AC1.1 Success:** A JPEG larger than the client-side threshold (default 14 MB) is re-encoded to ≤14 MB before `request-upload` fires, and the resulting upload commits with EXIF GPS and TakenAt preserved.
- **oversize-image-compression.AC1.2 Success:** A PNG larger than the threshold (e.g. 18 MB iPhone screenshot) is re-encoded to JPEG, compressed to ≤14 MB, and committed. PNGs have no EXIF GPS so placeName comes from the pin-drop fallback, not from EXIF (AC covered by existing AC5.3 path).
- **oversize-image-compression.AC1.3 Success:** A HEIC photo on iOS Safari is converted to JPEG, EXIF extracted via exifr before conversion, compressed to ≤14 MB, EXIF reinjected, and committed with correct GPS.
- **oversize-image-compression.AC1.4 Edge:** A photo under the threshold (e.g. 3 MB JPEG) is uploaded unchanged — no decode/re-encode cycle, byte-for-byte identical to original.

### oversize-image-compression.AC2: Compression correctness

- **oversize-image-compression.AC2.1 Success:** After compression, the output JPEG's EXIF GPS coordinates match the input within 6 decimal places of latitude/longitude (lossless EXIF reinjection).
- **oversize-image-compression.AC2.2 Success:** TakenAt (`DateTimeOriginal`) in the compressed output matches the input timestamp exactly.
- **oversize-image-compression.AC2.3 Success:** Compressed output is a decodable JPEG (`SKImage.FromEncodedData` in .NET-side tier generation produces non-null bitmap).
- **oversize-image-compression.AC2.4 Edge:** A photo that cannot be compressed below the threshold even at quality 0.3 (extreme case, e.g. a 100 MP uncompressed TIFF) surfaces a clear user-facing error rather than a silent failure or an oversize upload attempt.

### oversize-image-compression.AC3: Progress panel integration

- **oversize-image-compression.AC3.1 Success:** During compression, the progress panel shows a "Compressing…" status for each oversize photo before transitioning to the normal upload lifecycle.
- **oversize-image-compression.AC3.2 Success:** The `upload:created` event fires after compression completes, not before, so optimistic pins appear with the correct final file size.
- **oversize-image-compression.AC3.3 Failure:** If compression throws (out-of-memory on a very large image, invalid input), the per-file row transitions to `failed` with the compression error recorded and visible in the retry panel.

### oversize-image-compression.AC4: Bundle and performance

- **oversize-image-compression.AC4.1 Success:** The compression dependencies are lazy-loaded via dynamic `import()` from jsDelivr the first time an oversize photo is detected — adding zero bytes to the post-page load time for users who don't trigger the path.
- **oversize-image-compression.AC4.2 Success:** Compressing a single 18 MB PNG on a modern mobile browser completes in under 8 seconds (budget verified via a Playwright scenario).

### oversize-image-compression.ACX: Cross-cutting

- **oversize-image-compression.ACX.1:** No raw image bytes, EXIF GPS coordinates, or SAS URLs are written to persistent server-side logs at any point in the compression or upload flow (inherits resilient-uploads.ACX.1).
- **oversize-image-compression.ACX.2:** Every compression failure path surfaces a user-visible message and a structured telemetry event — no silent drops (inherits resilient-uploads.ACX.2).

## Glossary

- **Block upload**: Azure Blob Storage upload pattern where a client PUTs chunks ("blocks") individually then issues a single "commit block list" call to atomically compose the final blob. The resilient upload pipeline uses this for chunked, resumable uploads.
- **EXIF**: Exchangeable Image File Format — metadata embedded in JPEG/HEIC files including GPS coordinates, capture timestamp, camera make/model, and orientation. Stripped by most image re-encoders unless explicitly preserved.
- **HEIC / HEIF**: High Efficiency Image Format — the default iPhone photo format since iOS 11. Not decodable to Canvas in any browser; must be converted to JPEG via a WASM library (`heic2any`) before in-browser processing.
- **SAS URL**: Shared Access Signature — a time-limited, permission-scoped URL that grants the client direct write access to a specific Azure blob without exposing account keys. Issued by the backend's `UserDelegationSasIssuer`.
- **User Delegation SAS**: A SAS variant signed with a user delegation key obtained via the App Service's managed identity — requires OAuth/Bearer auth, not account keys. This is how the prod app authenticates to blob storage post-tonight's security fix.
- **Feature flag**: `FeatureFlags:ResilientUploadsUI` — App Service appsetting that toggles between the legacy FormData upload path and the new resilient queue. Currently `false` in prod (Phase 4 acceptance pending); will be removed after acceptance.
- **Tier generation**: Server-side resize step that produces `_display.jpg` (1920px max) and `_thumb.jpg` (300px max) from the uploaded `_original.jpg` blob. Uses SkiaSharp; the client-side photo proxy endpoint serves these tiers.
- **Dynamic import**: JavaScript `import('url')` expression that fetches and evaluates a module lazily at call time rather than at page load. Used here to keep the compression library off the critical path.
- **browser-image-compression**: npm package that wraps Canvas + OffscreenCanvas to produce size-targeted JPEG output with optional Web Worker offload. MIT licensed, ~30 KB gzipped core.
- **exifr**: Fast, streaming EXIF reader for JPEG and HEIC; used to extract GPS + timestamp before compression strips them. Lite build ~10 KB gzipped.
- **piexifjs**: JPEG-only EXIF read/write library used to reinject the extracted EXIF into the compressed JPEG output. MIT licensed, ~8 KB gzipped.

## Architecture

### Overall shape

Compression is a new pre-upload stage that sits between EXIF triage and `UploadQueue.start`:

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
┌───────────────────────────────────┐
│ ImageCompressor.prepareForUpload  │  NEW — lazy, size-gated
│ • Size check ≤ threshold → pass   │
│ • HEIC → decode → JPEG            │
│ • Oversize → compress to target   │
│ • Reinject EXIF on output         │
└────────┬──────────────────────────┘
         │ { file: possibly-replaced, metadata, compressionApplied }
         ▼
┌───────────────────┐
│ UploadQueue.start │  (existing, unchanged)
└───────────────────┘
```

The compressor is a pure, testable module with one public method. It never fires events directly — it returns a promise and `postUI` handles the "Compressing…" display state by emitting a synthetic progress event before calling `UploadQueue.start`.

### Module layout

- **New:** `src/RoadTripMap/wwwroot/js/imageCompressor.js` — window-global module matching the codebase convention. Contains:
  - `const ImageCompressor = { prepareForUpload, _needsCompression, _loadDependencies, ... }`
  - Configurable threshold (`THRESHOLD_BYTES = 14 * 1024 * 1024`), target (`TARGET_BYTES = 13.5 * 1024 * 1024`), and quality floor (`MIN_QUALITY = 0.3`).
  - Dependencies loaded on first call via dynamic `import()` from jsDelivr pinned versions — page load unaffected if the path never fires.
- **Modified:** `src/RoadTripMap/wwwroot/js/postUI.js` — `onMultipleFilesSelected` calls `ImageCompressor.prepareForUpload` after `extractPhotoMetadata` and before building the `UploadQueue.start` payload. Emits a new `CustomEvent('upload:preparing', { detail: { filename } })` that `progressPanel.js` listens for.
- **Modified:** `src/RoadTripMap/wwwroot/js/progressPanel.js` — handler for `upload:preparing` adds a row in a "Compressing…" state; transitions to normal queue state when `upload:created` arrives.
- **Modified:** `src/RoadTripMap/wwwroot/post.html` — add `<script src="/js/imageCompressor.js">` in the load order after `exifUtil.js` and before `uploadQueue.js`. The lazy deps (`browser-image-compression`, `heic2any`, `piexifjs`) are NOT script tags — they load via `import()` on demand.
- **Modified:** `src/RoadTripMap/wwwroot/js/uploadTelemetry.js` — add `recordCompressionApplied(uploadId, originalBytes, compressedBytes, durationMs, qualityUsed)` and `recordCompressionFailed(uploadId, reason, originalBytes)`.

### Contract: `ImageCompressor.prepareForUpload`

```js
/**
 * Ensure a file is under the upload threshold, converting HEIC and/or
 * compressing JPEG/PNG content as needed. Preserves EXIF when present.
 *
 * @param {File} file - User-selected file (any browser-supported image type)
 * @param {Object} [options]
 * @param {number} [options.thresholdBytes=14*1024*1024] - Max allowed upload size
 * @param {number} [options.targetBytes=13.5*1024*1024]  - Compression target (below threshold for safety)
 * @param {number} [options.maxWidthOrHeight=4032]        - Dimension cap
 * @param {AbortSignal} [options.signal]                  - Cancellation support
 * @returns {Promise<CompressionResult>}
 *
 * @typedef {Object} CompressionResult
 * @property {File} file                   - Same File if no change, or a new File with compressed bytes
 * @property {boolean} compressionApplied  - True if re-encoding happened
 * @property {boolean} heicConverted       - True if HEIC → JPEG happened
 * @property {number} originalBytes        - Input size
 * @property {number} outputBytes          - Output size (same as input if not applied)
 * @property {number} qualityUsed          - 0..1 when compression applied, 1 otherwise
 * @property {number} durationMs           - Wall-clock time
 *
 * @throws {CompressionFailedError} - When target cannot be reached or decode fails
 */
```

The function is pure with respect to side effects (no DOM, no network beyond the lazy import), which keeps it unit-testable with Vitest.

### Decision tree inside `prepareForUpload`

1. `file.size ≤ thresholdBytes` AND not HEIC → return `{ file, compressionApplied: false, ... }` (fast path, zero work).
2. Is HEIC (check `file.type` and magic bytes) → load `heic2any`, extract EXIF via `exifr` first (works on HEIC container), decode to JPEG Blob, then continue as if a JPEG.
3. Load `browser-image-compression`; call `imageCompression(blob, { maxSizeMB: 13.5, maxWidthOrHeight: 4032, useWebWorker: true, initialQuality: 0.85, fileType: 'image/jpeg' })`. Library binary-searches quality internally.
4. If input EXIF was captured (step 2 or upstream), reinject via `piexifjs.insert(dump(exif), compressedArrayBuffer)`.
5. Return result or throw `CompressionFailedError` on any step.

### Lazy loading strategy

Dependencies are loaded on first oversize encounter, cached in module-scope promises so concurrent calls within the same page visit don't double-fetch:

```js
// Module-private cached promises — resolve once, reuse forever
let _bicPromise = null;
let _exifrPromise = null;
let _heic2anyPromise = null;
let _piexifPromise = null;

function _loadBic() {
    _bicPromise ??= import('https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/+esm');
    return _bicPromise;
}
// ... analogous for exifr, heic2any, piexifjs
```

Pinned version tags (not `@latest`) for reproducibility. SHA-integrity checks are not used here because jsDelivr serves over HTTPS and the library is already a trust anchor — if jsDelivr is compromised, every other CDN asset on the page is too.

### Why no server-side compression

We already have SkiaSharp on the server doing display/thumb tier generation. Moving 15 MB+ uploads to a server-side compressor would:

1. Waste the user's upload bandwidth (they pay for their cellular data).
2. Require raising the 15 MB API ceiling, negating the cost-control motivation.
3. Double-encode the original — user's quality goes through JPEG twice (their encoder → ours).

Client-side compression wins on every axis except "simplicity," and that's a small cost for a well-contained new module.

## Existing Patterns

### Patterns followed

- **Window-global module shape**: `const ImageCompressor = { ... };` exactly matches `UploadQueue`, `StorageAdapter`, `UploadTransport`, etc. No ES module boilerplate visible to the rest of the codebase.
- **Dynamic import via jsDelivr**: The codebase already loads MapLibre from a CDN via `<script>` tag with `integrity=` SRI. Dynamic `import()` is a newer pattern but used consistently within this module.
- **Event contract**: New `upload:preparing` event follows the existing `upload:created`/`upload:committed`/`upload:failed` naming and emit-on-`document` pattern.
- **Telemetry**: `UploadTelemetry.recordCompressionApplied` follows the same structured-event pattern as `recordUploadRequested`, `recordBlockCompleted`, etc. Same sanitization rules (no GPS in logs, no filename-as-cleartext).
- **Testing**: Vitest tests against real `File`/`Blob` objects, same shape as `storageAdapter.test.js`. HEIC/compression dependencies mocked because we can't ship a 10 MB HEIC fixture to the test tree.

### New patterns introduced

- **Lazy CDN dependencies**: The codebase has not previously used dynamic `import()` against a CDN. This is justified by the bundle-size budget — making `browser-image-compression` a hard dependency would add ~30 KB to every page view for a code path that fires on maybe 5% of uploads. If this pattern proves successful it would be a candidate for broader adoption (currently all uploads-path modules are eagerly loaded).

### Divergence from prior assumptions

- Phase 1's `CLAUDE.md` says "Original media never degraded (re-encoded at quality 100, EXIF stripped)". The original tier path still honors this for sub-threshold uploads. For oversize uploads the user's choice is "degrade or can't upload at all" — degradation is the better failure mode and is explicitly surfaced in telemetry.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Phase 4 Acceptance + Legacy Audit

**Goal:** Close out Phase 4 outstanding work (Patrick acceptance, legacy-trip audit) so the baseline resilient upload pipeline is fully signed off before adding new compression logic on top.

**Components:**
- `docs/implementation-plans/2026-04-13-resilient-uploads/phase-4-acceptance.md` — filled in with real-device session notes, device/OS/network info, photo counts, retry counts observed, sign-off line.
- `scripts/audit-failed-uploads.sh` — executed against prod DB. Output captured and each flagged row annotated (retry / pin-drop / discard / orphan-swept).
- Appendix to `phase-4-acceptance.md` — each audited row's resolution.

**Dependencies:** None. Tonight's stabilization fixes are already deployed and green; acceptance can proceed.

**Done when:**
- `phase-4-acceptance.md` contains "Accepted by Patrick on YYYY-MM-DD" line.
- Every row returned by the audit script has an explicit resolution annotation.
- Test suites remain green (`npm test`, `dotnet test RoadTripMap.sln`).
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Feature flag removal

**Goal:** Remove `FeatureFlags:ResilientUploadsUI` from code and App Service config, delete the legacy-path branches in `postUI.js` / `uploadQueue.js`, and retire the legacy CSS (`.upload-status-bar`).

**Components:**
- `src/RoadTripMap/wwwroot/js/postUI.js` — remove `FeatureFlags.isEnabled('resilient-uploads-ui')` branches; keep only the new path.
- `src/RoadTripMap/wwwroot/js/uploadQueue.js` — remove `createStatusBar`/`updateStatusBar`/`removeStatusBar` stubs.
- `src/RoadTripMap/wwwroot/css/styles.css` — remove `.upload-status-bar*` rules.
- `src/RoadTripMap/wwwroot/post.html` — remove `data-resilient-uploads-ui` attribute from the feature-flag meta tag (or remove the whole tag; `featureFlags.js` stays for future flags).
- `src/RoadTripMap/appsettings.json`, `appsettings.Production.json`, `appsettings.Development.json` — remove `FeatureFlags:ResilientUploadsUI` keys.
- `src/RoadTripMap/Program.cs` — remove the conditional feature-flag injection in the static file response middleware.
- App Service config (runtime only, not code): `az webapp config appsettings delete --name app-roadtripmap-prod --setting-names FeatureFlags__ResilientUploadsUI`.

**Dependencies:** Phase 1 (must not remove the flag until Patrick has signed off; Phase 1 produces that sign-off).

**Done when:**
- Every automated test still passes.
- Manual smoke: load post page with DevTools open; no console errors; upload succeeds via the new pipeline.
- `/api/version` responds 200 with correct headers after deploy.
- App Service config no longer lists `FeatureFlags__ResilientUploadsUI`.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Image compressor module + unit tests

**Goal:** Add the `ImageCompressor` module with lazy-loaded dependencies, size-gated bypass, HEIC branch, JPEG/PNG compression, and EXIF reinjection. Ship with Vitest coverage that exercises every decision-tree branch using real `File` objects and mocked dependency modules.

**Components:**
- `src/RoadTripMap/wwwroot/js/imageCompressor.js` — new module with `prepareForUpload`, `_needsCompression`, `_loadBic`/`_loadExifr`/`_loadHeic2any`/`_loadPiexif`, `CompressionFailedError`.
- `tests/js/imageCompressor.test.js` — Vitest suite covering:
  - Sub-threshold JPEG passes through unchanged (AC1.4)
  - Oversize JPEG compressed with EXIF preserved (AC1.1, AC2.1, AC2.2)
  - Oversize PNG compressed and converted to JPEG (AC1.2)
  - HEIC input converted + EXIF preserved (AC1.3, with heic2any mocked)
  - Unreachable target throws `CompressionFailedError` (AC2.4)
  - Lazy imports fire exactly once and are cached (AC4.1 structural check)
- `tests/js/setup.js` — register new global.
- `src/RoadTripMap/wwwroot/post.html` — `<script src="/js/imageCompressor.js">` in load order.

**Covers ACs:** AC1.1–AC1.4, AC2.1–AC2.4, AC4.1 (structural), ACX.1.

**Dependencies:** Phase 2 (easier to modify `postUI` once the legacy branch is gone).

**Done when:**
- All new Vitest cases pass; existing 173 tests remain green.
- No eager load of compression libraries happens on an unmodified post page (verified by asserting `document.querySelectorAll('script[src*=browser-image-compression]').length === 0`).
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: postUI + progress panel integration

**Goal:** Wire the compressor into the real upload flow and make the progress panel show a "Compressing…" state during the pre-upload stage.

**Components:**
- `src/RoadTripMap/wwwroot/js/postUI.js` — in `onMultipleFilesSelected`, for each item call `ImageCompressor.prepareForUpload(item.file)` before building the `UploadQueue.start` payload. Emit `upload:preparing` on start of compression (per file) and let `upload:created` fire naturally when the queue takes over. On `CompressionFailedError`, transition the row to `failed` via a synthetic `upload:failed` event and surface a toast.
- `src/RoadTripMap/wwwroot/js/progressPanel.js` — add handler for `upload:preparing` that creates/updates a row in `data-status="compressing"` showing filename, size, and spinner. The existing `upload:created` handler merges state into the same row.
- `src/RoadTripMap/wwwroot/css/styles.css` — `.upload-panel__row[data-status="compressing"]` styling (match existing row styles; use a subtle blue to signal pre-upload).
- `src/RoadTripMap/wwwroot/js/uploadTelemetry.js` — `recordCompressionApplied`, `recordCompressionFailed`.
- `tests/js/postUI-compression.test.js` — integration test: oversize file triggers `upload:preparing` → compression runs → `upload:created` fires with compressed file → queue progresses as normal.

**Covers ACs:** AC3.1, AC3.2, AC3.3, AC4.1 (event-level structural), ACX.2.

**Dependencies:** Phase 3 (module must exist).

**Done when:**
- Playwright flow from tonight's work still passes unchanged for sub-threshold uploads.
- New Vitest integration test confirms the `upload:preparing` → `upload:created` transition for oversize input.
- Manual smoke on a live environment: upload an 18 MB PNG from desktop → compression panel row appears → upload completes → thumbnails render.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Playwright e2e + budget verification

**Goal:** Extend the Playwright suite to exercise the compression path end-to-end against a live server (when run locally/CI with Azurite), including the 8-second budget assertion for mobile-class hardware.

**Components:**
- `tests/playwright/resilient-uploads.spec.js` — new scenario:
  - Synthesize a large high-entropy PNG in-browser (similar to the SkiaSharp regression test), drop into the file input.
  - Wait for `data-status="compressing"` row to appear.
  - Wait for `data-status="committed"` within 30s (generous CI ceiling; logged assertion uses 8s as a warning-level check, not a hard fail).
  - Assert the committed photo list includes the new photo with correct placename.
- `tests/playwright/helpers/imageSynthesis.js` — small helper that produces a target-size PNG from a Canvas in the browser context.

**Covers ACs:** AC1.1, AC1.2, AC4.2, AC3.1, AC3.2 (runtime behavior).

**Dependencies:** Phase 4.

**Done when:**
- `npm run test:e2e -- resilient-uploads.spec.js` passes locally with Azurite + the dev server running.
- CI scaffolding note added to `tests/playwright/README.md` (live-server runs are still manual; CI continues to run Vitest only).
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Deployment runbook update + dark-release toggle

**Goal:** Document the rollout path and gate compression behind a narrow, easily-rolled-back config knob so deploying the change can be done without a second code deploy if something goes wrong in production.

**Components:**
- `src/RoadTripMap/wwwroot/post.html` meta tag — `<meta id="clientConfig" data-compression-enabled="true">`.
- `src/RoadTripMap/wwwroot/js/imageCompressor.js` — check the meta tag in `prepareForUpload`; if `false` or missing, skip compression entirely (fail-open on the existing error rather than introduce a new failure mode).
- `src/RoadTripMap/Program.cs` — middleware injects `data-compression-enabled="@Configuration["Upload:ClientSideCompressionEnabled"]"` into the meta tag (reuse the existing feature-flag injection pattern).
- `src/RoadTripMap/appsettings.Production.json` — `"Upload": { "ClientSideCompressionEnabled": false }` initially; flip to `true` after smoke test.
- `docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md` — append Phase 5 section (`## Phase 5 — Oversize compression rollout`) covering: pre-flight, deploy with flag off, staging validation with flag on, prod cutover, rollback via flag flip.

**Covers ACs:** None directly — operational.

**Dependencies:** Phase 5.

**Done when:**
- Runbook section reviewed.
- Flag is wired end-to-end (code + config) and `npm test` covers both on/off states.
- Manual verification that flipping the flag to `false` on a deployed environment causes oversize uploads to fail with the original 15 MB error (pre-compression baseline) — confirming rollback works.
<!-- END_PHASE_6 -->

## Additional Considerations

### Deployment order of operations (critical)

Tonight's sequence taught us that client/server contract fixes and infrastructure changes compound risk when bundled together. This design sequences the deploys explicitly:

1. **Deploy Phase 1 outcomes** (no code change — just runbook entries and audit resolutions). Patrick's sign-off.
2. **Deploy Phase 2** (feature flag removal). Small, reversible (revert commit + redeploy). Verifies the current pipeline is healthy without the legacy fallback.
3. **Deploy Phase 3 + 4 code together**, but with Phase 6's `ClientSideCompressionEnabled` flag set to `false`. Code is inert in production.
4. **Flip the flag on staging slot**, run Phase 5 Playwright scenario against staging, smoke-test with a real iPhone photo.
5. **Flip the flag in prod**. Monitor telemetry (`upload.compression_applied`, `upload.compression_failed`) for 24 hours before considering rollout complete.
6. **Phase 6 is formally "done"** only after the 24-hour watch period with zero `upload.compression_failed` events of type "out_of_memory" or "decode_failure" from real user devices.

### Rollback strategy

- **Client bug** (compression loop, wrong EXIF): flip `ClientSideCompressionEnabled=false` via App Service config. Takes effect on next page load.
- **Server bug** (tier generation regression): revert the specific commit via PR, deploy. Same workflow as tonight's hotfix chain.
- **Library regression** (browser-image-compression publishes a broken version): versions are pinned (`@2.0.2`, not `@latest`). jsDelivr immutable tags mean this cannot happen silently. Fix-forward requires a code change to bump the pin.

### Runbook actions requiring human hands outside this container

The following are listed in the Phase 6 runbook addition; flagging them here for the morning so they're visible:

1. **Patrick's acceptance session** (Phase 1): real iPhone, real trip, real cellular network. Nothing about this is automatable.
2. **Prod DB query for legacy-trip audit** (Phase 1): requires `az keyvault secret show --vault-name kv-roadtripmap-prod --name DbConnectionString -o tsv` piped into `sqlcmd`. Can be run from this container now that `az` + `libicu` are installed, but needs Patrick's approval per the `azure_sp_identity_guard` hook.
3. **Feature flag removal from App Service config** (Phase 2): `az webapp config appsettings delete`. Scripted, but must run after PR merge and CI deploy, not before.
4. **Compression dark-release toggles** (Phases 6): two `az webapp config appsettings set` commands (staging slot on, prod on). Sequenced with Playwright smoke tests in between.

### Unresolved items not in this design

The following came up tonight but are out of scope for this design:

- **PhotoEntity.Filename column**: The original filename is not persisted server-side. The UI currently falls back to "Photo" when `placeName` is empty and GPS fallback didn't trigger. Tonight's bug (which turned out to be the GPS issue masquerading as a filename issue) resolved itself. Adding a `Filename` column would be a small schema migration but is not required for this feature; tracked as a future cleanup.
- **Automated contract-test hook**: Tonight's contract test file (`tests/js/api-contract.test.js`) is a manual pattern. Patrick explicitly asked for hooks that prevent the snake_case/camelCase class of bug from shipping. That work is a separate design (tooling around `JsonPropertyName` extraction and JS-side schema generation) and is tracked in memory (`feedback_api_contract_testing.md`).
- **Phases 5–7 of the original resilient-uploads plan** (Capacitor iOS shell, Swift plugins, TestFlight): unchanged by this design. They begin after compression ships and a stabilization period on the web path completes.

### Why three phases for compression, not one

The decision-tree inside `prepareForUpload` is small but the surrounding integration touches 5+ files and a new event type. Splitting the module (Phase 3) from the integration (Phase 4) from the e2e coverage (Phase 5) keeps each PR reviewable and each deploy rollback-able in isolation. If the compressor module is buggy it's a one-commit revert. If the integration is buggy but the module is fine, the integration is a one-commit revert and the module stays in for a second attempt.

### Test file strategy

Vitest tests use synthesized files via `new Blob([...])` and Canvas-generated images. We do **not** commit real iPhone photos (18 MB PNGs) to the test tree — that would bloat the repo and the CI cache. The Playwright scenario in Phase 5 synthesizes a large high-entropy PNG in-browser via Canvas at test runtime, which exercises the same code paths as a real iPhone screenshot at ~30–40 MB synthesized size.
