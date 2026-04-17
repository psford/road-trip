# Resilient Photo Uploads — Phase 3: Web UI (Progress Panel, Optimistic Pins, Resume, Retry, Pin-Drop Fallback)

**Goal:** Surface the Phase 2 queue state in the UI: a per-file progress panel, a resume banner on trip load, optimistic map pins with pending/committed/failed states, retry and pin-drop affordances on failed uploads. Gated behind a feature flag for dark release.

**Architecture:** Event-driven — each new UI module subscribes to DOM `CustomEvent`s emitted by `UploadQueue` (`upload:created`, `upload:progress`, `upload:committed`, `upload:failed`, `upload:aborted`, `version:reload-required`). Map pins use `maplibregl.Marker` per existing pattern. Feature flag is a server-rendered `<meta>` tag read at load.

**Tech Stack:** Vanilla JS, MapLibre GL JS, existing CSS tokens, Vitest + jsdom + Playwright for e2e.

**Scope:** Phase 3 of 7.

**Codebase verified:** 2026-04-13.

---

## Acceptance Criteria Coverage

### resilient-uploads.AC5: Per-file progress UI and pin-drop fallback

- **resilient-uploads.AC5.1 Success:** Per-file row per photo with live progress, filename, size, status icon.
- **resilient-uploads.AC5.2 Success:** Failed row exposes `[↻ retry]` button re-entering from first unfinished block.
- **resilient-uploads.AC5.3 Success:** Failed upload of a GPS-tagged photo exposes `[📍 Pin manually instead]` button routing to manual pin-drop.
- **resilient-uploads.AC5.4 Failure:** Max attempt count surfaced in UI ("gave up after 6 attempts").
- **resilient-uploads.AC5.5 Edge:** Progress panel collapsible; persists across navigations within the same trip.

### resilient-uploads.AC7: Optimistic photo placement

- **resilient-uploads.AC7.1 Success:** Photo with EXIF GPS produces a pending-state pin within ~1 s of `request-upload` success.
- **resilient-uploads.AC7.2 Success:** On commit, pending pin flips to committed styling with photo thumbnail.
- **resilient-uploads.AC7.3 Success:** On failure, pin turns red with retry / dismiss / pin-drop affordances when tapped.
- **resilient-uploads.AC7.4 Failure:** A photo without EXIF GPS does not produce an optimistic pin.
- **resilient-uploads.AC7.5 Edge:** Discarding a failed upload removes the red pin.

### resilient-uploads.ACX

- **resilient-uploads.ACX.4:** UI visual design for each user-facing screen in Phase 3 is reviewed with Patrick before implementation (gated by Task 2).

---

## Notes for Implementers

- **Feature flag.** `FeatureFlags.isEnabled('resilient-uploads-ui')` gates every new mount. When disabled, the legacy `UploadQueue.createStatusBar` path still runs (Phase 2 gave the legacy code a path via `UploadQueue` rewrite that dual-supports both).
- **DO NOT write CSS or HTML for Task 3/5/8 until Task 2 review is approved and recorded in `ui-review-notes.md`.** This is Patrick's hard gate (ACX.4).
- **Event contract from Phase 2:** `upload:created { uploadId, tripToken, filename, size, exif }`, `upload:progress { uploadId, bytesUploaded, totalBytes }`, `upload:committed { uploadId, photoId, tripToken, exif, photo }`, `upload:failed { uploadId, reason, error, exif }`, `upload:aborted { uploadId }`.
- **MapLibre pattern.** `mapUI.js` creates one `maplibregl.Marker` per photo with an HTML popup. Optimistic pins follow the same pattern using custom `element: document.createElement('div')` with `className` `photo-pin--pending|--committed|--failed` so CSS can swap appearance.

---

<!-- START_SUBCOMPONENT_A (task 1) -->
## Subcomponent A: Feature flag mechanism

<!-- START_TASK_1 -->
### Task 1: featureFlags.js and server wire-up

**Verifies:** None (enabling infra).

