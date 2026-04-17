# Resilient Photo Uploads — Phase 2: Web Upload State Machine and Transport

**Goal:** Replace the in-memory, FormData-based web upload path with a durable IndexedDB-backed queue + direct-to-Azure block uploader against the Phase 1 backend, plus the client-side version protocol. No user-visible UI additions — the existing status bar remains; Phase 3 adds the new progress panel, resume banner, and pins.

**Architecture:** Vanilla JS window-global modules (matching the existing `wwwroot/js` convention; no bundler introduced). IndexedDB is the durable queue. Blocks are uploaded concurrently via a hand-rolled semaphore (3 per file, 9 global). Retry uses decorrelated-jitter exponential backoff, capped at 30 s and 6 attempts. `BroadcastChannel` enforces single-tab ownership per `upload_id`.

**Tech Stack:** Vanilla JS ES2022, IndexedDB, fetch, BroadcastChannel, Vitest + jsdom + fake-indexeddb for tests, Azure Blob Storage (CORS-enabled).

**Scope:** Phase 2 of 7.

**Codebase verified:** 2026-04-13.

---

## Acceptance Criteria Coverage

### resilient-uploads.AC3: Upload state machine and retry policy

- **resilient-uploads.AC3.1 Success:** A photo transitions `pending → requesting → uploading → committing → committed` in order on a clean happy path.
- **resilient-uploads.AC3.2 Success:** A single block failure triggers exponential backoff retry (min(2^attempts × 1000ms, 30000ms) + jitter) and succeeds within 6 attempts when the underlying issue resolves.
- **resilient-uploads.AC3.3 Failure:** After 6 consecutive block upload failures, the photo transitions to `failed` with the last error recorded.
- **resilient-uploads.AC3.4 Edge:** Concurrent uploads respect the per-file (3 blocks) and global (3 photos, 9 in-flight) concurrency caps.
- **resilient-uploads.AC3.5 Edge:** A SAS expiration mid-upload (403 from Azure) triggers a fresh `request-upload` call with the same `upload_id` and resumes from the remaining pending blocks.

### resilient-uploads.AC4: Queue persistence and cross-session resume

- **resilient-uploads.AC4.1 Success:** Closing the browser tab mid-batch preserves queue state; reopening the trip page shows the resume banner with the correct count. (Banner UI in Phase 3; persistence + event here.)
- **resilient-uploads.AC4.2 Success:** Clicking "Resume" on the banner continues uploads from where they stopped, reusing Azure's uncommitted-block retention.
- **resilient-uploads.AC4.3 Success:** Clicking "Discard all" transitions all pending rows to `aborted` and removes them from the UI.
- **resilient-uploads.AC4.4 Failure:** Resuming after >7 days gracefully restarts the upload from block 1 rather than failing.
- **resilient-uploads.AC4.5 Edge:** Two browser tabs open to the same trip do not double-upload the same photo (queue is singleton per `upload_id`).

### resilient-uploads.AC7: Optimistic photo placement (event surface only; rendering in Phase 3)

- Emitted events (`upload:created`, `upload:committed`, `upload:failed`) carry the data Phase 3 will render; not user-visible in this phase.

### resilient-uploads.AC8: Version protocol (client side)

- **resilient-uploads.AC8.2 Success:** When a client's cached version is below `x-client-min-version`, UI surfaces the reload alert. (Event fired here; banner in Phase 3.) Verified by Task 12.
- **resilient-uploads.AC8.3 Failure:** Missing version headers do not crash the client. Verified by Task 12.

---

## Notes for Implementers

- **Module style.** Existing `wwwroot/js/*.js` files are window globals (`const UploadQueue = { ... };`). Do NOT introduce ES modules or a bundler. New files must follow the same pattern.
- **Script load order.** Edit `src/RoadTripMap/Pages/Post.cshtml` (or the view that currently loads `uploadQueue.js`) to add new scripts in this order: `uploadUtils.js`, `uploadSemaphore.js`, `storageAdapter.js`, `uploadTransport.js`, `versionProtocol.js`, `uploadQueue.js` (rewritten), `postUI.js` (updated).
- **Testing.** `npm test` runs Vitest. Setup file is `tests/js/setup.js` — extend it to `import 'fake-indexeddb/auto'` (add `fake-indexeddb` to root `package.json` devDependencies). Tests live under `tests/js/`.
- **Log sanitization.** Client-side `console.log` must not emit SAS URLs or GPS coordinates (ACX.1). Add a helper in `uploadUtils.js` that redacts the `sig=` and `se=` parameters of SAS URLs before logging.
- **No piexifjs assumption.** Design doc says piexifjs; codebase actually uses `exifr` (already handles HEIC). This is transparent to Phase 2; noted for Phase 6 design revisit.
- **Version header.** `x-server-version` and `x-client-min-version` come from Phase 1 middleware. The cached client version is emitted into the page via a `<meta name="client-version" content="...">` tag on the trip page; `versionProtocol.js` reads it on load.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
## Subcomponent A: Shared utilities

