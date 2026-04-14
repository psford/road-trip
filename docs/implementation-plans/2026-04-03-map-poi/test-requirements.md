# Map POI Test Requirements

Maps each acceptance criterion to specific tests. Determines whether each can be automated or requires human verification given the project's test infrastructure.

**Backend test stack:** .NET 8, xUnit, FluentAssertions, WebApplicationFactory with SQLite in-memory
**Frontend test stack:** None (vanilla JS with MapLibre GL JS, no test framework)
**Test directory:** `tests/RoadTripMap.Tests/`

---

## map-poi.AC1: POI markers on maps

### map-poi.AC1.1 — POI markers appear on post page map when zoomed to area with POIs

- **Automation:** Human verification
- **Justification:** This is a visual rendering test on a MapLibre GL JS map. The project has no frontend test framework, and verifying that GeoJSON circle/symbol layers render correctly on a live map requires a browser with WebGL context. No headless browser or Playwright setup exists.
- **Verification approach:**
  1. Ensure database has seeded POI data (Phase 2 or manual inserts)
  2. Open post page, open pin-drop map
  3. Zoom to an area with known POIs (e.g., Yellowstone area)
  4. Confirm colored circle markers appear with labels at higher zoom
  5. Pan away from POI area and confirm markers disappear

### map-poi.AC1.2 — POI markers appear on view page map when zoomed to area with POIs

- **Automation:** Human verification
- **Justification:** Same as AC1.1 — visual rendering on a MapLibre map with no frontend test framework.
- **Verification approach:**
  1. Open a trip view page
  2. Zoom to an area with known seeded POIs
  3. Confirm colored circle markers appear with labels at higher zoom
  4. Pan away and confirm markers disappear

### map-poi.AC1.3 — Markers are styled differently by category

