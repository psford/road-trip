# State Park Boundaries Implementation Plan — Phase 5

**Goal:** Render state park boundaries on map with fill, outline, centroid dot, labels, and click behavior

**Architecture:** New `stateParkLayer.js` module following `parkStyle.js` patterns exactly — fill+outline+dot+label MapLibre layers with `sp-` prefix and a different color hue. Fetches boundaries from `GET /api/park-boundaries` via new `API.fetchParkBoundaries()` method. Updates GeoJSON source on map `moveend`. Integrates with existing toggle via `poiLayer._parkLayers` array. Click handlers on centroid dots follow same popup pattern as national parks with `onPoiSelect`/`onPoiZoom` callbacks.

**Tech Stack:** JavaScript / MapLibre GL JS / IndexedDB (via mapCache.js)

**Scope:** Phase 5 of 6 from original design

**Codebase verified:** 2026-04-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### state-park-boundaries.AC1: Boundaries visible on map
- **state-park-boundaries.AC1.1 Success:** State park fill+outline polygons render on map at zoom >= 8
- **state-park-boundaries.AC1.2 Success:** Centroid dot and label visible for each park in viewport, styled differently from national parks (different hue)
- **state-park-boundaries.AC1.3 Success:** Clicking centroid dot on post page shows popup with "Use this location" and "Pick nearby spot" buttons
- **state-park-boundaries.AC1.4 Failure:** No boundaries render at zoom < 8

### state-park-boundaries.AC5: Toggle integration
- **state-park-boundaries.AC5.1 Success:** Hide POIs button hides state park boundary fill, outline, dot, and label layers

---

<!-- START_TASK_1 -->
### Task 1: Add fetchParkBoundaries method to api.js

**Verifies:** state-park-boundaries.AC1.1 (data fetching)

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/api.js`

**Implementation:**

Add a new method to the `API` object following the existing `fetchPois` pattern. Place it after `fetchPois`:

```javascript
async fetchParkBoundaries(bounds, zoom, detail = 'moderate') {
    const params = new URLSearchParams({
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLng: bounds.getWest(),
        maxLng: bounds.getEast(),
        zoom: Math.floor(zoom),
        detail: detail
    });
    const response = await fetch(`${this.baseUrl}/park-boundaries?${params}`);
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `Failed to fetch park boundaries: ${response.status}`);
    }
    return response.json();
},
```

**Verification:**

Run:
```bash
cd /home/patrick/projects/road-trip && dotnet build src/RoadTripMap/RoadTripMap.csproj
```
Expected: Build succeeds (static file served).

<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->

<!-- START_TASK_2 -->
### Task 2: Create stateParkLayer.js

**Verifies:** state-park-boundaries.AC1.1, state-park-boundaries.AC1.2, state-park-boundaries.AC1.3, state-park-boundaries.AC1.4

**Files:**
- Create: `src/RoadTripMap/wwwroot/js/stateParkLayer.js`

**Implementation:**

Follow `parkStyle.js` structure exactly — global namespace object with `init(map, options)` entry point. Use `sp-` prefix for all layer/source IDs and a different color hue from national parks (#2d6a4f green → use teal #2a9d8f or similar — verify with user preference).

**Module structure:**

```javascript
const StateParkLayer = {
    _map: null,
    _options: {},
    _loadedIds: new Set(),
    _debounceTimer: null,

    init(map, options) { ... },
    _addSources() { ... },
    _addLayers() { ... },
    _setupClickHandlers() { ... },
    _setupMoveHandler() { ... },
    _loadBoundaries() { ... },
    _findFirstSymbolLayer() { ... }
};
```

**Layer structure (mirrors parkStyle.js):**

| Layer ID | Type | Style | Min Zoom |
|----------|------|-------|----------|
| `sp-boundary-fill` | fill | color TBD, opacity 0.15 | 8 |
| `sp-boundary-outline` | line | color TBD, width 2, opacity 0.7 | 8 |
| `sp-centroid-dot` | circle | radius 6, color TBD, stroke white | 8 |
| `sp-boundary-labels` | symbol | text from `name` property, color TBD | 8 |

**Sources:**
- `sp-boundaries` — GeoJSON source, starts empty `{ type: 'FeatureCollection', features: [] }`
- `sp-label-points` — GeoJSON source for centroid dots, starts empty

**Key behaviors:**

1. **`init(map, options)`** — Store map and options. Add sources and layers. Set up click handlers. Set up debounced `moveend` handler (300ms, same as poiLayer). Call `_loadBoundaries()` immediately.

2. **`_loadBoundaries()`** — Get viewport bounds and zoom from map. If zoom < 8, skip (AC1.4). Call `API.fetchParkBoundaries(bounds, zoom)` with default detail level (Phase 6 adds adaptive detail). On response, update `sp-boundaries` source data and compute centroid points for `sp-label-points` source. Track loaded park IDs in `_loadedIds` Set to avoid redundant source updates within a single page session. **IndexedDB cache integration is intentionally deferred to Phase 6** — Phase 5 focuses on correct rendering and interaction; Phase 6 adds persistent caching, adaptive detail, and prefetch as a cohesive unit. The in-memory `_loadedIds` Set will be replaced by `MapCache` lookups in Phase 6.

3. **`_setupClickHandlers()`** — On click of `sp-centroid-dot` layer, create popup with park name and optional action buttons. Follow parkStyle.js click handler pattern exactly (lines 120-167). If `options.onPoiSelect` provided, show "Use this location" button. If `options.onPoiZoom` provided, show "Pick nearby spot" button.

4. **`_findFirstSymbolLayer()`** — Same utility as parkStyle.js — finds first symbol layer to insert fill/outline below it.

5. **Centroid computation for label points** — For each feature in the response, use `properties.centroidLat` and `properties.centroidLng` (returned by API) to create point features for the label source. No need to compute centroid client-side — the API already provides it.

**Minzoom:** All layers use `minzoom: 8` (not 7 like national parks — state parks are denser and shouldn't appear until zoom 8 per AC1.4).

**Verification:**

Build succeeds. Manual testing in next task.

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Integrate stateParkLayer into map pages and toggle

**Verifies:** state-park-boundaries.AC1.1, state-park-boundaries.AC1.3, state-park-boundaries.AC5.1

**Files:**
- Modify: `src/RoadTripMap/wwwroot/trips.html` — add script tag
- Modify: `src/RoadTripMap/wwwroot/post.html` — add script tag
- Modify: `src/RoadTripMap/wwwroot/js/mapUI.js` — add init call
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js` — add init calls (two map contexts)
- Modify: `src/RoadTripMap/wwwroot/js/poiLayer.js` — add sp- layers to _parkLayers

