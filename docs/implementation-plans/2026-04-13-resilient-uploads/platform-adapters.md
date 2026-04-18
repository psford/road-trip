# Platform Adapters — Seam Contract for Phase 6

## Purpose

This document defines the seam contract for platform-specific adapter selection in the resilient uploads system. The seams enable Phase 6 to swap adapter implementations (storage backend, upload transport) based on runtime platform detection without modifying callers.

In Phase 5, both platforms (`web` and `ios`) use the same IndexedDB-backed storage and fetch-based transport. Phase 6 will replace the `ios` branch with native implementations: SQLite for storage and background-upload native API for transport.

## Platform Detection (Phase 6 Hook Point)

**Phase 5 status:** Platform-specific detection is deferred to Phase 6. Currently, all platforms use the same factory functions, defined once at module scope.

**Phase 6 design:** When a second adapter implementation exists (SQLite for storage, native background-upload for transport), the module will add runtime platform detection. Two realistic approaches:

1. **Call-time detection (simpler):** The exported factory checks `window.Capacitor?.getPlatform?.()` internally:
   ```js
   const StorageAdapter = {
     async putItem(item) {
       const platform = window.Capacitor?.getPlatform?.() || 'web';
       if (platform === 'ios') {
         return createSqliteAdapter().putItem(item);
       }
       return createIndexedDbAdapter().putItem(item);
     },
     // ... other methods delegate similarly
   };
   ```
   **Advantage:** Simple, no duplicate constants. **Disadvantage:** Platform check on every call (minor perf cost).

2. **Factory-time detection (faster):** Detect once at module load:
   ```js
   const _platform = (typeof window !== 'undefined' && window.Capacitor?.getPlatform?.()) || 'web';
   const StorageAdapter = _platform === 'ios' ? createSqliteAdapter() : createIndexedDbAdapter();
   ```
   **Advantage:** Single detection, direct reference. **Disadvantage:** Requires distinct local names (`_storagePlatform`, `_transportPlatform`) if both adapters use it to avoid const redeclaration (or wrap in IIFE).

Phase 6 should pick the approach that best fits the native adapter's design.

## StorageAdapter Contract

### Current Implementation (Phase 5)

Location: `src/RoadTripMap/wwwroot/js/storageAdapter.js`

**Shape:** Single exported constant (`StorageAdapter`) is the result of calling a factory function (`_storageAdapterImpl`) once at module load. No platform branching.

Backend: IndexedDB with in-memory fallback.

### Public API

All methods are async (return Promise). Errors are logged; promises resolve even on failure (fail-open pattern).

#### `putItem(item: Object): Promise<void>`

Store or update an upload item.

**Parameters:**
- `item.upload_id` (string, required) — Unique upload session identifier
- `item.trip_token` (string) — Trip secret token
- `item.filename` (string) — Original filename
- `item.size` (number) — File size in bytes
- `item.exif` (object, optional) — EXIF metadata
- `item.status` (string) — One of: `'pending'`, `'requesting'`, `'uploading'`, `'committing'`, `'committed'`, `'aborted'`, `'failed'`
- `item.created_at` (timestamp) — Creation time
- `item.last_activity_at` (timestamp) — Last update time

**Semantics:**
- Idempotent on `upload_id` (duplicate calls with same ID replace the item).
- Item persists across page reloads.

#### `getItem(uploadId: string): Promise<Object | null>`

Retrieve a single item by upload ID.

**Returns:** Item object matching the schema above, or `null` if not found.

#### `listByTrip(tripToken: string): Promise<Array<Object>>`

List all items for a trip.

**Returns:** Array of item objects, empty array if none found. Order is unspecified.

#### `listNonTerminal(tripToken: string): Promise<Array<Object>>`

List items with non-terminal status (pending, requesting, uploading, committing).

**Returns:** Array of items filtered to non-terminal statuses.

#### `updateItemStatus(uploadId: string, status: string, extraFields?: Object): Promise<void>`

