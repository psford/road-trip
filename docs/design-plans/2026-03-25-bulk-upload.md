# Bulk Photo Upload Design

## Summary
<!-- TO BE GENERATED after body is written -->

## Definition of Done
- Users can select multiple photos at once from the iOS photo picker on the post page
- GPS-tagged photos upload in the background without blocking the UI
- Non-GPS photos handled gracefully: pin-drop offered for a small number, skipped with a message for many
- Rate limit raised to support large batches (100+ photos)
- Existing single-photo flow still works unchanged
- Zero breaking changes to database schema or existing trip/photo data
- Progress feedback during bulk upload (approach TBD in design)

## Acceptance Criteria

### bulk-upload.AC1: Multi-select file picker works
- **bulk-upload.AC1.1 Success:** Tapping 'Add Photo' opens iOS photo picker with multi-select enabled
- **bulk-upload.AC1.2 Success:** Selecting 1 photo follows existing single-photo flow unchanged
- **bulk-upload.AC1.3 Success:** Selecting multiple photos enters bulk upload flow
- **bulk-upload.AC1.4 Edge:** Selecting 0 photos (cancelling picker) does nothing

### bulk-upload.AC2: GPS triage correctly categorizes photos
- **bulk-upload.AC2.1 Success:** Photos with EXIF GPS data are identified as GPS-tagged
- **bulk-upload.AC2.2 Success:** Photos without GPS data are identified as untagged
- **bulk-upload.AC2.3 Success:** All-GPS batch queues all photos for upload
- **bulk-upload.AC2.4 Success:** Mixed batch queues GPS photos immediately
- **bulk-upload.AC2.5 Edge:** All photos lack GPS — no uploads, appropriate message shown

### bulk-upload.AC3: Background upload with concurrency
- **bulk-upload.AC3.1 Success:** GPS-tagged photos upload without blocking the UI
- **bulk-upload.AC3.2 Success:** Maximum 3 uploads run concurrently
- **bulk-upload.AC3.3 Success:** Each completed upload adds a marker to the map immediately
- **bulk-upload.AC3.4 Success:** Carousel updates as each photo completes
- **bulk-upload.AC3.5 Failure:** Failed upload retries once automatically
- **bulk-upload.AC3.6 Failure:** Second failure marks photo as failed with manual retry option

### bulk-upload.AC4: Floating status bar shows progress
- **bulk-upload.AC4.1 Success:** Status bar appears at bottom when bulk upload starts
- **bulk-upload.AC4.2 Success:** Collapsed view shows 'N/M uploading...' with progress fill
- **bulk-upload.AC4.3 Success:** Tapping expands to show per-photo status list
- **bulk-upload.AC4.4 Success:** Auto-dismisses 3 seconds after all uploads complete
- **bulk-upload.AC4.5 Success:** Dismissing mid-upload continues uploads silently with badge on Add Photo
- **bulk-upload.AC4.6 Edge:** Single-photo upload does NOT show status bar

### bulk-upload.AC5: Non-GPS handling respects threshold
- **bulk-upload.AC5.1 Success:** 1-5 untagged photos trigger pin-drop prompt after GPS uploads finish
- **bulk-upload.AC5.2 Success:** Pin-drop flow is sequential (one photo at a time)
- **bulk-upload.AC5.3 Success:** 6+ untagged photos are skipped with message
- **bulk-upload.AC5.4 Success:** Skipped photos message shows exact count
- **bulk-upload.AC5.5 Edge:** Exactly 5 untagged photos triggers pin-drop (boundary)
- **bulk-upload.AC5.6 Edge:** Exactly 6 untagged photos triggers skip (boundary)

### bulk-upload.AC6: No regressions
- **bulk-upload.AC6.1 Success:** Existing single-photo upload flow works unchanged
- **bulk-upload.AC6.2 Success:** Existing trip and photo data unaffected
- **bulk-upload.AC6.3 Success:** Rate limit raised to 200/hour
- **bulk-upload.AC6.4 Success:** All existing backend tests pass

