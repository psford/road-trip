# Resilient Uploads — Test Requirements

Maps every acceptance criterion in `docs/design-plans/2026-04-13-resilient-uploads.md` to either an automated test or a documented human verification activity. Every AC is covered; the coverage matrix at the bottom confirms no gaps.

## Conventions

- "Phase X / Task N" refers to the phase implementation files in this directory.
- Backend tests use xUnit + `WebApplicationFactory`; an Azurite docker container started by `tests/RoadTripMap.Tests/Infrastructure/AzuriteFixture.cs` (Phase 1 Task 5) is the integration substrate. Production uses User-Delegation SAS via `BlobServiceClient.GetUserDelegationKeyAsync`; tests use `AccountKeySasIssuer` with `StorageSharedKeyCredential` because Azurite does not implement user delegation keys (Phase 1 Task 4 decision).
- Web client tests use Vitest + jsdom + `fake-indexeddb` (`tests/js/setup.js`). End-to-end web tests use Playwright (`tests/playwright/`).
- iOS native tests use XCTest under `ios/App/AppTests/`; iOS device-matrix scenarios are human-verified by design and recorded in `phase-5-device-smoke.md`, `phase-6-device-matrix.md`, `phase-7-tester-feedback.md`.
- The Phase 3 UI is gated by `FeatureFlags:ResilientUploadsUI`. Phase 3 Task 11 wires the flag; the Playwright suite (Phase 3 Task 12) covers flag-on; legacy/flag-off behavior is covered by the pre-existing UI tests that remain green until Phase 4 Task 7 removes the flag.

---

## 1. Summary Table