- **Automation:** Human verification
- **Justification:** Category-based marker styling is a `match` expression on MapLibre circle-color paint property. Verifying visual color differences requires human observation or screenshot comparison (no visual regression tooling exists).
- **Verification approach:**
  1. Seed POIs across all five categories in the same geographic area
  2. Zoom to that area at zoom 10+ (all categories visible)
  3. Confirm visually distinct colors:
     - National park: dark green (#2d6a4f)
     - State park: light green (#52b788)
     - Natural feature: brown (#7b2d26)
     - Historic site: purple (#6c4ab6)
     - Tourism: gold (#d4a017)
  4. Confirm each category is distinguishable at a glance

### map-poi.AC1.4 — API returns POIs filtered to current viewport bounding box

- **Automation:** Automated (integration test)
- **Test type:** Integration
- **Test file:** `tests/RoadTripMap.Tests/Endpoints/PoiEndpointTests.cs`
- **Tests:**
  - `ReturnsOnlyPoisWithinBoundingBox` — Seed POIs at known coordinates (e.g., lat 44.0/lng -72.0 and lat 35.0/lng -80.0). Request with bounding box containing only the first. Assert response contains only the first POI.
  - `ReturnsEmptyWhenNoPoisInBoundingBox` — Request with bounding box that contains no seeded POIs. Assert empty array response.
  - `ExcludesPoisOutsideBoundingBox` — Seed POIs inside and outside viewport. Assert outside POIs are absent from response.

---

## map-poi.AC2: Park polygon restyling

### map-poi.AC2.1 — Park boundaries display with bolder green fill and outline

- **Automation:** Human verification
- **Justification:** Park boundary styling uses `setPaintProperty()` on MapTiler vector tile source-layers. These are runtime WebGL paint property overrides on third-party tile data. No automated way to verify rendered fill color/opacity without visual regression tooling.
- **Verification approach:**
  1. Open any map page (post or view)
  2. Navigate to a known park (e.g., Franconia Notch State Park at lat 44.14, lng -71.68)
  3. At zoom 8-10, confirm park polygon has bold green fill (noticeably greener/more opaque than surrounding terrain)
  4. Confirm dark green outline visible on park boundary edges
  5. Compare against default MapTiler styling (disable `applyParkStyling` temporarily) to confirm the override is effective

### map-poi.AC2.2 — Park labels visible at zoom level 6+

- **Automation:** Human verification
- **Justification:** Label visibility depends on a custom MapLibre symbol layer added at runtime with `minzoom: 6`. Testing requires rendering vector tiles in a browser at specific zoom levels and confirming text labels appear. No frontend test framework or headless map rendering available.
- **Verification approach:**
  1. Navigate to Franconia Notch State Park area
  2. Zoom out to zoom 6 — confirm "Franconia Notch State Park" label is visible
  3. Zoom out to zoom 5 — confirm label disappears (below minzoom)
  4. Zoom in to zoom 8-12 — confirm label remains visible and readable
  5. Check browser console: `map.getStyle().layers.filter(l => l.id === 'park-labels-custom')` returns the custom layer

### map-poi.AC2.3 — Restyling applies to both post and view page maps

- **Automation:** Human verification
- **Justification:** Requires opening two different pages and visually confirming identical styling on each. No automated cross-page visual comparison tooling exists.
- **Verification approach:**
  1. Open post page pin-drop map, navigate to a park area — confirm bold green styling and labels
  2. Open trip view page, navigate to same park area — confirm identical styling
  3. Compare the two side-by-side (or sequentially) to confirm consistency

---

## map-poi.AC3: Tap-to-pin interaction

### map-poi.AC3.1 — Tapping POI marker on post page shows popup with name and two options

- **Automation:** Human verification
- **Justification:** Tests a MapLibre click handler on a GeoJSON layer that creates a DOM popup. Requires a live map with rendered POI markers and user click interaction. No frontend test framework or browser automation exists.
- **Verification approach:**
  1. Open post page, open pin-drop map
  2. Navigate to area with POI markers
  3. Click/tap a POI marker
  4. Confirm popup appears with:
     - POI name displayed
     - "Use this location" button (green)
     - "Pick nearby spot" button (gray)
  5. Click outside popup — confirm it dismisses

### map-poi.AC3.2 — "Use this location" sets coordinates to POI centroid and fills place name

- **Automation:** Human verification
- **Justification:** Tests interaction between MapLibre popup button click, marker placement, and form field population. Involves DOM manipulation triggered by map layer events. No frontend test framework.
- **Verification approach:**
  1. Click a POI marker on the post page pin-drop map
  2. Click "Use this location"
  3. Confirm:
     - Popup dismisses
     - A pin marker appears at the POI's location
     - Latitude/longitude form fields are populated with the POI's centroid coordinates
     - Place name field is filled with the POI's name
     - The upload/next step is enabled (same as manual pin placement)

### map-poi.AC3.3 — "Pick nearby spot" zooms to POI area for precise location

- **Automation:** Human verification
- **Justification:** Tests map flyTo animation and subsequent manual pin-drop interaction. Requires observing zoom animation and then performing a second click. No frontend test framework.
- **Verification approach:**
  1. Click a POI marker on the post page pin-drop map
  2. Click "Pick nearby spot"
  3. Confirm:
     - Popup dismisses
     - Map animates to zoom 13 centered on the POI
     - User can then click/tap the map at a precise location
     - Pin placement and geocoding work normally after the zoom

### map-poi.AC3.4 — Tapping POI marker on view page does NOT show tap-to-pin popup

- **Automation:** Human verification
- **Justification:** Negative test verifying absence of behavior on a specific page. The POI click handler is only registered in `postUI.js`, not `mapUI.js`. Requires clicking POI markers on the view page and confirming nothing happens. No frontend test framework.
- **Verification approach:**
  1. Open a trip view page
  2. Navigate to area with POI markers
  3. Click/tap a POI marker
  4. Confirm: NO popup appears — no action buttons, no pin-drop behavior
  5. Confirm: existing photo marker popups still work normally (not broken by POI layer)

---

## map-poi.AC4: Regional/viewport loading

### map-poi.AC4.1 — At zoom < 7, only national parks appear as markers

- **Automation:** Automated (integration test)
- **Test type:** Integration
- **Test file:** `tests/RoadTripMap.Tests/Endpoints/PoiEndpointTests.cs`
- **Tests:**
  - `Zoom5_ReturnsOnlyNationalParks` — Seed POIs with categories `national_park`, `state_park`, `natural_feature`, `historic_site`, `tourism` in the same bounding box. Call `/api/poi` with `zoom=5`. Assert response contains only `national_park` category POIs.
  - `Zoom6_ReturnsOnlyNationalParks` — Same seed data, `zoom=6`. Assert only `national_park` returned (boundary test at zoom < 7).

### map-poi.AC4.2 — At zoom 7-9, state parks and natural features also appear

- **Automation:** Automated (integration test)
- **Test type:** Integration
- **Test file:** `tests/RoadTripMap.Tests/Endpoints/PoiEndpointTests.cs`
- **Tests:**
  - `Zoom7_ReturnsNationalStateAndNatural` — Same seed data. Call with `zoom=7`. Assert response contains `national_park`, `state_park`, and `natural_feature` but NOT `historic_site` or `tourism`.
  - `Zoom9_ReturnsNationalStateAndNatural` — Same seed data, `zoom=9`. Assert same categories as zoom 7 (boundary test at top of range).

### map-poi.AC4.3 — At zoom 10+, all categories appear

- **Automation:** Automated (integration test)
- **Test type:** Integration
- **Test file:** `tests/RoadTripMap.Tests/Endpoints/PoiEndpointTests.cs`
- **Tests:**
  - `Zoom10_ReturnsAllCategories` — Same seed data, `zoom=10`. Assert response contains all five categories.
  - `Zoom15_ReturnsAllCategories` — Same seed data, `zoom=15`. Assert all categories still returned at high zoom.

### map-poi.AC4.4 — API never returns more than 200 POIs per request

- **Automation:** Automated (integration test)
- **Test type:** Integration
- **Test file:** `tests/RoadTripMap.Tests/Endpoints/PoiEndpointTests.cs`
- **Tests:**
  - `ResultCappedAt200` — Seed 250 POIs (all `national_park` category) within the same bounding box. Call `/api/poi` with `zoom=5` and that bounding box. Assert response contains exactly 200 items.

---

## map-poi.AC5: POI data pipeline

### map-poi.AC5.1 — Seed script imports national parks from NPS API

- **Automation:** Automated (integration test with mocked HTTP)
- **Test type:** Integration
- **Test file:** `tests/RoadTripMap.Tests/Seeder/NpsImporterTests.cs`
- **Tests:**
  - `ImportsParksFromNpsResponse` — Mock NPS API HTTP response with 3 parks (valid `latLong` strings, `parkCode`, `fullName`). Run NPS importer against in-memory DB. Assert 3 POIs created with `category = "national_park"`, `source = "nps"`, and correctly parsed latitude/longitude from the `"lat:XX.XXX, long:YY.YYY"` format.
  - `SkipsParksWithMissingCoordinates` — Mock response with one park having empty `latLong`. Assert that park is skipped, others imported.
  - `SetsSourceIdToParkCode` — Assert each imported POI has `SourceId` set to the NPS `parkCode` value.

### map-poi.AC5.2 — Seed script imports state parks from PAD-US

- **Automation:** Automated (integration test with test fixture file)
- **Test type:** Integration
- **Test file:** `tests/RoadTripMap.Tests/Seeder/PadUsImporterTests.cs`
- **Tests:**
  - `ImportsStateParksFromGeoJson` — Create a small test GeoJSON fixture file (2-3 polygon features with state park properties: `Unit_Nm`, `d_Des_Tp = "State Park"`, polygon coordinates). Run PAD-US importer. Assert POIs created with `category = "state_park"`, `source = "pad_us"`, correct centroid coordinates computed from polygon vertices.
  - `SkipsFeaturesWithoutName` — Include a feature with empty `Unit_Nm`. Assert it is skipped.
  - `ComputesCentroidCorrectly` — Feature with known polygon coordinates. Assert imported POI latitude/longitude matches expected centroid (average of coordinate pairs).

### map-poi.AC5.3 — Seed script imports landmarks/tourism from Overpass API

- **Automation:** Automated (integration test with mocked HTTP)
- **Test type:** Integration
- **Test file:** `tests/RoadTripMap.Tests/Seeder/OverpassImporterTests.cs`
- **Tests:**
  - `ImportsTourismNodes` — Mock Overpass response with elements tagged `tourism=attraction`. Run importer. Assert POIs created with `category = "tourism"`, `source = "osm"`.
  - `ImportsHistoricNodes` — Mock response with `historic=monument`. Assert `category = "historic_site"`.
  - `ImportsNaturalFeatureNodes` — Mock response with `natural=peak`. Assert `category = "natural_feature"`.
  - `SkipsNodesWithoutName` — Include element without `name` tag. Assert it is skipped, others imported.
  - `SetsSourceIdToOsmElementId` — Assert `SourceId` is set to the OSM element `id` as string.

### map-poi.AC5.4 — Re-running seed script does not create duplicates (idempotent)

- **Automation:** Automated (integration test)
- **Test type:** Integration
- **Test files:**
  - `tests/RoadTripMap.Tests/Seeder/NpsImporterTests.cs`
  - `tests/RoadTripMap.Tests/Seeder/DeduplicatorTests.cs`
- **Tests:**
  - `RerunDoesNotCreateDuplicates` (in NpsImporterTests) — Mock NPS response with 3 parks. Run NPS importer twice against same DB. Assert POI count is still 3 (not 6).
  - `RerunUpdatesExistingRecords` (in NpsImporterTests) — Run importer with initial data. Run again with same `parkCode` but updated `fullName`. Assert POI count unchanged and name is updated.
  - `CrossSourceDedup_RemovesLowerPriorityDuplicate` (in DeduplicatorTests) — Insert two POIs with similar names and nearby coordinates (< 1km) from different sources (`nps` and `pad_us`). Run deduplicator. Assert only the `nps` source POI remains (higher priority).
  - `CrossSourceDedup_KeepsDistinctPois` (in DeduplicatorTests) — Insert two POIs with similar names but far-apart coordinates (> 1km). Run deduplicator. Assert both are retained.
  - `CrossSourceDedup_PriorityOrder` (in DeduplicatorTests) — Insert duplicates from `osm` and `pad_us`. Assert `pad_us` is kept (`nps` > `pad_us` > `osm`).

---

## map-poi.AC6: Pin-drop default location

### map-poi.AC6.1 — Pin-drop map centers on last posted photo's location when photos exist

- **Automation:** Human verification
- **Justification:** Tests MapLibre map initialization center/zoom based on JavaScript array state in `postUI.js`. The map center is set during `new maplibregl.Map()` construction using data from the loaded photos array. Verifying the map's actual rendered center requires a browser with the full application context (photo data loaded via API, MapLibre initialized). No frontend test framework exists.
- **Verification approach:**
  1. Create a trip and post at least one photo pinned to a known location (e.g., lat 44.14, lng -71.68)
  2. Open the pin-drop UI to add another photo
  3. Confirm the map opens centered near lat 44.14, lng -71.68 at approximately zoom 10
  4. The surrounding geography should match the expected area (Franconia Notch in this example)
  5. Post a second photo at a different location (e.g., lat 36.1, lng -112.1 for Grand Canyon)
  6. Open pin-drop again — confirm it now centers on the second (last) photo's location

### map-poi.AC6.2 — Pin-drop map falls back to center of US when trip has no photos

- **Automation:** Human verification
- **Justification:** Same as AC6.1 — requires browser-rendered MapLibre map to verify center/zoom. The fallback path (`[-98.5795, 39.8283]` at zoom 4) is a simple conditional in JS but verification requires observing the rendered map.
- **Verification approach:**
  1. Create a new trip with no photos
  2. Open the pin-drop UI
  3. Confirm the map opens showing the full continental US (zoom ~4)
  4. Confirm center is approximately central Kansas (the geographic center of the contiguous US)

---

## Test Summary

| AC | Cases | Automated | Human Verification |
|----|-------|-----------|-------------------|
| AC1 | 4 | 1 (AC1.4) | 3 (AC1.1, AC1.2, AC1.3) |
| AC2 | 3 | 0 | 3 (AC2.1, AC2.2, AC2.3) |
| AC3 | 4 | 0 | 4 (AC3.1, AC3.2, AC3.3, AC3.4) |
| AC4 | 4 | 4 (AC4.1, AC4.2, AC4.3, AC4.4) | 0 |
| AC5 | 4 | 4 (AC5.1, AC5.2, AC5.3, AC5.4) | 0 |
| AC6 | 2 | 0 | 2 (AC6.1, AC6.2) |
| **Total** | **21** | **9** | **12** |

## Automated Test Files

| File | AC Coverage | Test Count |
|------|-------------|------------|
| `tests/RoadTripMap.Tests/Endpoints/PoiEndpointTests.cs` | AC1.4, AC4.1, AC4.2, AC4.3, AC4.4 | 8 |
| `tests/RoadTripMap.Tests/Seeder/NpsImporterTests.cs` | AC5.1, AC5.4 | 5 |
| `tests/RoadTripMap.Tests/Seeder/PadUsImporterTests.cs` | AC5.2 | 3 |
| `tests/RoadTripMap.Tests/Seeder/OverpassImporterTests.cs` | AC5.3 | 5 |
| `tests/RoadTripMap.Tests/Seeder/DeduplicatorTests.cs` | AC5.4 | 3 |
| **Total** | | **24** |

## Human Verification Rationale

All 12 human-verification items fall into two categories:

1. **Visual map rendering** (AC1.1, AC1.2, AC1.3, AC2.1, AC2.2, AC2.3): MapLibre GL JS paint properties, symbol layers, and vector tile style overrides render via WebGL. Verifying correct colors, label visibility, and polygon styling requires a browser with GPU context. No headless map rendering or visual regression tooling exists in the project.

2. **Frontend interaction and state** (AC3.1, AC3.2, AC3.3, AC3.4, AC6.1, AC6.2): MapLibre click handlers, popup DOM creation, map flyTo animations, and initialization center/zoom are pure frontend JS. The project uses vanilla JS with `<script>` tags (no module bundler, no test runner, no Playwright/Cypress). Automating these would require introducing a frontend test framework, which is out of scope for this feature.
