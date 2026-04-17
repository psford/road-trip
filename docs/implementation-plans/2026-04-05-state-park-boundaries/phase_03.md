# State Park Boundaries Implementation Plan — Phase 3

**Goal:** Serve park boundaries by viewport via `GET /api/park-boundaries`

**Architecture:** New minimal API endpoint in `Program.cs` following existing `/api/poi` pattern. Queries `ParkBoundaries` table with bbox overlap filter using simple float comparisons (same as POI viewport query). Returns GeoJSON FeatureCollection (new response pattern — no existing endpoints return GeoJSON). Capped at 50 results sorted by GisAcres descending.

**Tech Stack:** C# / .NET 8.0 / ASP.NET Core Minimal API / EF Core 8.0.23 / xUnit + FluentAssertions + SQLite

**Scope:** Phase 3 of 6 from original design

**Codebase verified:** 2026-04-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### state-park-boundaries.AC2: Viewport-based delivery
- **state-park-boundaries.AC2.1 Success:** `GET /api/park-boundaries` returns GeoJSON FeatureCollection with parks whose bbox overlaps the viewport
- **state-park-boundaries.AC2.2 Success:** `detail` parameter selects correct simplification level (full/moderate/simplified)
- **state-park-boundaries.AC2.3 Success:** Response capped at 50 parks, sorted by GisAcres descending
- **state-park-boundaries.AC2.4 Failure:** Returns 400 for missing or invalid coordinate/zoom parameters
- **state-park-boundaries.AC2.5 Failure:** Returns empty array when zoom < 8

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create GeoJSON response models

**Verifies:** state-park-boundaries.AC2.1 (response structure)

**Files:**
- Create: `src/RoadTripMap/Models/ParkBoundaryResponse.cs`

**Implementation:**

No existing endpoint returns GeoJSON, so this is a new pattern. Create models that serialize to valid GeoJSON FeatureCollection format. Follow existing response model conventions — C# records with `required` properties and `init` setters, in `src/RoadTripMap/Models/`.

The models must produce this JSON structure when serialized:
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "id": 123, "name": "...", "state": "WA", "category": "SP", "centroidLat": 48.40, "centroidLng": -122.65 },
      "geometry": { "type": "MultiPolygon", "coordinates": [...] }
    }
  ]
}
```

The `geometry` field contains the raw GeoJSON string from the database (`GeoJsonFull`, `GeoJsonModerate`, or `GeoJsonSimplified`). Since the geometry is already stored as a JSON string in the DB, it needs to be serialized as raw JSON (not as an escaped string). Use `System.Text.Json.Nodes.JsonNode.Parse()` to convert the stored string to a JSON node that serializes inline.

**Verification:**

Run:
```bash
cd /home/patrick/projects/road-trip && dotnet build src/RoadTripMap/RoadTripMap.csproj
```
Expected: Build succeeds.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement GET /api/park-boundaries endpoint

**Verifies:** state-park-boundaries.AC2.1, state-park-boundaries.AC2.2, state-park-boundaries.AC2.3, state-park-boundaries.AC2.4, state-park-boundaries.AC2.5

**Files:**
- Modify: `src/RoadTripMap/Program.cs` (add new endpoint after existing `/api/poi` block)

**Implementation:**

Add `app.MapGet("/api/park-boundaries", ...)` inline in Program.cs, following the same pattern as `/api/poi` (lines 480-599).

**Parameters** (all nullable doubles/ints from query string):
- `minLat`, `maxLat`, `minLng`, `maxLng` — viewport bounds
- `zoom` — current map zoom level
- `detail` — optional string, one of `"full"`, `"moderate"`, `"simplified"`, defaults to `"moderate"`

**Validation** (same pattern as `/api/poi` lines 484-497):
1. All five coordinate/zoom params required — return `Results.BadRequest(new { error = "..." })` if missing
2. Latitude range: -90 to 90
3. Longitude range: -180 to 180
4. Zoom >= 0
5. If `detail` provided, must be one of `"full"`, `"moderate"`, `"simplified"` — return 400 otherwise

**Zoom gating:**
- If zoom < 8: return `Results.Ok(new { type = "FeatureCollection", features = Array.Empty<object>() })`

**Query:**
```csharp
var parks = await db.ParkBoundaries
    .Where(p => p.MaxLat >= minLat && p.MinLat <= maxLat && p.MaxLng >= minLng && p.MinLng <= maxLng)
    .OrderByDescending(p => p.GisAcres)
    .Take(50)
    .ToListAsync();
