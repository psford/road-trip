# Map POI Implementation Plan — Phase 4: POI Marker Layer on Maps

**Goal:** Display POI markers from the API as a GeoJSON overlay on both post and view maps, loading dynamically as the user pans and zooms.

**Architecture:** New `poiLayer.js` module manages a GeoJSON source and two MapLibre layers (circle markers + symbol labels). On `moveend` (debounced 300ms), it fetches `/api/poi` with current viewport bounds and zoom, then updates the GeoJSON source. Integrated into both `postUI.js` and `mapUI.js` map initialization.

**Tech Stack:** MapLibre GL JS 5.21.0, GeoJSON overlay layers, fetch API

**Scope:** 6 phases from original design (phase 4 of 6)

**Codebase verified:** 2026-04-03

**Codebase findings for this phase:**
- `api.js` handles all backend API calls — add POI fetch method there
- Post page map: `postUI.js` — pin-drop map at lines 409-445, photo map at 550-638
- View page map: `mapUI.js` — map init at line 57
- Route layer already uses GeoJSON source pattern in both files (lines 647-665 in postUI.js, 217-235 in mapUI.js)
- Scripts loaded via `<script>` tags, not ES modules

---

## Acceptance Criteria Coverage

This phase implements and tests:

### map-poi.AC1: POI markers on maps
- **map-poi.AC1.1 Success:** POI markers appear on the post page map when zoomed to an area with POIs
- **map-poi.AC1.2 Success:** POI markers appear on the view page map when zoomed to an area with POIs
- **map-poi.AC1.3 Success:** Markers are styled differently by category (parks, historic, tourism distinguishable)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add POI fetch method to api.js

**Verifies:** None (infrastructure for Phase 4)

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/api.js` (add `fetchPois` method)

**Implementation:**

Add a new static method to the existing `API` class in `api.js`:

```javascript
static async fetchPois(bounds, zoom) {
    const params = new URLSearchParams({
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLng: bounds.getWest(),
        maxLng: bounds.getEast(),
        zoom: Math.floor(zoom)
    });
    const response = await fetch(`/api/poi?${params}`);
    if (!response.ok) return [];
    return response.json();
}
```

This follows the existing pattern in `api.js` where static methods call backend endpoints and return parsed JSON.

**Verification:**
Run: `dotnet build src/RoadTripMap/RoadTripMap.csproj`
Expected: Build succeeds (JS is served statically, no build step)

**Commit:** `feat: add POI fetch method to api.js`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create poiLayer.js module

**Verifies:** map-poi.AC1.1, map-poi.AC1.2, map-poi.AC1.3

**Files:**
- Create: `src/RoadTripMap/wwwroot/js/poiLayer.js`

**Implementation:**

Create a new module that manages the POI overlay layer on a MapLibre map. Expose a global `PoiLayer` object (following the project's non-module pattern).

The module should provide:

**`PoiLayer.init(map)`** — Called after `map.on('load')`. Sets up:

1. A GeoJSON source named `poi-source` with empty FeatureCollection
2. A `circle` layer named `poi-markers` for marker dots:
   - `circle-radius`: 6
   - `circle-color`: data-driven by category using `match` expression:
     - `national_park` → `#2d6a4f` (dark green)
     - `state_park` → `#52b788` (light green)
     - `natural_feature` → `#7b2d26` (brown)
     - `historic_site` → `#6c4ab6` (purple)
     - `tourism` → `#d4a017` (gold)
     - default → `#666666`
   - `circle-stroke-color`: `#ffffff`, `circle-stroke-width`: 1.5
3. A `symbol` layer named `poi-labels` for text labels:
   - `text-field`: `['get', 'name']`
   - `text-size`: 11
   - `text-offset`: `[0, 1.2]` (below circle)
   - `text-anchor`: `top`
   - `text-color`: `#333333`
   - `text-halo-color`: `#ffffff`, `text-halo-width`: 1
   - `text-allow-overlap`: false
   - `minzoom`: 8 (labels only at higher zoom to reduce clutter)

