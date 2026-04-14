# State Park Boundaries Implementation Plan — Phase 2

**Goal:** Pull state park boundaries from PAD-US ArcGIS Feature Service, process geometry, store in DB

**Architecture:** New `PadUsBoundaryImporter` class in the existing PoiSeeder console app. Queries the PAD-US ArcGIS Feature Service REST API with pagination (2000 records/page), filters for SP/SREC designation types, merges parcels sharing the same `Unit_Nm + State_Nm` into single MultiPolygons, applies geometry simplification at 3 levels (full with Chaikin smoothing only, moderate with Douglas-Peucker tolerance ~0.001 + smoothing, simplified with tolerance ~0.005 + smoothing), computes bounding box and centroid, and upserts into `ParkBoundaries` table. Geometry processing functions (Douglas-Peucker, Chaikin, centroid, bbox) are implemented from scratch — no external geometry library.

**Tech Stack:** C# / .NET 8.0 / EF Core 8.0.23 / System.Text.Json / HttpClient

**Scope:** Phase 2 of 6 from original design

**Codebase verified:** 2026-04-05

**External dependency investigation findings:**
- PAD-US ArcGIS Feature Service query endpoint: `https://gis1.usgs.gov/arcgis/rest/services/padus3/[SERVICE_NAME]/FeatureServer/0/query`
- Filter: `where=d_Des_Tp IN ('State Park', 'State Recreation Area')`
- Fields: `outFields=Unit_Nm,State_Nm,d_Des_Tp,GIS_Acres,OBJECTID`
- GeoJSON format: `f=geojson&outSR=4326&returnGeometry=true`
- Pagination: `resultOffset` + `resultRecordCount=2000`, check `exceededTransferLimit` in response
- Total count: `returnCountOnly=true`
- Rate limiting: implement backoff on HTTP 429; 2s delay between pages per CLAUDE.md API rules

---

## Acceptance Criteria Coverage

This phase implements and tests:

### state-park-boundaries.AC4: Import pipeline
- **state-park-boundaries.AC4.1 Success:** Import script queries live PAD-US ArcGIS Feature Service and populates `ParkBoundaries` table
- **state-park-boundaries.AC4.2 Success:** Parcels with same `Unit_Nm + State_Nm` merged into single MultiPolygon
- **state-park-boundaries.AC4.3 Success:** Tiny polygons filtered out below area threshold
- **state-park-boundaries.AC4.4 Success:** Three GeoJSON columns populated with different simplification levels
- **state-park-boundaries.AC4.5 Success:** Bbox and centroid computed correctly from geometry
- **state-park-boundaries.AC4.6 Failure:** Import is idempotent — re-running does not create duplicate rows

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Implement geometry processing utilities

**Verifies:** state-park-boundaries.AC4.3, state-park-boundaries.AC4.4, state-park-boundaries.AC4.5

**Files:**
- Create: `src/RoadTripMap.PoiSeeder/Geometry/GeoJsonProcessor.cs`

**Implementation:**

Create a static utility class with pure geometry functions. No existing geometry library is used in the project — implement from scratch. All coordinates are `[longitude, latitude]` pairs (GeoJSON convention).

The class needs these methods:

1. **`ComputeCentroid(List<List<List<double[]>>> multiPolygonCoords)`** — Averages all coordinates across all rings of all polygons. Follow existing pattern from `PadUsImporter` (simple average of all coordinate lon/lat values).

2. **`ComputeBbox(List<List<List<double[]>>> multiPolygonCoords)`** — Returns `(minLat, maxLat, minLng, maxLng)` by scanning all coordinates for min/max values.

3. **`SimplifyRing(double[][] ring, double tolerance)`** — Douglas-Peucker simplification. Recursively finds the point farthest from the line between start and end. If distance > tolerance, keep it and recurse on both halves. Otherwise discard intermediate points. Must preserve first and last point (ring closure).

4. **`SmoothRing(double[][] ring, int iterations = 2)`** — Chaikin corner-cutting. For each iteration, replace each pair of adjacent points with two new points at 25% and 75% along the segment. Preserves ring closure (first point == last point).

5. **`FilterTinyPolygons(List<List<double[][]>> polygons, double minAreaDeg2)`** — Removes polygons whose shoelace-formula area is below threshold. The area threshold is in square degrees (approximate, sufficient for filtering). Use `0.0001` as default (~0.7 km² at mid-latitudes).