<!-- START_TASK_1 -->
### Task 1: uploadUtils.js

**Verifies:** None (utility; covered via Task 3 tests).

**Files:**
- Create: `src/RoadTripMap/wwwroot/js/uploadUtils.js`

**Implementation:**

`UploadUtils` global exposing:
- `backoffMs(attempt)` — decorrelated jitter `min(2^attempt * 1000, 30000) + random(0, min(cap, 3 * base) - base)`; `base=1000`, `cap=30000`. Returns int ms.
- `makeBlockId(index)` — `btoa(String(index).padStart(64, '0'))`. 64-char base64 zero-padded; all block IDs in a blob have equal length (required by Azure).
- `sliceFile(file, chunkSize = 4 * 1024 * 1024)` — generator yielding `{ index, blockId, blob, start, end }`.
- `redactSasForLog(url)` — replaces `sig=...` and `se=...` with `sig=REDACTED`.
- `newGuid()` — `crypto.randomUUID()`.

**Verification:**

Run: `npm test tests/js/uploadUtils.test.js` (added in Task 3).

**Commit:** `feat(web): uploadUtils with backoff, block IDs, file slicing, log redaction`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: uploadSemaphore.js

**Verifies:** AC3.4 (logic).

**Files:**
- Create: `src/RoadTripMap/wwwroot/js/uploadSemaphore.js`

**Implementation:**

`UploadSemaphore` class with `acquire()` returning Promise that resolves when a slot is available, `release()` releasing one. Plus `UploadConcurrency.create({ perFile, global })` factory returning `{ acquireForBlock(uploadId) → releaseFn }` that nests: acquire the per-file semaphore for `uploadId`, then acquire the global semaphore. Release in reverse order in `finally`. Tracks per-`uploadId` semaphores in a `Map`, disposed when all blocks for that `uploadId` release.

**Verification:**

Run: `npm test tests/js/uploadSemaphore.test.js` (Task 3).

**Commit:** `feat(web): per-file + global upload concurrency semaphores`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Unit tests for utilities

**Verifies:** AC3.2 (backoff), AC3.4 (concurrency).

**Files:**
- Create: `tests/js/uploadUtils.test.js`
- Create: `tests/js/uploadSemaphore.test.js`
- Modify: `package.json` (add `fake-indexeddb` devDependency)
- Modify: `tests/js/setup.js` (import `fake-indexeddb/auto`)

**Implementation:**

`uploadUtils.test.js`:
- `backoffMs(0)` ∈ [1000, 3000]; monotonic-ish growth; capped at 30_000.
- `makeBlockId` returns 64-char strings; deterministic per index; distinct across indices.
- `sliceFile` on a 10 MB Blob with chunkSize=4 MB yields 3 chunks (4, 4, 2 MB); last chunk `end = file.size`.
- `redactSasForLog` strips `sig=` and `se=` but keeps other params.

`uploadSemaphore.test.js`:
- Semaphore with capacity 3 only runs 3 concurrent acquires; 4th waits.
- `UploadConcurrency` with `{perFile:3, global:9}`: simulate 5 files × 5 blocks each; observe never >3 per file, never >9 total (track peak counters).

**Verification:**

Run: `npm test tests/js/uploadUtils.test.js tests/js/uploadSemaphore.test.js`
Expected: All pass.

