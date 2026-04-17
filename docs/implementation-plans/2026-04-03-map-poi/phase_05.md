# Map POI Implementation Plan — Phase 5: Tap-to-Pin Interaction (Post Page)

**Goal:** Users can tap a POI marker on the post page to adopt its location for a photo, with options to use exact coordinates or zoom in for a nearby spot.

**Architecture:** Click handler on the `poi-markers` layer in postUI.js (post page only). Shows a MapLibre popup with two action buttons that integrate with the existing pin-drop flow (marker placement + geocode call). View page deliberately does NOT get this handler.

**Tech Stack:** MapLibre GL JS 5.21.0, existing postUI.js pin-drop flow

**Scope:** 6 phases from original design (phase 5 of 6)

**Codebase verified:** 2026-04-03

**Codebase findings for this phase:**
- Pin-drop flow in `postUI.js`:
  - Line 418: `map.on('click')` places marker at clicked location
  - Line 429: Creates `maplibregl.Marker().setLngLat([lng, lat]).addTo(this.map)`
  - Line 432: Geocodes via `API.geocode(lat, lng)` and fills place name
  - Existing marker variable: `this.marker`
- Popup styling already exists in `styles.css` (lines 950-1007) — use same pattern
- View page (`mapUI.js`) has photo popups but no pin-drop interaction

---

## Acceptance Criteria Coverage

This phase implements and tests:

### map-poi.AC3: Tap-to-pin interaction
- **map-poi.AC3.1 Success:** Tapping a POI marker on the post page shows popup with POI name and two options
- **map-poi.AC3.2 Success:** "Use this location" sets photo coordinates to the POI centroid and fills place name
- **map-poi.AC3.3 Success:** "Pick nearby spot" zooms to POI area and lets user tap for precise location
- **map-poi.AC3.4 Failure:** Tapping a POI marker on the view page does NOT show the tap-to-pin popup (display only)

---

<!-- START_TASK_1 -->
### Task 1: Add POI click handler to postUI.js pin-drop map

**Verifies:** map-poi.AC3.1, map-poi.AC3.2, map-poi.AC3.3

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js` (add POI click handler in `initializePinDropMap()`)
- Modify: `src/RoadTripMap/wwwroot/css/styles.css` (add POI popup button styles)

**Implementation:**

In `postUI.js`, inside `initializePinDropMap()`, after `PoiLayer.init(this.map)`, add a click handler on the `poi-markers` layer:

```javascript
this.map.on('click', 'poi-markers', (e) => {
    if (!e.features || !e.features.length) return;
    
    const feature = e.features[0];
    const { name, id } = feature.properties;
    const [lng, lat] = feature.geometry.coordinates;
    
    // Remove any existing popup
    if (this.poiPopup) this.poiPopup.remove();
    
    // Create popup with two action buttons
    // IMPORTANT: Escape name to prevent XSS — POI names come from external sources
    const escapedName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const popupHTML = `
        <div class="poi-action-popup">
            <div class="poi-action-name">${escapedName}</div>
            <button class="poi-action-btn poi-use-location" data-lat="${lat}" data-lng="${lng}" data-name="${escapedName}">
                Use this location
            </button>
            <button class="poi-action-btn poi-pick-nearby" data-lat="${lat}" data-lng="${lng}">
                Pick nearby spot
            </button>
        </div>
    `;
    
    this.poiPopup = new maplibregl.Popup({ closeOnClick: true, maxWidth: '240px' })
        .setLngLat([lng, lat])
        .setHTML(popupHTML)
        .addTo(this.map);
    
    // "Use this location" handler
    const useBtn = this.poiPopup.getElement().querySelector('.poi-use-location');
    useBtn.addEventListener('click', async () => {
        this.poiPopup.remove();
        // Place marker at POI coordinates (same as existing click handler logic)
        if (this.marker) this.marker.remove();
        this.marker = new maplibregl.Marker()
            .setLngLat([lng, lat])
            .addTo(this.map);
        // Set the place name from POI name instead of geocoding
        // Fill the location fields using existing flow
        this.setLocationFromPoi(lat, lng, name);
    });
    
    // "Pick nearby spot" handler
    const nearbyBtn = this.poiPopup.getElement().querySelector('.poi-pick-nearby');
    nearbyBtn.addEventListener('click', () => {
        this.poiPopup.remove();
        // Zoom to POI area at zoom 13 for precise placement
        this.map.flyTo({ center: [lng, lat], zoom: 13 });
        // User then taps map normally via existing click handler
    });
});