| AC | Method | Phase / Task | Owner |
|---|---|---|---|
| AC1.1 | Automated (integration, xUnit + Azurite) | Phase 1 / Tasks 5, 16 | Backend |
| AC1.2 | Automated (integration, xUnit + Azurite) | Phase 1 / Tasks 5, 16 | Backend |
| AC1.3 | Automated (unit + integration) | Phase 1 / Tasks 5, 16 | Backend |
| AC1.4 | Automated (unit + integration) | Phase 1 / Tasks 5, 16 | Backend |
| AC1.5 | Automated (integration, expired SAS) | Phase 1 / Tasks 5, 16 | Backend |
| AC1.6 | Automated (unit + integration) | Phase 1 / Tasks 5, 16 | Backend |
| AC1.7 | Automated (integration, 15 MB synthetic) | Phase 1 / Tasks 5, 16 | Backend |
| AC2.1 | Automated (Azurite integration) | Phase 1 / Task 8 | Backend |
| AC2.2 | Automated (Azurite integration, idempotency) | Phase 1 / Task 8 | Backend |
| AC2.3 | Automated (unit, mixed-tier seed) | Phase 1 / Task 10 | Backend |
| AC2.4 | Automated (Azurite integration) | Phase 1 / Task 8 | Backend |
| AC2.5 | Automated (unit, invalid name) | Phase 1 / Task 8 | Backend |
| AC2.6 | Automated (unit, zero-photo trip) | Phase 1 / Task 10 | Backend |
| AC3.1 | Automated (Vitest state-machine) + e2e | Phase 2 / Task 9; Phase 3 / Task 12 | Web |
| AC3.2 | Automated (Vitest with fake timers) + e2e throttled | Phase 2 / Task 7; Phase 4 / Task 3 | Web |
| AC3.3 | Automated (Vitest with fake timers) | Phase 2 / Tasks 7, 9 | Web |
| AC3.4 | Automated (Vitest semaphore) | Phase 2 / Tasks 2, 3 | Web |
| AC3.5 | Automated (Vitest fetch stubs) + e2e | Phase 2 / Task 7; Phase 4 / Task 3 | Web |
| AC4.1 | Automated (Vitest persistence) + e2e + human acceptance | Phase 2 / Task 9; Phase 3 / Task 12; Phase 4 / Task 5 | Web |
| AC4.2 | Automated (Vitest resume) + e2e | Phase 2 / Task 9; Phase 3 / Task 12 | Web |
| AC4.3 | Automated (Vitest discardAll) + e2e | Phase 2 / Task 9; Phase 3 / Task 12 | Web |
| AC4.4 | Automated (Vitest, simulated 7-day stale) | Phase 2 / Task 9 | Web |
| AC4.5 | Automated (Vitest cross-tab BroadcastChannel mock) | Phase 2 / Task 9 | Web |
| AC5.1 | Automated (Vitest progressPanel) + e2e | Phase 3 / Tasks 4, 12 | Web |
| AC5.2 | Automated (Vitest panel actions) + e2e | Phase 3 / Tasks 4, 12 | Web |
| AC5.3 | Automated (Vitest postUI failure routing) + e2e | Phase 3 / Tasks 4, 10, 12 | Web |
| AC5.4 | Automated (Vitest progressPanel "gave up") + e2e | Phase 3 / Tasks 4, 12 | Web |
| AC5.5 | Automated (Vitest sessionStorage round-trip) | Phase 3 / Task 4 | Web |
| AC6.1 | Automated (xUnit OrphanSweeperTests) | Phase 1 / Task 12 | Backend |
| AC6.2 | Automated (xUnit OrphanSweeperTests) | Phase 1 / Task 12 | Backend |
| AC6.3 | Automated (xUnit OrphanSweeperTests, double-run) | Phase 1 / Task 12 | Backend |
| AC7.1 | Automated (Vitest optimisticPins) + e2e + iOS device | Phase 3 / Tasks 9, 12; Phase 6 / Task 8 | Web + iOS |
| AC7.2 | Automated (Vitest optimisticPins) + e2e | Phase 3 / Tasks 9, 12 | Web |
| AC7.3 | Automated (Vitest optimisticPins) + e2e | Phase 3 / Tasks 9, 12 | Web |
| AC7.4 | Automated (Vitest optimisticPins) | Phase 3 / Task 9 | Web |
| AC7.5 | Automated (Vitest optimisticPins) + e2e | Phase 3 / Tasks 9, 12 | Web |
| AC8.1 | Automated (xUnit middleware integration) | Phase 1 / Task 14 | Backend |
| AC8.2 | Automated (Vitest versionProtocol) + e2e + iOS device | Phase 2 / Task 12; Phase 3 / Task 12; Phase 5 / Task 11 | Web + iOS |
| AC8.3 | Automated (Vitest versionProtocol missing-headers) | Phase 2 / Task 12 | Web |
| AC9.1 | Automated (Vitest bootstrap-loader) + iOS device | Phase 5 / Tasks 9, 11 | iOS |
| AC9.2 | Automated (Vitest bootstrap-loader) + iOS device | Phase 5 / Tasks 9, 11 | iOS |
| AC9.3 | Automated (Vitest bootstrap-loader) + iOS device | Phase 5 / Tasks 9, 11 | iOS |
| AC9.4 | Automated (Vitest bootstrap-loader) + iOS device | Phase 5 / Tasks 9, 11 | iOS |
| AC9.5 | Automated (Vitest bootstrap-loader) + iOS device | Phase 5 / Tasks 9, 11 | iOS |
| AC10.1 | Human (iOS device, no-flash visual) | Phase 5 / Task 11 | iOS |
| AC10.2 | Human (iOS device, redeploy + relaunch) | Phase 5 / Task 11 | iOS |
| AC11.1 | Automated (XCTest plugin unit) + iOS device matrix | Phase 6 / Tasks 5, 8 | iOS |
| AC11.2 | Automated (XCTest UserDefaults round-trip) + iOS device matrix | Phase 6 / Tasks 5, 8 | iOS |
| AC11.3 | Human (iOS device, az-cli synthetic 7-day) | Phase 6 / Task 8 | iOS |
| AC11.4 | Human (iOS device, Network Link Conditioner) | Phase 6 / Tasks 5, 8 | iOS |
| AC12.1 | Automated (XCTest HEIC fixture) + iOS device matrix | Phase 6 / Tasks 6, 8 | iOS |
| AC12.2 | Automated (XCTest JPEG fixture) + iOS device matrix | Phase 6 / Tasks 6, 8 | iOS |
| AC12.3 | Automated (XCTest no-EXIF fixture) + iOS device matrix | Phase 6 / Tasks 6, 8 | iOS |
| AC12.4 | Automated (XCTest malformed fixture) | Phase 6 / Task 6 | iOS |
| ACX.1 | Automated (xUnit log capture) | Phase 1 / Task 16 | Backend |
| ACX.2 | Automated (Vitest no-silent-failures audit) + human acceptance | Phase 4 / Tasks 2, 5; Phase 7 / Task 5 | Web + iOS |
| ACX.3 | Automated (xUnit dual-read snapshot) + human regression smoke | Phase 1 / Task 10; Phase 4 / Task 6; Phase 7 / Task 7 | Backend + Patrick |
| ACX.4 | Human (UI design review with Patrick) | Phase 3 / Task 2 | Patrick |

