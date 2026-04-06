# State Park Boundaries Design

## Summary

This feature adds state park boundary polygons to the road trip map, giving the same visual treatment that national parks already have: filled polygon outlines, centroid dots, and labels. The source data is PAD-US 4.1, a federal dataset that catalogs roughly 11,200 state parks and state recreation areas (SP/SREC category) across all 50 states. A one-time import script pulls from the PAD-US ArcGIS Feature Service, merges the many small parcels that PAD-US records per park into a single shape per park, computes three pre-simplified versions of each boundary, and stores everything in a new `ParkBoundaries` database table.

At runtime the client never loads all 11,200 parks at once. Instead, a new API endpoint returns only the parks whose bounding boxes overlap the current map viewport, and the client selects one of the three stored geometry levels based on measured connection quality -- fetching a coarser shape on slow connections and a detailed one on fast connections. Boundaries already seen are stored in an IndexedDB cache so revisiting the same area requires no network request. A background prefetch step at zoom level 7 warms that cache just before the zoom-8 threshold where boundaries first appear, making the reveal feel instant.

## Definition of Done

1. **State park boundaries visible on map** -- ~11,200 SP/SREC parks from PAD-US 4.1, rendered as fill+outline polygons with centroid dots and labels, styled like national parks but a different hue
2. **Viewport-based delivery** -- new API endpoint serves boundaries filtered by bounding box, not loaded all at once
3. **Adaptive detail levels** -- 3 pre-computed simplification levels per boundary; client selects based on connection quality (navigator.connection + measured response time), no user tracking
4. **One-time import script** -- pulls from PAD-US ArcGIS Feature Service, simplifies/smooths geometry, stores in new ParkBoundary DB table
5. **Hide POIs toggle** -- state park boundaries toggle with existing hide/show

## Acceptance Criteria

### state-park-boundaries.AC1: Boundaries visible on map
- **state-park-boundaries.AC1.1 Success:** State park fill+outline polygons render on map at zoom >= 8
- **state-park-boundaries.AC1.2 Success:** Centroid dot and label visible for each park in viewport, styled differently from national parks (different hue)
- **state-park-boundaries.AC1.3 Success:** Clicking centroid dot on post page shows popup with "Use this location" and "Pick nearby spot" buttons
- **state-park-boundaries.AC1.4 Failure:** No boundaries render at zoom < 8

### state-park-boundaries.AC2: Viewport-based delivery
- **state-park-boundaries.AC2.1 Success:** `GET /api/park-boundaries` returns GeoJSON FeatureCollection with parks whose bbox overlaps the viewport
- **state-park-boundaries.AC2.2 Success:** `detail` parameter selects correct simplification level (full/moderate/simplified)
- **state-park-boundaries.AC2.3 Success:** Response capped at 50 parks, sorted by GisAcres descending
- **state-park-boundaries.AC2.4 Failure:** Returns 400 for missing or invalid coordinate/zoom parameters
- **state-park-boundaries.AC2.5 Failure:** Returns empty array when zoom < 8

### state-park-boundaries.AC3: Adaptive detail and caching
- **state-park-boundaries.AC3.1 Success:** On slow connection (downlink < 1 Mbps or measured response > 3s), client requests `simplified` detail
- **state-park-boundaries.AC3.2 Success:** On fast connection (downlink > 5 Mbps and response < 500ms), client requests `full` detail; otherwise `moderate`
- **state-park-boundaries.AC3.3 Success:** Detail level adapts mid-session based on measured response times, not just initial connection check
- **state-park-boundaries.AC3.4 Success:** Fetched boundaries persist in IndexedDB across page reloads -- revisiting same area loads from cache with no network request
- **state-park-boundaries.AC3.5 Success:** At zoom 7, client prefetches simplified boundaries for viewport and all levels for ~100-mile radius in background