Atomic status update with optional field merge.

**Parameters:**
- `uploadId` — Upload session ID
- `status` — New status (see putItem for valid values)
- `extraFields` — Additional fields to merge (optional)

**Semantics:**
- Atomic with respect to status field.
- Merges `extraFields` alongside status update.
- No-op if item doesn't exist.

#### `putBlock(uploadId: string, blockId: string, state: Object): Promise<void>`

Store or update block upload state.

**Parameters:**
- `uploadId` — Upload session ID
- `blockId` — Azure block ID (base64-encoded string)
- `state.status` (string) — One of: `'pending'`, `'done'`, `'failed'`
- `state.attempts` (number) — Number of upload attempts
- `state.error` (string, optional) — Error message if failed

**Semantics:**
- Composite key: `[uploadId, blockId]`.
- Idempotent on composite key.

#### `listBlocks(uploadId: string): Promise<Array<Object>>`

List all blocks for an upload, sorted by `block_id`.

**Returns:** Array of block state objects, empty if none. Always sorted for consistent ordering.

#### `updateBlock(uploadId: string, blockId: string, updates: Object): Promise<void>`

Atomic update of a block's state fields.

**Parameters:**
- `uploadId`, `blockId` — Composite key
- `updates` — Fields to merge (status, attempts, error, etc.)

**Semantics:**
- Atomic merge.
- No-op if block doesn't exist.

#### `deleteItem(uploadId: string): Promise<void>`

Delete an item and cascade-delete all its blocks.

