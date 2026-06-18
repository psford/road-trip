# Native iOS — Phase 6: Offline-First Upload Coordinator Implementation Plan

**Goal:** `queued` items drive end-to-end through the state machine: foreground `request-upload` (on connectivity restoration / at launch) → background 3-tier block PUTs to Azure SAS URLs → foreground `commit`. The pipeline survives offline-capture, app backgrounding, force-quit (resume on next launch), transient network drops, and SAS expiry. On success the `Photo` row lands in GRDB and the pin flips `pending → committed`; on permanent failure the pin goes red `failed` with a surfaced error.

**Architecture (the signature feature — honest about Apple's constraints):**
- **Capture is fully decoupled from network** (Phase 5 already enqueues `queued` with bytes cached, no network).
- **`UploadCoordinator`** (foreground, `@MainActor`) owns an `NWPathMonitor`; on connectivity-restored and at launch it walks `queued` + retryable `failed` items and performs the **JSON** calls (`requestUpload`, `commit`) — background sessions can't run those.
- **`BackgroundUploadSession`** — ONE `URLSession.background(withIdentifier:)`, `waitsForConnectivity = true`, **delegate-based** (background sessions forbid async/await completion + require `uploadTask(with:fromFile:)`), one task per 4 MB block.
- **`UploadReconciler`** — at launch + from `application(_:handleEventsForBackgroundURLSession:)`: re-attach to the session, advance finished tiers, call `commit`, re-`requestUpload` on 403/SAS-expiry (a background task can't refresh its own SAS).
- Force-quit is handled honestly: detect `NSURLErrorCancelledReasonUserForceQuitApplication` and **resume on next launch** (no OS background-wake promise). `BGTaskScheduler`/iOS-26 `BGContinuedProcessingTask` are explicitly out of scope.

**Stages (GRDB `UploadQueueItem.stage`, set in Phase 1):** `queued → requesting → uploadingOriginal → uploadingDisplay → uploadingThumb → committing → done | failed`. Each transition is a GRDB write.

**Tech Stack:** Foundation `URLSession` background config + delegate, Network `NWPathMonitor`, `RoadTripAPI` (Phase 2), GRDB, `StagingFileStore` (Phase 1), Azure Blob "Put Block"/"Put Block List" REST via SAS.

**Scope:** Phase 6 of 8.

**Codebase verified:** 2026-06-18.

---

## Verified facts grounding this phase (port the web state machine exactly)

Source of truth: `src/RoadTripMap/wwwroot/js/{uploadQueue.js,uploadTransport.js,uploadUtils.js}`.
- **Block size: 4 MB** (4 × 1024 × 1024).
- **Block ID: 64-byte buffer**, the block index written as a big-endian Int64 in the last 8 bytes, base64-encoded → a fixed-length 88-char base64 string (Azure requires equal-length block IDs). Port `makeBlockId(index)` from `uploadUtils.js` exactly (Uint8Array(64), Int64 at byte offset 56). Verify against `uploadUtils.js:33–46`.
- **Backoff:** `min(2^attempt * 1000, 30000) ms + jitter(0…2000)`; **max 6 retries per block**; retryable statuses `408, 429, 500, 503`; **403 ⇒ SAS expired** → refresh (re-call `request-upload`, idempotent on `uploadId`) and retry WITHOUT consuming the retry budget. Permanent (400 etc.) → fail. Port from `uploadTransport.js:77,119,177–268` + `uploadUtils.js:13–24`.
- **Azure Put Block:** `PUT {sasUrl}&comp=block&blockid={base64}` with header `x-ms-blob-type: BlockBlob`, body = raw block bytes; 201 on success. **Put Block List:** `PUT {sasUrl}&comp=blocklist`, body = `<?xml…><BlockList><Latest>{id}</Latest>…</BlockList>`. SAS auth is in the URL query — no extra auth header. (For original tier: many blocks then a block-list PUT. For display/thumb tiers: single block + block list, or a single full-file PUT — match what the server's `commit` expects; the server falls back to server-side tier generation if display/thumb blobs are absent, so **MVP may upload only the original tier** and let the server generate display/thumb, simplifying Phase 6. Decide explicitly: see Task 4.)
- **Server commit:** `POST …/commit` body `{ blockIds: [..] }` (the ORIGINAL tier's block IDs). Server validates the block list, commits the original blob, generates display/thumb if their blobs are missing, reverse-geocodes, returns `PhotoResponse`. So the native client MUST send the original block IDs; tier blobs are optional.
- **Idempotency:** `uploadId` is the correlation key; re-`requestUpload` with the same `uploadId` returns the same row/SAS — every retry/refresh/relaunch is safe.
- **Background session constraints (research):** must use `uploadTask(with:fromFile:)` (file-based; write each block to a temp file). `taskIdentifier` is NOT stable across relaunch — persist correlation via `task.taskDescription` (set it to `"{uploadId}:{tier}:{blockIndex}"`). Store the completion handler from `application(_:handleEventsForBackgroundURLSession:completionHandler:)` and call it in `urlSessionDidFinishEvents(forBackgroundURLSession:)`. `waitsForConnectivity = true` makes tasks wait for a network path instead of failing offline.
- **`NWPathMonitor`** (foreground) fires on connectivity restoration → trigger the coordinator. It does NOT drive the background session (that's automatic via `waitsForConnectivity`).
- **Force-quit detection:** in `urlSession(_:task:didCompleteWithError:)`, check `error.userInfo[NSURLErrorBackgroundTaskCancelledReasonKey] == NSURLErrorCancelledReasonUserForceQuitApplication` → leave the item in its current stage (not `failed`) for resume-on-next-launch.
- `UploadQueueItem` already has `bytesUploaded`, `blockIds`, `sasUrl/displaySasUrl/thumbSasUrl`, `blobPath`, `sasIssuedAt` to persist progress.

---

## Acceptance Criteria Coverage

### native-ios.AC3: Background upload survives app lifecycle
- **native-ios.AC3.1 Success:** start upload, background app → continues; progress visible on next foreground (from persisted state)
- **native-ios.AC3.2 Success:** start upload, force-quit → on relaunch, in-flight task resumes from last-completed-block
- **native-ios.AC3.3 Success:** SAS expires mid-upload (>2h) → coordinator re-calls `request-upload`, refreshes SAS, resumes
- **native-ios.AC3.4 Success:** block PUT fails transiently (503/drop) → retries with exponential backoff; succeeds on retry
- **native-ios.AC3.5 Failure:** commit fails permanently (500 after retries) → item stays `failed` with error message; manual retry from UI
- **native-ios.AC3.6 Edge:** all 3 tiers must be present before the Photo row is added (no half-uploaded photos visible)
  - **Deviation to confirm (see Task 4):** the design says "the native client uploads all three tiers." This phase's MVP uploads only the **original** tier and relies on the server's `commit` to generate display/thumb when their blobs are absent (CLAUDE.md: "Server always falls back to server-side tier generation when client tier blobs are absent"). AC3.6 is still satisfied because `commit` returns `PhotoResponse` only after all 3 blobs exist server-side, and the Photo row is written to GRDB only on a successful `commit`. **This narrows the design's client-uploads-3-tiers approach to original-only — a deliberate simplification, not a silent gap.** If Patrick wants true client-side 3-tier upload (e.g. to offload server CPU per the web's `Upload:ClientSideProcessingEnabled` path), Task 4 must upload display/thumb tiers too.

### native-ios.AC8: Offline-first optimistic capture (gating)
- **native-ios.AC8.1 Success:** add a photo offline → optimistic `pending` pin, bytes cached, `UploadQueueItem` at `queued`, **no network request** (stubbed transport asserts zero calls)
- **native-ios.AC8.2 Success:** connectivity returns while app in memory → `NWPathMonitor` fires; coordinator runs `request-upload` → block PUTs → `commit`; pin flips `pending → committed`, no user action
- **native-ios.AC8.3 Success:** force-quit with `queued`/in-flight items → next launch the reconciler resumes and completes
- **native-ios.AC8.6 Failure:** permanent failure → red `failed` pin with manual Retry/Discard; never silently dropped
- **native-ios.AC8.7 Edge:** queued overnight (SAS >2h stale) → on reconnect `request-upload` re-called before any block PUT

**Environment:** **Mac** (Swift build + simulator); force-quit/background final sign-off on a **real device** (screenshot).

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) — pure block protocol + state machine -->

<!-- START_TASK_1 -->
### Task 1: `BlockProtocol` — block slicing, block IDs, backoff (pure, ported from web)

**Verifies:** native-ios.AC3.4 (backoff policy)

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Upload/BlockProtocol.swift`
- Test: `ios-swift/RoadTrip/RoadTripTests/BlockProtocolTests.swift`

**Implementation (pure functions, no I/O):**
- `blockSize = 4 * 1024 * 1024`.
- `makeBlockId(_ index: Int) -> String`: 64-byte buffer, big-endian Int64 index at byte offset 56, base64-encode. Equal length for all (Azure requirement). Port `uploadUtils.js:33–46`.
- `blockCount(forSize:) -> Int`, `blockRange(index:totalSize:) -> Range<Int>`.
- `backoffDelayMs(attempt:) -> Int`: `min(pow(2,attempt)*1000, 30000) + jitter(0…2000)`. (Jitter via a seeded/injected RNG so it's testable; or expose a `baseDelayMs(attempt:)` pure fn tested separately from jitter.)
- `isRetryable(status: Int) -> Bool` → `[408,429,500,503].contains`. `isSasExpired(status: Int) -> Bool` → `status == 403`.
- `putBlockURL(sasUrl:, blockId:) -> URL` (append `comp=block&blockid=`), `blockListURL(sasUrl:) -> URL` (append `comp=blocklist`), `blockListXML(blockIds:) -> String`.

**Testing (BlockProtocolTests):**
- `makeBlockId(0)` and `makeBlockId(1)` are equal length and base64-decodable; index round-trips from the last 8 bytes.
- `blockCount` for a 10 MB size == 3 (4+4+2 MB).
- `baseDelayMs`: attempt 0 → 1000, attempt 5 → 30000 (capped).
- `isRetryable(503)==true`, `isRetryable(400)==false`, `isSasExpired(403)==true`.
- `putBlockURL`/`blockListURL` query construction; `blockListXML` emits well-formed `<BlockList><Latest>…</Latest></BlockList>`.

**Verification (Mac):** tests pass.

**Commit:** `feat(ios): BlockProtocol (4MB blocks, 64-byte block IDs, backoff) ported from web (+tests)`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: `UploadStateMachine` — pure transition function

**Verifies:** native-ios.AC3.6 (tier-completeness ordering), foundation for all AC3/AC8

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Upload/UploadStateMachine.swift`
- Test: `ios-swift/RoadTrip/RoadTripTests/UploadStateMachineTests.swift`

**Implementation (pure):**
- `enum UploadEvent { case beginRequest, gotSAS, originalTierDone, displayTierDone, thumbTierDone, beginCommit, committed, transientFailure, permanentFailure, sasExpired }`.
- `func next(_ stage: UploadStage, on event: UploadEvent) -> UploadStage?` encoding the legal sequence `queued→requesting→uploadingOriginal→uploadingDisplay→uploadingThumb→committing→done`, with `sasExpired` from any uploading stage → `requesting`, `permanentFailure` → `failed`, illegal transitions → nil. **If MVP uploads only the original tier (server generates the rest), the machine still passes through `uploadingDisplay`/`uploadingThumb` as no-op "skipped" transitions OR collapses them — decide in Task 4 and encode here consistently.** native-ios.AC3.6 ("all 3 tiers present before Photo row") is satisfied because the server `commit` guarantees all 3 blobs exist (client-uploaded or server-generated) before returning the `PhotoResponse` the client turns into a `Photo` row.

**Testing (UploadStateMachineTests):**
- Legal full path queued→…→done returns expected stages.
- `sasExpired` during `uploadingOriginal` → `requesting`.
- `permanentFailure` from any stage → `failed`.
- Illegal transition (e.g. `committed` event from `queued`) → nil.

**Verification (Mac):** tests pass.

**Commit:** `feat(ios): UploadStateMachine pure transitions (+tests)`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) — background session + coordinator + reconciler (shells) -->

<!-- START_TASK_3 -->
### Task 3: `BackgroundUploadSession` (delegate-based, file-based block PUTs)

**Verifies:** native-ios.AC3.1, native-ios.AC3.2 (the transport that survives lifecycle), native-ios.AC3.4

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Upload/BackgroundUploadSession.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/Upload/UploadProgressStore.swift`

**Implementation:**
- `final class BackgroundUploadSession: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate`:
  - One session: `URLSession(configuration: .background(withIdentifier: "com.psford.roadtripmap.native.uploads"), delegate: self, delegateQueue: nil)`; config `waitsForConnectivity = true`, `isDiscretionary = false`.
  - `enqueueBlockPUT(uploadId:, tier:, blockIndex:, sasUrl:, blockFileURL:)`: build a PUT `URLRequest` (header `x-ms-blob-type: BlockBlob`), write the block bytes to a temp file (background requires `fromFile:`), create `uploadTask(with:fromFile:)`, set `task.taskDescription = "{uploadId}:{tier}:{blockIndex}"`, `resume()`.
  - Delegate callbacks:
    - `didSendBodyData` → forward `(uploadId, bytesSent)` to `UploadProgressStore`.
    - `didCompleteWithError`: parse `taskDescription`; on success advance progress (mark that block done in GRDB `blockIds`/`bytesUploaded`); on transient/`isRetryable` schedule a retry per `BlockProtocol.backoffDelayMs`; on **403** signal the coordinator to re-`requestUpload`; on **force-quit** (`NSURLErrorCancelledReasonUserForceQuitApplication`) leave stage unchanged for relaunch; on permanent error mark `failed`. Use the HTTP status from `(task.response as? HTTPURLResponse)?.statusCode`.
    - `urlSessionDidFinishEvents(forBackgroundURLSession:)` → call the stored AppDelegate completion handler on the main queue, then clear it.
- `UploadProgressStore` (`@Observable @MainActor`): bridges delegate callbacks to SwiftUI; per-`uploadId` progress fraction; drives pin `pending → committed → failed` via the GRDB `ValueObservation` on `UploadQueueItem`/`Photo`.

**Verification (Mac):** builds; behavior verified via Tasks 4-6 on simulator/device.

**Commit:** `feat(ios): BackgroundUploadSession (delegate, file-based block PUTs) + UploadProgressStore`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: `UploadCoordinator` (NWPathMonitor + JSON calls + drive blocks)

**Verifies:** native-ios.AC8.1, native-ios.AC8.2, native-ios.AC8.7, native-ios.AC3.3, native-ios.AC3.4

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Upload/UploadCoordinator.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/Upload/TierUploadPolicy.swift` (pure: which tiers to upload)
- Test: `ios-swift/RoadTrip/RoadTripTests/UploadCoordinatorTests.swift`

**Implementation:**
- **DECISION (record in commit): MVP uploads ONLY the original tier**; the server generates display/thumb when their blobs are absent (verified server behavior). `TierUploadPolicy.tiersToUpload` returns `[.original]` for MVP. This drastically simplifies the background flow while satisfying native-ios.AC3.6 (server guarantees all 3 blobs before commit returns). Leave a documented seam to add `[.original,.display,.times]` later. (If the executor finds the server requires client tiers, revisit — but the design and CLAUDE.md both state server fallback exists.)
- `@MainActor final class UploadCoordinator`:
  - owns `NWPathMonitor` (start on init; `pathUpdateHandler` → on `.satisfied`, call `driveQueue()`).
  - `driveQueue()`: fetch `queued` + retryable `failed` `UploadQueueItem`s from GRDB. For each (serialize per item):
    1. stage → `requesting`; call `RoadTripAPI.requestUpload(uploadId:, …, secretToken:)` (secretToken from Keychain). **Always (re-)call requestUpload if `sasIssuedAt` is nil or older than ~110 min** (= the 2 h / 120 min SAS TTL minus a ~10 min safety margin, so an upload starting near the boundary doesn't 403 mid-flight) — covers native-ios.AC8.7 (overnight stale SAS) since it's idempotent. Persist the 3 SAS URLs + `blobPath` + `sasIssuedAt = now`.
    2. stage → `uploadingOriginal`; slice original from `StagingFileStore` bytes into 4 MB blocks via `BlockProtocol`; enqueue each block PUT on `BackgroundUploadSession`. (Tier policy = original only for MVP.)
    3. When all original blocks report done (via `UploadProgressStore`/GRDB), stage → `committing`; call `RoadTripAPI.commitUpload(secretToken:, photoId: uploadId, blockIds:)`.
    4. On commit success: map the returned `PhotoResponse` → a `Photo` GRDB row (`placeNamePending = false` — server reverse-geocoded), set stage → `done`, delete the staging bytes, remove the optimistic pending pin (the committed `Photo` annotation now renders). Pin flips `pending → committed`.
  - **SAS refresh (native-ios.AC3.3/native-ios.AC8.7):** when `BackgroundUploadSession` signals 403, set stage → `requesting`, re-call `requestUpload` (idempotent), update SAS, resume from the current block.
  - `retry(uploadId:)` (for Phase 7's failed-pin Retry) and the launch-time drive are public.
- **No network at capture:** the coordinator is the ONLY component that calls `RoadTripAPI` for uploads; Phase 5's capture path has no API dependency — so native-ios.AC8.1's "zero network calls at capture" is structurally guaranteed and asserted by a stubbed transport in tests.

**Testing (UploadCoordinatorTests — stubbed `RoadTripAPI` + a fake transport recording calls; in-memory GRDB; no real network/background session — inject a protocol-abstracted "block sink"):**
- native-ios.AC8.1: enqueue a `queued` item with `NWPathMonitor` reporting offline → `driveQueue()` makes **zero** `RoadTripAPI` calls (assert the stub's call count == 0).
- native-ios.AC8.2: flip the monitor to online → coordinator calls `requestUpload` then (after fake blocks complete) `commitUpload`; a `Photo` row appears; the `UploadQueueItem` stage reaches `done`; the pending pin is replaced by a committed one.
- native-ios.AC8.7/native-ios.AC3.3: an item with `sasIssuedAt` 3 hours ago → `requestUpload` is called before any block PUT; a simulated 403 mid-upload → `requestUpload` re-called, retry resumes (assert no retry-budget consumed).
- native-ios.AC3.4: a simulated 503 on a block → retried per backoff, then succeeds.

**Verification (Mac, simulator):** capture offline (Phase 5), toggle the simulator's network on → the pin flips pending→committed automatically with no user action (native-ios.AC8.2). Screenshot.

**Commit:** `feat(ios): UploadCoordinator (NWPathMonitor, request-upload/commit, SAS refresh, original-tier MVP) (+tests, native-ios.AC8.1/8.2/8.7/3.3/3.4)`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: `UploadReconciler` + `AppDelegate` background wiring (force-quit resume)

**Verifies:** native-ios.AC3.1, native-ios.AC3.2, native-ios.AC8.3, native-ios.AC3.5/native-ios.AC8.6 (failure persistence)

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Upload/UploadReconciler.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/App/AppDelegate.swift`
- Modify: `ios-swift/RoadTrip/RoadTrip/App/RoadTripApp.swift` (`@UIApplicationDelegateAdaptor` + drive reconciler at launch)
- Test: `ios-swift/RoadTrip/RoadTripTests/UploadReconcilerTests.swift`

**Implementation:**
- `AppDelegate: NSObject, UIApplicationDelegate` implementing `application(_:handleEventsForBackgroundURLSession:completionHandler:)` → store the completion handler where `BackgroundUploadSession` can call it in `urlSessionDidFinishEvents`, and ensure the background session singleton is recreated (re-attached) with the same identifier. Wire via `@UIApplicationDelegateAdaptor(AppDelegate.self)` in `RoadTripApp`.
- `UploadReconciler.reconcileAtLaunch()`: on app start, (1) re-attach to the background session (recreating it with the same identifier re-delivers outstanding delegate events), (2) for items mid-flight whose blocks all completed while suspended → advance to `committing` and call `commit`, (3) for `queued`/partially-uploaded items, hand to `UploadCoordinator.driveQueue()` if online (native-ios.AC8.3 force-quit resume), (4) detect items whose SAS is stale and re-`requestUpload`.
- **Failure persistence (native-ios.AC3.5/native-ios.AC8.6):** when a block exhausts its 6 retries OR commit returns a permanent 500, set stage `failed` + `errorMessage`; NEVER delete the staging bytes for a `failed` item (so Retry works) and NEVER drop the row (so the photo is never silently lost). The red `failed` pin + Retry/Discard UI is Phase 7, but the persistence guarantee is implemented here.
- Drive `reconcileAtLaunch()` from `RoadTripApp`'s root `.task`.

**Testing (UploadReconcilerTests, in-memory GRDB + stubs):**
- native-ios.AC8.3: an item left at `uploadingOriginal` with all blocks recorded done (simulating completion-while-suspended) → reconcile advances to `committing`, calls commit, reaches `done`.
- An item at `queued` after "relaunch" with online monitor → driveQueue resumes it.
- native-ios.AC3.5/native-ios.AC8.6: a commit stub returning permanent 500 after retries → item ends `failed` with `errorMessage`, staging bytes still present, row still present.

**Verification (Mac + REAL DEVICE for final sign-off):**
- Simulator: relaunch resumes a `queued` item (native-ios.AC8.3).
- **Real device (design-mandated):** start an upload, background the app → it completes; start an upload, force-quit → on relaunch it resumes from the last completed block (native-ios.AC3.1/native-ios.AC3.2). Screenshot of the committed pin after each.

**Commit:** `feat(ios): UploadReconciler + AppDelegate background wiring (force-quit resume, failure persistence) (+tests, native-ios.AC3.1/3.2/3.5/8.3/8.6)`
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

---

## Phase Done When
A photo captured offline (Phase 5) auto-uploads end-to-end against the dev slot once connectivity returns — all blocks PUT, `commit` succeeds, the `Photo` row appears, the pin flips `pending → committed` (native-ios.AC8.2). Tests cover: offline capture makes zero network calls (native-ios.AC8.1); reconnect via `NWPathMonitor` fires the queue (native-ios.AC8.2); backgrounded upload completes (native-ios.AC3.1); force-quit + relaunch resumes (native-ios.AC3.2/native-ios.AC8.3); stale/overnight SAS re-mints before block PUT (native-ios.AC8.7/native-ios.AC3.3); simulated 503 retries with backoff (native-ios.AC3.4); commit permanent-failure → `failed` + surfaced error, staging bytes + row retained (native-ios.AC3.5/native-ios.AC8.6); the server's commit guarantees all 3 tiers before the Photo row is written (native-ios.AC3.6). **Final force-quit/background sign-off on a real device (screenshot)** (Mac + device).