**Implementation:**

**Script tags** — Add `<script src="/js/stateParkLayer.js"></script>` after `parkStyle.js` and before `photoCarousel.js` in both HTML files.

**mapUI.js** — In the `map.on('load')` handler (around line 67), after `PoiLayer.init(this.map)`, add:
```javascript
StateParkLayer.init(this.map);
```
No options needed on view page (no action buttons for visitors).

**postUI.js** — In both map load handlers:

Pin-drop map (around line 544, after `PoiLayer.init`):
```javascript
StateParkLayer.init(this.map, this._poiActionOptions());
```

Photo map (around line 728, after `PoiLayer.init`):
```javascript
StateParkLayer.init(this.photoMap, this._poiActionOptions());
```

**poiLayer.js** — Update `_parkLayers` array (line 174) to include state park layers:
```javascript
_parkLayers: [
    'nps-centroid-dot', 'nps-boundary-labels', 'nps-boundary-fill', 'nps-boundary-outline',
    'sp-centroid-dot', 'sp-boundary-labels', 'sp-boundary-fill', 'sp-boundary-outline'
],
```

This ensures `PoiLayer.show()`, `PoiLayer.hide()`, and `PoiLayer.toggle()` automatically control state park layers (AC5.1).

**Verification:**

Manual verification with running app:
1. Start the app: `cd /home/patrick/projects/road-trip && dotnet run --project src/RoadTripMap/RoadTripMap.csproj`
2. Open browser to trip view page
3. Zoom to >= 8 on an area with state parks — verify fill+outline polygons render with distinct color from national parks
4. Verify centroid dots and labels visible
5. Navigate to post page, zoom to park area — verify "Use this location" and "Pick nearby spot" buttons appear in popup on centroid dot click
6. Click "Hide POIs" button — verify state park layers disappear along with POI markers and national park layers

**Note on JavaScript testing:** This project uses Playwright for client-side e2e testing (no JS unit test framework). The manual verification steps above cover the same behaviors that a Playwright test would assert. A Playwright e2e test for state park boundaries is a follow-up task — it requires a running app with seeded boundary data and is best added after the import pipeline (Phase 2) has populated a test database.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/js/stateParkLayer.js src/RoadTripMap/wwwroot/js/api.js src/RoadTripMap/wwwroot/js/mapUI.js src/RoadTripMap/wwwroot/js/postUI.js src/RoadTripMap/wwwroot/js/poiLayer.js src/RoadTripMap/wwwroot/trips.html src/RoadTripMap/wwwroot/post.html
git commit -m "feat: render state park boundaries with fill, outline, dots, labels, and toggle integration"
```

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