**Files:**
- Create: `src/RoadTripMap/wwwroot/js/featureFlags.js`
- Modify: `src/RoadTripMap/Pages/Post.cshtml` (render `<meta id="featureFlags" data-resilient-uploads-ui="@ViewData[...]">`)
- Modify: `src/RoadTripMap/Program.cs` (inject `FeatureFlags:ResilientUploadsUI` into ViewData on the post page handler)
- Modify: `src/RoadTripMap/appsettings.json` (default `"FeatureFlags": { "ResilientUploadsUI": false }`)

**Implementation:**

`FeatureFlags` global:
```js
const FeatureFlags = (() => {
  const node = document.getElementById('featureFlags');
  const ds = node?.dataset ?? {};
  const toBool = (v) => v === 'true' || v === 'True';
  return {
    isEnabled(camelCaseName) {
      const key = camelCaseName.replace(/-./g, c => c.charAt(1).toUpperCase());
      return toBool(ds[key]);
    }
  };
})();
```

Usage: `FeatureFlags.isEnabled('resilient-uploads-ui')`.

Server: page handler reads `builder.Configuration.GetValue<bool>("FeatureFlags:ResilientUploadsUI")`, writes to `ViewData["Flag_ResilientUploadsUI"]`.

**Verification:**

Run: `dotnet run`; view page source on `/trip/<token>`; meta tag present with correct value.

**Commit:** `feat(web): feature flag mechanism with meta-tag reader`
<!-- END_TASK_1 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 2-4) -->
## Subcomponent B: Progress panel

<!-- START_TASK_2 -->
### Task 2: UI visual design review with Patrick

**Verifies:** ACX.4 (gate for subsequent tasks).

**Files:**
- Create: `docs/implementation-plans/2026-04-13-resilient-uploads/ui-review-notes.md`

**Implementation:**

Produce ASCII / text mockups for each screen and share with Patrick in conversation BEFORE coding Task 3, 5, 8:

1. Progress panel — collapsed & expanded, per-file row states (queued / uploading / committing / done / failed / retrying).
2. Resume banner — trip page load with pending uploads.
3. Optimistic pin states — pending / committed / failed with popup.
4. Failed-row affordances — [↻ Retry] [📍 Pin manually] [✕ Discard] and "gave up after 6 attempts" copy placement.

Record Patrick's approval in `ui-review-notes.md` with a timestamp and any change requests. Any subsequent UI tweaks require an amendment entry.

**Verification:**

`ui-review-notes.md` has an explicit "Approved on YYYY-MM-DD by Patrick" line before Task 3 proceeds.

**Commit:** `docs(uploads): UI review notes for resilient uploads Phase 3`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: progressPanel.js + CSS

**Verifies:** AC5.1, AC5.2, AC5.4, AC5.5.

**Files:**
- Create: `src/RoadTripMap/wwwroot/js/progressPanel.js`
- Modify: `src/RoadTripMap/wwwroot/css/styles.css` (append `.upload-panel*` classes using existing tokens)
- Modify: `src/RoadTripMap/Pages/Post.cshtml` (add `<script src="~/js/progressPanel.js">` in correct load order after `uploadQueue.js`, before `postUI.js`)

**Implementation:**

`ProgressPanel` global with `mount(container)` and `unmount()`. On `mount`:
- Creates container `<div class="upload-panel" role="region" aria-label="Upload progress">` with header (collapse toggle + title + count) and body (`<ul class="upload-panel__list">`).
- Registers listeners on `document` for the 5 events; each handler finds-or-creates the row by `uploadId`.

Row structure per item:
```
<li class="upload-panel__row" data-upload-id="{uploadId}" data-status="...">
  <span class="upload-panel__icon">{icon per status}</span>
  <div class="upload-panel__meta">
    <span class="upload-panel__filename">{filename}</span>
    <span class="upload-panel__size">{formatBytes(size)}</span>
  </div>
  <div class="upload-panel__progress">
    <div class="upload-panel__progress-fill" style="width: X%"></div>
  </div>
  <span class="upload-panel__status">{status text}</span>
  <div class="upload-panel__actions">
    <button class="upload-panel__retry" hidden>↻ Retry</button>
    <button class="upload-panel__pin-drop" hidden>📍 Pin manually</button>
    <button class="upload-panel__discard" hidden>✕</button>
  </div>
  <span class="upload-panel__failed-reason" hidden></span>
</li>
```