**`PoiLayer.loadPois(map)`** — Fetches and updates POI data:

1. Get current bounds via `map.getBounds()`
2. Get current zoom via `map.getZoom()`
3. Call `API.fetchPois(bounds, zoom)`
4. Convert response to GeoJSON FeatureCollection:
   ```javascript
   {
     type: 'FeatureCollection',
     features: pois.map(p => ({
       type: 'Feature',
       geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
       properties: { id: p.id, name: p.name, category: p.category }
     }))
   }
   ```
5. Update source: `map.getSource('poi-source').setData(geojson)`

**Debounced moveend handler** — Attached during `init()`:
- Listen to `map.on('moveend', ...)` with a 300ms debounce
- On trigger, call `PoiLayer.loadPois(map)`
- Also trigger an initial load after init completes

**Verification:**
- Load post page with seeded POI data in the database
- Navigate to an area with POIs — markers should appear
- Pan/zoom — markers should update after 300ms debounce
- Different categories should show different colored dots

**Commit:** `feat: add poiLayer.js for dynamic POI marker overlay`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Integrate poiLayer.js into post and view pages

**Verifies:** map-poi.AC1.1, map-poi.AC1.2

**Files:**
- Modify: `src/RoadTripMap/wwwroot/post.html` (add script tag)
- Modify: `src/RoadTripMap/wwwroot/trips.html` (add script tag)
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js` (call `PoiLayer.init` in map load handlers)
- Modify: `src/RoadTripMap/wwwroot/js/mapUI.js` (call `PoiLayer.init` in map load handler)

**Implementation:**

**Script tags:** Add `<script src="/js/poiLayer.js"></script>` after `api.js` and before `parkStyle.js` in both HTML files. The load order should be:
- `api.js` (POI fetch method)
- `poiLayer.js` (POI layer management — depends on API)
- `parkStyle.js` (park styling — independent)
- Page-specific UI scripts

**postUI.js integration:**
In `initializePinDropMap()` (line ~415), inside the `map.on('load')` handler, after `applyParkStyling(this.map)`:
```javascript
PoiLayer.init(this.map);
```

In `renderPhotoMap()` (line ~570), inside the map load/idle handler, after `applyParkStyling(this.photoMap)`:
```javascript
PoiLayer.init(this.photoMap);
```

**mapUI.js integration:**
In `renderMap()` (line ~62), inside the `map.on('load')` handler, after `applyParkStyling(this.map)`:
```javascript
PoiLayer.init(this.map);
```

**Verification:**
- Open post page, open pin-drop map — POI markers appear when zoomed to seeded area
- Open view page — POI markers appear when zoomed to seeded area
- Pan and zoom — markers update dynamically
- No console errors

**Commit:** `feat: integrate POI markers into post and view page maps`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: POI marker layer visual verification

**Verifies:** map-poi.AC1.1, map-poi.AC1.2, map-poi.AC1.3

**Files:** None (verification only)

**Testing:**

This phase combines frontend JS with backend API. Verification:

1. Ensure database has seeded POI data (from Phase 2, or manually insert test rows)
2. Open post page → pin-drop map → zoom to area with POIs → markers appear (AC1.1)
3. Open view page → zoom to same area → markers appear (AC1.2)
4. Verify different categories show different colors (AC1.3):
   - Dark green for national parks
   - Light green for state parks
   - Brown for natural features
   - Purple for historic sites
   - Gold for tourism
5. Pan map → markers update after ~300ms
6. Zoom out far (zoom 4) → only national park markers visible
7. Zoom in (zoom 10+) → all categories visible
8. No console errors at any point

**Note:** POI marker rendering on maps is visual behavior that cannot be automated without a browser testing framework (which this project does not use). These are manual verification steps. The backend API logic (filtering, zoom categories, result cap) IS covered by automated tests in Phase 1.

**Verification:**
Run: `dotnet run --project src/RoadTripMap`
Expected: App starts, POI markers visible on all maps with category-based styling

**Commit:** None (verification only)

<!-- END_TASK_4 -->