### state-park-boundaries.AC4: Import pipeline
- **state-park-boundaries.AC4.1 Success:** Import script queries live PAD-US ArcGIS Feature Service and populates `ParkBoundaries` table
- **state-park-boundaries.AC4.2 Success:** Parcels with same `Unit_Nm + State_Nm` merged into single MultiPolygon
- **state-park-boundaries.AC4.3 Success:** Tiny polygons filtered out below area threshold
- **state-park-boundaries.AC4.4 Success:** Three GeoJSON columns populated with different simplification levels
- **state-park-boundaries.AC4.5 Success:** Bbox and centroid computed correctly from geometry
- **state-park-boundaries.AC4.6 Failure:** Import is idempotent -- re-running does not create duplicate rows

### state-park-boundaries.AC5: Toggle integration
- **state-park-boundaries.AC5.1 Success:** Hide POIs button hides state park boundary fill, outline, dot, and label layers

## Glossary

- **PAD-US**: Protected Areas Database of the United States. A federal geospatial dataset maintained by USGS that catalogs all protected land in the US, including national parks, state parks, wilderness areas, and wildlife refuges. Version 4.1 is used here.
- **ArcGIS Feature Service**: A REST API provided by Esri's ArcGIS platform that serves geographic features (points, lines, polygons) as JSON. PAD-US exposes its data through this interface; the import script queries it directly.
- **SP / SREC**: PAD-US category codes for State Park (`SP`) and State Recreation Area (`SREC`). These are the two categories imported by this feature.
- **GeoJSON**: An open standard format for encoding geographic features (points, lines, polygons) as JSON. Used throughout this feature for API responses, MapLibre layer sources, and stored geometry columns.
- **FeatureCollection**: A GeoJSON container type that holds an array of `Feature` objects. The `/api/park-boundaries` endpoint returns this type.
- **MultiPolygon**: A GeoJSON geometry type representing a single named entity made up of multiple non-contiguous polygon rings. Used here because many state parks consist of more than one land parcel.
- **Bbox (bounding box)**: The rectangular geographic envelope that contains a shape, defined by min/max latitude and longitude. Stored as four float columns in `ParkBoundaries` and used for fast viewport intersection queries without spatial extensions.
- **Centroid**: The geometric center point of a polygon or MultiPolygon, stored as a lat/lng pair. Used to place the park's dot marker and label on the map.
- **Douglas-Peucker simplification**: An algorithm that reduces the number of points in a polygon by removing vertices that fall within a given tolerance of a straight line between neighbors. Used to produce the `moderate` and `simplified` geometry levels.
- **Chaikin smoothing**: A curve-smoothing algorithm that repeatedly cuts corners of a polygon to produce a smoother outline. Applied after Douglas-Peucker to reduce the blocky appearance of simplified geometry.
- **MapLibre GL JS**: The open-source WebGL map rendering library used by this application. Renders vector data as styled layers (fill, line, symbol) on top of base map tiles.
- **IndexedDB**: A browser-native key-value database with ~50 MB+ capacity and an async API. Used here as the client-side persistent cache for boundary GeoJSON, replacing repeated network fetches for previously viewed areas.
- **navigator.connection**: A browser API (Network Information API) that exposes an estimated `downlink` value in Mbps for the current network connection. Used to select an initial detail level before any requests are made.
- **GisAcres**: A numeric field from PAD-US indicating the area of a protected unit in acres as computed from its GIS geometry. Used here to sort results and prioritize larger parks when the response is capped at 50.
- **EF Core migration**: An Entity Framework Core feature that generates and applies incremental database schema changes from C# model classes. Phase 1 uses this to create the `ParkBoundaries` table.
- **WebApplicationFactory**: An ASP.NET Core test utility that spins up the full application pipeline in memory against a test database. Used in Phase 3 to integration-test the API endpoint with SQLite.
- **Idempotent**: Describes an operation that produces the same result regardless of how many times it is run. The import script is required to be idempotent -- re-running it must not create duplicate rows.
- **Prefetch**: Downloading data before it is needed so that it is available from cache when the user reaches the zoom level or viewport that requires it. Here, simplified boundaries are prefetched at zoom 7 so they are ready when the zoom-8 render threshold is crossed.