**Commit:** `test(web): upload utils + semaphore tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->
## Subcomponent B: Durable queue storage

<!-- START_TASK_4 -->
### Task 4: storageAdapter.js

**Verifies:** AC4.1 (persistence logic).

**Files:**
- Create: `src/RoadTripMap/wwwroot/js/storageAdapter.js`

**Implementation:**

`StorageAdapter` global. IndexedDB database `"RoadTripUploadQueue"` v1 with stores:
- `upload_items` — keyPath `upload_id`; indices `by_status` (on `status`), `by_trip_token` (on `trip_token`).
- `block_state` — keyPath `[upload_id, block_id]`; index `by_upload` (on `upload_id`).

Methods (all return Promises):
- `putItem(item)` — upsert.
- `updateItemStatus(uploadId, status, extraFields)` — atomic tx.
- `getItem(uploadId)`.
- `listByTrip(tripToken)` — all items for a trip.
- `listNonTerminal(tripToken)` — items with `status ∈ {pending, requesting, uploading, committing}`.
- `putBlock(uploadId, blockId, state)` / `listBlocks(uploadId)` / `updateBlock(uploadId, blockId, state)`.
- `deleteItem(uploadId)` — cascades to blocks for that upload.

Graceful degradation: if `indexedDB === undefined` or `open` fails, fall back to `Map`-backed in-memory store (matches `mapCache.js` pattern). Log a warning once; items in non-persistent mode are marked `persistent: false`.

**Verification:** Tested in Task 5.

**Commit:** `feat(web): IndexedDB storage adapter for upload queue`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: storageAdapter tests

**Verifies:** AC4.1.

**Files:**
- Create: `tests/js/storageAdapter.test.js`

**Implementation:**

Using `fake-indexeddb/auto` (from setup). Per-test `beforeEach` deletes the DB for isolation.

Scenarios:
- Insert then get round-trips all fields.
- Status update persists and is queryable via `listNonTerminal`.
- Items with `status='committed'` are excluded from `listNonTerminal`.
- `deleteItem` removes item and its blocks (`listBlocks` returns empty).
- Multiple blocks per upload — `listBlocks` returns them ordered consistently.

**Verification:**

Run: `npm test tests/js/storageAdapter.test.js`
Expected: Pass.

**Commit:** `test(web): storage adapter IndexedDB tests`
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-7) -->
## Subcomponent C: Block upload transport

<!-- START_TASK_6 -->
### Task 6: uploadTransport.js

**Verifies:** AC3.2, AC3.3, AC3.5 (logic).

**Files:**
- Create: `src/RoadTripMap/wwwroot/js/uploadTransport.js`

**Implementation:**

`UploadTransport` global. Error classes: `RetryableError`, `PermanentError extends Error`, `SasExpiredError extends RetryableError`.

`putBlock(sasUrl, blockId, blob, { signal })`:
1. Parse `sasUrl`, set `comp=block`, `blockid=<urlencoded blockId>`.
2. `fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Length': String(blob.size), 'x-ms-version': '2024-11-04' }, signal })`.
3. Status 201 → return.
4. Status 403 → throw `SasExpiredError` (AC3.5).
5. Status ∈ {408, 429, 500, 503} → throw `RetryableError`.
6. Other → `PermanentError`.

`uploadFile({ file, uploadId, tripToken, photoId, sasUrl, storageAdapter, semaphores, onProgress, onSasExpired })`:
1. From `storageAdapter.listBlocks(uploadId)`, determine pending blocks. If empty, slice file via `UploadUtils.sliceFile` and seed `block_state` rows.
2. For each pending block, `semaphores.acquireForBlock(uploadId)`.
3. For each attempt 0..5, call `putBlock`; on `RetryableError` sleep `UploadUtils.backoffMs(attempt)` then retry (AC3.2); on `SasExpiredError` call `onSasExpired()` → receive fresh `sasUrl`, retry with new URL (AC3.5). On `PermanentError` throw. After 6 failed attempts on `RetryableError`, throw final error (AC3.3).
4. On block success: `storageAdapter.updateBlock(uploadId, blockId, { status: 'done', attempts })`.
5. On block final failure: `updateBlock(... { status: 'failed', error })` and rethrow.
6. Return array of `blockIds` in slice order when all done.

Cancellation via `AbortController` passed through as `signal`.

Log sanitization: never `console.log(sasUrl)`; use `UploadUtils.redactSasForLog`.

**Verification:** Tests in Task 7.

**Commit:** `feat(web): block upload transport with retry, backoff, SAS refresh`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: uploadTransport tests

**Verifies:** AC3.2, AC3.3, AC3.5.

**Files:**
- Create: `tests/js/uploadTransport.test.js`

**Implementation:**

`fetch` stubbed via `vi.stubGlobal('fetch', vi.fn())`. `vi.useFakeTimers()` to test backoff waits.

