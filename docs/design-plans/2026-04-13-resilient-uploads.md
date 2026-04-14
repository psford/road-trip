# Resilient Photo Uploads (Web + iOS) Design

## Summary

This design builds a resilient, resumable photo upload pipeline shared by the road-trip web client and a new Capacitor iOS app. The core architectural decision is to move from server-proxied uploads to direct-to-blob uploads: the server issues a short-lived, write-only, per-blob SAS token scoped to exactly one blob path, and the client uploads file chunks directly to Azure Blob Storage using the block-blob protocol (PutBlock / PutBlockList). This keeps large binary data off the ASP.NET Core process while giving the client fine-grained control over retry and resume at the block level. A client-generated `upload_id` GUID makes the `request-upload` call idempotent, so a crashed tab or killed app can re-enter the pipeline without creating duplicate records.

The queue and state machine are written once in vanilla JS (`uploadQueue.js`) and shared between web and iOS via platform-adapter seams — IndexedDB on web, native SQLite via a custom Capacitor plugin on iOS, and `fetch` vs. `URLSession` background tasks for the transport layer. Storage is reorganized from a single shared blob container to per-trip containers (`trip-{secretToken}`), with a `storage_tier` column and dual-read logic ensuring existing photos remain visible without migration. A version-header protocol (`x-server-version` / `x-client-min-version`) on every API response enables the iOS hybrid bootstrap to detect stale cached bundles and provides a path for future breaking API changes without forced App Store updates.

## Definition of Done

**Primary deliverables — two coordinated phases sharing one upload pipeline:**

### Phase 1 (Web, ships first)

- Web client uploads photos directly to Azure Blob Storage via per-blob SAS tokens with block-level chunked uploads, exponential backoff + jitter retries, and resumable transfers (uncommitted blocks).
- New per-trip container layout for uploads; existing photos in the shared `road-trip-photos` container remain accessible via dual-read (new writes → per-trip, reads fall back to shared).
- IndexedDB-backed upload queue survives tab close / browser crash; on return to the trip page, a "X uploads paused — Resume" banner lets the user continue.
- Per-file progress UI with progress bar, status (queued / uploading / committing / failed / done), and per-file retry button. Replaces the current chunked bar-fills-as-files-complete UI.
- Optimistic photo placement: pin appears on the map immediately with a pending/uploading visual state; flips to normal on commit; red state with retry affordance on failure.
- Upload failures (not just missing EXIF GPS) now offer the manual pin-drop fallback flow.
- API surface stabilized as `request-upload → client uploads blocks directly to blob → commit` (plus `abort`), identical shape used by web and iOS clients.
- Orphan-cleanup job removes abandoned pending blobs/DB rows after a reasonable window.
- Token-based auth model preserved (per-trip `secretToken`); no password auth introduced.

### Phase 2 (iOS, ships as soon as Phase 1 is stable)

- Capacitor iOS app distributed via TestFlight.
- Hybrid bootstrap: a tiny HTML/JS loader is bundled into the IPA; on first online launch it fetches the real web bundle (HTML/JS/CSS) from Azure and caches it in IndexedDB. Subsequent launches load from cache (fully offline after first online launch). JS/HTML/CSS changes deploy via Azure without requiring TestFlight rebuilds.
- Server-driven version protocol: `x-server-version` / `x-client-min-version` headers on API responses trigger a "site updated — please reload" alert when the cached bundle is incompatible with the server.
- Native photo capture via PHPicker, native EXIF/GPS extraction via ImageIO (replaces piexifjs inside the app).
- Background uploads via `URLSessionConfiguration.background` — uploads continue when the app is backgrounded, and resume after app kill via native SQLite queue.
- iOS-specific styling via `platform-ios` body class + lazy-loaded `ios.css` served from Azure for fast iteration without TestFlight rebuilds.
- No Phase 1 endpoint changes required — iOS client calls the same request-upload / commit API built in Phase 1.

### Success criteria

- Tester, on their current trip with intermittent cellular service, can upload a batch of 20+ photos and all arrive without silent failure.
- Closing the tab (or killing the app) mid-batch does not lose progress — resume works on both platforms.
- iOS app UI loads and accepts photo selections with zero connectivity; uploads flush when connectivity returns, including while app is backgrounded.
- Existing trips' photos continue to display correctly throughout rollout.

### Explicit exclusions

- Android native app
- Password / user account authentication
- App Store public release (TestFlight only for Phase 2)
- Migration of existing blobs from shared container to per-trip containers
- Server-side EXIF fallback (EXIF extraction stays client-side / native)
- Changes to reverse-geocoding, trip-planning, or map rendering behavior beyond the pending-photo visual state

## Acceptance Criteria

### resilient-uploads.AC1: Direct-to-blob upload pipeline

