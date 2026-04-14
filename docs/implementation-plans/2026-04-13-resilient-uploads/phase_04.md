# Resilient Photo Uploads — Phase 4: Web Stabilization

**Goal:** Validate the Phases 1–3 pipeline against real-world network conditions and Patrick's active trip. Add minimal observability. Remove the feature flag after acceptance.

**Architecture:** No new runtime modules. Structured telemetry sprinkled into existing modules. Playwright suite extended with network-condition simulation. Acceptance recorded in a dated document.

**Tech Stack:** existing (Vitest, Playwright). Optional App Insights `trackEvent` if environment has the instrumentation key.

**Scope:** Phase 4 of 7.

**Codebase verified:** 2026-04-13.

---

## Acceptance Criteria Coverage

Operational phase — tightens real-world quality of AC3, AC4, AC5, AC7; explicitly verifies ACX.2.

- **resilient-uploads.ACX.2:** All errors surfaced to the user include enough context to retry or recover; no silent failures.

---

## Notes for Implementers

- **Do not add new features.** This phase exclusively hardens and observes. Any feature request surfaced during acceptance gets filed to `docs/implementation-plans/2026-04-13-resilient-uploads/phase-4-acceptance.md` as a follow-up item, not implemented here.
- **Telemetry sanitization.** No SAS URLs, blob paths with tokens, or GPS coordinates in any log line (ACX.1).
- **Patrick is the acceptance reviewer.** Task 5 cannot be self-signed-off.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
## Subcomponent A: Telemetry and failure surfaces

<!-- START_TASK_1 -->
### Task 1: Structured upload telemetry