Scenarios:
- Happy path: 3 blocks, all 201 on first attempt → returns `[id0, id1, id2]`; `block_state` all `done`.
- AC3.2: block 1 returns 503 twice then 201 → succeeds after advancing timers; attempts counted correctly.
- AC3.3: block 0 returns 503 six times → throws, `block_state` for that block is `failed`.
- AC3.5: block 2 returns 403 once → `onSasExpired` called with `uploadId`, returns new URL; retry uses new URL and succeeds. `block_state` for earlier `done` blocks is untouched (resume from remaining).
- Permanent 400 → immediate throw, no retry.

**Verification:**

Run: `npm test tests/js/uploadTransport.test.js`
Expected: Pass.

**Commit:** `test(web): upload transport retry + SAS refresh tests`
<!-- END_TASK_7 -->
<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D (tasks 8-9) -->
## Subcomponent D: Upload queue state machine

<!-- START_TASK_8 -->
### Task 8: Rewrite uploadQueue.js

**Verifies:** AC3.1, AC4.1, AC4.2, AC4.3, AC4.4, AC4.5.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/uploadQueue.js` (complete rewrite; preserve file path so HTML script order doesn't change)

**Implementation:**

State machine per item: `pending → requesting → uploading → committing → committed | failed | aborted`.

Public API (`UploadQueue` global):
- `async start(tripToken, filesWithMetadata, callbacks)` — for each file: create `upload_id`, `storageAdapter.putItem({ upload_id, trip_token, filename, size, exif, status:'pending', created_at, last_activity_at })`, dispatch `document.dispatchEvent(new CustomEvent('upload:created', { detail: {...} }))`, enqueue worker.
- `async resume(tripToken)` — `storageAdapter.listNonTerminal(tripToken)`, for each attempt to continue from current `status`.
- `async discardAll(tripToken)` — mark each non-terminal item `aborted`, call `API.abort`, emit `upload:failed` with `reason:'aborted'`, call `storageAdapter.deleteItem`.
- `retry(uploadId)` — reset `block_state` for any `failed` blocks to `pending`, re-enqueue (Phase 3 wires the button).
- `abort(uploadId)` — like `discardAll` but for one.
- `subscribe(eventName, handler)` — convenience wrapper over `document.addEventListener`.

Worker (`_processItem(uploadId)`):
1. `pending → requesting`: POST `API.requestUpload(tripToken, { upload_id, filename, content_type, size_bytes, exif })`. Persist `photo_id`, `sas_url`, `blob_path` to `storageAdapter`.
2. `requesting → uploading`: `UploadTransport.uploadFile({...})`. Pass `onSasExpired` that re-POSTs `requestUpload` with same `upload_id`, persists new `sas_url`.
3. `uploading → committing`: POST `API.commit(tripToken, photo_id, blockIds)`. If response is `400 BlockListMismatch` AND local `block_state` marks all done (AC4.4 — stale uncommitted blocks gone after 7 days): reset all blocks to `pending`, call `request-upload` again (new photo_id on server since old `upload_id` still idempotent — server returns same photo_id, we just re-upload to the same blob path), retry upload. Cap this reset to 1 attempt to avoid infinite loop.
4. `committing → committed`: emit `upload:committed` with `{ uploadId, photoId, tripToken, exif }`. Call `callbacks.onEachComplete()` (preserves existing contract with `postUI.refreshPhotoList`).
5. On permanent failure from any step: transition to `failed`, emit `upload:failed` with `{ uploadId, reason, error }`.

Cross-tab singleton (AC4.5):
- On `start`/`resume`, open `BroadcastChannel('roadtrip-uploads-' + tripToken)`.
- Before taking work on `upload_id`, broadcast `{type:'claim', uploadId, claimantId}` (claimantId = page-load GUID).
- Listen for `claim` on same `upload_id`: if claimantId ≠ ours AND we haven't moved past `requesting`, yield (mark as observer in memory only; DB row stays, another tab owns).
- If we have moved past `requesting`, respond with `{type:'owned', uploadId, claimantId}`; owner stays, other tab yields.
- Test path: spawn two `UploadQueue` instances in jsdom, verify only one makes network calls for a given `upload_id`.

Log sanitization: never log SAS URLs; log `uploadId`, `photoId`, `status` only.

**Verification:** Tests in Task 9.

**Commit:** `feat(web): rewrite UploadQueue as persistent state machine`
<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: UploadQueue tests

**Verifies:** AC3.1, AC4.1, AC4.2, AC4.3, AC4.4, AC4.5.

**Files:**
- Create: `tests/js/uploadQueue.test.js`

**Implementation:**

Stubs: `API` methods via `vi.stubGlobal`, `UploadTransport.uploadFile` via spy that resolves with given block IDs, `fake-indexeddb` for `storageAdapter`.

Scenarios:
- AC3.1 happy path: single file progresses through all 5 states; events fire in correct order; DB row ends `committed`.
- AC4.1: start 3 items, stop mid-way (don't await). Open a second `UploadQueue` instance (simulates reload) and call `resume(tripToken)` — all 3 complete. DB rows all `committed`.
- AC4.2: seed DB with items in `uploading` with partial `block_state` (2 of 4 blocks `done`); call `resume` — transport is invoked only for the 2 pending blocks.
- AC4.3: `discardAll(tripToken)` marks non-terminal items `aborted`, emits `upload:failed`; `API.abort` called per item; DB rows removed.
- AC4.4: commit returns `400 BlockListMismatch` on first attempt with all local blocks `done` — queue resets blocks to `pending`, re-requests upload, re-uploads, commit succeeds second time. A second mismatch throws → item `failed`.
- AC4.5: two `UploadQueue` instances in the same jsdom; verify claim/owned handshake via `BroadcastChannel` mock (use `broadcast-channel` polyfill or a tiny hand-rolled fake); only one instance calls `API.requestUpload` for a given `upload_id`.

**Verification:**

Run: `npm test tests/js/uploadQueue.test.js`
Expected: Pass.

**Commit:** `test(web): UploadQueue state machine + persistence + cross-tab tests`
<!-- END_TASK_9 -->
<!-- END_SUBCOMPONENT_D -->

<!-- START_SUBCOMPONENT_E (task 10) -->
## Subcomponent E: API extensions

<!-- START_TASK_10 -->
### Task 10: Extend api.js with new upload endpoints

**Verifies:** None directly (integration tested via Task 9 + Task 14).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/api.js`
- Modify: `tests/js/api.test.js`