- **resilient-uploads.AC1.1 Success:** A single photo uploaded via `request-upload` → block PUTs → `commit` results in a committed blob in the correct per-trip container and a `photos` row with `status='committed'`.
- **resilient-uploads.AC1.2 Success:** A batch of 20 photos uploads concurrently (respecting the concurrency cap) and all commit successfully.
- **resilient-uploads.AC1.3 Success:** Re-submitting the same `upload_id` to `request-upload` returns the existing `photo_id` and SAS URL (idempotent).
- **resilient-uploads.AC1.4 Failure:** `commit` rejects a block ID list that doesn't match the blocks actually uploaded to Azure (returns 400).
- **resilient-uploads.AC1.5 Failure:** SAS URL expires after 2 hours; a PUT using an expired SAS returns 403 from Azure.
- **resilient-uploads.AC1.6 Failure:** `commit` rejects a `photo_id` belonging to a different trip (returns 404 or 403).
- **resilient-uploads.AC1.7 Edge:** Upload of a photo at the configured size ceiling (currently 15 MB) succeeds with appropriate block count.

### resilient-uploads.AC2: Per-trip container provisioning and dual-read

- **resilient-uploads.AC2.1 Success:** Creating a new trip eagerly provisions the `trip-{secretToken}` container.
- **resilient-uploads.AC2.2 Success:** The backfill migration provisions containers for all existing trips and is idempotent when re-run.
- **resilient-uploads.AC2.3 Success:** `GET /api/trips/{token}/photos` returns legacy photos from `road-trip-photos` and new photos from `trip-{token}` in a single response.
- **resilient-uploads.AC2.4 Success:** Deleting a trip deletes the per-trip container and any legacy blobs.
- **resilient-uploads.AC2.5 Failure:** Provisioning a container for a `secretToken` that produces an invalid container name (shouldn't happen with GUIDs, but defensive) returns a clear error.
- **resilient-uploads.AC2.6 Edge:** A trip with zero photos (new or legacy) renders without error.

### resilient-uploads.AC3: Upload state machine and retry policy

- **resilient-uploads.AC3.1 Success:** A photo transitions `pending → requesting → uploading → committing → committed` in order on a clean happy path.
- **resilient-uploads.AC3.2 Success:** A single block failure triggers exponential backoff retry (min(2^attempts × 1000ms, 30000ms) + jitter) and succeeds within 6 attempts when the underlying issue resolves.
- **resilient-uploads.AC3.3 Failure:** After 6 consecutive block upload failures, the photo transitions to `failed` with the last error recorded.
- **resilient-uploads.AC3.4 Edge:** Concurrent uploads respect the per-file (3 blocks) and global (3 photos, 9 in-flight) concurrency caps.
- **resilient-uploads.AC3.5 Edge:** A SAS expiration mid-upload (403 from Azure) triggers a fresh `request-upload` call with the same `upload_id` and resumes from the remaining pending blocks.

### resilient-uploads.AC4: Queue persistence and cross-session resume

- **resilient-uploads.AC4.1 Success:** Closing the browser tab mid-batch preserves queue state; reopening the trip page shows the resume banner with the correct count.
- **resilient-uploads.AC4.2 Success:** Clicking "Resume" on the banner continues uploads from where they stopped, reusing Azure's uncommitted-block retention.
- **resilient-uploads.AC4.3 Success:** Clicking "Discard all" transitions all pending rows to `aborted` and removes them from the UI.
- **resilient-uploads.AC4.4 Failure:** Resuming after >7 days (Azure uncommitted-block expiry) gracefully restarts the upload from block 1 rather than failing.
- **resilient-uploads.AC4.5 Edge:** Two browser tabs open to the same trip do not double-upload the same photo (queue is singleton per `upload_id`).

### resilient-uploads.AC5: Per-file progress UI and pin-drop fallback

- **resilient-uploads.AC5.1 Success:** Uploading a batch shows a per-file row for each photo with live progress, filename, size, and status icon.
- **resilient-uploads.AC5.2 Success:** A failed upload row exposes a `[↻ retry]` button that re-enters the upload from the first unfinished block.
- **resilient-uploads.AC5.3 Success:** A failed upload of a photo with EXIF GPS exposes a `[📍 Pin manually instead]` button that routes the user into the manual pin-drop flow.
- **resilient-uploads.AC5.4 Failure:** Per-file retry has a maximum attempt count surfaced in the UI (user sees "gave up after 6 attempts" instead of infinite retry).
- **resilient-uploads.AC5.5 Edge:** Progress panel is collapsible and persists across navigations within the same trip.

### resilient-uploads.AC6: Orphan cleanup

- **resilient-uploads.AC6.1 Success:** `OrphanSweeperJob` deletes `photos` rows with `status='pending'` and `last_activity_at` older than 48 hours.
- **resilient-uploads.AC6.2 Failure:** Sweeper does not touch rows with `status='committed'` regardless of age.
- **resilient-uploads.AC6.3 Edge:** Sweeper is idempotent — running twice in a row produces the same end state.

### resilient-uploads.AC7: Optimistic photo placement

- **resilient-uploads.AC7.1 Success:** A photo with EXIF GPS produces a pending-state pin on the map within ~1 second of `request-upload` success.
- **resilient-uploads.AC7.2 Success:** On commit, the pending-state pin flips to the normal committed styling with the photo thumbnail.
- **resilient-uploads.AC7.3 Success:** On upload failure, the pin turns red and surfaces retry/dismiss/pin-drop affordances when tapped.
- **resilient-uploads.AC7.4 Failure:** A photo without EXIF GPS does not produce an optimistic pin (routes to manual pin-drop flow instead).
- **resilient-uploads.AC7.5 Edge:** Discarding a failed upload removes the red pin from the map cleanly.

### resilient-uploads.AC8: Version protocol

- **resilient-uploads.AC8.1 Success:** Every API response includes `x-server-version` and `x-client-min-version` headers.
- **resilient-uploads.AC8.2 Success:** When a client's cached version is below `x-client-min-version`, the UI surfaces the "site updated — please reload" alert.
- **resilient-uploads.AC8.3 Failure:** Missing version headers on an API response do not crash the client (gracefully treated as "version unknown, no forced upgrade").

### resilient-uploads.AC9: Capacitor hybrid bootstrap and offline UI shell

- **resilient-uploads.AC9.1 Success:** First launch with internet fetches the web bundle from Azure, caches it in IndexedDB, and renders the trip UI.
- **resilient-uploads.AC9.2 Success:** Subsequent launch in airplane mode loads the cached bundle and renders the full trip UI.
- **resilient-uploads.AC9.3 Success:** Deploying a new web bundle to Azure is picked up on the next online launch (no TestFlight rebuild needed).
- **resilient-uploads.AC9.4 Failure:** First-ever launch with no connectivity renders the bundled `fallback.html` screen.
- **resilient-uploads.AC9.5 Edge:** A cached bundle that is incompatible with the current server (version mismatch) triggers the "site updated — reload" alert before any broken API calls are made.

### resilient-uploads.AC10: iOS-specific CSS from Azure

- **resilient-uploads.AC10.1 Success:** On iOS, the `platform-ios` body class is set before paint and iOS-specific CSS overrides apply without a visual flash.
- **resilient-uploads.AC10.2 Success:** Updating `ios.css` on Azure and redeploying is reflected on the next online launch of the iOS app.

### resilient-uploads.AC11: Native background uploads

- **resilient-uploads.AC11.1 Success:** Starting an upload batch and backgrounding the app results in uploads continuing via URLSession; checking the app later shows all photos committed.
- **resilient-uploads.AC11.2 Success:** Force-quitting the app mid-batch and relaunching resumes uncommitted uploads from the native SQLite queue + Azure's uncommitted blocks.
- **resilient-uploads.AC11.3 Failure:** An upload that exceeds Azure's 7-day uncommitted-block retention gracefully restarts from block 1 on resume.
- **resilient-uploads.AC11.4 Edge:** Uploads queued while offline are drained automatically when connectivity returns, without user interaction.

### resilient-uploads.AC12: Native EXIF via ImageIO

- **resilient-uploads.AC12.1 Success:** Selecting a HEIC photo via PHPicker yields correct GPS coordinates and `taken_at` via the `NativeExifPlugin`.
- **resilient-uploads.AC12.2 Success:** A JPEG photo with GPS yields the same coordinates as piexifjs on the equivalent file on web (within expected precision).
- **resilient-uploads.AC12.3 Failure:** A photo without EXIF GPS yields a null GPS structure (routes to manual pin-drop flow).
- **resilient-uploads.AC12.4 Edge:** A photo whose EXIF is malformed does not crash the plugin — returns null with a logged warning.

### resilient-uploads.ACX: Cross-cutting behaviors

- **resilient-uploads.ACX.1:** No upload-related operation logs the SAS URL, photo contents, or GPS coordinates in a form that would appear in persistent server logs (follows existing log sanitization rules).
- **resilient-uploads.ACX.2:** All errors surfaced to the user include enough context to retry or recover; no silent failures.
- **resilient-uploads.ACX.3:** Existing trips' photos (pre-rollout) continue to load and render correctly throughout all phases (no regressions to current behavior).
- **resilient-uploads.ACX.4:** UI visual design for each user-facing screen in Phase 3 is reviewed with Patrick before implementation (architectural AC, not testable in code).

## Glossary

- **SAS (Shared Access Signature)**: A time-limited, scope-limited Azure Blob Storage URL that grants specific permissions (here: write-only to a single blob path) without exposing the storage account key. Expires after 2 hours in this design.
- **PutBlock / PutBlockList**: The two-phase Azure Blob Storage API for block blobs. PutBlock uploads an individual chunk (identified by a base64 block ID) as an "uncommitted block"; PutBlockList atomically commits an ordered list of block IDs into the final blob. Only after PutBlockList does the blob become readable.
- **Uncommitted blocks**: Chunks uploaded via PutBlock that have not yet been committed via PutBlockList. Azure retains these for 7 days, enabling upload resume across sessions or app restarts.
- **upload_id**: A client-generated GUID that serves as the idempotency key for `request-upload`. If the same `upload_id` is submitted again (e.g., after a crash), the server returns the existing record rather than creating a duplicate.
- **Capacitor**: Ionic's cross-platform native runtime that wraps a web app (HTML/JS/CSS) in a native iOS (or Android) shell and exposes native APIs to JavaScript via plugin bridges. Used here to ship the road-trip web UI as an iOS app.
- **Hybrid bootstrap**: The pattern used by the iOS app where a minimal HTML/JS loader is bundled into the IPA, but the real application bundle (JS/CSS) is fetched from Azure and cached in IndexedDB on first launch. Subsequent launches use the cached bundle, enabling web deployments without TestFlight rebuilds.
- **PHPicker**: Apple's modern iOS photo-picker API (`PHPickerViewController`), introduced in iOS 14. Used here instead of `UIImagePickerController` because it provides full-resolution originals with intact EXIF metadata and does not require full Photos library permission.
- **URLSession background / URLSessionConfiguration.background**: An iOS networking mode where HTTP transfers are handed off to the OS and continue even when the app is suspended or force-quit. The OS calls back `handleEventsForBackgroundURLSession` in `AppDelegate` when transfers complete.
- **ImageIO / CGImageSource**: Apple's low-level image decoding framework used here (via `NativeExifPlugin`) to extract EXIF metadata — including GPS coordinates and `taken_at` — from photos selected via PHPicker, including HEIC/HEIF files.
- **piexifjs**: A JavaScript library for reading and writing EXIF metadata in JPEG files, currently used client-side in `exifUtil.js` on the web path. Replaced by `NativeExifPlugin` on iOS because piexifjs cannot handle HEIC files.
- **IndexedDB**: A browser-native key-value / object store with structured data support, used here as the durable upload queue on web. Survives tab close and browser crash; persists until explicitly cleared.
- **storage_tier**: A new column added to `roadtrip.photos` to record which blob container layout a photo uses — `'legacy'` (shared `road-trip-photos` container, old path scheme) or `'per-trip'` (new `trip-{secretToken}` container). Drives dual-read logic without requiring blob migration.
- **dual-read**: The `IPhotoReadService` pattern that reads `storage_tier` to decide which container to query, returning photos from both `road-trip-photos` (legacy) and `trip-{token}` (new) in a single response. Lets old and new photos coexist during and after rollout.
- **secretToken**: The existing per-trip opaque token embedded in trip URLs that scopes all API access to a single trip. Used here as the basis for deterministic container naming (`trip-{secretToken.ToLowerInvariant()}`); no new auth primitive is introduced.
- **OrphanSweeperJob**: A scheduled background job that deletes `photos` rows stuck in `pending` status for more than 48 hours — uploads that were abandoned before any blocks were committed. Azure auto-expires the uncommitted blocks after 7 days independently.
- **x-server-version / x-client-min-version**: Response headers injected by `ServerVersionMiddleware` on every API response. The client (and iOS bootstrap) compares its cached bundle version against `x-client-min-version`; if the cache is too old, it fetches a fresh bundle or alerts the user to reload.
- **platform-ios**: A CSS body class set by the iOS bootstrap before first paint, used to scope iOS-specific style overrides in `ios.css` without affecting the web path.
- **NativeExifPlugin**: A custom Capacitor plugin (`NativeExifPlugin.swift`) that bridges `ImageIO` / `CGImageSource` to JavaScript, exposing a `NativeExif.extract()` call that returns GPS coordinates and `taken_at` for a given `PHAsset` reference.
- **BackgroundUploadPlugin**: A custom Capacitor plugin (`BackgroundUploadPlugin.swift`) that bridges `URLSessionConfiguration.background` to JavaScript, replacing `fetch`-based block uploads on iOS so that uploads continue after the app is backgrounded.

## Architecture

**One upload pipeline, two clients.** The web browser and the Capacitor iOS app are peers consuming the same ASP.NET Core API and the same Azure Blob Storage contracts. The only differences are client-side: the web uses `fetch` + IndexedDB for the queue; iOS uses native `URLSession` background tasks + SQLite for the same queue semantics, exposed to shared JS logic via a custom Capacitor plugin.

### Data flow for a single photo upload

1. **Preflight (client-local).** User selects a photo. Client extracts EXIF/GPS locally (piexifjs on web; `ImageIO` via custom Swift plugin on iOS). Client records the photo in the local queue (IndexedDB / SQLite) with status `pending` and a client-generated `upload_id` GUID.
2. **Request upload.** Client POSTs metadata to `POST /api/trips/{token}/photos/request-upload`. Server creates a `photos` row with status `pending`, returns a per-blob SAS URL (write-only, 2-hour expiry, scoped to exactly one blob path in the trip's container) and the server-assigned `photo_id`.
3. **Upload blocks.** Client splits the file into ~4 MB chunks, assigns base64 block IDs, and PUTs each block directly to Azure via `{sas_url}&comp=block&blockid={id}`. Up to 3 concurrent blocks per file, 3 concurrent files, 9 in-flight requests total. Failed blocks retry with exponential backoff + jitter (cap 30 s, max 6 attempts). Block state is persisted in the queue after every transition.
4. **Commit.** When all blocks succeed, client POSTs the ordered block ID list to `POST /api/trips/{token}/photos/{photo_id}/commit`. Server calls `PutBlockList`, flips the row to `committed`, returns the full `PhotoResponse`. Thumbnail / reverse-geocode work runs asynchronously.
5. **Optimistic display.** As soon as step 2 succeeds, the map pin appears in a pending visual state. On commit, the pin flips to normal. On failure, the pin turns red with retry / dismiss / manual-pin-drop affordances.

### Components

**Backend (ASP.NET Core, C#):**
- `UploadController` in `Controllers/` — hosts `request-upload`, `commit`, `abort`, `version` endpoints.
- `IUploadService` in `Services/` — functional core: generates SAS URLs, validates commit block lists, enforces per-trip scope.
- `IBlobContainerProvisioner` in `Services/` — idempotent eager container creation on trip create + backfill migration.
- `IPhotoReadService` in `Services/` — dual-read logic: consults `storage_tier` column to select container/path.
- `OrphanSweeperJob` — scheduled cleanup of abandoned `pending` rows older than 48 hours.
- `ServerVersionMiddleware` in `Middleware/` — injects `x-server-version` / `x-client-min-version` headers on every response.

**Web client (vanilla JS):**
- `uploadQueue.js` — state machine, cross-platform (shared with iOS).
- `storageAdapter.js` — platform-specific: IndexedDB on web, Capacitor-SQLite on iOS.
- `uploadTransport.js` — platform-specific: `fetch` on web, `BackgroundUpload.enqueue()` on iOS.
- `progressPanel.js` — per-file progress UI.
- `resumeBanner.js` — session-recovery banner.
- `optimisticPins.js` — pending-state pin rendering for the map.
- `versionProtocol.js` — watches response headers, triggers "site updated — reload" alert.

**iOS Capacitor app (Swift + shared JS):**
- Bundled bootstrap (`src/bootstrap/`) — tiny loader HTML/JS shipped in the IPA.
- `BackgroundUploadPlugin.swift` — custom Capacitor plugin wrapping `URLSessionConfiguration.background`.
- `NativeExifPlugin.swift` — custom Capacitor plugin wrapping `ImageIO` / `CGImageSource`.
- Shared JS layer — same `uploadQueue.js` / `storageAdapter.js` / `uploadTransport.js` with platform-adapter selection.

### Storage model

| Context | Container | Path | `storage_tier` value |
|---|---|---|---|
| Legacy (existing data) | `road-trip-photos` | `{tripId}/{photoId}[_display/_thumb].jpg` | `'legacy'` |
| New uploads | `trip-{secretToken.ToLowerInvariant()}` | `{photoId}_original.jpg`, `{photoId}_display.jpg`, `{photoId}_thumb.jpg` | `'per-trip'` |

- Container name is deterministic from the trip's `secretToken` — no new DB column for container identity.
- Provisioned eagerly on trip create; one-time idempotent backfill job provisions containers for existing trips.
- Trip deletion nukes the per-trip container outright (fast), plus any legacy blobs individually.

### API contract

**`POST /api/trips/{token}/photos/request-upload`**

```
Request:
{
  upload_id: string,          // client-generated GUID
  filename: string,
  content_type: string,
  size_bytes: number,
  exif: { gps_lat?: number, gps_lon?: number, taken_at?: string } | null
}

Response:
{
  photo_id: string,           // server-generated GUID
  sas_url: string,            // per-blob SAS, write-only, 2hr expiry
  blob_path: string,
  max_block_size_bytes: number,
  server_version: string,
  client_min_version: string
}
```

Idempotent on `upload_id` — returns existing record if the same `upload_id` is seen again for the same trip.

**`POST /api/trips/{token}/photos/{photo_id}/commit`**

```
Request:  { block_ids: string[] }      // ordered list
Response: PhotoResponse                 // same shape as GET /photos returns today
```

**`POST /api/trips/{token}/photos/{photo_id}/abort`** — idempotent; removes the `photos` row. Uncommitted blocks auto-expire at 7 days (Azure built-in behavior).

**`GET /api/version`** — returns `{ server_version, client_min_version }`. Cheap; used by iOS bootstrap and for mid-session deploy detection.

**Auth.** All endpoints remain token-scoped via the existing `{token}` URL segment. No new auth primitives.

### Upload queue schema (shared contract, web and iOS)

```
upload_queue row:
  upload_id:      string (primary key, client-generated GUID)
  trip_token:     string (indexed)
  photo_id:       string | null
  filename:       string
  size_bytes:     number
  content_type:   string
  exif:           object | null
  file_ref:       Blob | FileHandle | nativeFileUrl (platform-specific)
  status:         'pending' | 'requesting' | 'uploading' | 'committing' | 'committed' | 'failed' | 'aborted'
  sas_url:        string | null
  blob_path:      string | null
  total_blocks:   number | null
  block_state:    [{ id: string, status: 'pending'|'done'|'failed', attempts: number }]
  bytes_uploaded: number
  last_error:     string | null
  created_at:     number (epoch ms)
  last_activity_at: number (epoch ms)
```

Each state transition is persisted **before** the network call, so a crash mid-operation leaves the queue in a recoverable state. On page / app load, any row with non-terminal status for the current trip surfaces in the resume banner.

### iOS bootstrap protocol

On app launch:

1. Capacitor loads bundled `index.html`.
2. Bootstrap loader checks IndexedDB for cached bundle + its `server_version`.
3. Bootstrap calls `GET /api/version`.
4. **Both match** → inject cached JS/CSS, render trip UI.
5. **No cache** → fetch `app.js`, `app.css`, `ios.css` from Azure, cache in IndexedDB, inject.
6. **Cache stale (client_min_version > cached version)** → fetch new bundle, cache, inject.
7. **Offline + no cache** → render bundled `fallback.html` ("Connect to the internet to finish setting up").

iOS-specific CSS (`ios.css`) is loaded alongside `app.css` and applies styles scoped to a `.platform-ios` body class set by the bootstrap.

## Existing Patterns

Investigation found the following in the current road-trip codebase:

- **Backend service pattern.** Existing endpoints live in `Program.cs` with a minimal-API style. `PhotoService` in `src/RoadTripMap/Services/` already encapsulates `BlobServiceClient` and container writes. This design extends that pattern: new `IUploadService`, `IBlobContainerProvisioner`, `IPhotoReadService` follow the same DI-injected service style. No architectural divergence.
- **Existing blob container.** Single `road-trip-photos` container with `{tripId}/{photoId}` path scheme, created once. New per-trip container scheme coexists via the `storage_tier` column; legacy blobs remain untouched.
- **Frontend upload infrastructure.** Current `uploadQueue.js`, `api.js`, `postUI.js` in `wwwroot/js/` establish the queue concept (with `maxConcurrent: 3`, `onEachComplete` callbacks, single-retry logic). This design replaces the network-transport layer while keeping the queue-module convention. No framework is introduced; the client remains vanilla JS.
- **Photo refresh on upload success.** `refreshPhotoList()` in `postUI.js` debounces and re-fetches `GET /api/post/{token}/photos`. Optimistic pins layer on top of this — the refresh still happens on commit, but the pin is already visible with pending styling beforehand.
- **EXIF extraction location.** piexifjs is already used client-side for GPS triage in `exifUtil.js`. This design keeps EXIF extraction client-side on web; iOS uses native `ImageIO` via the new `NativeExifPlugin` for reliability.
- **SQL schema conventions.** The `photos` table lives in schema `roadtrip.*` (per project memory). Adding `storage_tier`, `upload_id`, and `status` columns follows existing conventions (snake_case, lowercase).
- **No existing pattern for.** Eager container provisioning, custom Capacitor plugins, Azure Blob direct-upload from browser, or version-header protocol. These are new patterns introduced by this design. Each is justified by the design constraints (resilient uploads on flaky networks, iOS background uploads, offline-capable iOS bootstrap).

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Backend API, storage model, and provisioning

**Goal:** Ship the stable API contract (`request-upload`, `commit`, `abort`, `version`), per-trip container provisioning, dual-read photo service, orphan sweeper, and version-header middleware. No client changes yet.

**Components:**
- `UploadController` in `src/RoadTripMap/Controllers/` — minimal-API endpoints.
- `IUploadService` in `src/RoadTripMap/Services/` — SAS generation with per-blob scope, commit validation.
- `IBlobContainerProvisioner` in `src/RoadTripMap/Services/` — eager creation on trip create + one-time idempotent backfill migration for existing trips.
- `IPhotoReadService` in `src/RoadTripMap/Services/` — dual-read logic using `storage_tier` column.
- `OrphanSweeperJob` in `src/RoadTripMap/BackgroundJobs/` — scheduled cleanup of `pending` rows > 48 hours.
- `ServerVersionMiddleware` in `src/RoadTripMap/Middleware/` — injects `x-server-version` / `x-client-min-version` headers.
- SQL migration: add `storage_tier`, `upload_id`, `status`, `last_activity_at` to `roadtrip.photos`.
- Update `Program.cs` to wire DI and register middleware/jobs.
- Update Bicep in `infrastructure/azure/` to grant the App Service's managed identity the container-create role where needed.

**Dependencies:** None (foundation phase).

**ACs covered:** `resilient-uploads.AC1.*`, `resilient-uploads.AC2.*`, `resilient-uploads.AC6.*`, `resilient-uploads.AC8.*`.

**Done when:**
- `request-upload`, `commit`, `abort`, `version` endpoints return expected shapes and status codes.
- Idempotency: duplicate `upload_id` returns existing record.
- Per-blob SAS writes succeed to the correct container with correct expiry.
- Commit rejects block lists that don't match uploaded blocks.
- Dual-read returns legacy photos from `road-trip-photos` and per-trip photos from `trip-{token}`.
- Backfill migration creates containers idempotently for existing trips.
- Orphan sweeper deletes `pending` rows older than 48 hours without touching committed rows.
- All tests (xUnit + Azurite) pass.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Web upload state machine and transport

**Goal:** Implement the shared queue + block-upload logic on the web client. No UI changes; existing upload UI continues to call it as a drop-in replacement.

**Components:**
- `uploadQueue.js` in `wwwroot/js/` — state machine (pending → requesting → uploading → committing → committed/failed/aborted), transition persistence.
- `storageAdapter.js` in `wwwroot/js/` — IndexedDB backend for the queue (web-only build; iOS swap in Phase 5).
- `uploadTransport.js` in `wwwroot/js/` — fetch-based per-block uploader with exponential backoff + jitter, up to 6 attempts, cap 30 s.
- `versionProtocol.js` in `wwwroot/js/` — response-header watcher that surfaces the "site updated" alert.
- Wire into existing `postUI.js` call sites as a replacement for the old queue.

**Dependencies:** Phase 1 (backend API must exist).

**ACs covered:** `resilient-uploads.AC3.*`, `resilient-uploads.AC4.*`, `resilient-uploads.AC7.*`.

**Done when:**
- Uploading a single photo end-to-end succeeds (browser → blob → commit → map refresh).
- Dropping a block mid-upload triggers retry with correct backoff, eventually succeeds.
- Force-failing a block 6 times transitions the photo row to `failed`.
- Queue state persists across page reload (verified via fake-indexeddb in Vitest).
- Version-mismatch header triggers the reload alert on next response.
- Unit tests (Vitest + fake-indexeddb + fake fetch) cover all state-machine transitions and retry policy.
- Integration tests (Playwright + Azurite) verify real end-to-end block upload and commit.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Web UI — progress panel, optimistic pins, resume, retry, pin-drop on failure

**Goal:** User-visible changes that surface the queue state and failure-recovery paths. UI design discussed collaboratively before each screen; architectural behavior specified here, visual design not frozen.

**Components:**
- `progressPanel.js` in `wwwroot/js/` — per-file rows with progress bar, status icon, retry/drop buttons; collapsible; persists across navigation within the trip.
- `resumeBanner.js` in `wwwroot/js/` — "N uploads paused — Resume / Retry failed / Discard all" banner on trip page load when non-terminal queue rows exist.
- `optimisticPins.js` in `wwwroot/js/` — renders pending-state pins on the map as soon as `request-upload` returns; flips on commit; red-state on failure with affordances.
- Update `postUI.js` to route upload failures (not just missing-EXIF-GPS) to the manual pin-drop fallback.
- Feature flag (`wwwroot/js/featureFlags.js` or server-side flag) gating the new UI for progressive rollout.

**Dependencies:** Phase 2 (state machine must exist).

**ACs covered:** `resilient-uploads.AC5.*`, `resilient-uploads.AC7.*` (UI-observable portions).

**Done when:**
- Per-file progress panel renders queued / uploading / committing / failed / done states correctly for a batch upload.
- Optimistic pin appears on the map within ~1 s of request-upload success and flips to normal on commit.
- Closing and reopening the browser mid-batch shows the resume banner and resumes uploads on user action.
- Failed upload for a GPS-tagged photo offers the manual pin-drop fallback.
- Integration tests (Playwright) simulate network drop mid-batch, close and reopen the page, and verify resume flow.
- UI visual design reviewed with Patrick before each screen is implemented.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Web stabilization

**Goal:** Real-user validation (Patrick), metrics collection, edge-case fixes, feature-flag removal.

**Components:**
- Metrics / logging improvements to expose upload failure rates, retry counts, time-to-commit distributions in existing observability sinks.
- Edge-case fixes surfaced during testing.
- Remove the Phase 3 feature flag.

**Dependencies:** Phase 3.

**Done when:**
- Patrick uploads 20+ photos over a throttled / unstable connection and all land without silent failure.
- Resume banner verified with real tab-close scenarios.
- Failure rate under simulated 3G with packet loss is within acceptable bounds (specific threshold agreed during stabilization).
- Feature flag removed; new UI is the only path.
- All previously-failing uploads from the existing tester's current trip are recoverable (either complete or fall through the new manual-pin-drop path).
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Capacitor shell, bundled bootstrap, Azure-hosted bundle

**Goal:** Ship a TestFlight build that loads the web UI natively via the hybrid bootstrap. No background uploads yet — iOS uses the same web transport (`fetch`) so the pipeline is validated end-to-end before native complexity is added.

**Components:**
- New directory or repo for the Capacitor project (decision during this phase — `/ios` subdirectory of road-trip vs. separate repo).
- `capacitor.config.json` pointing to bundled `src/bootstrap/index.html`.
- `src/bootstrap/` — tiny loader: `index.html`, `loader.js`, `fallback.html`.
- `loader.js` implements the bootstrap protocol: check cache, fetch from Azure if needed, cache in IndexedDB, inject app bundle, handle version mismatch.
- `shared/` directory or npm workspace linking web JS modules so they compile into a deployable Azure-hosted bundle (`app.js`, `app.css`, `ios.css`).
- Platform-adapter seams in `storageAdapter.js` and `uploadTransport.js` (still select web implementations for Phase 5; iOS-native implementations added in Phase 6).
- iOS-specific CSS (`ios.css`) with `.platform-ios`-scoped overrides.
- TestFlight configuration (App ID, provisioning profiles, signing).

**Dependencies:** Phase 4 (stable web pipeline + shared JS modules ready to bundle).

**ACs covered:** `resilient-uploads.AC9.*`, `resilient-uploads.AC10.*`.

**Done when:**
- `npm run ios` builds and runs on a simulator and a real device.
- First launch with internet fetches the bundle from Azure, caches it, and shows the trip UI.
- Second launch with airplane mode loads the cached bundle and shows the full UI.
- First-ever launch with no connectivity shows the `fallback.html` screen.
- Version-mismatch response header surfaces the "site updated — reload" alert.
- TestFlight build installed via internal testers succeeds on Patrick's device.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Custom Swift plugins — native background upload and EXIF

**Goal:** Replace the iOS client's transport and EXIF layers with native Swift implementations so uploads continue while the app is backgrounded and EXIF extraction is reliable.

**Components:**
- `BackgroundUploadPlugin.swift` in `ios/App/App/Plugins/` — Capacitor plugin wrapping `URLSessionConfiguration.background`. Exposes `enqueue({ uploadId, blockUrl, filePath, blockId })` to JS. Stores task↔uploadId map in `UserDefaults`. Posts completion callbacks via `notifyListeners`. Implements `handleEventsForBackgroundURLSession` in `AppDelegate`.
- `NativeExifPlugin.swift` in `ios/App/App/Plugins/` — Capacitor plugin wrapping `ImageIO` / `CGImageSource` for EXIF/GPS extraction from `PHAsset` references.
- Update `storageAdapter.js` on iOS to use `@capacitor-community/sqlite` for the queue (parallel IndexedDB schema).
- Update `uploadTransport.js` on iOS to call `BackgroundUpload.enqueue()` instead of `fetch` for block uploads.
- Update `exifUtil.js` on iOS to call `NativeExif.extract()` instead of piexifjs.
- Update photo-picker call sites on iOS to use `@capacitor/camera` with PHPicker for full-resolution originals with intact EXIF.

**Dependencies:** Phase 5 (Capacitor shell must exist).

**ACs covered:** `resilient-uploads.AC11.*`, `resilient-uploads.AC12.*`.

**Done when:**
- Start upload of 10+ photos, background the app — uploads continue and complete.
- Start upload of 10+ photos, force-quit the app mid-batch — on relaunch, the queue resumes uncommitted uploads from uncommitted blocks.
- EXIF/GPS correctly extracted from native photo library images including HEIC.
- Swift unit tests (XCTest) cover plugin entry points.
- Manual device tests pass (real iPhone, mobile data, airplane-mode toggling).
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: iOS stabilization and TestFlight rollout

**Goal:** Real-device validation by the tester on their current trip, polish, and TestFlight rollout.

**Components:**
- Polish items surfaced during stabilization: loading states, transitions, empty states, error copy.
- Icon, splash, permissions copy ("Road Trip needs access to Photos to upload…").
- Deep-link support for returning to an active trip from a shared link.
- TestFlight submission + internal tester invite for the original reporter.
- Capture telemetry/feedback from the tester's real-world usage.

**Dependencies:** Phase 6.

**Done when:**
- Tester installs the TestFlight build and successfully uploads photos from their current trip.
- At least one "background for ≥10 minutes, return, uploads completed" scenario verified on the tester's device.
- Reported issues from the original complaint are demonstrably fixed in both web and iOS paths.
- No regressions in the web path confirmed via smoke test after all iOS work lands.
<!-- END_PHASE_7 -->

## Additional Considerations

**Error handling.** Server rejects commits where block IDs don't match what Azure confirms was uploaded (prevents malformed SAS abuse). Failed `request-upload` returns a retryable error with correlation ID. Server-side reverse-geocoding failure does not fail the commit — location is stored as "pending enrichment" and retried by a background job.

**Edge cases.**
- HEIC / HEIF files on iOS: preserved as originals per the existing "preserve original media" CLAUDE.md principle. Resizing for display tier happens server-side post-commit, same as JPEG today.
- EXIF rotation: unchanged from today — existing display/thumbnail tier preserves orientation metadata.
- Trip deletion during an active upload: commit endpoint rejects with 410 Gone; client transitions the photo to `aborted`.
- SAS expiry during an in-flight upload: client catches 403 from Azure, re-requests a new SAS via `request-upload` with the same `upload_id`, resumes from remaining blocks.

**Future extensibility.**
- Per-trip container layout is the natural unit for future per-trip auth / access scoping if user accounts are ever added.
- The shared queue + transport seam allows future platforms (Android Capacitor, Electron desktop) to plug in without backend changes.
- Version protocol enables future breaking API changes with graceful forced-upgrade UX.

**Deliberately out of scope (again, for emphasis).**
- Android native or PWA build: no tester, no phone.
- Migration of existing blobs out of `road-trip-photos`: dual-read is sufficient.
- Password auth / user accounts: token model stands.
- App Store public release: TestFlight-only during this effort.