---

## 2. Automated Tests — Details

### AC1: Direct-to-blob upload pipeline

**AC1.1 happy path**
- Type: integration (xUnit + Azurite + account-key SAS)
- File: `tests/RoadTripMap.Tests/Endpoints/UploadEndpointTests.cs` (Phase 1 Task 5 + Task 16)
- Assertions: `request-upload` returns 200 with `photo_id`, `sas_url`, `blob_path`; PUT 4 blocks succeeds against returned SAS; `commit` returns 200 + `PhotoResponse`; DB row `status='committed'`; blob exists in Azurite container `trip-{token}` at expected length.

**AC1.2 batch of 20 concurrent**
- Type: integration
- File: `tests/RoadTripMap.Tests/Endpoints/UploadEndpointTests.cs`
- Assertions: `Parallel.ForEachAsync` with 5-way concurrency over 20 photos completes; 20 distinct `photos` rows, all `committed`; no DB deadlock or duplicate-row exceptions.

**AC1.3 idempotent request-upload**
- Type: unit (`UploadServiceTests.cs`) + integration (`UploadEndpointTests.cs`)
- Files: `tests/RoadTripMap.Tests/Services/UploadServiceTests.cs`, `tests/RoadTripMap.Tests/Endpoints/UploadEndpointTests.cs` (Phase 1 Task 5)
- Assertions: second call with same `upload_id` returns identical `photo_id`; new SAS URL issued; `photos` row count unchanged.

**AC1.4 commit rejects mismatched block list**
- Type: unit + integration
- Files: same as AC1.3
- Assertions: when `commit` block_ids include an ID Azure has no record of, response is HTTP 400 with body `{ code: "BlockListMismatch", missing: [...] }`.

**AC1.5 SAS expiry returns 403**
- Type: integration (Azurite)
- File: `tests/RoadTripMap.Tests/Endpoints/UploadEndpointTests.cs`
- Assertions: `request-upload` issued with 1-second TTL via test-only `ISasTokenIssuer` knob; sleep 2 s; PUT block returns 403 from Azurite.

**AC1.6 cross-trip commit rejected**
- Type: unit + integration
- Files: same as AC1.3
- Assertions: create trips A and B; `commit` against trip B with a `photo_id` from trip A returns 404 (or 403); DB unchanged.

**AC1.7 15 MB ceiling**
- Type: integration
- File: `tests/RoadTripMap.Tests/Endpoints/UploadEndpointTests.cs`
- Assertions: 15 MB synthetic buffer split into 4 ~4 MB blocks uploads + commits; final `blob.Length == 15 * 1024 * 1024`.

### AC2: Per-trip container provisioning and dual-read

**AC2.1 eager provisioning on trip create**
- Type: integration (Azurite)
- File: `tests/RoadTripMap.Tests/Services/BlobContainerProvisionerTests.cs` (Phase 1 Task 8)
- Assertions: after `POST /api/trips`, container `trip-{secretToken.ToLowerInvariant()}` exists.

**AC2.2 backfill is idempotent**
- Type: integration
- File: `tests/RoadTripMap.Tests/Services/BlobContainerProvisionerTests.cs`
- Assertions: invoke backfill startup hosted-service entry point twice; both runs succeed; no exception on existing containers; final container set equals expected set.

**AC2.3 dual-read mixed response**
- Type: unit (in-memory EF Sqlite)
- File: `tests/RoadTripMap.Tests/Services/PhotoReadServiceTests.cs` (Phase 1 Task 10)
- Assertions: seed 2 legacy + 2 per-trip rows; response contains 4 entries; legacy URLs point to `road-trip-photos/{tripId}/{photoId}`, per-trip URLs point to `trip-{token}/{photoId}_*.jpg`.

**AC2.4 trip delete removes per-trip container + legacy blobs**
- Type: integration (Azurite)
- File: `tests/RoadTripMap.Tests/Services/BlobContainerProvisionerTests.cs`
- Assertions: after `DELETE /api/trips/{token}`, per-trip container does not exist; any legacy blobs under `road-trip-photos/{tripId}/` are deleted.