**Implementation:**

Add to `API`:
- `async requestUpload(secretToken, body)` — POST `/api/trips/{secretToken}/photos/request-upload`, JSON body, returns JSON.
- `async commit(secretToken, photoId, blockIds)` — POST `.../photos/{photoId}/commit`.
- `async abort(secretToken, photoId)` — POST `.../photos/{photoId}/abort`.
- `async getVersion()` — GET `/api/version`.

Error handling follows existing `!response.ok` pattern. On 400, surface the error body so callers can inspect `code` (e.g., `BlockListMismatch`).

Update `tests/js/api.test.js` with happy-path + 400 error tests for each new method.

**Verification:**

Run: `npm test tests/js/api.test.js`
Expected: Pass.

**Commit:** `feat(web): API.requestUpload, commit, abort, getVersion`
<!-- END_TASK_10 -->
<!-- END_SUBCOMPONENT_E -->

<!-- START_SUBCOMPONENT_F (tasks 11-12) -->
## Subcomponent F: Version protocol

<!-- START_TASK_11 -->
### Task 11: versionProtocol.js

**Verifies:** AC8.2 (event-fire), AC8.3 (graceful missing headers).

**Files:**
- Create: `src/RoadTripMap/wwwroot/js/versionProtocol.js`
- Modify: `src/RoadTripMap/Pages/Shared/_Layout.cshtml` (or wherever meta tags live) — add `<meta name="client-version" content="@ViewData["ClientVersion"]">` sourced from server

**Implementation:**

`VersionProtocol` global. On load:
- Read `document.querySelector('meta[name=client-version]')?.content` as `currentClientVersion`. If missing, warn and disable check.
- Wrap `window.fetch`: call original, then inspect response headers `x-server-version`, `x-client-min-version`. If both present and `currentClientVersion < clientMin` (semver compare), call `dispatchReload()` at most once.
- `dispatchReload()` fires `document.dispatchEvent(new CustomEvent('version:reload-required', { detail: { serverVersion, clientMin, currentVersion } }))`. Set an internal flag to suppress further fires.
- If any header missing, no-op (AC8.3).