State → visibility:
- `uploading`: progress bar visible; actions hidden.
- `failed (retryExhausted)`: retry hidden (already exhausted), `upload-panel__failed-reason` shows "gave up after 6 attempts" (AC5.4), pin-drop shown iff `exif.gps` exists (AC5.3, AC5.2 caveat), discard shown.
- `failed (retryable)`: retry + discard shown; pin-drop shown iff gps.
- `committed`: all actions hidden, check icon.
- `aborted`: row removed or greyed out.

Buttons:
- Retry → `UploadQueue.retry(uploadId)` (AC5.2).
- Pin manually → `PostUI.manualPinDropFor(uploadId)` (AC5.3, Task 6).
- Discard → `UploadQueue.abort(uploadId)`.

Collapse toggle: stores `sessionStorage[`upload-panel:${tripToken}:collapsed`]` (AC5.5).

CSS uses `var(--color-primary)`, `var(--color-danger)`, `var(--radius)`, `var(--shadow)`, `var(--space-sm)`.

Log sanitization: never log filenames as-is to persistent logs; browser `console.log` OK per project convention.

**Verification:**

Run: `npm test tests/js/progressPanel.test.js` (Task 4).
Also load the page behind the flag and upload 2 photos; panel renders and updates.

**Commit:** `feat(web): progress panel UI`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: progressPanel tests

**Verifies:** AC5.1, AC5.2, AC5.4, AC5.5.

**Files:**
- Create: `tests/js/progressPanel.test.js`

**Implementation:**

jsdom: create container, call `ProgressPanel.mount(container)`. Dispatch custom events in sequence, assert DOM reflects state:
- `upload:created` → row appears with `data-status="pending"`, filename visible, size formatted.
- `upload:progress` (0.5) → fill width ~50 %.
- `upload:committed` → row status `committed`, check icon, no action buttons.
- `upload:failed { reason: 'retryExhausted' }` → "gave up after 6 attempts" visible (AC5.4); retry hidden; discard shown; pin-drop shown when `exif.gps` present.
- Retry button click → `UploadQueue.retry` (stubbed) called with correct `uploadId` (AC5.2).
- Pin-drop button click → `PostUI.manualPinDropFor` called.
- Collapse toggle → `sessionStorage` updated; re-mount on the same trip token restores collapsed state (AC5.5).

**Verification:**

Run: `npm test tests/js/progressPanel.test.js`
Expected: Pass.

**Commit:** `test(web): progress panel event + action tests`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-6) -->
## Subcomponent C: Resume banner + postUI integration

<!-- START_TASK_5 -->
### Task 5: resumeBanner.js + CSS

**Verifies:** AC4.1 (banner surface — persistence itself covered in Phase 2), AC4.2, AC4.3.

**Files:**
- Create: `src/RoadTripMap/wwwroot/js/resumeBanner.js`
- Modify: `src/RoadTripMap/wwwroot/css/styles.css` (append `.resume-banner*`)
- Modify: `src/RoadTripMap/Pages/Post.cshtml` (script tag, mount container `<div id="resumeBannerContainer"></div>`)

**Implementation:**

`ResumeBanner` global with `async mount(container, tripToken)`:
1. `const items = await StorageAdapter.listNonTerminal(tripToken)`.
2. If `items.length === 0`, `unmount()`.
3. Render: "{count} upload{s} paused — [Resume] [Retry failed] [Discard all]". Count bucketed into pending/uploading vs failed.
4. Buttons:
   - Resume → `UploadQueue.resume(tripToken)`; banner updates reactively via `upload:committed` + `upload:failed` event listeners recounting items.
   - Retry failed → filter to `status='failed'`, call `UploadQueue.retry(uploadId)` for each.
   - Discard all → `UploadQueue.discardAll(tripToken)`.
5. When count reaches 0 (after listener recalculation), auto-unmount.

**Verification:**

Run: seed IndexedDB with 3 items in non-terminal states, reload page — banner visible with count 3. Click resume — stubbed uploads complete — banner disappears.

**Commit:** `feat(web): resume banner for non-terminal uploads`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: PostUI integration and manualPinDropFor

