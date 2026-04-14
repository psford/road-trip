# Map POI Implementation Plan — Phase 6: Pin-Drop Map Default Location

**Goal:** When opening the pin-drop UI, center the map on the last posted photo's location instead of the center of the US.

**Architecture:** Modify `initializePinDropMap()` in `postUI.js` to check if the trip has existing photos. If yes, use the last photo's coordinates at zoom 10. If no, fall back to center-of-US at zoom 4.

**Tech Stack:** MapLibre GL JS 5.21.0, existing postUI.js photo data

**Scope:** 6 phases from original design (phase 6 of 6)

**Codebase verified:** 2026-04-03

**Codebase findings for this phase:**
- Pin-drop map init in `postUI.js` at line 410: `center: [-98.5795, 39.8283], zoom: 4` (center of US)
- Photos are loaded via `loadPhotoList()` (line 504-540) and passed to `renderPhotoMap(photos)`
- The photo map carousel has access to photo data including `lat`/`lng` coordinates
- PostService module (`postService.js`) provides `listPhotos(secretToken)` for fetching photos
- Edit location modal also has a map at line 770 that should get the same treatment

---

## Acceptance Criteria Coverage

This phase implements and tests:

### map-poi.AC6: Pin-drop default location
- **map-poi.AC6.1 Success:** Pin-drop map centers on last posted photo's location when photos exist
- **map-poi.AC6.2 Success:** Pin-drop map falls back to center of US when trip has no photos

---

<!-- START_TASK_1 -->
### Task 1: Update pin-drop map default center to last photo location

**Verifies:** map-poi.AC6.1, map-poi.AC6.2

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js` (update `initializePinDropMap()` at ~line 409-445)

**Implementation:**

Modify `initializePinDropMap()` to determine the map center based on existing photos:

1. Check if photos are already loaded (the post page loads photos for the carousel/photo map)
2. If photos exist and the last photo has valid coordinates, use `[lastPhoto.lng, lastPhoto.lat]` at zoom 10
3. If no photos or no valid coordinates, fall back to `[-98.5795, 39.8283]` at zoom 4

The exact implementation depends on how photos are stored in the PostUI instance. Look at how `renderPhotoMap(photos)` receives its data — the same source should be available when `initializePinDropMap()` runs.

Likely approach:
```javascript
// In initializePinDropMap()
let center = [-98.5795, 39.8283];  // Center of US fallback
let zoom = 4;

// Check if photos are loaded (from carousel or photo list)
if (this.photos && this.photos.length > 0) {
    const lastPhoto = this.photos[this.photos.length - 1];
    if (lastPhoto.lat && lastPhoto.lng) {
        center = [lastPhoto.lng, lastPhoto.lat];
        zoom = 10;
    }
}

this.map = new maplibregl.Map({
    container: 'pinDropMap',
    style: MAP_STYLE,
    center: center,
    zoom: zoom
});
```

**If photos aren't available yet when pin-drop initializes:** The pin-drop might open before photos are loaded. In that case, either:
- Move the pin-drop center update to happen after photo load completes (add a `map.flyTo()` call)
- Or ensure photos load before pin-drop can be opened (check existing flow)

Check the order of operations in the PostUI initialization to determine the right approach. The key constraint is: don't break existing behavior if photos haven't loaded yet.

**Also apply to edit-location modal** (line ~770): If the edit location modal creates its own map, apply the same logic — but for edit-location, the better default is the CURRENT photo's coordinates (since you're editing a specific photo's location).

**Verification:**
- Post several photos with known locations
- Open pin-drop map for a new photo — should center on last posted photo's area at zoom 10
- Delete all photos — open pin-drop map — should center on US at zoom 4
- No console errors

**Commit:** `feat: default pin-drop map to last photo location`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Pin-drop default location tests

**Verifies:** map-poi.AC6.1, map-poi.AC6.2

**Files:** None (manual verification — frontend JS without build tooling)

**Testing:**

The center/zoom determination is pure conditional logic that could be extracted into a testable function (e.g., `getDefaultMapCenter(photos)` returning `{ center, zoom }`). Consider extracting during implementation if the logic grows complex. For now, these are manual verification steps since the project doesn't have a frontend testing framework:

1. **AC6.1 — Photos exist:**
   - Create a trip with at least one photo pinned to a known location (e.g., lat: 44.14, lng: -71.68)
   - Open the pin-drop UI to add another photo
   - Verify the map opens centered near lat: 44.14, lng: -71.68 at zoom ~10
   - The area should be recognizable (Franconia Notch area in this example)

2. **AC6.2 — No photos:**
   - Create a new trip with no photos
   - Open the pin-drop UI
   - Verify the map opens centered at approximately [-98.5795, 39.8283] (central Kansas/US) at zoom 4
   - The full continental US should be visible

3. **Edge cases:**
   - Trip with one photo that has no coordinates (lat/lng null) — should fall back to US center
   - Trip with multiple photos — should center on the LAST photo's location

**Verification:**
Run: `dotnet run --project src/RoadTripMap`
Expected: Pin-drop map centers correctly based on existing photos

**Commit:** None (verification only)

<!-- END_TASK_2 -->