## Architecture

Bbox + GeoJSON text storage approach. New `roadtrip.ParkBoundaries` table stores one row per merged park with bounding box columns (indexed for viewport queries) and three pre-computed GeoJSON text columns at different simplification levels. New API endpoint `GET /api/park-boundaries` returns GeoJSON FeatureCollection filtered by viewport. Client-side module (`stateParkLayer.js`) renders boundaries using MapLibre fill+outline layers and manages an IndexedDB persistent cache to minimize re-downloads.

**Data flow:**

1. One-time import: Python-or-.NET script queries PAD-US ArcGIS Feature Service → merges parcels by name+state → simplifies at 3 levels → computes bbox and centroid → inserts into `ParkBoundaries` table
2. Runtime: Client pans map → `stateParkLayer` computes viewport → checks IndexedDB cache for known parks → fetches only missing parks from `/api/park-boundaries` → caches new results → updates MapLibre GeoJSON source
3. Prefetch: At zoom >= 7, client background-fetches boundaries for current viewport (simplified detail) and all detail levels for a ~100-mile radius around center

**Key decisions:**

- **Bbox + GeoJSON text over spatial types**: Simple float comparisons for viewport filtering. No new NuGet dependencies. Follows existing PoiEntity query pattern. False positives from bbox overlap are acceptable (client renders whatever is returned).
- **IndexedDB over localStorage**: 50MB+ capacity vs 5MB. Async API prevents UI blocking. Parks don't move — cache entries persist indefinitely with no TTL.
- **Merged parcels**: PAD-US has many small parcels per park. Merging by `Unit_Nm + State_Nm` into single MultiPolygon reduces DB rows, prevents duplicate labels, matches national park approach.
- **3 detail levels**: `full` (Chaikin smoothing only), `moderate` (Douglas-Peucker tolerance ~0.001 + smoothing), `simplified` (Douglas-Peucker tolerance ~0.005 + smoothing). Client selects based on `navigator.connection.downlink` (estimated Mbps) and measured response time. Thresholds: < 1 Mbps → simplified, 1-5 Mbps → moderate, > 5 Mbps → full. Measured response time overrides: > 3s steps down, < 500ms steps up.

### Database Schema

```
roadtrip.ParkBoundaries
────────────────────────────────────────
 Id              int (PK, identity)
 Name            nvarchar(300)
 State           nvarchar(2)
 Category        nvarchar(50)       -- 'SP' or 'SREC'
 GisAcres        int
 CentroidLat     float
 CentroidLng     float
 MinLat          float  ┐
 MaxLat          float  │ composite index
 MinLng          float  │ for viewport queries
 MaxLng          float  ┘
 GeoJsonFull     nvarchar(max)
 GeoJsonModerate nvarchar(max)
 GeoJsonSimplified nvarchar(max)
 Source          nvarchar(50)       -- 'pad_us'
 SourceId        nvarchar(200)      -- PAD-US Unit_Nm + State_Nm hash
```

### API Contract

```
GET /api/park-boundaries?minLat={}&maxLat={}&minLng={}&maxLng={}&detail={full|moderate|simplified}

Response: GeoJSON FeatureCollection
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "id": 123,
        "name": "Deception Pass State Park",
        "state": "WA",
        "category": "SP",
        "centroidLat": 48.40,
        "centroidLng": -122.65
      },
      "geometry": {
        "type": "MultiPolygon",
        "coordinates": [...]
      }
    }
  ]
}

Constraints:
- Zoom gating: returns empty below zoom 8 (zoom param required)
- Result limit: max 50 parks per response, sorted by GisAcres descending
- Validation: same coordinate/zoom validation as /api/poi
- Detail default: "moderate"
```

### Client Cache Contract

