# Map POI Implementation Plan — Phase 3: MapTiler Park Polygon Restyling

**Goal:** Make park boundaries visually prominent on both post and view maps by overriding MapTiler Streets v2 vector tile styles and adding park labels at lower zoom levels.

**Architecture:** Shared JS function that uses MapLibre GL JS `setPaintProperty()` to override existing `park` source-layer fill/line styles, plus a new `symbol` layer for park labels at zoom 6+. Applied in `map.on('load')` on both post and view page maps.

**Tech Stack:** MapLibre GL JS 5.21.0, MapTiler Streets v2 vector tiles (OpenMapTiles schema)

**Scope:** 6 phases from original design (phase 3 of 6)

**Codebase verified:** 2026-04-03

**Key research findings:**
- MapTiler Streets v2 uses OpenMapTiles schema — park polygons are in `park` source-layer
- `setPaintProperty(layerId, property, value)` overrides fill/line paint properties on existing layers
- `map.getStyle().layers.filter(l => l['source-layer'] === 'park')` finds park layers by source-layer name
- New `symbol` layer with `source-layer: 'park'` and `['get', 'name']` adds labels at custom zoom levels
- Vector tile source name is likely `maptiler_planet` — must be confirmed at runtime via `map.getStyle().sources`
- Use `map.on('load')` for initial style overrides (not `style.load`)

---

## Acceptance Criteria Coverage

This phase implements and tests:

### map-poi.AC2: Park polygon restyling
- **map-poi.AC2.1 Success:** Park boundaries display with bolder green fill and outline compared to default MapTiler style
- **map-poi.AC2.2 Success:** Park labels (e.g., "Franconia Notch State Park") visible at zoom level 6+ where previously invisible
- **map-poi.AC2.3 Success:** Restyling applies to both post and view page maps

---

<!-- START_TASK_1 -->
### Task 1: Create parkStyle.js shared module

**Verifies:** map-poi.AC2.1, map-poi.AC2.2

**Files:**
- Create: `src/RoadTripMap/wwwroot/js/parkStyle.js`

**Implementation:**

Create a new JS module following the project's existing module pattern (see `mapService.js`, `api.js`). This module exports a single function `applyParkStyling(map)` that:

1. Finds all existing layers with `source-layer === 'park'` OR (`source-layer === 'landuse'` with class `park`) using `map.getStyle().layers` — both source-layers may contain park polygons per the OpenMapTiles schema
2. For each `fill` type layer: override `fill-color` to `#2ecc71` (bold green), `fill-opacity` to `0.35`
3. For each `line` type layer: override `line-color` to `#1e8449` (dark green), `line-width` to `2`
4. Determines the vector tile source name by inspecting `map.getStyle().sources` — find the source with type `vector` (likely `maptiler_planet` or `openmaptiles`)
5. Adds a new `symbol` layer `park-labels-custom` using that source, with:
   - `source-layer: 'park'`
   - `minzoom: 6`, `maxzoom: 24`
   - `text-field: ['get', 'name']`
   - `text-size`: interpolated from 10 at zoom 6 to 14 at zoom 12
   - `text-color: '#1e5631'`
   - `text-halo-color: '#ffffff'`, `text-halo-width: 1.5`
   - `text-allow-overlap: false`
6. Guard: check `map.getLayer('park-labels-custom')` before adding to avoid duplicate layer errors on re-init

The function should be defensive — if no park layers are found, log a warning and return gracefully.

**Verification:**
- Load the post page in browser, navigate to a known park area (e.g., Yellowstone at zoom 6-8)
- Parks should display with bold green fill and visible labels
- No JS console errors

**Commit:** `feat: add parkStyle.js for MapTiler park polygon restyling`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Integrate parkStyle.js into post page maps

**Verifies:** map-poi.AC2.3 (post page half)

**Files:**
- Modify: `src/RoadTripMap/wwwroot/post.html` (add script tag for parkStyle.js)
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js` (call `applyParkStyling` in map load handlers)

**Implementation:**

In `post.html`, add `<script src="/js/parkStyle.js"></script>` after `mapService.js` and before `postUI.js` in the script loading order (around line 94, after the MapLibre CDN script).

In `postUI.js`, call `applyParkStyling(this.map)` inside the existing `map.on('load')` callback in two places:
1. `initializePinDropMap()` (line ~415 area) — after map creation, inside the load handler
2. `renderPhotoMap()` (line ~570 area) — after the photo map creation, inside its load/idle handler

If there's no existing `map.on('load')` wrapper, add one:
```javascript
this.map.on('load', () => {
    applyParkStyling(this.map);
});
```

**Verification:**
- Open post page, open pin-drop map — parks should show bold green styling
- Post a photo and view the photo map — parks should also show bold green styling
- No console errors

**Commit:** `feat: integrate park restyling into post page maps`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Integrate parkStyle.js into view page map

**Verifies:** map-poi.AC2.3 (view page half)

**Files:**
- Modify: `src/RoadTripMap/wwwroot/trips.html` (add script tag for parkStyle.js)
- Modify: `src/RoadTripMap/wwwroot/js/mapUI.js` (call `applyParkStyling` in map load handler)

**Implementation:**

In `trips.html`, add `<script src="/js/parkStyle.js"></script>` after `mapService.js` and before `mapUI.js` in the script loading order (around line 27).

In `mapUI.js`, call `applyParkStyling(this.map)` inside the `map.on('load')` callback in `renderMap()` (around line 62 area, after map creation).

**Verification:**
- Open a trip view page — parks should show bold green styling with labels at zoom 6+
- Compare with the post page — styling should be identical
- No console errors

**Commit:** `feat: integrate park restyling into view page map`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Park restyling visual verification

**Verifies:** map-poi.AC2.1, map-poi.AC2.2, map-poi.AC2.3

**Files:** None (verification only)

**Testing:**

This phase involves visual map styling that cannot be unit tested. Verification is manual:

1. Open the post page, navigate to Franconia Notch State Park area (lat: 44.14, lng: -71.68)
2. At zoom 6: verify park label "Franconia Notch State Park" is visible
3. At zoom 8: verify park boundary polygon has bold green fill with dark green outline
4. Verify the same at zoom 10+ (labels should remain visible)
5. Open a trip view page, navigate to same area — verify identical styling
6. Open browser dev tools console — verify no JS errors
7. Inspect via console: `map.getStyle().layers.filter(l => l['source-layer'] === 'park')` — verify park layers exist

No automated tests for this phase — it's purely visual CSS/style overrides on third-party vector tiles.

**Verification:**
Run: `dotnet build src/RoadTripMap/RoadTripMap.csproj && dotnet run --project src/RoadTripMap`
Expected: App starts, parks are visually prominent on all maps

**Commit:** None (verification only, no code changes)

<!-- END_TASK_4 -->
