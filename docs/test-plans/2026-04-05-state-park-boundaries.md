# Human Test Plan: State Park Boundaries

**Feature:** State park boundary rendering with adaptive detail, caching, and prefetch
**Implementation plan:** `docs/implementation-plans/2026-04-05-state-park-boundaries/`
**Date:** 2026-04-05

## Prerequisites

- Road-trip application running locally (`dotnet run` from the web project)
- Database seeded with state park boundaries (run PadUsBoundaryImporter or use pre-seeded DB)
- Automated tests passing: `dotnet test` from the test project
- Chrome browser (required for `navigator.connection` API in AC3.x tests)
- DevTools familiarity for network inspection and IndexedDB browsing

---

## Phase 1: Map Rendering

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Start the app locally. Navigate to a trip view page. | Page loads with the MapLibre GL map visible. |
| 1.2 | Zoom to level 8+ in Washington state (near Deception Pass, ~48.4N, -122.4W). | State park boundary polygons appear as filled polygons with visible outlines. |
| 1.3 | Verify centroid dots and labels appear for each visible state park. | Each park shows a dot at its centroid with a text label showing the park name. |
| 1.4 | Pan to an area where both a national park and state park are visible (e.g., Olympic NP area). | State park dots/labels use a visibly different hue (teal) from national park dots/labels (green). |
| 1.5 | Zoom out to level 7. | All state park layers disappear: no fill, outlines, dots, or labels. |
| 1.6 | Zoom back to level 8. | State park layers reappear immediately. |

**Covers:** AC1.1, AC1.2, AC1.4

---

## Phase 2: Post Page Interaction

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Navigate to the post/create page. | Map loads on the post page. |
| 2.2 | Zoom to level 8+ near a known state park. | State park centroid dots are visible. |
| 2.3 | Click a state park centroid dot. | Popup appears with park name, "Use this location" button, and "Pick nearby spot" button. |
| 2.4 | Click "Use this location". | Park location selected as post location. Popup closes. |
| 2.5 | Click the same dot again, then click "Pick nearby spot". | Map zooms into the park area for finer location selection. |

**Covers:** AC1.3

---

## Phase 3: Adaptive Detail Level

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Open Chrome DevTools Network tab. Ensure no throttling is active. | DevTools open, network tab visible. |
| 3.2 | Zoom to level 8+ near state parks. Check the `/api/park-boundaries` request URL. | `detail` parameter should be `full` or `moderate` on a fast connection. |
| 3.3 | Enable "Slow 3G" throttle in DevTools. | Throttling active. |
| 3.4 | Pan the map to trigger a new request. | Request URL shows `detail=simplified`. |
| 3.5 | Disable throttling (back to "Online"). Pan the map again. | Next request uses higher detail level (`moderate` or `full`), confirming mid-session adaptation. |

**Covers:** AC3.1, AC3.2, AC3.3

---

## Phase 4: IndexedDB Caching

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | Open DevTools Network tab. Clear IndexedDB if needed for clean state. | Network tab open, clean state. |
| 4.2 | Zoom to level 8+ near state parks. Observe requests. | At least one `/api/park-boundaries` request with 200 response. |
| 4.3 | Open Application tab > IndexedDB > `roadtripmap-cache` > `map-data`. | Entries exist for fetched park boundary data. |
| 4.4 | Reload the page (F5). | Page reloads. |
| 4.5 | Zoom to the same area at the same zoom level. Watch Network tab. | No new `/api/park-boundaries` request. Boundaries render from cache. |

**Covers:** AC3.4

---

## Phase 5: Prefetching at Zoom 7

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | Open DevTools Network tab. Navigate to an area with state parks at zoom 6. | No `/api/park-boundaries` requests fire. |
| 5.2 | Zoom to level 7. | Background requests fire for `detail=simplified` at `zoom=8`. Additional requests for expanded bounds at all detail levels may appear. |
| 5.3 | Zoom to level 8. | Boundaries render immediately with no new network requests (prefetched). |

**Covers:** AC3.5

---

## Phase 6: Hide POIs Toggle

| Step | Action | Expected |
|------|--------|----------|
| 6.1 | Zoom to level 8+ with state park boundaries visible. | Fill polygons, outlines, centroid dots, and labels all visible. |
| 6.2 | Click the "Hide POIs" button. | All state park layers disappear simultaneously. National parks and POIs also hide. |
| 6.3 | Click "Show POIs" (toggle back). | All layers reappear. |

**Covers:** AC5.1

---

## End-to-End: Full Import-to-Render Pipeline

1. Start with an empty `ParkBoundaries` table (or drop and recreate).
2. Run PadUsBoundaryImporter against the live PAD-US service. Note imported/merged/skipped counts.
3. Query DB: `SELECT COUNT(*) FROM ParkBoundaries` -- should match imported count.
4. Spot-check a known park (e.g., `SELECT * FROM ParkBoundaries WHERE Name = 'Deception Pass' AND State = 'WA'`). Verify all three GeoJSON columns populated and differ in length. Verify bbox/centroid are geographically reasonable.
5. Start the app. Navigate to zoom 8 near the spot-checked park.
6. Confirm boundary polygon renders at the correct location.
7. Click centroid dot. Confirm popup shows correct park name.

---

## End-to-End: Idempotent Re-Import

1. Note current row count: `SELECT COUNT(*) FROM ParkBoundaries`.
2. Run PadUsBoundaryImporter again.
3. Verify row count unchanged.
4. Spot-check a park: geometry, acres, centroid unchanged.
5. Reload the map. Confirm rendering unchanged.

---

## Traceability Matrix

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 - Polygons render at zoom >= 8 | -- | Phase 1: 1.2, 1.6 |
| AC1.2 - Centroid dot/label different hue | -- | Phase 1: 1.3, 1.4 |
| AC1.3 - Click shows popup with buttons | -- | Phase 2: 2.3-2.5 |
| AC1.4 - No boundaries at zoom < 8 | -- | Phase 1: 1.5-1.6 |
| AC2.1 - GeoJSON FeatureCollection with bbox overlap | `ParkBoundaryEndpointTests` | -- |
| AC2.2 - detail parameter selects level | `ParkBoundaryEndpointTests` | -- |
| AC2.3 - Capped at 50, sorted by GisAcres | `ParkBoundaryEndpointTests` | -- |
| AC2.4 - 400 for invalid parameters | `ParkBoundaryEndpointTests` (5 tests) | -- |
| AC2.5 - Empty at zoom < 8 | `ParkBoundaryEndpointTests` | -- |
| AC3.1 - Slow connection requests simplified | -- | Phase 3: 3.3-3.4 |
| AC3.2 - Fast connection requests full/moderate | -- | Phase 3: 3.2 |
| AC3.3 - Detail adapts mid-session | -- | Phase 3: 3.2-3.5 |
| AC3.4 - IndexedDB cache persists | -- | Phase 4: 4.1-4.5 |
| AC3.5 - Zoom 7 prefetches | -- | Phase 5: 5.1-5.3 |
| AC4.1 - Import populates table | `PadUsBoundaryImporterTests` | -- |
| AC4.2 - Parcel merging | `PadUsBoundaryImporterTests` | -- |
| AC4.3 - Tiny polygon filter | `GeoJsonProcessorTests` | -- |
| AC4.4 - Three simplification levels | `GeoJsonProcessorTests` | -- |
| AC4.5 - Bbox and centroid | `GeoJsonProcessorTests` (6 tests) | -- |
| AC4.6 - Idempotent import | `PadUsBoundaryImporterTests` | -- |
| AC5.1 - Toggle hides all layers | -- | Phase 6: 6.1-6.3 |