```javascript
// mapCache.js — shared cache module (IndexedDB)
// Designed for park boundaries now, extensible to POIs and NPS boundaries later

mapCache.get(type, id, detailLevel)    // → cached GeoJSON or null
mapCache.put(type, id, detailLevel, data) // → stores entry
mapCache.getIds(type, bounds)          // → Set of cached IDs in viewport
mapCache.clear(type)                   // → clears all entries of a type

// type: 'park-boundary' | 'nps-boundary' | 'poi' (future)
// No TTL, no expiration. Entries persist indefinitely.
// LRU eviction only under browser storage pressure.
```

## Existing Patterns

**Followed from codebase:**

- **Viewport query pattern**: `/api/poi` in `Program.cs` uses `WHERE Latitude >= @minLat AND Latitude <= @maxLat ...` with simple float comparisons. The new `/api/park-boundaries` uses the same pattern with bbox columns.
- **Boundary rendering**: `parkStyle.js` renders national parks with fill layer (`nps-boundary-fill`), outline layer (`nps-boundary-outline`), centroid dot (`nps-centroid-dot`), and label (`nps-boundary-labels`). State parks follow identical layer structure with `sp-` prefix and different hue.
- **Click behavior**: National park centroid dots have click handlers with popup and action buttons (`onPoiSelect`/`onPoiZoom` from `postUI.js`). State parks use same callback pattern.
- **Toggle integration**: `poiLayer._parkLayers` array lists all park layer IDs for hide/show. New `sp-` layers appended to this array.
- **Import infrastructure**: `RoadTripMap.PoiSeeder` project has `PadUsImporter` for centroid extraction. New `PadUsBoundaryImporter` class follows same batch save + upsert pattern but targets `ParkBoundaries` table and pulls from live API instead of file.
- **Geometry processing**: `parkStyle.js._computeCentroid()` averages all coordinates. Import script uses same algorithm server-side. Chaikin smoothing and tiny-polygon filtering applied during import (same as `nps-boundaries.geojson` preprocessing).

**New pattern introduced:**

- **IndexedDB client-side cache** (`mapCache.js`): No existing client-side caching in the app. This module is new but designed to be adopted by existing features (NPS boundaries, POIs) later without rearchitecting.
- **Adaptive detail selection**: Client-side connection quality detection using `navigator.connection` API. New pattern, no existing precedent in codebase.
- **Predictive prefetch**: Background data loading at zoom 7 before boundaries render at zoom 8. New pattern.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Database Schema and Migration
**Goal:** Create `ParkBoundaries` table with EF Core migration

**Components:**
- `ParkBoundaryEntity` in `src/RoadTripMap/Entities/`
- Migration in `src/RoadTripMap/Migrations/`
- DbContext update in `src/RoadTripMap/Data/RoadTripDbContext.cs`

**Dependencies:** None

**Done when:** Migration applies successfully, table exists with correct schema and indexes
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Import Script
**Goal:** Pull state park boundaries from PAD-US ArcGIS Feature Service, process geometry, store in DB

**Components:**
- `PadUsBoundaryImporter` in `src/RoadTripMap.PoiSeeder/Importers/`
- Geometry processing: merge by name+state, filter tiny polygons, simplify at 3 levels, compute bbox and centroid
- Integration with existing `Program.cs` CLI in PoiSeeder (new `--boundaries` flag)

**Dependencies:** Phase 1 (table must exist)

**Done when:**
- Import script runs against live PAD-US API and populates DB
- Integration test hits live PAD-US API for a known park (e.g., Deception Pass SP in WA), verifies response format, runs full pipeline (merge → simplify → bbox → centroid → DB insert), confirms correct data in DB
- Unit tests for pure geometry functions (Chaikin smoothing, Douglas-Peucker simplification, centroid computation, bbox extraction)
- Covers: state-park-boundaries.AC4.1 through AC4.5
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: API Endpoint
**Goal:** Serve park boundaries by viewport via `GET /api/park-boundaries`

**Components:**
- New endpoint in `src/RoadTripMap/Program.cs`
- Response model (GeoJSON FeatureCollection constructed from DB rows)

**Dependencies:** Phase 2 (DB must have data to serve)