**Verifies:** None (enabling observability).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/uploadQueue.js`, `uploadTransport.js` (emit structured events)
- Create: `src/RoadTripMap/wwwroot/js/uploadTelemetry.js`
- Modify: `src/RoadTripMap/Program.cs` (correlation-id middleware + structured logs)

**Implementation:**

`UploadTelemetry` global: `record(eventName, payload)`. If `window.appInsights` defined, calls `trackEvent`; else `console.info(JSON.stringify({event, ...payload, ts}))` (so prod ASP.NET logs pick it up via browser → server if routed; otherwise DevTools-inspectable).

Events and payloads (sanitized):
- `upload.requested { uploadId, tripTokenPrefix, sizeBytes, exifPresent }`
- `upload.block_completed { uploadId, blockIndex, attempts, durationMs }`
- `upload.block_retry { uploadId, blockIndex, attempt, statusCode, nextBackoffMs }`
- `upload.committed { uploadId, photoId, totalDurationMs, blockCount }`
- `upload.failed { uploadId, reason, lastError, attemptCount }`
- `upload.sas_refreshed { uploadId }`
- `upload.resumed { uploadId, remainingBlocks }`

Server adds per-request `x-correlation-id` header (GUID) middleware. Logs include `correlation_id`, `upload_id` where applicable. Document the correlation approach in runbook Task 8.

**Verification:**

Run: Upload a photo with DevTools console open; verify structured JSON events emitted in correct order.

**Commit:** `feat(observability): structured upload telemetry + correlation ids`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: No-silent-failures audit test

**Verifies:** ACX.2.

**Files:**
- Create: `tests/js/no-silent-failures.test.js`

**Implementation:**

Exhaustive parameterized test that forces each known error branch:
1. `API.requestUpload` throws → `upload:failed` event emitted AND `uploadTelemetry.record('upload.failed', ...)` called.
2. `UploadTransport.uploadFile` throws `PermanentError` → same.
3. `API.commit` throws 400 → same.
4. `StorageAdapter.putItem` rejects → caller catches and surfaces (not swallowed).
5. `versionProtocol.js` header parse exception → console.warn but no crash; covered in its own test, asserted here too.

Uses `vi.spyOn` to count calls. Any silent branch fails the test.

**Verification:**

Run: `npm test tests/js/no-silent-failures.test.js`
Expected: Pass.

**Commit:** `test(uploads): audit every error branch surfaces user-visible or structured log`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (task 3) -->
## Subcomponent B: Throttled-network e2e

<!-- START_TASK_3 -->
### Task 3: Playwright throttled-network scenarios

**Verifies:** AC3.2, AC3.3, AC3.5, AC4.1, AC4.2, AC5.1, ACX.2 under real-ish conditions.

**Files:**
- Modify: `tests/playwright/resilient-uploads.spec.js` (extend with throttled scenarios)
- Create: `tests/playwright/helpers/networkConditions.js`

**Implementation:**

Helper exposing `applySlow3G(page)`, `applyOffline(page)`, `applyPacketLoss(page, { ratio })` (`page.route` drops/503s per ratio).

New scenarios:
- 20-photo batch under Slow 3G (uses `page.context().route` to throttle bandwidth via `await route.continue()` with artificial delay): all 20 committed within a generous bound (<10 min CI budget). Inspect structured events — at least one block retry observed, zero permanent failures.
- Intermittent offline: upload 10 photos, mid-batch `setOffline(true)` for 30 s then `setOffline(false)`. Verify all 10 commit (AC3.5 SAS may or may not have expired — recover either way).
- 10% packet-loss (route drops 1 in 10 PUT Block calls by returning 503): all photos commit; retries visible in events; failure rate stays <5% final.

Success criteria asserted in the test: final DB has `committed` rows for 100 % of uploads, zero `failed`.

**Verification:**

Run: `npm run test:e2e -- resilient-uploads.spec.js`
Expected: All scenarios pass within CI timeout.

**Commit:** `test(e2e): throttled-network Playwright scenarios`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 4-6) -->
## Subcomponent C: Stabilization and acceptance

<!-- START_TASK_4 -->
### Task 4: Reserved for edge-case fixes surfaced during Task 3 and Task 5

**Verifies:** Depends on bugs found.

**Files:**
- Variable.

**Implementation:**

During execution, any defect surfaced by throttled-network suite or Patrick's acceptance session is filed here. Each fix commit includes a test reproducing the bug. If no issues surface, close with an empty-content commit: `chore: Phase 4 stabilization pass with no defects found` (Git allows `--allow-empty`; use that rather than fabricating work).

**Verification:**

All filed bugs have corresponding regression tests that pass.

**Commit:** `fix(uploads): [per defect]` or `chore: Phase 4 stabilization pass with no defects found`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Patrick acceptance session

**Verifies:** Real-world validation across AC3, AC4, AC5, AC7.

**Files:**
- Create: `docs/implementation-plans/2026-04-13-resilient-uploads/phase-4-acceptance.md`

**Implementation:**

Scheduled session with Patrick:
- Deploy latest develop to staging (or prod with flag on via Phase 3 runbook).
- Patrick opens real trip on mobile with real cellular network.
- Upload 20+ photos. Observe progress panel, optimistic pins, any retries.
- Record in `phase-4-acceptance.md`:
  - Session date, device, connection type.
  - Photo count attempted / committed / failed.
  - Retry counts observed (from telemetry).
  - Any UI issues (screenshots if possible).
  - Sign-off or open defects list.

Pass criteria: 100 % of photos ultimately committed (after retries / manual pin-drop); UI matches Phase 3 approved mockups; no data loss.

**Verification:**

`phase-4-acceptance.md` contains an "Accepted by Patrick on YYYY-MM-DD" line OR a defect list that blocks progression to Task 7.

**Commit:** `docs(uploads): Phase 4 acceptance session notes`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Legacy-trip recoverability audit

**Verifies:** ACX.3 (legacy trips keep working), and resolves any pre-rollout failed uploads on Patrick's active trip.

**Files:**
- Create: `scripts/audit-failed-uploads.sh` or `scripts/audit-failed-uploads.py`
- Append to: `docs/implementation-plans/2026-04-13-resilient-uploads/phase-4-acceptance.md`

**Implementation:**

Script connects to prod DB (via `az keyvault secret show`) and queries `SELECT id, trip_id, status, last_activity_at FROM roadtrip.Photos WHERE status IN ('failed', 'pending') AND last_activity_at > DATEADD(day, -30, GETUTCDATE())`. For each result, emit Trip URL and instructions for the user to retry or pin-drop in the new UI.

Patrick runs through each flagged photo via the new UI. Audit line appended for each: `{photo_id}: {retry|pin-drop|discard|orphan-swept}`.

Zero unresolved entries required before Task 7.

**Verification:**

Script runs green; all flagged rows resolved.

**Commit:** `chore(uploads): legacy-trip failed-upload audit script + resolutions`
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D (task 7) -->
## Subcomponent D: Feature-flag removal

<!-- START_TASK_7 -->
### Task 7: Remove FeatureFlags:ResilientUploadsUI

**Verifies:** None; cleanup.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js` — remove `FeatureFlags.isEnabled('resilient-uploads-ui')` branches; keep only new code path.
- Modify: `src/RoadTripMap/wwwroot/js/uploadQueue.js` — remove legacy `createStatusBar` / `updateStatusBar` / `removeStatusBar` dead code.
- Modify: `src/RoadTripMap/wwwroot/css/styles.css` — remove `.upload-status-bar` styles.
- Modify: `src/RoadTripMap/Pages/Post.cshtml` — remove `data-resilient-uploads-ui` attribute.
- Modify: `src/RoadTripMap/appsettings.json`, `appsettings.Production.json` — remove `FeatureFlags:ResilientUploadsUI`.
- Modify: `src/RoadTripMap/Program.cs` — remove ViewData injection for that flag.

