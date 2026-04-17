# Map POI Implementation Plan — Phase 1: Database Schema & API Endpoint

**Goal:** Create the PointsOfInterest database table and a viewport-scoped API endpoint that returns POIs filtered by bounding box and zoom level.

**Architecture:** New EF Core entity + migration following the existing GeoCacheEntity pattern, plus a new Minimal API GET endpoint in Program.cs that queries by bounding box with zoom-based category filtering and a 200-result cap.

**Tech Stack:** .NET 8, EF Core 8.0 (SQL Server), ASP.NET Core Minimal APIs

**Scope:** 6 phases from original design (phase 1 of 6)

**Codebase verified:** 2026-04-03

---

## Acceptance Criteria Coverage

This phase implements and tests:

### map-poi.AC1: POI markers on maps
- **map-poi.AC1.4 Success:** API returns POIs filtered to the current viewport bounding box

### map-poi.AC4: Regional/viewport loading
- **map-poi.AC4.1 Success:** At zoom < 7, only national parks appear as markers
- **map-poi.AC4.2 Success:** At zoom 7-9, state parks and natural features also appear
- **map-poi.AC4.3 Success:** At zoom 10+, all categories (historic, tourism) appear
- **map-poi.AC4.4 Failure:** API never returns more than 200 POIs per request

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Create PoiEntity and PoiResponse model

**Verifies:** None (infrastructure — entity and model definitions)

**Files:**
- Create: `src/RoadTripMap/Entities/PoiEntity.cs`
- Create: `src/RoadTripMap/Models/PoiResponse.cs`

**Implementation:**

Create the entity following the GeoCacheEntity pattern (`src/RoadTripMap/Entities/GeoCacheEntity.cs`). Properties:

- `Id` (int, PK, auto-increment)
- `Name` (string, required, max 300)
- `Category` (string, required, max 50) — values: `national_park`, `state_park`, `historic_site`, `natural_feature`, `tourism`
- `Latitude` (double, required)
- `Longitude` (double, required)
- `Source` (string, required, max 50) — values: `pad_us`, `osm`, `nps`
- `SourceId` (string, nullable, max 200) — external ID for upsert dedup

Create the response record following the existing pattern in `src/RoadTripMap/Models/PhotoResponse.cs` — use `public record` with init properties:

- `Id` (int)
- `Name` (string)
- `Category` (string)
- `Lat` (double)
- `Lng` (double)

**Verification:**
Run: `dotnet build src/RoadTripMap/RoadTripMap.csproj`
Expected: Build succeeds

**Commit:** `feat: add PoiEntity and PoiResponse models`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Register PoiEntity in DbContext and create migration

**Verifies:** None (infrastructure — database schema)

**Files:**
- Modify: `src/RoadTripMap/Data/RoadTripDbContext.cs` (add `DbSet<PoiEntity>` property and entity configuration in `OnModelCreating`)

**Implementation:**

Add to `RoadTripDbContext`:
1. `public DbSet<PoiEntity> PointsOfInterest { get; set; }` property
2. In `OnModelCreating` (after the GeoCacheEntity block at line ~55), add PoiEntity configuration:
   - Table name: `PointsOfInterest`
   - `Name`: required, max length 300
   - `Category`: required, max length 50
   - `Source`: required, max length 50
   - `SourceId`: max length 200 (nullable)
   - Composite index on `(Latitude, Longitude)` (not unique — multiple POIs can share coordinates)
   - Index on `SourceId`
   - Index on `Category`

Then generate migration:

Run: `dotnet ef migrations add AddPointsOfInterest --project src/RoadTripMap/RoadTripMap.csproj`

Verify the generated migration file creates the table with correct columns and indexes.

**Verification:**
Run: `dotnet build src/RoadTripMap/RoadTripMap.csproj`
Expected: Build succeeds with new migration file in `src/RoadTripMap/Migrations/`

**Commit:** `feat: add PointsOfInterest table migration with indexes`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Add GET /api/poi endpoint

**Verifies:** map-poi.AC1.4, map-poi.AC4.1, map-poi.AC4.2, map-poi.AC4.3, map-poi.AC4.4

**Files:**
- Modify: `src/RoadTripMap/Program.cs` (add new endpoint after existing endpoints, before `app.Run()`)

**Implementation:**

Add `app.MapGet("/api/poi", ...)` endpoint in `Program.cs` following existing endpoint patterns (see geocode endpoint at ~line 99 for query parameter pattern).

Query parameters (all required):
- `minLat`, `maxLat`, `minLng`, `maxLng` (double) — viewport bounding box
- `zoom` (int) — current map zoom level

Endpoint logic:
1. Validate all 5 parameters are present (return 400 if missing)
2. Validate lat range (-90 to 90), lng range (-180 to 180), zoom >= 0
3. Determine allowed categories based on zoom:
   - zoom < 7: `["national_park"]`
   - zoom 7-9: `["national_park", "state_park", "natural_feature"]`
   - zoom >= 10: `["national_park", "state_park", "natural_feature", "historic_site", "tourism"]`
4. Query `db.PointsOfInterest` with:
   - `.Where(p => p.Latitude >= minLat && p.Latitude <= maxLat && p.Longitude >= minLng && p.Longitude <= maxLng)`
   - `.Where(p => allowedCategories.Contains(p.Category))`
   - `.Take(200)`
   - `.Select(p => new PoiResponse { ... })`
   - `.ToListAsync()`
5. Return `Results.Ok(pois)`

No auth required (public reference data).

**Verification:**
Run: `dotnet build src/RoadTripMap/RoadTripMap.csproj`
Expected: Build succeeds

**Commit:** `feat: add GET /api/poi endpoint with viewport and zoom filtering`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: POI endpoint tests

**Verifies:** map-poi.AC1.4, map-poi.AC4.1, map-poi.AC4.2, map-poi.AC4.3, map-poi.AC4.4

**Files:**
- Create: `tests/RoadTripMap.Tests/Endpoints/PoiEndpointTests.cs`

**Testing:**

Reference existing test patterns in `tests/RoadTripMap.Tests/Endpoints/` — use `WebApplicationFactory` with SQLite in-memory database (see `SecurityHeaderTests.cs` lines 10-47 for the pattern, and `IntegrationTests.cs` for endpoint testing).

Use FluentAssertions for assertions. Seed test POI data directly into the in-memory database before each test.

Tests must verify each AC listed:

- **map-poi.AC1.4:** Seed POIs in a known bounding box. Call `/api/poi` with that bounding box. Assert response contains expected POIs. Call with a different bounding box that excludes them. Assert empty response.

- **map-poi.AC4.1:** Seed POIs with categories `national_park`, `state_park`, `historic_site`. Call with `zoom=5`. Assert only `national_park` POIs returned.

- **map-poi.AC4.2:** Same seed data. Call with `zoom=8`. Assert `national_park`, `state_park`, and `natural_feature` returned but NOT `historic_site` or `tourism`.

- **map-poi.AC4.3:** Same seed data. Call with `zoom=12`. Assert all categories returned.

- **map-poi.AC4.4:** Seed 250 POIs in same bounding box. Call endpoint. Assert response contains at most 200 items.

Additional tests:
- Missing required parameters returns 400
- Invalid coordinate ranges return 400

**Verification:**
Run: `dotnet test tests/RoadTripMap.Tests/RoadTripMap.Tests.csproj --filter "FullyQualifiedName~PoiEndpoint"`
Expected: All tests pass

**Commit:** `test: add POI endpoint tests for viewport filtering and zoom categories`

<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->