**Done when:**
- Endpoint returns GeoJSON FeatureCollection filtered by bbox
- Detail parameter selects correct GeoJSON column
- Zoom gating returns empty below zoom 8
- Result limiting caps at 50 sorted by GisAcres
- Validation rejects invalid coordinates/zoom
- Tests verify all of the above using WebApplicationFactory + SQLite (same pattern as `PoiEndpointTests`)
- Covers: state-park-boundaries.AC2.1 through AC2.5
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Client-Side Cache Module
**Goal:** IndexedDB-backed persistent cache for map data

**Components:**
- `mapCache.js` in `src/RoadTripMap/wwwroot/js/`
- IndexedDB schema: object store per type, keyed by `{id}_{detailLevel}`

**Dependencies:** None (can be built in parallel with Phase 3)

**Done when:**
- `mapCache.get/put/getIds/clear` methods work correctly
- Data persists across page reloads
- Manual verification: store boundary, reload page, confirm cached data returns
- Covers: state-park-boundaries.AC3.4
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Frontend Rendering
**Goal:** Render state park boundaries on map with fill, outline, centroid dot, labels, and click behavior

**Components:**
- `stateParkLayer.js` in `src/RoadTripMap/wwwroot/js/`
- Integration in `mapUI.js` and `postUI.js` (init calls, options passthrough)
- API client method in `api.js` (`fetchParkBoundaries`)
- Toggle integration in `poiLayer.js` (`_parkLayers` array)
- Script tags in `trips.html` and `post.html`

**Dependencies:** Phase 3 (API), Phase 4 (cache)

**Done when:**
- Boundaries render at zoom >= 8 with correct styling (fill + outline, different hue from national parks)
- Centroid dot and label visible, clickable with popup and action buttons on post page
- Hide POIs button toggles state park layers
- Manual verification with running app and screenshots
- Covers: state-park-boundaries.AC1.1 through AC1.4, AC5.1
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Adaptive Detail and Predictive Prefetch
**Goal:** Client selects detail level based on connection quality and prefetches data at lower zoom levels

**Components:**
- Adaptive detail logic in `stateParkLayer.js` — checks `navigator.connection.downlink` (Mbps), measures response time, steps up/down
- Prefetch logic in `stateParkLayer.js` — at zoom >= 7, background-fetch simplified boundaries for viewport; fetch all levels for ~100-mile radius
- Cache integration — prefetched data stored in IndexedDB, render checks cache before fetching

**Dependencies:** Phase 5 (rendering must work first)

**Done when:**
- Adaptive detail: throttle to 3G in DevTools, verify simplified detail requested; on fast connection, verify moderate/full requested
- Prefetch: at zoom 7, verify network requests fire in background; zoom to 8, verify boundaries render from cache without new network request
- Manual verification via browser DevTools Network tab and Application > IndexedDB
- Covers: state-park-boundaries.AC3.1 through AC3.3, AC3.5
<!-- END_PHASE_6 -->

## Additional Considerations

**Deduplication with existing POI dots:** The `PointsOfInterest` table already has `state_park` category POI dots from Overpass and PAD-US centroid imports. After state park boundaries are rendering with their own centroid dots, the POI dots become redundant for parks that have boundaries. A follow-up task should exclude parks with boundaries from the POI dot layer to avoid visual clutter. This is out of scope for this design.

**Future: shared cache for all map data:** The `mapCache.js` module is designed with a `type` parameter so national park boundaries and POIs can adopt it later. National parks could store their 62 features in IndexedDB on first load instead of re-fetching the static file. POIs could cache by viewport hash. No changes needed to `mapCache.js` — just call it from `parkStyle.js` and `poiLayer.js`.

**Import runtime:** PAD-US API returns max 2,000 features per request. At ~11,200 features with 2s rate limiting between requests, import takes ~30-45 minutes. This is a one-time cost.

**Future: adaptive map tile detail:** On slow connections, serving lower-detail base map tiles (basic roads and towns without terrain/forest shading) would further reduce bandwidth. This requires configuring multiple MapTiler style URLs or switching tile providers and is a separate feature from boundary data.
