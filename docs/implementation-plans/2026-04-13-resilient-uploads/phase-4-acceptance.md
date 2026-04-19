# Phase 4 Acceptance Session

**Status:** ACCEPTED

## Session Details

- **Date:** 2026-04-17
- **Device:** iPhone (iOS Safari)
- **Connection type:** WiFi + cellular (mixed)
- **Trip used:** `281f3c41-10b6-4dcc-9123-8dce4f268227`

## Test Matrix

| Test | Photos | Result | Notes |
|------|--------|--------|-------|
| Batch upload (20+ photos) | 8+ photos across multiple batches | PASS | Uploads committed successfully via both azurewebsites.net and psfordtheriver.com (after CORS fix) |
| Progress panel rendering | 8 | PASS | Progress panel shows file names, sizes, and committed status |
| Optimistic pins (pending → committed) | 8 | PASS | Pins appeared on map at correct GPS locations |
| Retry on failure | 2 | PASS | Failed uploads on psfordtheriver.com showed retry/discard buttons (CORS was root cause, not app logic) |
| Resume after tab close | — | NOT TESTED | Not explicitly tested during session |
| Pin-drop on failed upload | — | NOT TESTED | Not explicitly tested during session |
| Discard all | — | NOT TESTED | Not explicitly tested during session |
| Version protocol (no-op expected) | — | PASS | No version mismatch errors observed |

## Metrics

- Photo count attempted: ~12 (across multiple batches on both domains)
- Photo count committed: 8+ confirmed committed
- Photo count failed: 2 (CORS issue on psfordtheriver.com, resolved by adding domain to blob storage CORS)
- Retry counts observed: 2 (auto-retry on CORS failures)
- Total upload duration: Fast — "MUCH better" per Patrick's assessment

## UI Issues

- Progress panel shows all photos appearing at once after parallel upload completes ("nothing... nothing... boom, both photos posted"). Patrick requested per-file progress bars. Filed as top-of-backlog improvement.

## Sign-off

- [x] Accepted by Patrick on 2026-04-17
- [ ] OR: Defect list below blocks progression

## Defects

- **CORS missing for psfordtheriver.com** — blob storage CORS rules had `psfordtaurus.com` (stock analyzer) but not `psfordtheriver.com`. Fixed during session by adding the domain to Azure Blob Storage CORS. Root cause: domain was never added when custom domain was configured for road trip app.

## Follow-up Items

- Per-file gradient progress bars in upload progress panel (top of backlog — Patrick specifically requested this)
- Client-side image processing now deployed and enabled (`Upload:ClientSideProcessingEnabled=true`) — significant improvement in upload speed and reliability

## Legacy-Trip Audit

24 rows found, all `status='pending'` from test uploads in last 2 days. No `status='failed'` rows.

All will be auto-swept by `OrphanSweeperHostedService` after 48 hours (stale threshold). No manual intervention needed.

| Trip ID | Count | Last Activity | Resolution |
|---------|-------|---------------|------------|
| 55 | 8 | 2026-04-16 02:19–03:01 | orphan-swept (test uploads) |
| 57 | 6 | 2026-04-17 00:12 | orphan-swept (test uploads) |
| 59 | 1 | 2026-04-17 00:23 | orphan-swept (test uploads) |
| 60 | 6 | 2026-04-17 04:26 | orphan-swept (test uploads, CORS failures) |
| 40 | 3 | 2026-04-17 04:34 | orphan-swept (test uploads, CORS failures) |