6. **`SimplifyMultiPolygon(List<List<double[][]>> polygons, double dpTolerance, int chaikinIterations)`** — Applies Douglas-Peucker then Chaikin to every ring of every polygon. Returns simplified polygon list.

7. **`BuildGeoJson(List<List<double[][]>> polygons)`** — Serializes polygon coordinates to a GeoJSON geometry object string: `{"type": "MultiPolygon", "coordinates": [...]}`.

The three detail levels call `SimplifyMultiPolygon` with different parameters:
- **Full:** dpTolerance = 0 (no simplification), chaikinIterations = 2
- **Moderate:** dpTolerance = 0.001, chaikinIterations = 2
- **Simplified:** dpTolerance = 0.005, chaikinIterations = 2

**Verification:**

Run:
```bash
cd /home/patrick/projects/road-trip && dotnet build src/RoadTripMap.PoiSeeder/RoadTripMap.PoiSeeder.csproj
```
Expected: Build succeeds.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Unit tests for geometry processing

**Verifies:** state-park-boundaries.AC4.3, state-park-boundaries.AC4.4, state-park-boundaries.AC4.5

**Files:**
- Create: `tests/RoadTripMap.Tests/Seeder/GeoJsonProcessorTests.cs`

**Implementation:**

Follow existing seeder test patterns from `PadUsImporterTests.cs` — xUnit with FluentAssertions, no DB needed for pure geometry functions.

**Tests must verify each AC:**

- **state-park-boundaries.AC4.5 (centroid):** Given a simple square polygon (e.g., corners at [0,0], [1,0], [1,1], [0,1]), `ComputeCentroid` returns center (0.5, 0.5). Given a MultiPolygon with two disjoint squares, centroid is average of all coordinates.

- **state-park-boundaries.AC4.5 (bbox):** Given a polygon, `ComputeBbox` returns correct min/max lat/lng. Given MultiPolygon spanning from (-122, 47) to (-121, 48), bbox is minLng=-122, maxLng=-121, minLat=47, maxLat=48.

- **state-park-boundaries.AC4.3 (tiny polygon filter):** Create a list of polygons: one large (area > threshold) and one tiny (area < threshold). After `FilterTinyPolygons`, only the large polygon remains.

- **state-park-boundaries.AC4.4 (Douglas-Peucker simplification):** Given a ring with collinear points (e.g., [0,0], [0.5,0], [1,0], [1,1], [0,1], [0,0]), simplification with tolerance > 0 removes the collinear intermediate point. Given a ring with a point far from the line, it is preserved.

- **state-park-boundaries.AC4.4 (Chaikin smoothing):** Given a simple square ring, one iteration of Chaikin produces 8 points (each edge split into two segments). Output ring is still closed (first == last).

- **state-park-boundaries.AC4.4 (three detail levels):** `SimplifyMultiPolygon` with dpTolerance=0 returns more points than with dpTolerance=0.005. All three levels produce valid GeoJSON when passed through `BuildGeoJson`.

**Verification:**

Run:
```bash
cd /home/patrick/projects/road-trip && dotnet test tests/RoadTripMap.Tests/RoadTripMap.Tests.csproj --filter "FullyQualifiedName~GeoJsonProcessorTests"
```
Expected: All geometry tests pass.

**Commit:**

```bash
git add src/RoadTripMap.PoiSeeder/Geometry/GeoJsonProcessor.cs tests/RoadTripMap.Tests/Seeder/GeoJsonProcessorTests.cs
git commit -m "feat: add geometry processing utilities for boundary simplification"
```

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->
### Task 3: Implement PadUsBoundaryImporter

**Verifies:** state-park-boundaries.AC4.1, state-park-boundaries.AC4.2, state-park-boundaries.AC4.6

**Files:**
- Create: `src/RoadTripMap.PoiSeeder/Importers/PadUsBoundaryImporter.cs`
- Create: `src/RoadTripMap.PoiSeeder/BoundaryUpsertHelper.cs`

**Implementation:**

Follow existing `PadUsImporter` and `OverpassImporter` patterns — constructor takes `RoadTripDbContext` and `HttpClient`, batch save every 100 records.