// Change cursor on POI hover
this.map.on('mouseenter', 'poi-markers', () => {
    this.map.getCanvas().style.cursor = 'pointer';
});
this.map.on('mouseleave', 'poi-markers', () => {
    this.map.getCanvas().style.cursor = '';
});
```

Also add a `setLocationFromPoi(lat, lng, name)` method to the PostUI class that:
1. Updates the latitude/longitude form fields (find how existing pin-drop does this — likely `this.latInput.value` and `this.lngInput.value`)
2. Sets the place name directly to the POI name (skip geocoding since we already have the name)
3. Enables the submit/next button (same as existing flow after successful pin placement)

The exact integration depends on how the existing pin-drop click handler at line 418 stores coordinates and triggers the next step. Follow that pattern exactly.

**CSS additions** in `styles.css`:

```css
.poi-action-popup {
    padding: 8px;
    text-align: center;
}
.poi-action-name {
    font-weight: 600;
    margin-bottom: 8px;
    font-size: 14px;
    color: #333;
}
.poi-action-btn {
    display: block;
    width: 100%;
    padding: 8px 12px;
    margin-bottom: 6px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
}
.poi-action-btn:last-child {
    margin-bottom: 0;
}
.poi-use-location {
    background: #2d6a4f;
    color: white;
}
.poi-use-location:hover {
    background: #1e5631;
}
.poi-pick-nearby {
    background: #e9ecef;
    color: #333;
}
.poi-pick-nearby:hover {
    background: #dee2e6;
}
```

**Important:** The existing `map.on('click')` handler (line 418) fires for ALL map clicks. The POI click handler must prevent propagation so that clicking a POI marker does NOT also trigger a pin placement at that location. Use `e.originalEvent.stopPropagation()` in the POI handler, OR check in the generic click handler whether the click was on a POI feature.

Recommended approach: In the existing generic click handler, add a guard:
```javascript
// Skip if click was on a POI marker (handled by POI click handler)
const poiFeatures = this.map.queryRenderedFeatures(e.point, { layers: ['poi-markers'] });
if (poiFeatures.length > 0) return;
```

**Verification:**
- Open post page, open pin-drop map
- Click a POI marker — popup appears with POI name and two buttons
- Click "Use this location" — marker placed at POI, place name filled
- Click "Pick nearby spot" — map zooms to area, then click elsewhere for precise pin

**Commit:** `feat: add tap-to-pin interaction for POI markers on post page`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Verify view page does NOT show tap-to-pin

**Verifies:** map-poi.AC3.4

**Files:** None (verification only — no code changes needed)

**Testing:**

The view page (`mapUI.js`) calls `PoiLayer.init(map)` which only adds source + circle + symbol layers. The click handler on `poi-markers` is ONLY added in `postUI.js`. Therefore:

1. Open a trip view page
2. Navigate to an area with POI markers
3. Click on a POI marker
4. Verify: NO popup appears (no action buttons, no pin-drop behavior)
5. Verify: Photo popups still work normally on photo markers

This is a negative test — we're verifying the absence of behavior. No code changes are needed because the POI click handler was only added to `postUI.js`, not to `poiLayer.js` or `mapUI.js`.

**Verification:**
Run: `dotnet run --project src/RoadTripMap`
Expected: View page shows POI markers but clicking them does nothing

**Commit:** None (verification only)

<!-- END_TASK_2 -->