**AC2.5 invalid container name**
- Type: unit
- File: `tests/RoadTripMap.Tests/Services/BlobContainerProvisionerTests.cs`
- Assertions: passing a token that produces a non-conforming name throws `InvalidContainerNameException` with a clear message.

**AC2.6 zero-photo trip renders**
- Type: unit
- File: `tests/RoadTripMap.Tests/Services/PhotoReadServiceTests.cs`
- Assertions: empty list returned, 200 OK, no exception. Snapshot baseline frozen for ACX.3 regression coverage.

### AC3: Upload state machine and retry

**AC3.1 ordered state transitions**
- Type: unit (Vitest + fake-indexeddb) + e2e (Playwright)
- Files: `tests/js/uploadQueue.test.js` (Phase 2 Task 9), `tests/playwright/resilient-uploads.spec.js` (Phase 3 Task 12)
- Assertions: events fire in order `pending → requesting → uploading → committing → committed`; final DB row status `committed`.

**AC3.2 exponential backoff retry**
- Type: unit (Vitest + `vi.useFakeTimers()`) + e2e throttled
- Files: `tests/js/uploadTransport.test.js` (Phase 2 Task 7), `tests/playwright/resilient-uploads.spec.js` (Phase 4 Task 3)
- Assertions: block returns 503 twice then 201; total wait advances per `min(2^n * 1000, 30000) + jitter`; succeeds on 3rd attempt; structured telemetry shows `retryCount >= 1`.

**AC3.3 fail after 6 attempts**
- Type: unit
- File: `tests/js/uploadTransport.test.js`, `tests/js/uploadQueue.test.js`
- Assertions: after 6 consecutive 503 responses, transport throws; `uploadQueue` flips item to `failed` with `last_error` populated; exactly 6 attempts recorded.

**AC3.4 concurrency caps**
- Type: unit
- File: `tests/js/uploadSemaphore.test.js` (Phase 2 Task 3)
- Assertions: with 9 enqueued tasks, in-flight count never exceeds 9 globally; per-file semaphore caps at 3; per-photo cap at 3.

**AC3.5 SAS expiration mid-upload**
- Type: unit + e2e
- Files: `tests/js/uploadTransport.test.js`, `tests/playwright/resilient-uploads.spec.js`
- Assertions: 403 from PUT triggers `onSasExpired(uploadId)` callback; new SAS used on retry; previously-`done` blocks not re-uploaded.

### AC4: Queue persistence and resume

**AC4.1 queue survives tab close**
- Type: unit + e2e + human
- Files: `tests/js/uploadQueue.test.js` (Phase 2 Task 9), `tests/playwright/resilient-uploads.spec.js` (Phase 3 Task 12), `phase-4-acceptance.md` (Phase 4 Task 5)
- Assertions (unit): start 3 items, abandon awaits, instantiate a second queue, call `resume(token)`; all 3 finish `committed`. (e2e): `page.context().close()`, new page, banner appears with correct count. (Human): real Patrick close-tab session.

**AC4.2 Resume continues from partial blocks**
- Type: unit + e2e
- Files: same as AC4.1
- Assertions: seed item with `block_state` 2-of-4 `done`; `resume` invokes transport only for 2 pending blocks.

**AC4.3 Discard all → aborted**
- Type: unit + e2e
- Files: same as AC4.1
- Assertions: `discardAll(token)` flips non-terminal items to `aborted`, calls `API.abort` per item, removes DB rows; banner clears.

**AC4.4 stale uncommitted blocks (>7 days)**
- Type: unit
- File: `tests/js/uploadQueue.test.js`
- Assertions: simulate `commit` returning 400 `BlockListMismatch` despite all local blocks `done`; queue resets blocks to `pending`, re-issues `request-upload`, re-uploads, second commit succeeds. Reset is capped at 1 attempt — second mismatch transitions to `failed`.

**AC4.5 cross-tab singleton**
- Type: unit
- File: `tests/js/uploadQueue.test.js`
- Assertions: two `UploadQueue` instances + mocked `BroadcastChannel`; only one calls `API.requestUpload` per `upload_id`.

### AC5: Per-file progress UI and pin-drop fallback

(Phase 3 Task 12 Playwright covers all five at the e2e layer; Vitest covers unit-level rendering.)