## Glossary
<!-- TO BE GENERATED after body is written -->

## Architecture

Bulk upload extends the existing single-photo upload flow without replacing it. When a user selects one photo, the current flow runs unchanged. When multiple photos are selected, a new client-side upload queue takes over.

**Flow:**

1. User taps "Add Photo" → iOS multi-select photo picker opens (HTML `multiple` attribute)
2. Client extracts EXIF GPS + timestamp from each file using exifr (existing library)
3. GPS triage sorts files into tagged and untagged buckets
4. GPS-tagged files enter the upload queue immediately (3 concurrent uploads)
5. Each upload hits the existing `POST /api/trips/{secretToken}/photos` endpoint — no new server endpoints
6. As each upload completes, map and carousel refresh to show the new marker
7. After GPS uploads finish, non-GPS handling triggers based on count

**GPS triage rules:**

| Untagged count | Behavior |
|----------------|----------|
| 0 | All photos queued, no special handling |
| 1 (single photo selected) | Existing pin-drop flow, unchanged |
| 1-5 | GPS photos upload immediately; status bar prompts "N photos need a location" after GPS uploads finish; user enters sequential pin-drop flow |
| 6+ | GPS photos upload immediately; status bar shows "N photos skipped — no GPS data"; user can add them individually later |

**Upload queue** (`uploadQueue.js`, new file):

- Manages a FIFO queue of pending uploads
- Runs up to 3 concurrent uploads via `Promise` pooling
- Each upload calls the existing `PostService.uploadPhoto()` — no new API call
- On failure: auto-retry once, then mark failed with manual retry option
- Emits events for the status bar UI to consume (progress, complete, failed)

**Floating status bar** (rendered by `uploadQueue.js`):

- Collapsed: progress fill bar with "N/M uploading..." text, pinned to viewport bottom
- Expanded (tap): scrollable list of per-photo status (thumbnail, filename, status icon)
- Auto-dismisses 3 seconds after all uploads complete
- If dismissed while uploads in-progress, uploads continue silently; badge appears on "Add Photo" button showing remaining count

**Server-side:** Only change is rate limit increase from 20 to 200 uploads/hour/IP in `UploadRateLimiter.cs`. The upload endpoint, photo processing (SkiaSharp 3-tier resize), blob storage, and database writes are unchanged.

## Existing Patterns

**Module pattern:** All existing JS modules (`PostUI`, `MapUI`, `PhotoCarousel`, `PostService`, `ExifUtil`) use the vanilla JS object-literal module pattern. `uploadQueue.js` follows the same pattern as `const UploadQueue = { ... }`.

**Service layer:** `PostService` handles business logic (metadata extraction, upload formatting). `API` handles HTTP calls. Bulk upload adds `uploadBatch()` to `PostService` which orchestrates the queue but delegates individual uploads to the existing `uploadPhoto()`.

**EXIF extraction:** `ExifUtil.extractAll(file)` already returns `{ gps: { lat, lng } | null, timestamp }`. Bulk upload calls this per file — no changes needed.

**Event handling:** `postUI.js` uses inline event handlers and direct DOM manipulation. The status bar follows this same pattern — no custom event system, just DOM updates driven by callback functions passed to the queue.

**Map/carousel refresh:** `PostUI.refreshPhotoList()` reloads all photos and re-renders the map and carousel. Bulk upload calls this after each successful upload so markers appear incrementally.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: File Input & GPS Triage
**Goal:** Accept multiple files and sort them by GPS availability.

**Components:**
- `src/RoadTripMap/wwwroot/post.html` — add `multiple` attribute to file input
- `src/RoadTripMap/wwwroot/js/postUI.js` — refactor `onFileSelected` to accept `FileList`, extract EXIF per file, sort into GPS/no-GPS buckets, route single-file to existing flow

**Dependencies:** None