```

Note the bbox overlap logic: a park's bbox overlaps the viewport when `park.MaxLat >= viewport.minLat AND park.MinLat <= viewport.maxLat AND park.MaxLng >= viewport.minLng AND park.MinLng <= viewport.maxLng`.

**Detail level selection:**
Select the correct GeoJSON column based on the `detail` parameter:
- `"full"` → `GeoJsonFull`
- `"moderate"` → `GeoJsonModerate`
- `"simplified"` → `GeoJsonSimplified`

**Response construction:**
Build a GeoJSON FeatureCollection from the query results. For each park, parse the stored GeoJSON string into a `JsonNode` so it serializes as inline JSON (not escaped string). Return the FeatureCollection with `Results.Ok()`.

**Verification:**

Run:
```bash
cd /home/patrick/projects/road-trip && dotnet build src/RoadTripMap/RoadTripMap.csproj
```
Expected: Build succeeds.

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Integration tests for park-boundaries endpoint

**Verifies:** state-park-boundaries.AC2.1, state-park-boundaries.AC2.2, state-park-boundaries.AC2.3, state-park-boundaries.AC2.4, state-park-boundaries.AC2.5

**Files:**
- Create: `tests/RoadTripMap.Tests/Endpoints/ParkBoundaryEndpointTests.cs`

**Implementation:**

Follow `PoiEndpointTests.cs` pattern exactly:
- Class implements `IAsyncLifetime`
- `InitializeAsync`: create SQLite in-memory connection, configure `WebApplicationFactory<Program>` replacing DbContextOptions with SQLite, create HttpClient
- `DisposeAsync`: dispose client, factory, connection
- Seed helper method creates `ParkBoundaryEntity` records via separate DbContext using same connection

**Tests must verify each AC:**

- **state-park-boundaries.AC2.1:** Seed 3 parks with known bboxes. Request viewport that overlaps 2 of them. Assert response is valid GeoJSON FeatureCollection with exactly 2 features. Assert each feature has correct `properties` (id, name, state, category, centroidLat, centroidLng) and `geometry` object.

- **state-park-boundaries.AC2.2:** Seed 1 park with all 3 GeoJSON columns populated with different content. Request with `detail=full`, assert geometry matches `GeoJsonFull`. Request with `detail=simplified`, assert geometry matches `GeoJsonSimplified`. Request with no detail param, assert geometry matches `GeoJsonModerate` (default).

- **state-park-boundaries.AC2.3:** Seed 60 parks all within viewport. Assert response contains exactly 50 features. Assert they are sorted by GisAcres descending (first feature has highest GisAcres).

- **state-park-boundaries.AC2.4:** Test missing params (no minLat, no zoom, etc.) — each returns 400. Test invalid values (lat=100, zoom=-1) — returns 400. Test invalid detail value (detail=ultra) — returns 400.

- **state-park-boundaries.AC2.5:** Seed parks within viewport. Request with zoom=7 — assert response has `"type": "FeatureCollection"` and empty features array. Request with zoom=8 — assert features are populated.

Parse responses with `JsonDocument` using `JsonSerializerOptions { PropertyNameCaseInsensitive = true }` as done in `PoiEndpointTests.cs`.

**Verification:**

Run:
```bash
cd /home/patrick/projects/road-trip && dotnet build RoadTripMap.sln && dotnet test RoadTripMap.sln --configuration Release --no-build
```
Expected: All tests pass including new park boundary endpoint tests.

**Commit:**

```bash
git add src/RoadTripMap/Models/ParkBoundaryResponse.cs src/RoadTripMap/Program.cs tests/RoadTripMap.Tests/Endpoints/ParkBoundaryEndpointTests.cs
git commit -m "feat: add GET /api/park-boundaries endpoint with viewport filtering and GeoJSON response"
```

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