**PadUsBoundaryImporter class structure:**

Constructor: `PadUsBoundaryImporter(RoadTripDbContext context, HttpClient httpClient)`

Public method: `async Task<(int imported, int skipped, int merged)> ImportAsync()`

**Import workflow:**

1. **Count total features** — Query PAD-US with `returnCountOnly=true` and `where=d_Des_Tp IN ('State Park','State Recreation Area')` to report total count.

2. **Paginate through all features** — Query with `resultOffset` incrementing by 2000, `resultRecordCount=2000`, `f=geojson`, `outSR=4326`, `outFields=Unit_Nm,State_Nm,d_Des_Tp,GIS_Acres,OBJECTID`. Check `exceededTransferLimit` or feature count < 2000 to know when done. Rate limit: `Task.Delay(2000)` between pages (per CLAUDE.md API rules).

3. **Group by name+state** — Accumulate all features in a `Dictionary<string, List<Feature>>` keyed by `$"{Unit_Nm}|{State_Nm}"`. This groups parcels that belong to the same park.

4. **Process each merged park:**
   - Extract all polygon coordinates from all features in the group
   - Build a single MultiPolygon coordinate list
   - Filter tiny polygons via `GeoJsonProcessor.FilterTinyPolygons()`
   - Skip if no polygons remain after filtering
   - Compute three GeoJSON levels via `GeoJsonProcessor.SimplifyMultiPolygon()` + `BuildGeoJson()`
   - Compute centroid and bbox via `GeoJsonProcessor.ComputeCentroid()` / `ComputeBbox()`
   - Sum `GIS_Acres` across all parcels in the group
   - Generate `SourceId` as hash of `Unit_Nm|State_Nm` (use SHA256, take first 40 hex chars)

5. **Upsert** — Use new `BoundaryUpsertHelper.UpsertBoundaryAsync()` following same pattern as `PoiUpsertHelper`: lookup by `Source + SourceId`, insert if new, update all fields if existing. This ensures idempotency (AC4.6).

6. **Batch save** — `SaveChangesAsync()` every 100 records, final save after loop.

**BoundaryUpsertHelper** — follows `PoiUpsertHelper` pattern exactly:
```csharp
public static async Task UpsertBoundaryAsync(RoadTripDbContext context, ParkBoundaryEntity newBoundary)
{
    var existing = await context.ParkBoundaries
        .FirstOrDefaultAsync(p => p.Source == newBoundary.Source && p.SourceId == newBoundary.SourceId);

    if (existing == null)
    {
        context.ParkBoundaries.Add(newBoundary);
    }
    else
    {
        existing.Name = newBoundary.Name;
        existing.State = newBoundary.State;
        existing.Category = newBoundary.Category;
        existing.GisAcres = newBoundary.GisAcres;
        existing.CentroidLat = newBoundary.CentroidLat;
        existing.CentroidLng = newBoundary.CentroidLng;
        existing.MinLat = newBoundary.MinLat;
        existing.MaxLat = newBoundary.MaxLat;
        existing.MinLng = newBoundary.MinLng;
        existing.MaxLng = newBoundary.MaxLng;
        existing.GeoJsonFull = newBoundary.GeoJsonFull;
        existing.GeoJsonModerate = newBoundary.GeoJsonModerate;
        existing.GeoJsonSimplified = newBoundary.GeoJsonSimplified;
        context.ParkBoundaries.Update(existing);
    }
}
```

**Verification:**

Run:
```bash
cd /home/patrick/projects/road-trip && dotnet build src/RoadTripMap.PoiSeeder/RoadTripMap.PoiSeeder.csproj
```
Expected: Build succeeds.

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Wire up --boundaries flag in PoiSeeder CLI

**Files:**
- Modify: `src/RoadTripMap.PoiSeeder/Program.cs`

**Implementation:**

Add a new `--boundaries-only` flag following the existing CLI pattern. The codebase uses individual boolean flags (`npsOnly`, `overpassOnly`, `padUsOnly`) with negated guard conditions — there is no `hasOnlyFlag` variable.

**Step 1: Add the flag variable** (after line 18, alongside existing flag declarations):

```csharp
var boundariesOnly = args.Contains("--boundaries-only");
```