**Done when:** Selecting multiple photos triggers EXIF extraction on each; GPS and non-GPS files are correctly categorized; selecting a single photo still follows the existing flow. Tests verify triage logic for: all GPS, mixed, all non-GPS, single file.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Upload Queue
**Goal:** Upload GPS-tagged photos in parallel with concurrency control and retry.

**Components:**
- `src/RoadTripMap/wwwroot/js/uploadQueue.js` (new) — FIFO queue with 3-concurrent-upload pool, retry logic, progress callbacks
- `src/RoadTripMap/wwwroot/js/postService.js` — add `uploadBatch(secretToken, filesWithMetadata)` that creates and starts the queue
- `src/RoadTripMap/wwwroot/js/postUI.js` — wire bulk flow to call `PostService.uploadBatch()` and refresh map/carousel on each completion

**Dependencies:** Phase 1 (triage provides the file list)

**Done when:** Multiple GPS-tagged photos upload concurrently (3 at a time), map updates incrementally as each completes, failed uploads retry once then report failure. Tests verify: concurrent upload limit, retry behavior, incremental refresh, queue completion callback.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Floating Status Bar
**Goal:** Visual progress feedback during bulk upload.

**Components:**
- `src/RoadTripMap/wwwroot/js/uploadQueue.js` — add status bar DOM rendering and update logic
- `src/RoadTripMap/wwwroot/css/styles.css` — status bar styles (fixed positioning, collapsed/expanded states, progress fill, mobile responsive)
- `src/RoadTripMap/wwwroot/post.html` — add status bar container element

**Dependencies:** Phase 2 (queue provides progress events)

**Done when:** Status bar appears during bulk upload showing progress count, expands to show per-photo status on tap, auto-dismisses after completion, uploads continue when dismissed. Tests verify: collapsed display, expanded display, auto-dismiss timing, dismiss-while-uploading badge.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Non-GPS Photo Handling
**Goal:** Handle untagged photos with pin-drop or skip based on count.

**Components:**
- `src/RoadTripMap/wwwroot/js/postUI.js` — after GPS uploads finish, check untagged count: 1-5 triggers sequential pin-drop flow, 6+ shows skip message in status bar
- `src/RoadTripMap/wwwroot/js/uploadQueue.js` — status bar messaging for skipped photos and pin-drop prompts

**Dependencies:** Phase 2 (queue completion), Phase 3 (status bar for messaging)

**Done when:** After bulk GPS upload, 1-5 untagged photos prompt for sequential pin-drop; 6+ untagged photos show skip message; pin-dropped photos upload through existing single-photo flow. Tests verify: threshold logic, skip message display, pin-drop prompt trigger.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Rate Limit & Verification
**Goal:** Raise rate limit and verify end-to-end flow.

**Components:**
- `src/RoadTripMap/Services/UploadRateLimiter.cs` — change `MaxUploadsPerHour` from 20 to 200
- End-to-end verification: select 10+ photos, confirm all GPS-tagged ones upload, map shows all markers, carousel updates, status bar reflects progress

**Dependencies:** Phases 1-4

**Done when:** Rate limit is 200/hour, backend tests pass, full bulk upload flow works end-to-end with no regressions to single-photo upload. Tests verify: rate limit constant change, existing single-photo upload still works.
<!-- END_PHASE_5 -->

## Additional Considerations

**No database migration needed.** Each bulk-uploaded photo creates a standard `PhotoEntity` row via the existing endpoint. No schema changes.

**Nominatim rate limiting.** The geocoding service has its own rate limiter (1 request/second per Nominatim policy). Bulk uploads trigger reverse geocoding server-side for each photo. With 3 concurrent uploads, geocoding requests may queue behind the rate limiter. This is acceptable — geocoding happens after blob upload, so the photo is saved even if geocoding is delayed.

**Mobile browser suspension.** If the user switches apps during upload, the browser may suspend network requests. Uploads resume when the user returns. No special handling needed — the queue retries on failure, which covers this case.