**AC5.1 per-file row**
- Files: `tests/js/progressPanel.test.js` (Phase 3 Task 4), `tests/playwright/resilient-uploads.spec.js` (Task 12)
- Assertions: dispatching `upload:created` events renders one row per item with filename, size, status icon; live progress updates on `upload:progress`.

**AC5.2 retry button on failed row**
- Files: same
- Assertions: on `upload:failed` (non-exhausted), `[↻ retry]` visible and click invokes `UploadQueue.retry(uploadId)`.

**AC5.3 pin-drop fallback for GPS-tagged failure**
- Files: `tests/js/progressPanel.test.js`, `tests/js/postUI-failure-routing.test.js` (Phase 3 Task 10), `tests/playwright/resilient-uploads.spec.js`, plus backend pin-drop test in `tests/RoadTripMap.Tests/Endpoints/UploadEndpointTests.cs` (Phase 3 Task 7)
- Assertions: `[📍 Pin manually instead]` visible only when `exif.gps` exists; click routes via `PostUI.manualPinDropFor` → `API.pinDropPhoto`; backend endpoint accepts and persists.

**AC5.4 max-attempt copy**
- Files: `tests/js/progressPanel.test.js`, e2e
- Assertions: `upload:failed` with `reason: 'retryExhausted'` renders "gave up after 6 attempts"; retry button hidden.

**AC5.5 collapsible + persistence**
- Files: `tests/js/progressPanel.test.js`
- Assertions: collapse toggle writes `sessionStorage[upload-panel:${tripToken}:collapsed]`; re-mount restores state.

### AC6: Orphan cleanup

**AC6.1, 6.2, 6.3**
- Type: unit (xUnit, in-memory EF Sqlite, injected `utcNow`)
- File: `tests/RoadTripMap.Tests/BackgroundJobs/OrphanSweeperTests.cs` (Phase 1 Task 12)
- Assertions: 6.1 — pending row `last_activity_at = utcNow - 49h` deleted. 6.2 — committed row aged 365 days retained. 6.3 — second `SweepAsync` deletes 0 rows; final DB state identical.

### AC7: Optimistic photo placement

**AC7.1 pending pin within 1 s**
- Type: unit + e2e + iOS device
- Files: `tests/js/optimisticPins.test.js` (Phase 3 Task 9), `tests/playwright/resilient-uploads.spec.js`, `phase-6-device-matrix.md`
- Assertions: dispatch `upload:created` with GPS → MapLibre `Marker` created with class `photo-pin--pending` at correct coords.

**AC7.2 pending → committed flip**
- Files: `tests/js/optimisticPins.test.js`, e2e
- Assertions: `upload:committed` event swaps marker class to `photo-pin--committed`; popup HTML now reflects real photo response.

**AC7.3 failure → red pin with affordances**
- Files: `tests/js/optimisticPins.test.js`, e2e
- Assertions: `upload:failed` swaps class to `photo-pin--failed`; popup contains [Retry], [Discard], [Pin elsewhere] buttons wired to UploadQueue/PostUI.

**AC7.4 no GPS → no pin**
- File: `tests/js/optimisticPins.test.js`
- Assertions: `upload:created` without `exif.gps` does not create a marker.

**AC7.5 discard removes pin**
- Files: `tests/js/optimisticPins.test.js`, e2e
- Assertions: `upload:aborted` removes marker from map.

### AC8: Version protocol

**AC8.1 headers on every response**
- Type: integration
- File: `tests/RoadTripMap.Tests/Middleware/ServerVersionMiddlewareTests.cs` (Phase 1 Task 14)
- Assertions: hit several endpoints (incl. `/api/version` and upload endpoints from Task 16); every response carries `x-server-version` and `x-client-min-version` non-empty.

**AC8.2 client below min triggers reload alert**
- Type: unit + e2e + iOS device
- Files: `tests/js/versionProtocol.test.js` (Phase 2 Task 12), `tests/playwright/resilient-uploads.spec.js`, `phase-5-device-smoke.md`
- Assertions: meta `client-version=1.0.0` + response header `x-client-min-version: 1.1.0` → `dispatchReload` event fires once across multiple requests.

**AC8.3 missing headers do not crash**
- Type: unit
- File: `tests/js/versionProtocol.test.js`
- Assertions: response without version headers — no exception thrown, no event fired, fetch result returned unchanged.