**Step 2: Update existing guard conditions** to exclude boundaries-only runs. Each existing importer block uses negated guards. Add `&& !boundariesOnly` to each:

- NPS guard (line 40): `if (!overpassOnly && !padUsOnly && !boundariesOnly)`
- Overpass guard (line 58): `if (!npsOnly && !padUsOnly && !boundariesOnly)`
- PAD-US guard (line 75): `if (!npsOnly && !overpassOnly && !boundariesOnly)`

**Step 3: Add boundary importer block** after the PAD-US importer block (before the deduplication block at line 98):

```csharp
// Run PAD-US boundary importer if not restricted to other importers
if (!npsOnly && !overpassOnly && !padUsOnly)
{
    Console.WriteLine("Running PAD-US boundary importer...");
    var boundaryImporter = new PadUsBoundaryImporter(context, httpClient);
    try
    {
        var boundaryResult = await boundaryImporter.ImportAsync();
        Console.WriteLine($"  Boundaries: {boundaryResult.imported} imported, {boundaryResult.skipped} skipped, {boundaryResult.merged} parks merged\n");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"  Boundary import failed: {ex.Message}\n");
    }
}
```

Add the using directive at the top if not auto-resolved.

**Verification:**

Run:
```bash
cd /home/patrick/projects/road-trip && dotnet build src/RoadTripMap.PoiSeeder/RoadTripMap.PoiSeeder.csproj
```
Expected: Build succeeds.

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Integration test hitting live PAD-US API and unit tests for importer

**Verifies:** state-park-boundaries.AC4.1, state-park-boundaries.AC4.2, state-park-boundaries.AC4.6

**Files:**
- Create: `tests/RoadTripMap.Tests/Seeder/PadUsBoundaryImporterTests.cs`

**Implementation:**

Follow existing `PadUsImporterTests.cs` pattern — xUnit + FluentAssertions + in-memory DbContext.

**Tests must verify:**

- **state-park-boundaries.AC4.1 (live API integration test):** Hit the live PAD-US ArcGIS Feature Service for a single known park (e.g., Deception Pass State Park in WA). Query with `where=Unit_Nm='Deception Pass' AND State_Nm='WA'`. Verify the response contains features with geometry. Run the full pipeline (parse → merge → simplify → bbox → centroid → DB insert). Confirm the `ParkBoundaryEntity` in the in-memory DB has: non-empty Name, State="WA", valid bbox (MinLat < MaxLat, MinLng < MaxLng), non-empty GeoJsonFull/Moderate/Simplified, valid centroid within bbox. Mark this test with `[Trait("Category", "Integration")]` so it can be excluded from CI if needed.

- **state-park-boundaries.AC4.2 (parcel merging):** Create a mock HTTP handler that returns 3 features with the same `Unit_Nm + State_Nm` but different polygons. After import, assert only 1 `ParkBoundaryEntity` exists in DB. Assert its GeoJSON contains all 3 polygons as a MultiPolygon.

- **state-park-boundaries.AC4.6 (idempotency):** Run importer with mock HTTP handler returning 2 parks. Assert 2 entities in DB. Run again with same data. Assert still 2 entities (not 4). Assert field values are updated (not duplicated).

- **Feature filtering:** Mock response with one valid state park and one feature with missing `Unit_Nm`. Assert only the valid park is imported.

**Verification:**

Run unit tests:
```bash
cd /home/patrick/projects/road-trip && dotnet test tests/RoadTripMap.Tests/RoadTripMap.Tests.csproj --filter "FullyQualifiedName~PadUsBoundaryImporterTests"
```

Run integration test separately (requires network):
```bash
cd /home/patrick/projects/road-trip && dotnet test tests/RoadTripMap.Tests/RoadTripMap.Tests.csproj --filter "FullyQualifiedName~PadUsBoundaryImporterTests&Category=Integration"
```

Expected: All tests pass.

**Commit:**

```bash
git add src/RoadTripMap.PoiSeeder/Importers/PadUsBoundaryImporter.cs src/RoadTripMap.PoiSeeder/BoundaryUpsertHelper.cs src/RoadTripMap.PoiSeeder/Program.cs tests/RoadTripMap.Tests/Seeder/PadUsBoundaryImporterTests.cs
git commit -m "feat: add PAD-US boundary importer with parcel merging and geometry simplification"
```

<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->
