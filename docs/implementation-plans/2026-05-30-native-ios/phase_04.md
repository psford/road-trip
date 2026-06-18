# Native iOS — Phase 4: Map Overlays (POI, Park Boundaries, Route Line) Implementation Plan

**Goal:** Map overlay parity with the website — POI markers (viewport + zoom-tier fetch), state-park boundary polygons (`MKPolygon` fill/outline/centroid label), and the toggleable dotted route line (`MKPolyline`, `lineDashPattern [3,2]`), with an on-device cache so overlays render offline from the last fetch.

**Architecture:** Extend the Phase-3 `TripMapView` Coordinator. POIs and boundaries are fetched on viewport change (debounced `regionDidChangeAnimated`) via `RoadTripAPI.poi` / `.parkBoundaries`, rendered as annotations / `MKPolygon` overlays through `mapView(_:rendererFor:)`. The route line is an `MKPolyline` through the trip's photos ordered by `takenAt`. A GRDB-backed overlay cache (replacing the web's `mapCache.js`) stores the last response keyed by region+detail so overlays survive offline.

**Tech Stack:** MapKit (`MKPolygon`, `MKPolygonRenderer`, `MKPolyline`, `MKPolylineRenderer`, `MKOverlayRenderer`, annotation overlays), `RoadTripAPI` (Phase 2 `poi`/`parkBoundaries`), GRDB (overlay cache table).

**Scope:** Phase 4 of 8.

**Codebase verified:** 2026-06-18.

---

## Verified facts grounding this phase

- **`/api/poi`** params `minLat,maxLat,minLng,maxLng,zoom`; returns `[{id,name,category,lat,lng}]` (max 200). Zoom tiers (port exactly from `poiLayer.js` + server): `zoom<7` → `national_park` only; `7–9` → + `state_park`, `natural_feature`; `10+` → + `historic_site`, `tourism`. Category colors from `poiLayer.js`: national_park `#2d6a4f`, state_park `#52b788`, natural_feature `#7b2d26`, historic_site `#6c4ab6`, tourism `#d4a017`, default `#666666`. Labels at zoom ≥ 8.
- **`/api/park-boundaries`** params `…bbox…,zoom,detail?`; returns GeoJSON `FeatureCollection`; **empty below zoom 8**; `detail` ∈ `full|moderate(default)|simplified`. Feature `properties`: `{id,name,state,category,centroidLat,centroidLng,gisAcres}`; geometry `Polygon|MultiPolygon`. Web renders fill teal `#2a9d8f` opacity 0.15, outline teal width 2 opacity 0.7, centroid dot + name label (minzoom 8). 300 ms debounce on viewport move (`stateParkLayer.js`). **`detail` is selected adaptively by NETWORK QUALITY, not zoom** (`stateParkLayer.js:_selectDetailLevel`, line 258): start from a connection estimate (`navigator.connection.downlink < 1` → `simplified`, `> 5` → `full`, else `moderate`), then override by the last measured response time (`> 3000 ms` → step DOWN one level; `< 500 ms` → step UP one level; otherwise hold). Default fallback is `moderate`.
- **Route line:** `postUI.setupRouteToggle` + `MapService.smoothRoute` — a dashed polyline through photos ordered by `takenAt`, toggleable. Paint (port exactly): `line-color #2a9d8f`, `line-width 2.5`, `line-opacity 0.7`, `line-dasharray [3,2]`. **Smoothing is a Catmull-Rom spline at 16 interpolated points per segment** (`MapService.smoothRoute(points, pointsPerSegment = 16)`, `mapService.js:37`) — it is part of AC10.3 ("smoothed"), not optional.
- Phase 2 Task 1 adds the `poi`/`parkBoundaries` methods + the GeoJSON `FeatureCollection` decoder to `RoadTripAPI` (confirmed present in `phase_02.md`). Build on them; do not re-derive.
- The web's `mapCache.js` uses IndexedDB keyed `{type}_{id}_{detail}` with no TTL (server is source of truth). The native cache is GRDB; `/api/poi` + `/api/park-boundaries` were the web's NON-page-cached endpoints — here we DO cache them on-device for offline overlay render (native-ios.AC10.4), which is the native analog the design calls for.
- **MapKit overlay rendering (research):** implement `mapView(_:rendererFor:)` returning `MKPolygonRenderer` (fillColor + strokeColor + lineWidth) for boundary polygons and `MKPolylineRenderer` (strokeColor + lineWidth + `lineDashPattern = [3,2]`) for the route. Add/remove overlays + annotations on `regionDidChangeAnimated`, debounced with a `Timer`/`Task` sleep.