**Verifies:** AC5.3, AC7.5.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js`

**Implementation:**

In `PostUI.init()` (behind feature flag):
- `ProgressPanel.mount(document.getElementById('progressPanelContainer'))`.
- `await ResumeBanner.mount(document.getElementById('resumeBannerContainer'), this.secretToken)`.
- `OptimisticPins.init(this.mapUI)` (Task 8).

Add `async manualPinDropFor(uploadId, preloadedFile = null)`:
1. Fetch item from `StorageAdapter.getItem(uploadId)`; if still has a valid local `file_ref` or `preloadedFile` is supplied, reuse it.
2. Enter `showPinDropMap()` flow; on `onMapClick`, instead of posting a new photo, call `API.pinDropPhoto(secretToken, { uploadId, gpsLat, gpsLon })`.
3. On success: transition local item to `committed` (via `UploadQueue.markPinDropCommitted(uploadId, photoResponse)` helper added in Task 8 / or direct StorageAdapter + event emit). Dispatch `upload:committed` event so pins + progress panel update.
4. On failure: surface error toast; leave row in `failed` state.

For an upload that was `committed` but arrived without GPS (legacy user action), manualPinDrop reuses this same path since server `pin-drop` endpoint accepts either a pending `upload_id` or a committed `photo_id` (see Task 7).

**Verification:**

Integration test in Task 12 (Playwright) covers the full flow.

**Commit:** `feat(web): PostUI wiring for progress panel, resume banner, manual pin-drop`
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D (tasks 7-9) -->
## Subcomponent D: Optimistic map pins

<!-- START_TASK_7 -->
### Task 7: Backend pin-drop endpoint

**Verifies:** AC5.3 (server side of the fallback), supports AC7.3.

**Files:**
- Modify: `src/RoadTripMap/Endpoints/UploadEndpoints.cs` (add `POST /api/trips/{token}/photos/{photoId:guid}/pin-drop`)
- Modify: `src/RoadTripMap/Services/UploadService.cs` (add `PinDropAsync(tripToken, photoId, gpsLat, gpsLon)`)
- Modify: `src/RoadTripMap/wwwroot/js/api.js` (add `API.pinDropPhoto`)
- Modify: `tests/RoadTripMap.Tests/Endpoints/UploadEndpointTests.cs` (pin-drop happy path + cross-trip 404)

**Implementation:**

`PinDropAsync`:
- Load `photos` row by `photoId`; 404 if missing or trip mismatch.
- Update `Latitude`, `Longitude`, `LastActivityAt = UtcNow`. No blob changes.
- If row was `status='failed'`, flip to `committed` (user has manually provided location; no blob required for pin-drop-only photos? Design intent: a failed upload + manual pin means the photo data is lost but the event record stays — discuss; for now, we keep the row and mark it `committed_no_blob='true'` via a new bool column OR keep it simple: pin-drop only works for rows that already have a blob (successful commit that had no GPS). If user wants to salvage a failed upload with manual pin, that's a different flow — we delete the failed row and create a new one with no blob but valid GPS. Decision deferred to UI review; default implementation rejects pin-drop on `failed` rows with a 409 error and the UI routes to a "create note without photo" flow in Phase 4 if Patrick wants it.)

Scope for this task: pin-drop only succeeds on committed rows (AC7.3 surfaces the button but clicking it on a failed row shows "Not yet supported" — noted in ui-review-notes.md).

**Verification:**

Run: `dotnet test --filter "FullyQualifiedName~UploadEndpointTests"` — pin-drop tests pass.

**Commit:** `feat(uploads): pin-drop endpoint for post-upload manual GPS correction`
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: optimisticPins.js

**Verifies:** AC7.1, AC7.2, AC7.3, AC7.4, AC7.5.

**Files:**
- Create: `src/RoadTripMap/wwwroot/js/optimisticPins.js`
- Modify: `src/RoadTripMap/wwwroot/css/styles.css` (add `.photo-pin--pending`, `.photo-pin--committed`, `.photo-pin--failed`)
- Modify: `src/RoadTripMap/Pages/Post.cshtml` (script tag)

**Implementation:**

`OptimisticPins` global with `init(mapUI)`. Keeps `Map<uploadId, maplibregl.Marker>`.

Handlers:
- `upload:created`: if `detail.exif?.gps`, create DIV element with class `photo-pin photo-pin--pending`, attach to `new maplibregl.Marker({element}).setLngLat([gps.lon, gps.lat]).addTo(mapUI.map)`. Track by `uploadId`. (AC7.1)
- `upload:committed`: swap element's class to `photo-pin--committed`. Replace popup HTML with the real `mapUI.createPopupHtml(detail.photo)` once `detail.photo` is present. (AC7.2)
- `upload:failed`: swap class to `photo-pin--failed` (red). Popup HTML contains [↻ Retry] [✕ Discard] [📍 Pin elsewhere] buttons wired to `UploadQueue.retry`, `UploadQueue.abort`, `PostUI.manualPinDropFor`. (AC7.3)
- `upload:aborted`: remove marker, delete from map. (AC7.5)
- No GPS → no marker created (AC7.4, branch skipped above).

**Verification:** Task 9 tests.

**Commit:** `feat(web): optimistic map pins for in-flight uploads`
<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: optimisticPins tests

**Verifies:** AC7.1, AC7.2, AC7.3, AC7.4, AC7.5.

**Files:**
- Create: `tests/js/optimisticPins.test.js`

**Implementation:**

`vi.stubGlobal('maplibregl', { Marker: MockMarker, Popup: MockPopup })` where `MockMarker` records `setLngLat`, `setPopup`, `addTo`, `remove` calls, and `getElement`.

Scenarios:
- Dispatch `upload:created` with GPS → new marker at correct lnglat with `photo-pin--pending` class.
- Dispatch `upload:committed` with same `uploadId` → class swap to `--committed`; popup updated.
- Dispatch `upload:failed` → class `--failed`; popup HTML contains 3 action buttons.
- Dispatch `upload:aborted` → `remove` called; map size decreases.
- Dispatch `upload:created` without GPS → no marker created (AC7.4).

**Verification:**

Run: `npm test tests/js/optimisticPins.test.js`
Expected: Pass.

**Commit:** `test(web): optimistic pins lifecycle tests`
<!-- END_TASK_9 -->
<!-- END_SUBCOMPONENT_D -->

<!-- START_SUBCOMPONENT_E (task 10) -->
## Subcomponent E: Failure routing to pin-drop

<!-- START_TASK_10 -->
### Task 10: Extend postUI with failure routing

**Verifies:** AC5.3.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js` (extend `handleNoGpsFiles` to accept `uploadId`; wire progress-panel pin-drop button).