### AC9: Capacitor bootstrap (unit)

All AC9.1–9.5 are covered automatically by `tests/js/bootstrap-loader.test.js` (Phase 5 Task 9) which loads `src/bootstrap/loader.js` into a controlled jsdom scope with `fake-indexeddb` + stubbed `fetch`. The same five scenarios are re-verified on real iPhone (human) — see section 3.

- AC9.1: no cache + fetch OK → manifest + 3 file fetches; IndexedDB populated; `<script>` + `<style>` injected.
- AC9.2: cache present + `fetch` rejects → cached bundle injected; no network call.
- AC9.3: manifest version differs from cached → re-fetch; cache replaced.
- AC9.4: no cache + fetch rejects → `fallback.html` injected.
- AC9.5: `client_min_version > cached.version` → `alert` called once; re-fetch happens.

### AC11: Native background uploads (unit)

**AC11.1, 11.2** — XCTest in `ios/App/AppTests/BackgroundUploadPluginTests.swift` (Phase 6 Task 5).
- AC11.1: stub `URLSession` via protocol injection; `enqueue` stores task↔uploadId map in UserDefaults; delegate `didCompleteWithError = nil` + 201 → `blockCompleted` notification fires on JS bridge.
- AC11.2: re-instantiate plugin; orphaned `UserDefaults` mappings → `blockFailed kind: "retryable"` emitted so JS queue resumes.

(AC11.3 and 11.4 are device-only; see section 3.)

### AC12: Native EXIF (unit)

XCTest in `ios/App/AppTests/NativeExifPluginTests.swift` (Phase 6 Task 6) using `ios/App/AppTests/Fixtures/`.
- AC12.1: HEIC fixture with known GPS → coords within tolerance.
- AC12.2: JPEG fixture compared to exifr-precomputed reference.
- AC12.3: no-EXIF fixture → `{ gps: null, takenAt: null }`.
- AC12.4: corrupted-header fixture → no crash; warning logged; nulls returned.

### ACX cross-cutting (automated portions)

**ACX.1 log sanitization**
- Type: integration log capture
- File: `tests/RoadTripMap.Tests/Endpoints/UploadEndpointTests.cs` (Phase 1 Task 16)
- Assertions: capture all log records during a full round trip; assert no record contains the SAS URL string, full blob path, or any GPS coordinate value. Web-side `redactSasForLog` covered by `tests/js/uploadUtils.test.js` (Phase 2 Task 3) — strips `sig=` and `se=`, preserves other params.

**ACX.2 no silent failures (audit)**
- Type: parameterized unit
- File: `tests/js/no-silent-failures.test.js` (Phase 4 Task 2)
- Assertions: every known error branch in `uploadQueue.js`, `uploadTransport.js`, `versionProtocol.js`, `storageAdapter.js`, `progressPanel.js` either dispatches a user-visible event or emits a structured telemetry record. `vi.spyOn` counts; any silent branch fails the suite.

**ACX.3 legacy regression**
- Type: unit snapshot + Playwright smoke + human
- Files: `tests/RoadTripMap.Tests/Services/PhotoReadServiceTests.cs` (Phase 1 Task 10) snapshots an all-legacy response; `tests/playwright/resilient-uploads.spec.js` includes a legacy-trip happy-path; Phase 4 Task 6 legacy-trip audit script; Phase 7 Task 7 final regression smoke.

---

## 3. Human Verification — Details

### AC10: iOS-specific CSS

**AC10.1 platform-ios class set before paint, no flash**
- Verification: Phase 5 Task 11 device smoke. Bootstrap sets `body.classList.add('platform-ios')` synchronously before injecting CSS. Verified visually on real iPhone — no flash of unstyled content during cold launch. Recorded in `phase-5-device-smoke.md`.
- Why not automated: visual flash detection is unreliable in jsdom and Capacitor simulator differs subtly from real WebKit timing; the unit test in `bootstrap-loader.test.js` verifies the class is set before `inject()` is called but cannot prove "before paint" on real hardware.

**AC10.2 ios.css redeploy reflected on next launch**
- Verification: Phase 5 Task 11. Edit `wwwroot/ios.css`, run `npm run build:bundle`, deploy, terminate iOS app, relaunch with internet — observe the change. Recorded in `phase-5-device-smoke.md`.
- Why not automated: requires real Azure deploy + real device launch cycle; the cache-bust path itself is unit-tested via AC9.3.