**Semantics:**
- Atomic: item and all blocks deleted together or not at all.
- Idempotent (no-op if item doesn't exist).

### Lifecycle

**Construction:** `StorageAdapter` object is constructed once at module load.

**Initialization:** `_getDb()` lazy-opens IndexedDB on first access. Fallback to in-memory if unavailable.

**Persistence:** Items survive page reload (IndexedDB persists), unless storage is cleared or cache expires.

**Cleanup:** No explicit cleanup. Browser's storage quota and user clear-cache control lifecycle.

### Error Handling

- All methods log to `console.warn` on failure.
- All methods resolve successfully even if underlying storage fails (fail-open pattern).
- Callers must not rely on exceptions for error detection; check return values or assume best-effort persistence.

### Tests to Keep Passing

**Locations:**
- `tests/js/storageAdapter.test.js`
- `tests/js/uploadQueue.test.js`
- `tests/js/uploadTransport.test.js` (also tests storageAdapter indirectly)
- `tests/js/bootstrap-loader.test.js` (loader AC9 scenarios)

Tests exercise:
- Item CRUD: putItem, getItem, updateItemStatus, deleteItem
- Block tracking: putBlock, listBlocks, updateBlock
- Cascade delete: deleteItem removes all blocks
- Fallback: In-memory fallback works when IndexedDB unavailable
- Idempotency: Duplicate calls are safe
- Upload resumption: Inspects storage for pending blocks, re-uploads only those
- SAS refresh and retry: Handles 403 and retryable errors correctly
- Bootstrap scenarios: Offline-first loading (AC9.1–9.5), platform CSS (AC10.1–10.2)
- IDB write error: Loader injects bundle even if cache write fails (IDB quota exceeded, transaction error, etc.)

Verify `npm test` passes (all 245+ scenarios).

## UploadTransport Contract

### Current Implementation (Phase 5)

Location: `src/RoadTripMap/wwwroot/js/uploadTransport.js`

**Shape:** Single exported constant (`UploadTransport`) is the result of calling a factory function (`_uploadTransportImpl`) once at module load. No platform branching.

Backend: Fetch API to Azure Blob Storage with block uploads, retry, backoff, SAS refresh.

### Public API

#### Error Classes

Exported as properties of `UploadTransport`:

- **`UploadTransport.SasExpiredError`** — 403 Forbidden; SAS token invalid or expired. Triggers refresh-and-retry in caller.
- **`UploadTransport.RetryableError`** — Transient (408, 429, 500, 503). Caller retries with backoff.
- **`UploadTransport.PermanentError`** — Permanent failure (400, etc.). Caller stops.

#### `putBlock(sasUrl: string, blockId: string, blob: Blob, options: Object): Promise<void>`

Upload a single block to Azure Blob Storage.

**Parameters:**
- `sasUrl` — Base SAS URL (without query params; caller appends `comp=block` and `blockid`)
- `blockId` — Azure block ID (base64-encoded)
- `blob` — File chunk (Blob or ArrayBuffer)
- `options.signal` — AbortSignal for cancellation

**Throws:**
- `SasExpiredError` on 403
- `RetryableError` on 408, 429, 500, 503
- `PermanentError` on all other errors

**Semantics:**
- Atomic: block is fully uploaded or throws.
- Idempotent on Azure side (block PUT is idempotent if blockId is the same).

#### `uploadFile(params: Object): Promise<Array<string>>`

Upload entire file as ordered blocks with automatic retry, backoff, and SAS refresh.

**Parameters:**
- `params.file` — File object (File or Blob)
- `params.uploadId` — Upload session ID (for persistence and telemetry)
- `params.tripToken` — Trip secret token
- `params.photoId` — Photo ID from server
- `params.sasUrl` — Initial SAS URL for block uploads
- `params.storageAdapter` — StorageAdapter instance for block state persistence
- `params.semaphores` — Semaphore pool for concurrency control
- `params.onProgress` — Progress callback (optional)
- `params.onSasExpired` — Callback returning new SAS URL when token expires

**Returns:** Array of block IDs in order (matching Azure block list order).

**Throws:**
- `PermanentError` if unrecoverable error (permanent error on block, all retries exhausted)
- Other exceptions from semaphore or storage

**Semantics:**
- Resumable: inspects storage for pending/failed blocks; re-uploads only those.
- Retries: up to 6 attempts per block with exponential backoff (AC3.3).
- SAS refresh: calls `onSasExpired` to obtain new token; retries block with new URL (retry decrement logic to not count toward max retries).
- Fail-fast on permanent error (does not continue with next block).
- Concurrency: uses semaphores to limit concurrent block uploads.
- Telemetry: records block completion, retries, failures via `UploadTelemetry` global.

### Lifecycle

**Construction:** `UploadTransport` object is constructed once at module load.

**State:** Stateless; no side effects except HTTP requests. All state is stored in `storageAdapter` and caller context.

**Cleanup:** No explicit cleanup. HTTP connections close on completion or abort signal.

### Error Handling

- `putBlock` throws specific error types (SasExpiredError, RetryableError, PermanentError) to enable caller routing.
- `uploadFile` catches and retries on RetryableError and SasExpiredError; propagates PermanentError immediately.
- Caller is responsible for handling thrown errors and deciding whether to retry the entire file.

### Tests to Keep Passing

**Locations:**
- `tests/js/uploadTransport.test.js` — Transport-specific scenarios
- `tests/js/uploadQueue.test.js` — Orchestration and integration tests
- `tests/js/storageAdapter.test.js` — Storage backend tests
- `tests/js/bootstrap-loader.test.js` — Loader AC9/AC10 scenarios

Tests exercise:
- Block upload: single block PUT succeeds, throws on non-201 status
- Error classification: 403 → SasExpiredError, 429 → RetryableError, 400 → PermanentError
- Retry loop: retries up to 6 times, backoff delays increase exponentially
- SAS refresh: on SasExpiredError, calls onSasExpired, retries with new URL
- Block persistence: resumable uploads inspect storage, re-upload pending blocks
- Concurrency: respects semaphore limits
- Integration: StorageAdapter and UploadTransport work together across upload lifecycle

Verify `npm test` passes (all 245+ scenarios).

## Phase 6 Hook Points

### StorageAdapter Replacement

**File:** `src/RoadTripMap/wwwroot/js/storageAdapter.js`

**Current (Phase 5):**
```js
const StorageAdapter = _storageAdapterImpl;
```

**Phase 6 Seam:** The factory function itself is the replacement point. Choose one approach from the Platform Detection section above. Example (call-time):

```js
// Phase 6: Add platform check inside the exported object
const StorageAdapter = {
  async putItem(item) {
    const impl = getPlatform() === 'ios' ? createSqliteAdapter() : _storageAdapterImpl;
    return impl.putItem(item);
  },
  // ... repeat for all methods
};

function getPlatform() {
  return (typeof window !== 'undefined' && window.Capacitor?.getPlatform?.()) || 'web';
}
```

Or alternatively (factory-time, if both adapters are ready):

```js
const _storagePlatform = (typeof window !== 'undefined' && window.Capacitor?.getPlatform?.()) || 'web';
const StorageAdapter = _storagePlatform === 'ios' ? createSqliteAdapter() : createIndexedDbAdapter();
```

**Contract for new implementation:**
- Must expose the same public API as StorageAdapter (putItem, getItem, listByTrip, listNonTerminal, updateItemStatus, putBlock, listBlocks, updateBlock, deleteItem).
- Must be async (return Promises).
- Must be fail-open (resolve even on storage errors).
- Storage backend: SQLite (via Capacitor SQLite plugin).
- Persistence: survives app restart, uninstall-clean (depends on app lifecycle).

### UploadTransport Replacement

**File:** `src/RoadTripMap/wwwroot/js/uploadTransport.js`

**Current (Phase 5):**
```js
const UploadTransport = _uploadTransportImpl;
```

**Phase 6 Seam:** Similar to StorageAdapter, the factory function is the replacement point. Example (call-time):

```js
// Phase 6: Add platform check inside the exported object
const UploadTransport = {
  async putBlock(sasUrl, blockId, blob, options) {
    const impl = getPlatform() === 'ios' ? createBackgroundUploadTransport() : _uploadTransportImpl;
    return impl.putBlock(sasUrl, blockId, blob, options);
  },
  async uploadFile(params) {
    const impl = getPlatform() === 'ios' ? createBackgroundUploadTransport() : _uploadTransportImpl;
    return impl.uploadFile(params);
  }
};

function getPlatform() {
  return (typeof window !== 'undefined' && window.Capacitor?.getPlatform?.()) || 'web';
}
```

**Contract for new implementation:**
- Must expose the same public API: `putBlock()` and `uploadFile()`.
- Error classes (SasExpiredError, RetryableError, PermanentError) may be replaced or reused.
- Transport backend: Capacitor background-upload native API (Capacitor iOS plugin or custom).
- Semantics: same as fetch-based (resumable, retryable, SAS-refresh-aware, concurrency-controlled).
- Persistence: Capacitor manages upload queue; Phase 6 sync point determines whether to enqueue or await.

## Testing Strategy

### Phase 5 (Current)

All tests run with `_platform === 'web'`. Verify:
- `npm test` passes (all test suites)
- `dotnet test RoadTripMap.sln` passes (.NET integration tests)

### Phase 6 Preparation

Add platform-aware test fixtures:
- Mock `window.Capacitor` and `getPlatform()` in test harness.
- Run StorageAdapter tests with `_platform === 'web'` and `_platform === 'ios'` (will test IndexedDB on both, since Phase 5 seam returns same adapter).
- Phase 6 will add SQLite-backed tests for `ios` path.

### Phase 6 Validation

- Verify SQLite adapter passes existing StorageAdapter test suite (same interface, semantics).
- Verify BackgroundUpload transport passes existing UploadTransport test suite.
- Add platform-specific integration tests (device-level: TestFlight on iOS).

## Summary

Phase 5 ships a single implementation for each adapter. The seam for Phase 6 is the factory function itself: it can either grow an internal platform check (call-time or factory-time) or be replaced wholesale. The contracts above ensure that whichever approach Phase 6 takes, the public API and error semantics are stable. Tests and callers need not change when the implementation swaps.