Keep `featureFlags.js` util and the `<meta id="featureFlags">` scaffolding (both useful for future flags — confirm with Patrick if he'd prefer a full removal).

**Verification:**

Run: `dotnet build`, `npm test`, `npm run test:e2e`. All green. Manual: load page; new UI is the only path.

**Commit:** `chore(uploads): remove ResilientUploadsUI feature flag after Phase 4 acceptance`
<!-- END_TASK_7 -->
<!-- END_SUBCOMPONENT_D -->

<!-- START_SUBCOMPONENT_E (task 8) -->
## Subcomponent E: Deployment runbook

<!-- START_TASK_8 -->
### Task 8: Extend deployment-runbook.md with Phase 4 section

**Verifies:** None (operational).

**Files:**
- Modify: `docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md`

**Implementation:**

Append `## Phase 4 — Stabilization + flag removal`:

1. **Pre-flight**
   - `phase-4-acceptance.md` has Patrick's sign-off.
   - Legacy-trip audit (Task 6) closed with zero unresolved entries.

2. **Deploy code change (flag removal)**
   - `[GitHub web]` Merge PR; CI deploys.
   - `[bash/WSL]` Smoke: `curl -I https://<prod>/post/<trip>` loads; DevTools verifies no flag meta attribute; upload one photo.

3. **Remove the flag from prod App Service config**
   - `[bash/WSL]` `az webapp config appsettings delete --name <prod-app> --resource-group <rg> --setting-names FeatureFlags__ResilientUploadsUI`.

4. **Observability check**
   - `[bash/WSL]` Query structured logs for last 24 h — assert zero `upload.failed` with `reason='silent'` (i.e., an unexpected failure reason).

5. **Rollback**
   - Revert the removal commit (new branch off main, cherry-pick revert, PR, merge). Flag re-appears in config; staging can flip it back to `false` temporarily. This is a heavier rollback than earlier phases — document that accepting Task 5 is a commitment to the new path.

6. **Sign-off** — Patrick initials.

**Verification:** Runbook reviewed.

**Commit:** `docs(uploads): deployment runbook — Phase 4 stabilization + flag removal`
<!-- END_TASK_8 -->
<!-- END_SUBCOMPONENT_E -->

---

## Phase 4 Done When

- Patrick's acceptance session is signed off.
- Throttled-network Playwright suite green in CI.
- Structured telemetry observable in prod logs for at least one upload flow.
- Legacy-trip audit closed.
- Feature flag removed.
- Failure rate under simulated Slow 3G < 5 % (measured via telemetry over 20+ photo batch).
- Deployment runbook Phase 4 section added and signed off.