---

## Acceptance Criteria Coverage

### native-ios.AC10: Map overlay parity — POI, boundaries, route
- **native-ios.AC10.1 Success:** POI markers fetch by viewport + zoom tier (`<7` national_park; `7–9` + state_park/natural; `10+` + historic/tourism), are category-colored, labeled at zoom ≥ 8, and tappable
- **native-ios.AC10.2 Success:** State-park boundaries render as `MKPolygon` overlays with fill + outline + centroid label, reloading on viewport change
- **native-ios.AC10.3 Success:** Dotted route line (`lineDashPattern [3,2]`, smoothed) draws through the trip's photos and toggles on/off
- **native-ios.AC10.4 Edge:** Offline with cached overlay data → overlays still render from the on-device cache

(native-ios.AC10.5 "empty response → no overlay, no error" is folded into each task's empty-handling.)

**Environment:** **Mac** (Swift build + simulator). Screenshot required.

---

<!-- START_TASK_1 -->
### Task 1: Viewport + debounce plumbing on the map Coordinator

**Verifies:** foundation for native-ios.AC10.1/10.2 (no AC alone)

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Map/TripMapView.swift` (Coordinator)
- Create: `ios-swift/RoadTrip/RoadTrip/Map/ViewportTier.swift` (pure: map region → bbox + zoom-tier + category list)
- Test: `ios-swift/RoadTrip/RoadTripTests/ViewportTierTests.swift`

**Implementation:**
- Pure `ViewportTier`: from an `MKCoordinateRegion`, compute `(minLat,maxLat,minLng,maxLng)` and an integer zoom approximation (MapKit has no native zoom level; derive from `region.span.longitudeDelta` via the standard `log2(360 / span)` formula, clamped 0…20). Map zoom → POI category list per the tier rules. This is the one place the tier thresholds live; unit-test it.
- Coordinator: implement `mapView(_:regionDidChangeAnimated:)` to debounce (cancel a pending `Task`, `try await Task.sleep(for: .milliseconds(300))`, then trigger POI + boundary reloads). Guard re-entrancy.

**Testing (ViewportTierTests):**
- bbox extraction from a known region is correct.
- zoom→categories: zoom 6 → `[national_park]`; zoom 8 → `[national_park, state_park, natural_feature]`; zoom 11 → all five.

**Verification (Mac):** tests pass; build clean.

**Commit:** `feat(ios): map viewport tiering + debounced region-change (ViewportTier +tests)`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: On-device overlay cache (GRDB)

**Verifies:** foundation for native-ios.AC10.4

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Map/OverlayCache.swift`
- Modify: `ios-swift/RoadTrip/RoadTrip/Storage/Migrator.swift` (v3: overlay cache table)
- Test: `ios-swift/RoadTrip/RoadTripTests/OverlayCacheTests.swift`

**Implementation:**
- Migrator **v3** (after v2): create `overlayCache` table — `key TEXT PRIMARY KEY` (composite `"{kind}:{detail}:{roundedBboxKey}"`), `kind TEXT` (`poi`|`boundary`), `payload BLOB` (the raw JSON response bytes), `cachedAt DATETIME`. (Never edit v1/v2.)
- `OverlayCache`: `put(kind:detail:bbox:payload:)`, `latest(kind:detail:near bbox:) -> Data?` returning the most recent cached payload whose bbox overlaps the requested region (port the web's `_boundsIntersect`; a simple overlap test on stored bbox columns — add `minLat/maxLat/minLng/maxLng` columns to support overlap queries). Decide: store bbox as columns for overlap querying. No TTL (server is source of truth; offline shows last-known).

**Testing (OverlayCacheTests, in-memory):**
- put then `latest` returns the payload for an overlapping bbox; returns nil for a disjoint bbox.
- v3 migration applies over a v2 DB with existing rows.

**Verification (Mac):** tests pass.

**Commit:** `feat(ios): GRDB v3 overlay cache (OverlayCache +tests)`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: POI layer — fetch, category-colored annotations, labels, tap

**Verifies:** native-ios.AC10.1, native-ios.AC10.4 (POI portion), native-ios.AC10.5 (empty)

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Map/POIAnnotation.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/Map/POIOverlayController.swift`
- Modify: `ios-swift/RoadTrip/RoadTrip/Map/TripMapView.swift` (wire into debounced reload + `viewFor`)

**Implementation:**
- `POIAnnotation: NSObject, MKAnnotation` carrying category + name. `POIAnnotationView` (or styled `MKMarkerAnnotationView`): `markerTintColor` per category color map above; show the title label only when current zoom ≥ 8 (toggle `displayPriority`/hidden by zoom in the reload). Distinct reuse id from photo pins; do NOT cluster POIs with photo pins (different `clusteringIdentifier` or none).
- `POIOverlayController.reload(region:, zoom:)`: compute categories via `ViewportTier`; call `RoadTripAPI.poi(bbox:, zoom:)`; on success write-through `OverlayCache` and diff-update POI annotations; on `.networkUnavailable` read `OverlayCache.latest(kind:.poi…)` and render those (native-ios.AC10.4). Empty array → remove POI annotations, no error (native-ios.AC10.5). Filter the rendered set to the current zoom's category list (the server already tiers, but enforce client-side too).
- Tap: selecting a POI annotation shows a callout with name + category (port `poiLayer.js` info popup; the "Use this location" action belongs to the Phase-5 pin-drop flow, not here — keep Phase 4 to info-only display).

**Testing:** `POIOverlayController` reload logic with a stubbed `RoadTripAPI`: 3 POIs across categories at zoom 11 → 3 annotations; offline with cache → renders cached; empty → none. (Pure-ish controller test; the MapKit rendering itself is verified visually.)

**Verification (Mac, screenshot):** pan/zoom shows category-colored POIs tiering by zoom, labeled at zoom ≥ 8, tappable. Airplane mode after a fetch still shows cached POIs.

**Commit:** `feat(ios): POI overlay layer (tiered fetch, colors, labels, cache, native-ios.AC10.1/10.4)`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Park-boundary polygons (`MKPolygon` fill/outline/centroid label)

**Verifies:** native-ios.AC10.2, native-ios.AC10.4 (boundary portion), native-ios.AC10.5

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Map/BoundaryOverlayController.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/Map/GeoJSONPolygon.swift` (pure: GeoJSON geometry → `[MKPolygon]` + centroid)
- Modify: `ios-swift/RoadTrip/RoadTrip/Map/TripMapView.swift` (`rendererFor` + centroid annotations)
- Test: `ios-swift/RoadTrip/RoadTripTests/GeoJSONPolygonTests.swift`

**Implementation:**
- Pure `GeoJSONPolygon.polygons(from feature:) -> [MKPolygon]`: convert `Polygon` (`[[[lng,lat]]]`) and `MultiPolygon` (`[[[[lng,lat]]]]`) rings to `MKPolygon(coordinates:count:)` — remember GeoJSON is **[lng, lat]** order (easy bug). Attach `feature.properties.name`/`id` to a subclassed `MKPolygon` (a `TitledPolygon: MKPolygon` carrying name + centroid) for the renderer + label.
- `BoundaryOverlayController.reload(region:, zoom:)`: below zoom 8, remove all boundary overlays + labels and return (server gates too; enforce client-side). Else call `RoadTripAPI.parkBoundaries(bbox:, zoom:, detail:)`. **Pick `detail` by network quality, NOT zoom** — port `stateParkLayer.js:_selectDetailLevel`: keep a `lastResponseMs` on the controller; default `moderate`; after each fetch, if `lastResponseMs > 3000` step down one level (`full→moderate→simplified`), if `< 500` step up (`simplified→moderate→full`), else hold. For the initial estimate, iOS has no `navigator.connection.downlink` equivalent — derive a starting level from the `NWPath` already owned by the upload `NWPathMonitor` (`.constrained`/`.expensive` or a cellular interface → `simplified`; unconstrained Wi-Fi/wired → `full`; else `moderate`). Document this substitution in the commit (downlink-Mbps buckets have no direct iOS API; path properties + measured-RTT are the faithful analog). Write-through cache; render polygons + a centroid name-label annotation (minzoom-8 label). Offline → cache (native-ios.AC10.4). Empty FeatureCollection → remove overlays, no error (native-ios.AC10.5).
- In the Coordinator `mapView(_:rendererFor:)`: for a `TitledPolygon` return `MKPolygonRenderer` with `fillColor = teal@0.15`, `strokeColor = teal@0.7`, `lineWidth = 2` (port `stateParkLayer.js` styling).

**Testing (GeoJSONPolygonTests):**
- A `Polygon` feature → one `MKPolygon` with the right point count and coordinates ([lng,lat] correctly swapped to lat/lng).
- A `MultiPolygon` feature → multiple polygons.

**Verification (Mac, screenshot):** at zoom ≥ 8, park boundaries render with teal fill + outline + centroid name; nothing below zoom 8; reload on pan. Offline shows cached boundaries.

**Commit:** `feat(ios): park-boundary MKPolygon overlays + centroid labels (native-ios.AC10.2/10.4)`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Toggleable dotted route line (`MKPolyline`)

**Verifies:** native-ios.AC10.3

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Map/RouteOverlayController.swift`
- Modify: `ios-swift/RoadTrip/RoadTrip/Map/TripMapView.swift` (`rendererFor` polyline + a `showRoute` binding)
- Modify: `ios-swift/RoadTrip/RoadTrip/Views/Trips/TripDetailView.swift` (route toggle control)

**Implementation:**
- `RouteOverlayController`: build an `MKPolyline` through the trip's committed photos ordered by `takenAt` (fall back to `COALESCE(takenAt,createdAt)` consistent with the carousel order). **Smooth the path with a Catmull-Rom spline at 16 interpolated points per segment** — a direct port of `MapService.smoothRoute` (`mapService.js:37`): for each segment use control points `p0=points[max(0,i-1)]`, `p1=points[i]`, `p2=points[min(n-1,i+1)]`, `p3=points[min(n-1,i+2)]`, emit 16 points via the Catmull-Rom basis, then append the final point. `< 2` photos → no route; exactly 2 → straight segment (the JS returns the points unsmoothed). Straight segments are NOT acceptable as the general case — AC10.3 requires "smoothed". Keep the smoothing as a pure, unit-testable helper (`RouteSmoother.smooth(_:pointsPerSegment:) -> [CLLocationCoordinate2D]`). Add/remove the overlay based on a `showRoute` flag.
- `TripDetailView`: a map control/toolbar toggle (`Toggle`/button) bound to `viewModel.showRoute` (add to `TripDetailViewModel`), passed into `TripMapView`. `updateUIView` adds/removes the polyline overlay when the flag flips.
- Coordinator `rendererFor` polyline: `MKPolylineRenderer` with `strokeColor`, `lineWidth`, `lineDashPattern = [3, 2]` (native-ios.AC10.3 exact pattern).

**Testing:** route-building helper: photos with mixed dates → polyline points in `COALESCE(takenAt,createdAt)` order; toggling `showRoute` adds/removes (controller-level test on the points array; rendering verified visually). `RouteSmoother`: N=4 input → `3*16 + 1 = 49` output points, endpoints preserved (first/last output equal first/last input); N=2 → returned unsmoothed (2 points); N<2 → empty.

**Verification (Mac, screenshot):** dotted route line draws through photos in chronological order; the toggle turns it on/off.

**Commit:** `feat(ios): toggleable dotted route polyline (lineDashPattern [3,2], native-ios.AC10.3)`
<!-- END_TASK_5 -->

---

## Phase Done When
POI markers appear and tier by zoom, category-colored, labeled at zoom ≥ 8, tappable (native-ios.AC10.1); park-boundary polygons render with fill/outline/centroid label and reload on viewport change, nothing below zoom 8 (native-ios.AC10.2); the dotted route line draws through photos chronologically and toggles on/off (native-ios.AC10.3); with the device offline after a prior fetch, POIs and boundaries still render from the GRDB overlay cache (native-ios.AC10.4); empty responses draw nothing and raise no error (native-ios.AC10.5). **All verified on the simulator with screenshots** (Mac).