Semver compare: small helper `compareSemver(a, b)` returning -1/0/1 (sufficient for `X.Y.Z` without prerelease).

**Verification:** Task 12.

**Commit:** `feat(web): client version protocol reading response headers`
<!-- END_TASK_11 -->

<!-- START_TASK_12 -->
### Task 12: versionProtocol tests

**Verifies:** AC8.2, AC8.3.

**Files:**
- Create: `tests/js/versionProtocol.test.js`

**Implementation:**

Stub `document.head` with a meta tag `client-version=1.0.0`. Stub `fetch` responses with different header combinations. Assertions:
- AC8.2: `x-client-min-version: 1.1.0` → event fires once even across multiple requests.
- AC8.3: headers missing → no error thrown, no event fired.
- `x-client-min-version: 1.0.0` (equal) → no event.
- Case-insensitive header access (use `Headers` object methods).

**Verification:**

Run: `npm test tests/js/versionProtocol.test.js`
Expected: Pass.

**Commit:** `test(web): versionProtocol header watch + reload-required event`
<!-- END_TASK_12 -->
<!-- END_SUBCOMPONENT_F -->

<!-- START_SUBCOMPONENT_G (tasks 13-14) -->
## Subcomponent G: postUI integration

<!-- START_TASK_13 -->
### Task 13: Update postUI.js to use new pipeline

**Verifies:** AC3.1 (end-to-end surface).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js`
- Modify: `src/RoadTripMap/Pages/Post.cshtml` (add new script tags in correct load order)

**Implementation:**

In `postUI.onMultipleFilesSelected(fileList)`:
- Keep EXIF extraction loop.
- Replace `UploadQueue.start(this.secretToken, gpsFiles, {...})` call with new signature: each entry needs `{ file, metadata, uploadId: UploadUtils.newGuid() }`.
- Preserve `onEachComplete: () => this.refreshPhotoList()` and `onAllComplete: () => this.handleNoGpsFiles(noGpsFiles)`.

On `init()`:
- After existing setup, call `await UploadQueue.resume(this.secretToken)`.
- Attach event listener for `upload:committed` to call `this.refreshPhotoList()` (ensures refresh even for resumed items).
- Attach listener for `version:reload-required` — for Phase 2, log to console and show a simple `alert()` (Phase 3 adds a proper banner).

Script tags added to `Post.cshtml` in load order between existing `uploadQueue.js` line and `postUI.js` line:
```html
<script src="~/js/uploadUtils.js?v=@AppVersion"></script>
<script src="~/js/uploadSemaphore.js?v=@AppVersion"></script>
<script src="~/js/storageAdapter.js?v=@AppVersion"></script>
<script src="~/js/uploadTransport.js?v=@AppVersion"></script>
<script src="~/js/versionProtocol.js?v=@AppVersion"></script>
```

**Verification:**

Run: `dotnet run --project src/RoadTripMap` then open a trip page, pick a photo, observe DevTools Network tab: `request-upload` → PUT blocks to `<storage>.blob.core.windows.net` → `commit` → photo list refresh.

**Commit:** `feat(web): wire postUI into resilient upload queue`
<!-- END_TASK_13 -->

<!-- START_TASK_14 -->
### Task 14: postUI integration test

**Verifies:** AC3.1, AC4.1, AC8.2.

**Files:**
- Create: `tests/js/postUI-upload.test.js`

**Implementation:**

`fake-indexeddb` + stubbed `fetch` that routes to mock `request-upload` → returns SAS URL → PUT block intercepted returning 201 → `commit` returns `PhotoResponse`. Construct a 1 MB `File` mock, call `postUI.onMultipleFilesSelected([file])`. Assert:
- Events fire in order `upload:created`, `upload:committed`.
- `fetch` called with correct endpoint order.
- `refreshPhotoList` (spied) called after `onEachComplete`.
- No-GPS file skips queue and goes to manual pin-drop.

**Verification:**

Run: `npm test tests/js/postUI-upload.test.js`
Expected: Pass.

**Commit:** `test(web): postUI end-to-end upload flow test`
<!-- END_TASK_14 -->
<!-- END_SUBCOMPONENT_G -->

<!-- START_SUBCOMPONENT_H (tasks 15-16) -->
## Subcomponent H: Azure Blob CORS and deploy

<!-- START_TASK_15 -->
### Task 15: Bicep CORS rule for storage account

**Verifies:** None directly — production enablement.

**Files:**
- Modify: `infrastructure/azure/main.bicep`

**Implementation:**

Add a `blobServices` child resource on the storage account with CORS properties:

```bicep
resource blobServices 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          allowedOrigins: [
            'https://roadtripmap.azurewebsites.net'
            'https://localhost:5001'
          ]
          allowedMethods: [ 'GET', 'PUT', 'HEAD', 'OPTIONS' ]
          allowedHeaders: [ '*' ]
          exposedHeaders: [ 'x-ms-*' ]
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}
```

Respect the `infra_commit_checklist.py` and `azure_sp_identity_guard.py` hooks.

**Verification:**

`az deployment group create --what-if ...` — expect exactly one new `Microsoft.Storage/storageAccounts/blobServices` resource with the CORS rule; no other changes.

**Commit:** `feat(infra): Azure Blob CORS for browser direct-upload`
<!-- END_TASK_15 -->

<!-- START_TASK_16 -->
### Task 16: Extend deployment-runbook.md with Phase 2 section

**Verifies:** None directly — operational enablement.

**Files:**
- Modify: `docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md`

**Implementation:**

Append a `## Phase 2 — Web upload rollout` section with:

1. **Pre-flight**
   - `[bash/WSL]` `gh pr list --head develop --base main --state open` — confirm exactly one open PR; review.
   - `[bash/WSL]` Confirm Phase 1 deployed and healthy via `curl /api/version`.

2. **CORS deploy**
   - `[bash/WSL]` `az storage account blob-service-properties show --account-name <acct> --query cors` — snapshot current (probably empty).
   - `[bash/WSL]` `az deployment group create --resource-group <rg> --template-file infrastructure/azure/main.bicep --parameters @... --what-if` — expect only the new `blobServices` resource.
   - `[bash/WSL]` Apply (remove `--what-if`).
   - `[bash/WSL]` CORS preflight smoke: `curl -i -X OPTIONS -H 'Origin: https://roadtripmap.azurewebsites.net' -H 'Access-Control-Request-Method: PUT' -H 'Access-Control-Request-Headers: content-length' 'https://<storage>.blob.core.windows.net/<any-container>'` — expect 200 with `Access-Control-Allow-Methods: PUT`.

3. **App Service deploy**
   - `[GitHub web]` Merge PR; CI auto-deploys via existing workflow.
   - `[bash/WSL]` Verify new static JS files served: `curl -I https://roadtripmap.azurewebsites.net/js/uploadUtils.js` → 200.

4. **Smoke tests**
   - `[Browser]` Open a real trip page, DevTools Network open. Pick one photo. Observe:
     - POST `/api/trips/{token}/photos/request-upload` → 200 with `sas_url`.
     - PUT `<storage>.blob.core.windows.net/trip-{token}/...?comp=block&blockid=...` → 201.
     - POST `/api/trips/{token}/photos/{photoId}/commit` → 200.
     - Photo appears in list after `refreshPhotoList` fires.
   - `[Browser]` Repeat with a 15 MB photo; verify 4 block PUTs.
   - `[Browser]` Mid-upload, kill the tab, reopen → pending item visible in IndexedDB (via DevTools Application → IndexedDB); call resume (Phase 3 will surface a banner; for Phase 2, user action = page reload only, the queue auto-resumes on `init`).

5. **Rollback**
   - App Service: revert deployment slot.
   - CORS: leave in place (harmless even if clients stop using it).
   - Data: in-flight uploads can be aborted via `POST /abort` per item, or left to orphan-sweep after 48 h.

6. **Sign-off** — Patrick initials each step.

**Verification:** Runbook reviewed with Patrick before Task 15 deploy.

**Commit:** `docs(uploads): deployment runbook — Phase 2 CORS + web upload rollout`
<!-- END_TASK_16 -->
<!-- END_SUBCOMPONENT_H -->

---

## Phase 2 Done When

- All 16 tasks committed.
- `npm test` green with new Vitest suites covering state-machine transitions, retry/backoff policy, persistence, SAS expiry recovery, cross-tab singleton, and version protocol.
- `az deployment group create --what-if` on Bicep shows only the CORS rule addition.
- Manual browser upload round-trip against a deployed environment succeeds end-to-end (request-upload → block PUTs → commit → refresh).
- Mid-upload tab close + reload causes pending item to auto-resume on page load.
- Deployment runbook updated and sign-off complete before apply.
