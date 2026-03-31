# MapLibre Migration Design

## Summary

The road-trip app currently uses Leaflet, a raster-tile mapping library, to render interactive maps on two pages: the post page (where users drop a pin for location and view uploaded photos as map markers) and the view page (where completed trips are displayed with a route line and photo carousel). Leaflet has an unfixed bug (#5484) where popups containing images cause the map to auto-pan incorrectly, requiring a brittle overflow-detection hack to work around it. This migration replaces Leaflet wholesale with MapLibre GL JS, a modern vector-tile library, using MapTiler Cloud as the tile provider.

The approach is a direct API swap — no new files, no new architectural layers. Each Leaflet call in `postUI.js` and `mapUI.js` is replaced with its MapLibre equivalent in four sequential phases: CDN and map initialization, markers and popups, route polyline and map navigation, then final cleanup and verification. The most significant mechanical change is that Leaflet uses `[lat, lng]` coordinate order while MapLibre follows the GeoJSON standard of `[lng, lat]` — every coordinate in both files must be audited and flipped. Once complete, the popup auto-pan bug is resolved by the library itself, the overflow hack is deleted, and no Leaflet code or CSS remains anywhere in the codebase.

## Definition of Done
Replace Leaflet with MapLibre GL JS across the entire road-trip app. Both the post page (pin-drop map + photo map) and the view page (trip map) render using MapLibre with MapTiler vector tiles. All existing map features work — markers with photo popups, route polyline, flyTo, fitBounds, and pin-drop for manual location setting. The Leaflet popup auto-pan bug (GitHub issue #5484) is resolved by the migration. MapTiler API key is domain-restricted (not proxied). No Leaflet JS or CSS remains in any file.

## Acceptance Criteria

### maplibre-migration.AC1: Maps render with MapLibre + MapTiler vector tiles
- **maplibre-migration.AC1.1 Success:** Post page pin-drop map renders with vector tiles
- **maplibre-migration.AC1.2 Success:** Post page photo map renders with vector tiles
- **maplibre-migration.AC1.3 Success:** View page trip map renders with vector tiles
- **maplibre-migration.AC1.4 Success:** No Leaflet CDN script or CSS tags in any HTML file
- **maplibre-migration.AC1.5 Edge:** Maps render correctly on both localhost and production domain

### maplibre-migration.AC2: Markers display with styled popups
- **maplibre-migration.AC2.1 Success:** Photo markers appear at correct coordinates on photo map and trip map
- **maplibre-migration.AC2.2 Success:** Clicking a marker opens a popup with photo thumbnail and place name
- **maplibre-migration.AC2.3 Success:** Popup styling matches existing design (no close button, dark tip, custom width)
- **maplibre-migration.AC2.4 Success:** Pin-drop map places a marker on click at the clicked location
- **maplibre-migration.AC2.5 Success:** Clicking a new location on pin-drop map removes the previous marker

### maplibre-migration.AC3: Popup positioning works without overflow hack
- **maplibre-migration.AC3.1 Success:** Popups containing images position correctly within map viewport
- **maplibre-migration.AC3.2 Success:** Popups near map edges don't clip outside the container
- **maplibre-migration.AC3.3 Success:** Popups account for fixed header height (not hidden behind header)
- **maplibre-migration.AC3.4 Success:** No manual panBy/overflow detection code exists in codebase

### maplibre-migration.AC4: Route polyline renders between markers
- **maplibre-migration.AC4.1 Success:** Route line draws between photo markers in correct order
- **maplibre-migration.AC4.2 Success:** Route line styled with correct color and width
- **maplibre-migration.AC4.3 Success:** Route toggle button shows/hides the route line on view page
- **maplibre-migration.AC4.4 Edge:** Route with single photo shows no line (no two points to connect)

### maplibre-migration.AC5: Map navigation works (flyTo, fitBounds)
- **maplibre-migration.AC5.1 Success:** Map auto-fits to show all markers with padding on load
- **maplibre-migration.AC5.2 Success:** Carousel-to-marker interaction triggers animated flyTo
- **maplibre-migration.AC5.3 Success:** fitBounds accounts for fixed header height in top padding
- **maplibre-migration.AC5.4 Edge:** Single marker — map centers on it at reasonable zoom instead of fitting empty bounds

### maplibre-migration.AC6: Zero Leaflet remnants
- **maplibre-migration.AC6.1 Success:** grep -ri 'leaflet' src/ returns zero results
- **maplibre-migration.AC6.2 Success:** No .leaflet-* CSS class selectors in styles.css
- **maplibre-migration.AC6.3 Success:** No L.map, L.marker, L.polyline, or L.tileLayer calls in JS files

## Glossary

- **MapLibre GL JS**: An open-source JavaScript library for rendering interactive maps using WebGL. Community-maintained fork of Mapbox GL JS. Uses vector tiles instead of raster tiles.
- **Leaflet**: The JavaScript mapping library this migration replaces. Renders raster (image) tiles. Has unfixed popup auto-pan bug (#5484).
- **MapTiler**: A cloud tile service that provides vector tile styles and map data. Free tier: 100K requests/month, no credit card, domain-restricted API keys.
- **Vector tiles**: Map tiles delivered as compact binary geometry data and rendered client-side via WebGL, as opposed to raster tiles (pre-rendered PNG/JPEG images). Scale crisply at any zoom level and support dynamic styling.
- **Pin-drop map**: The map on the post page that allows a user to manually set a photo's location by clicking. Places a single replaceable marker.
- **Photo map**: The map on the post page showing all uploaded photos as markers with popups and a connecting route polyline.
- **Trip map**: The read-only map on the view page displaying a completed trip's photos, route, and carousel-driven navigation.
- **Popup auto-pan bug**: Leaflet GitHub issue #5484 — Leaflet miscalculates popup pan offset when popups contain images because it measures before images load. Unfixed upstream. The overflow detection hack in `postUI.js` (lines 356-376) works around this and is deleted in this migration.
- **GeoJSON source + line layer**: MapLibre's approach to drawing shapes. Instead of Leaflet's `L.polyline(coords)`, MapLibre adds geographic data as a GeoJSON source, then renders it with a styled layer. Route polyline uses a `LineString` geometry in a GeoJSON source rendered by a `line` layer.
- **`setLayoutProperty`**: A MapLibre method to change layer properties at runtime — used here to toggle route visibility (`'visibility': 'none'/'visible'`) instead of removing/re-adding the layer.
- **LngLatBounds**: MapLibre's class for geographic bounding boxes. Must be constructed manually when migrating from Leaflet's `featureGroup().getBounds()`.
- **Coordinate order flip**: Leaflet accepts `[latitude, longitude]`; MapLibre uses `[longitude, latitude]` (GeoJSON convention). Every coordinate pair in both JS files must be reversed.
- **`photoId → marker` lookup**: A JavaScript `Map` object associating photo IDs with marker instances, enabling carousel-to-marker sync (click carousel item → open corresponding popup on map).
- **Domain restriction**: A MapTiler API key setting limiting which domains can use the key. Requests from unauthorized origins are rejected. Used here instead of server-side proxying.

## Architecture

Direct 1:1 library swap — replace each Leaflet API call with its MapLibre GL JS equivalent across `postUI.js` and `mapUI.js`. Same file structure, same responsibilities, same DOM marker approach. No abstraction layers or architectural changes.

MapLibre GL JS loads from CDN (unpkg, pinned version). Map tiles come from MapTiler's vector tile service via a style JSON URL containing a domain-restricted API key. The key is visible in page source but locked to the production domain and localhost — unusable from other origins.

Three map instances migrate independently:
- **Pin-drop map** (`postUI.js`) — click-to-place marker for manual location entry
- **Photo map** (`postUI.js`) — all uploaded photos as markers with popups, route polyline, carousel sync
- **Trip map** (`mapUI.js`) — read-only view with markers, popups, route toggle, carousel sync

Key API translations:
- `L.map()` → `new maplibregl.Map({ container, style, center, zoom })`
- `L.marker([lat, lng])` → `new maplibregl.Marker().setLngLat([lng, lat])` (coordinate order flips)
- `marker.bindPopup(html, opts)` → `new maplibregl.Popup({ offset, maxWidth }).setHTML(html)` + `marker.setPopup(popup)`
- `L.polyline(coords)` → GeoJSON source with LineString geometry + line layer
- `L.featureGroup(markers).getBounds()` → manual `maplibregl.LngLatBounds` construction
- `map.flyTo([lat, lng], zoom)` → `map.flyTo({ center: [lng, lat], zoom })`
- `marker.on('popupopen')` → `popup.on('open')`

Popup HTML content (photo thumbnail with overlaid place name) is unchanged — it's plain HTML strings. CSS overrides retarget from `.leaflet-*` classes to `.maplibregl-*` equivalents.

**Deletions:** Popup overflow detection hack (postUI.js lines 356-376), all `invalidateSize()` calls, `L.point()` references, Leaflet CDN links.

## Existing Patterns

Investigation found two independent map modules (`postUI.js`, `mapUI.js`) that share no code but follow identical patterns: initialize map → add tile layer → create markers in loops → bind popups with HTML templates → listen for `popupopen` → draw polyline → fit bounds.

This design follows that pattern exactly — each file migrates independently with the same structure. No shared map utility is introduced (evaluated and rejected as over-engineering for a 2-page app).

CSS custom properties (`var(--color-*)`, `var(--space-*)`) are used throughout existing popup and map styling. The migration continues this pattern for any new MapLibre-specific styles.

New pattern introduced: **route visibility toggle via layout property.** Currently the route toggle removes and re-adds the polyline layer. MapLibre enables a cleaner approach using `map.setLayoutProperty('route', 'visibility', 'none'/'visible')` which avoids recreating the layer.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: CDN & Map Initialization
**Goal:** Replace Leaflet with MapLibre GL JS, get all three maps rendering with MapTiler vector tiles.

**Components:**
- `src/RoadTripMap/wwwroot/post.html` — swap Leaflet CDN links for MapLibre GL JS (pinned version), add MapTiler style URL
- `src/RoadTripMap/wwwroot/trips.html` — same CDN swap
- `src/RoadTripMap/wwwroot/js/postUI.js` — replace `L.map()` + `L.tileLayer()` for both pin-drop and photo map instances with `new maplibregl.Map()`. Remove `invalidateSize()` calls.
- `src/RoadTripMap/wwwroot/js/mapUI.js` — replace `L.map()` + `L.tileLayer()` with `new maplibregl.Map()`

**Dependencies:** None (first phase). Requires MapTiler API key created and domain-restricted.

**Done when:** All three maps render with MapTiler vector tiles. No Leaflet script/CSS tags remain in HTML files. Maps display at correct initial center and zoom. Covers maplibre-migration.AC1.*.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Markers & Popups
**Goal:** Migrate all marker creation and popup binding to MapLibre API.

**Components:**
- `src/RoadTripMap/wwwroot/js/postUI.js` — replace `L.marker()` + `marker.bindPopup()` with `maplibregl.Marker` + `maplibregl.Popup` for both pin-drop and photo markers. Replace `marker.on('popupopen')` with `popup.on('open')`. Delete popup overflow detection hack (lines 356-376). Build `photoId → marker` lookup using same Map object pattern.
- `src/RoadTripMap/wwwroot/js/mapUI.js` — same marker/popup migration. Replace `popupopen` event with `popup.on('open')`.
- `src/RoadTripMap/wwwroot/css/styles.css` — retarget `.leaflet-popup-content-wrapper`, `.leaflet-popup-close-button`, `.leaflet-popup-content`, `.leaflet-popup-tip` to `.maplibregl-popup-content`, `.maplibregl-popup-close-button`, `.maplibregl-popup-tip`. Retarget `.leaflet-top.leaflet-left` to `.maplibregl-ctrl-top-left`. Retarget `.leaflet-container` to `.maplibregl-map`.

**Dependencies:** Phase 1 (maps rendering)

**Done when:** Photo markers appear on all maps with styled popups. Pin-drop map places marker on click. Popup open events fire for carousel sync. Popup overflow hack is deleted. No `.leaflet-*` CSS classes remain. Covers maplibre-migration.AC2.*, maplibre-migration.AC3.*.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Route Polyline & Navigation
**Goal:** Migrate route drawing, bounds fitting, and animated navigation to MapLibre API.

**Components:**
- `src/RoadTripMap/wwwroot/js/postUI.js` — replace `L.polyline()` with GeoJSON source + line layer. Replace `L.featureGroup().getBounds()` + `map.fitBounds()` with manual `LngLatBounds` construction. Replace `map.flyTo([lat,lng], zoom)` with `map.flyTo({ center: [lng,lat], zoom })`. Account for header height in fitBounds padding.
- `src/RoadTripMap/wwwroot/js/mapUI.js` — same polyline and navigation migration. Replace route toggle remove/re-add with `map.setLayoutProperty('route', 'visibility', ...)`.

**Dependencies:** Phase 2 (markers exist to calculate bounds from)

**Done when:** Route polyline draws between markers on both pages. Route toggle shows/hides line on view page. Map auto-fits to show all markers with header-aware padding. flyTo animations work for carousel-to-marker navigation. Covers maplibre-migration.AC4.*, maplibre-migration.AC5.*.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Cleanup & Verification
**Goal:** Remove all Leaflet remnants and verify complete migration.

**Components:**
- `src/RoadTripMap/wwwroot/js/postUI.js` — remove any remaining `L.` references, `L.point()` calls
- `src/RoadTripMap/wwwroot/js/mapUI.js` — same cleanup
- `src/RoadTripMap/wwwroot/css/styles.css` — remove dead `.leaflet-*` CSS rules (if any remain after Phase 2 retargeting), remove `.photo-grid` styles if orphaned
- Grep entire codebase for "leaflet", "L.map", "L.marker" — verify zero results

**Dependencies:** Phase 3 (all functionality migrated)

**Done when:** `grep -ri "leaflet" src/` returns zero results. All map features verified working: markers, popups, route, flyTo, fitBounds, pin-drop, route toggle. Covers maplibre-migration.AC6.*.
<!-- END_PHASE_4 -->

## Additional Considerations

**Coordinate order:** Leaflet uses `[lat, lng]` throughout. MapLibre uses `[lng, lat]` (GeoJSON standard). Every coordinate reference in postUI.js and mapUI.js must be audited and flipped. This is the highest-risk mechanical change — easy to miss individual instances.

**MapTiler API key setup:** Before Phase 1, a MapTiler Cloud account must be created (free tier, no credit card) and an API key generated with domain restrictions for `app-roadtripmap-prod.azurewebsites.net` and `localhost`. The key value goes in the JS files as part of the style URL — it is not a secret (domain-restricted, rate-limited, free tier).

**Map style selection:** Deferred to implementation. MapTiler offers Streets, Outdoor, and Satellite on free tier. The style URL is a single string — easy to swap later or make user-configurable.

**Photo carousel dependency:** The upcoming photo carousel design plan references Leaflet APIs (popupopen events, marker lookups). After this migration, the carousel design's glossary entry for Leaflet and `popupopen` event will need updating to reflect MapLibre equivalents. The carousel's architecture is otherwise unaffected — same `photoId → marker` lookup pattern, same popup event-driven sync.