### AC11: Native background uploads (device-only scenarios)

**AC11.3 7-day uncommitted-block expiry restart**
- Verification: Phase 6 Task 8 device matrix. Synthetic recipe: start upload, then `az storage blob delete` the uncommitted block(s), then resume — plugin restarts from block 0 and completes. Real 7-day wait is impractical. Recorded in `phase-6-device-matrix.md`.
- Why not automated: requires real Azure + iOS coordination; the JS-layer equivalent (AC4.4) is already covered by Vitest with simulated 400 response.

**AC11.4 offline drain**
- Verification: Phase 6 Task 8 device matrix. iPhone Airplane Mode on → queue 5 photos via PHPicker → Airplane Mode off → uploads complete without user interaction. Recorded in `phase-6-device-matrix.md`.
- Why not automated: requires Network Link Conditioner toggling on a physical device; XCTest cannot meaningfully assert the OS-level `URLSession` background scheduling.

### AC12: Native EXIF (device validation)

The XCTest fixtures cover all four ACs in unit form. Phase 6 Task 8 also re-runs scenarios 12.1, 12.2, and 12.3 on a real iPhone with the user's actual photo library to catch fixture/library divergence. AC12.4 has no device test (malformed real photos rare; XCTest fixture is authoritative).

### ACX.2 No silent failures (real-world)

- Phase 4 Task 5 Patrick acceptance session and Phase 7 Task 5 tester TestFlight session. These complement the automated `no-silent-failures.test.js` audit by exercising real network conditions where unforeseen branches may surface.
- Recorded in `phase-4-acceptance.md` and `phase-7-tester-feedback.md`.

### ACX.3 Legacy trip regression (real-world)

- Phase 7 Task 7: Patrick smokes a known legacy trip in production after all iOS work lands; confirms photos render and behave identically to pre-rollout. Complements the unit snapshot in `PhotoReadServiceTests.cs`.

### ACX.4 UI design review with Patrick

- Verification: Phase 3 Task 2. Hard gate before Tasks 3, 5, 8 may proceed. Patrick reviews ASCII/text mockups for progress panel, resume banner, optimistic-pin states, failure popup. Approval recorded in `ui-review-notes.md` with explicit "Approved on YYYY-MM-DD by Patrick" line.
- Why not automated: the AC explicitly states "architectural AC, not testable in code." This is a process gate, enforced by the ordering rules in the phase document.

### AC4.1 (human portion)

Phase 4 Task 5 Patrick acceptance session includes a real "close the tab mid-batch and re-open" exercise on the real production app on Patrick's laptop, complementing the unit + Playwright coverage. Recorded in `phase-4-acceptance.md`.

### AC9 / AC8.2 device validation (overlay on automated)

The AC9 series is fully unit-tested via `bootstrap-loader.test.js`, but Phase 5 Task 11 device smoke re-verifies all five on a physical iPhone via TestFlight, since cache, IndexedDB, and `URLProtocol` behavior differ between jsdom and WebKit. Recorded in `phase-5-device-smoke.md`. AC8.2 mid-session reload is also re-validated on device.

---

## 4. Coverage Matrix

Every AC from the design document appears below with at least one verification entry. Counts: 12 AC categories + 1 cross-cutting = 13 categories; 51 numbered acceptance criteria. All 51 are covered.