**Implementation:**

Refactor `handleNoGpsFiles(files)` to `handleNoGpsFiles(files, { uploadId = null } = {})`. When `uploadId` is provided, the pin-drop flow uses the pin-drop endpoint (Task 7) instead of a new upload. `PostUI.manualPinDropFor(uploadId)` delegates into this path.

Add `tests/js/postUI-failure-routing.test.js`: simulate `upload:failed` with GPS → click pin-drop in panel → `handleNoGpsFiles` called with `{ uploadId }` → `API.pinDropPhoto` called with correct args.

**Verification:**

Run: `npm test tests/js/postUI-failure-routing.test.js`
Expected: Pass.

**Commit:** `feat(web): failed-upload → manual pin-drop routing`
<!-- END_TASK_10 -->
<!-- END_SUBCOMPONENT_E -->

<!-- START_SUBCOMPONENT_F (task 11) -->
## Subcomponent F: Feature-flag cutover

<!-- START_TASK_11 -->
### Task 11: Wire feature flag in PostUI and UploadQueue

**Verifies:** None (enabling).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js`
- Modify: `src/RoadTripMap/wwwroot/js/uploadQueue.js`

**Implementation:**

In `PostUI.init`, mount new UI only if `FeatureFlags.isEnabled('resilient-uploads-ui')`. Else, retain legacy call `UploadQueue.createStatusBar` path.

In `UploadQueue`, bypass `createStatusBar` / `updateStatusBar` when flag enabled — leave them defined for fallback.

Default: config `FeatureFlags:ResilientUploadsUI=true` in `appsettings.Development.json`, `false` in `appsettings.Production.json`. Patrick toggles prod in Phase 4.

**Verification:**

Toggle flag; reload; verify legacy status bar appears with flag off, new panel with flag on. No JS errors in either mode.

**Commit:** `feat(web): gate new upload UI behind FeatureFlags:ResilientUploadsUI`
<!-- END_TASK_11 -->
<!-- END_SUBCOMPONENT_F -->

<!-- START_SUBCOMPONENT_G (task 12) -->
## Subcomponent G: End-to-end tests

<!-- START_TASK_12 -->
### Task 12: Playwright e2e

**Verifies:** AC4.1, AC5.1–AC5.5, AC7.1–AC7.5.

**Files:**
- Create: `tests/playwright/resilient-uploads.spec.js`
- Create: `tests/playwright/README.md` (fixture setup instructions)
- Create: `tests/playwright/playwright.config.js` if not already present
- Modify: `package.json` (add `@playwright/test` devDep, `test:e2e` script)

**Implementation:**

Playwright config spins up:
- Azurite via docker-compose.
- ASP.NET Core app with feature flag on, in-memory or test DB.

Test cases:
- Batch of 3 photos (use `setInputFiles` with synthetic JPEGs containing EXIF via `piexif` shim): progress panel renders 3 rows, optimistic pins appear immediately (pending styling), each row + pin commits green.
- Force-fail by `page.route` returning 503 on all PUT Block calls: row shows "gave up after 6 attempts" (AC5.4); pin turns red (AC7.3); [↻ Retry] and [📍 Pin manually] buttons present (AC5.2, AC5.3).
- Click [📍 Pin manually] on failed row → pin-drop map opens → click location → row transitions to committed, pin turns normal (via fallback endpoint).
- Mid-batch `page.context().close()`; new page `goto(sameTrip)`; resume banner shows count (AC4.1 banner surface).
- Click [Discard all] → banner gone; red pins removed (AC7.5).

**Verification:**

Run: `npm run test:e2e`
Expected: All scenarios pass.

**Commit:** `test(e2e): Playwright resilient-uploads scenarios`
<!-- END_TASK_12 -->
<!-- END_SUBCOMPONENT_G -->

<!-- START_SUBCOMPONENT_H (task 13) -->
## Subcomponent H: Deployment runbook

<!-- START_TASK_13 -->
### Task 13: Extend deployment-runbook.md with Phase 3 section

**Verifies:** None (operational).

**Files:**
- Modify: `docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md`

**Implementation:**

Append `## Phase 3 — Resilient uploads UI (dark release)`:

1. **Pre-flight** — `ui-review-notes.md` contains Patrick's approval.
2. **Deploy with flag OFF**
   - `[Azure Portal | bash/WSL]` Confirm `FeatureFlags:ResilientUploadsUI=false` in prod App Service configuration (use `az webapp config appsettings list` first).
   - `[GitHub web]` Merge + deploy.
   - `[bash/WSL]` Smoke: legacy status bar still works on a prod test trip.
3. **Staging validation with flag ON**
   - `[Azure Portal]` Flip flag to `true` on staging slot; trigger restart.
   - `[Browser]` Patrick verifies UI matches approved mockups; signs off in `ui-review-notes.md`.
4. **Prod cutover**
   - `[Azure Portal | bash/WSL]` `az webapp config appsettings set --name <prod-app> --resource-group <rg> --settings FeatureFlags__ResilientUploadsUI=true` (Note: `:` → `__` in App Service config).
   - Restart App Service.
   - Smoke: real trip upload; observe DevTools Network (Phase 2 check) + new UI rendering.
5. **Rollback** — flip flag to `false`; restart. No code revert needed.
6. **Sign-off** — Patrick initials.

**Verification:** Runbook reviewed before prod flag flip.

**Commit:** `docs(uploads): deployment runbook — Phase 3 UI dark release`
<!-- END_TASK_13 -->
<!-- END_SUBCOMPONENT_H -->

---

## Phase 3 Done When

- 13 tasks committed.
- `ui-review-notes.md` approved by Patrick prior to any UI coding.
- `npm test` green; `npm run test:e2e` green.
- Feature flag on/off both leave no console errors; upload completes in both paths.
- Deployment runbook Phase 3 section added and staging sign-off recorded.