| # | AC ID | Automated coverage | Human coverage |
|---|---|---|---|
| 1 | AC1.1 | Yes (Phase 1 T5+T16) | — |
| 2 | AC1.2 | Yes (Phase 1 T5+T16) | — |
| 3 | AC1.3 | Yes (Phase 1 T5+T16) | — |
| 4 | AC1.4 | Yes (Phase 1 T5+T16) | — |
| 5 | AC1.5 | Yes (Phase 1 T5+T16) | — |
| 6 | AC1.6 | Yes (Phase 1 T5+T16) | — |
| 7 | AC1.7 | Yes (Phase 1 T5+T16) | — |
| 8 | AC2.1 | Yes (Phase 1 T8) | — |
| 9 | AC2.2 | Yes (Phase 1 T8) | — |
| 10 | AC2.3 | Yes (Phase 1 T10) | — |
| 11 | AC2.4 | Yes (Phase 1 T8) | — |
| 12 | AC2.5 | Yes (Phase 1 T8) | — |
| 13 | AC2.6 | Yes (Phase 1 T10) | — |
| 14 | AC3.1 | Yes (Phase 2 T9, Phase 3 T12) | — |
| 15 | AC3.2 | Yes (Phase 2 T7, Phase 4 T3) | — |
| 16 | AC3.3 | Yes (Phase 2 T7+T9) | — |
| 17 | AC3.4 | Yes (Phase 2 T2+T3) | — |
| 18 | AC3.5 | Yes (Phase 2 T7, Phase 4 T3) | — |
| 19 | AC4.1 | Yes (Phase 2 T9, Phase 3 T12) | Phase 4 T5 |
| 20 | AC4.2 | Yes (Phase 2 T9, Phase 3 T12) | — |
| 21 | AC4.3 | Yes (Phase 2 T9, Phase 3 T12) | — |
| 22 | AC4.4 | Yes (Phase 2 T9) | — |
| 23 | AC4.5 | Yes (Phase 2 T9) | — |
| 24 | AC5.1 | Yes (Phase 3 T4+T12) | — |
| 25 | AC5.2 | Yes (Phase 3 T4+T12) | — |
| 26 | AC5.3 | Yes (Phase 3 T4+T7+T10+T12) | — |
| 27 | AC5.4 | Yes (Phase 3 T4+T12) | — |
| 28 | AC5.5 | Yes (Phase 3 T4) | — |
| 29 | AC6.1 | Yes (Phase 1 T12) | — |
| 30 | AC6.2 | Yes (Phase 1 T12) | — |
| 31 | AC6.3 | Yes (Phase 1 T12) | — |
| 32 | AC7.1 | Yes (Phase 3 T9+T12) | Phase 6 T8 |
| 33 | AC7.2 | Yes (Phase 3 T9+T12) | — |
| 34 | AC7.3 | Yes (Phase 3 T9+T12) | — |
| 35 | AC7.4 | Yes (Phase 3 T9) | — |
| 36 | AC7.5 | Yes (Phase 3 T9+T12) | — |
| 37 | AC8.1 | Yes (Phase 1 T14) | — |
| 38 | AC8.2 | Yes (Phase 2 T12, Phase 3 T12) | Phase 5 T11 |
| 39 | AC8.3 | Yes (Phase 2 T12) | — |
| 40 | AC9.1 | Yes (Phase 5 T9) | Phase 5 T11 |
| 41 | AC9.2 | Yes (Phase 5 T9) | Phase 5 T11 |
| 42 | AC9.3 | Yes (Phase 5 T9) | Phase 5 T11 |
| 43 | AC9.4 | Yes (Phase 5 T9) | Phase 5 T11 |
| 44 | AC9.5 | Yes (Phase 5 T9) | Phase 5 T11 |
| 45 | AC10.1 | — | Phase 5 T11 |
| 46 | AC10.2 | — | Phase 5 T11 |
| 47 | AC11.1 | Yes (Phase 6 T5 XCTest) | Phase 6 T8 |
| 48 | AC11.2 | Yes (Phase 6 T5 XCTest) | Phase 6 T8 |
| 49 | AC11.3 | — | Phase 6 T8 |
| 50 | AC11.4 | — | Phase 6 T8 |
| 51 | AC12.1 | Yes (Phase 6 T6 XCTest) | Phase 6 T8 |
| 52 | AC12.2 | Yes (Phase 6 T6 XCTest) | Phase 6 T8 |
| 53 | AC12.3 | Yes (Phase 6 T6 XCTest) | Phase 6 T8 |
| 54 | AC12.4 | Yes (Phase 6 T6 XCTest) | — |
| 55 | ACX.1 | Yes (Phase 1 T16, Phase 2 T3) | — |
| 56 | ACX.2 | Yes (Phase 4 T2) | Phase 4 T5, Phase 7 T5 |
| 57 | ACX.3 | Yes (Phase 1 T10, Phase 4 T6) | Phase 7 T7 |
| 58 | ACX.4 | — | Phase 3 T2 |

**Confirmed: every acceptance criterion in the design has at least one verification entry. ACs 10.1, 10.2, 11.3, 11.4, and X.4 are intentionally human-only with documented justification; all other ACs have automated coverage as the primary verification method.**
