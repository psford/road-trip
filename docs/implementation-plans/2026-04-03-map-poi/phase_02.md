# Map POI Implementation Plan — Phase 2: POI Seed Script

**Goal:** Create a standalone CLI tool that imports POI data from NPS API, PAD-US, and Overpass API into the PointsOfInterest table, with idempotent re-run support.

**Architecture:** New .NET 8 console project (`src/RoadTripMap.PoiSeeder/`) that references the web app project to share DbContext and entity models. Three importers (NPS, PAD-US, Overpass) run sequentially, each performing bulk upsert via SourceId deduplication. Cross-source dedup uses name+proximity matching.

**Tech Stack:** .NET 8 console app, EF Core 8.0 (SQL Server), HttpClient, System.Text.Json

**Scope:** 6 phases from original design (phase 2 of 6)

**Codebase verified:** 2026-04-03

**Design discrepancy:** Design says `tools/PoiSeeder/` but project has no `tools/` directory. Project convention is `src/` for all code. Using `src/RoadTripMap.PoiSeeder/` instead, added to the solution alongside the web app.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### map-poi.AC5: POI data pipeline
- **map-poi.AC5.1 Success:** Seed script imports national parks from NPS API
- **map-poi.AC5.2 Success:** Seed script imports state parks from PAD-US
- **map-poi.AC5.3 Success:** Seed script imports landmarks/tourism from Overpass API
- **map-poi.AC5.4 Success:** Re-running seed script does not create duplicates (idempotent)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Create PoiSeeder console project and add to solution

**Verifies:** None (infrastructure)

**Files:**
- Create: `src/RoadTripMap.PoiSeeder/RoadTripMap.PoiSeeder.csproj`
- Create: `src/RoadTripMap.PoiSeeder/Program.cs` (minimal entry point)
- Modify: `RoadTripMap.sln` (add project reference)

**Implementation:**

Create a new .NET 8 console project:

Run: `dotnet new console -n RoadTripMap.PoiSeeder -o src/RoadTripMap.PoiSeeder --framework net8.0`

Add project reference to the web app (for shared DbContext and entities):

Run: `dotnet add src/RoadTripMap.PoiSeeder/RoadTripMap.PoiSeeder.csproj reference src/RoadTripMap/RoadTripMap.csproj`

Add to solution:

Run: `dotnet sln RoadTripMap.sln add src/RoadTripMap.PoiSeeder/RoadTripMap.PoiSeeder.csproj --solution-folder src`

The entry point `Program.cs` should:
1. Read connection string from `WSL_SQL_CONNECTION` env var, falling back to a hardcoded dev default matching `appsettings.Development.json` pattern
2. Build a `DbContextOptionsBuilder<RoadTripDbContext>` with `UseSqlServer(connectionString)`
3. Create `RoadTripDbContext` instance
4. Run each importer in sequence: NPS → PAD-US → Overpass
5. Run cross-source deduplication
6. Print summary (inserted/updated/skipped counts per source)

Add required NuGet package for EF Core SQL Server (already a transitive dependency from web app reference, but explicit is better):

Run: `dotnet add src/RoadTripMap.PoiSeeder/RoadTripMap.PoiSeeder.csproj package Microsoft.EntityFrameworkCore.SqlServer` (match version used by web app — currently 8.0.23)

**Verification:**
Run: `dotnet build src/RoadTripMap.PoiSeeder/RoadTripMap.PoiSeeder.csproj`
Expected: Build succeeds

**Commit:** `feat: add PoiSeeder console project to solution`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement NPS API importer

**Verifies:** map-poi.AC5.1

**Files:**
- Create: `src/RoadTripMap.PoiSeeder/Importers/NpsImporter.cs`

**Implementation:**

The NPS API importer fetches all NPS park units from `https://developer.nps.gov/api/v1/parks`.

Key details from API research:
- API key required (free registration). Store in `NPS_API_KEY` environment variable.
- Endpoint: `GET https://developer.nps.gov/api/v1/parks?limit=50&start={offset}&api_key={key}`
- Response JSON: `{ "total": N, "data": [ { "fullName": "...", "parkCode": "...", "latLong": "lat:44.409286, long:-68.239166", "designation": "..." } ] }`
- `latLong` is a string that needs parsing — format is `"lat:XX.XXX, long:YY.YYY"` (parse with regex or string split)
- Pagination: `limit=50`, `start` is zero-based offset. Loop until `start >= total`.
- Set `User-Agent: RoadTripMap/1.0` header (project convention from `NominatimGeocodingService.cs`)
- Rate limit: 1-second delay between paginated requests

The importer should:
1. Accept `HttpClient` and `RoadTripDbContext` as constructor parameters
2. Paginate through all parks (50 per request)
3. Parse `latLong` string to extract latitude/longitude doubles
4. Skip entries with missing or unparseable coordinates
5. Map `designation` to category: "National Park" → `national_park`, everything else (Monument, Battlefield, Seashore, etc.) → `national_park` (all NPS sites are national-level)
6. Set `Source = "nps"`, `SourceId = parkCode`
7. Upsert: check if `Source == "nps" && SourceId == parkCode` exists; if yes update name/coordinates, if no insert
8. Batch `SaveChangesAsync()` every 50 records
9. Return count of inserted/updated/skipped

**Verification:**
Run: `dotnet build src/RoadTripMap.PoiSeeder/RoadTripMap.PoiSeeder.csproj`
Expected: Build succeeds

**Commit:** `feat: add NPS API importer for national parks`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Implement Overpass API importer

**Verifies:** map-poi.AC5.3

**Files:**
- Create: `src/RoadTripMap.PoiSeeder/Importers/OverpassImporter.cs`

**Implementation:**

The Overpass API importer queries OpenStreetMap for US tourism, historic, and natural feature nodes.

Key details from API research:
- Endpoint: `POST https://overpass-api.de/api/interpreter` with `data=` form body containing Overpass QL query
- US bounding box: `(24,-125,50,-66)` (south, west, north, east)
- Response JSON: `{ "elements": [ { "type": "node", "id": 123, "lat": 40.71, "lon": -74.00, "tags": { "name": "...", "tourism": "attraction" } } ] }`
- Coordinates are `lat`/`lon` (note: `lon` not `lng`)
- Rate limit: single-threaded, 2-second delay between queries

Run these queries separately (to stay under rate limits and manage response size):

Query 1 — Tourism:
```
[out:json][timeout:120];
node["tourism"~"attraction|museum|viewpoint"](24,-125,50,-66);
out body;
```

Query 2 — Historic:
```
[out:json][timeout:120];
node["historic"~"monument|memorial|castle|ruins|archaeological_site|battlefield"](24,-125,50,-66);
out body;
```

Query 3 — Natural features:
```
[out:json][timeout:120];
(
  node["natural"="peak"](24,-125,50,-66);
  node["natural"="waterfall"](24,-125,50,-66);
  node["natural"="volcano"](24,-125,50,-66);
  node["natural"="cave_entrance"](24,-125,50,-66);
);
out body;
```

Query 4 — Nature reserves:
```
[out:json][timeout:120];
node["leisure"="nature_reserve"](24,-125,50,-66);
out body;
```

The importer should:
1. Accept `HttpClient` and `RoadTripDbContext` as constructor parameters
2. Run each query with 5-second delay between them
3. Skip elements without a `name` tag (unnamed nodes aren't useful as POIs)
4. Map tags to categories:
   - `tourism` tag → `tourism`
   - `historic` tag → `historic_site`
   - `natural` tag → `natural_feature`
   - `leisure=nature_reserve` → `natural_feature`
5. Set `Source = "osm"`, `SourceId = element.id.ToString()`
6. Upsert by `Source + SourceId`
7. Batch `SaveChangesAsync()` every 100 records
8. Return count of inserted/updated/skipped

**Verification:**
Run: `dotnet build src/RoadTripMap.PoiSeeder/RoadTripMap.PoiSeeder.csproj`
Expected: Build succeeds

**Commit:** `feat: add Overpass API importer for tourism, historic, and natural features`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Implement PAD-US importer

**Verifies:** map-poi.AC5.2

**Files:**
- Create: `src/RoadTripMap.PoiSeeder/Importers/PadUsImporter.cs`

**Implementation:**

PAD-US is a bulk download (not an API). The importer processes a pre-downloaded GeoJSON file.

Key details from research:
- Download from USGS: state-level GeoJSON files (~10-100MB each)
- Filter on `Mang_Type` or `d_Mang_Typ` field for state park agencies
- Polygon data requires centroid extraction (average of coordinates)
- Download URL pattern: user provides local file path as argument

The importer should:
1. Accept a file path to a pre-downloaded PAD-US GeoJSON file and `RoadTripDbContext`
2. Stream-parse the GeoJSON using `System.Text.Json.JsonDocument` to avoid loading the entire file into memory
3. For each feature in the FeatureCollection:
   - Check `properties.Mang_Type` or `properties.d_Mang_Typ` — include only state park management types (e.g., "State Park", state agency names)
   - Also check `properties.d_Des_Tp` for designation type containing "State Park" or "State Recreation Area"
   - Extract `properties.Unit_Nm` as the POI name
   - Compute centroid from polygon coordinates: average all `[lng, lat]` pairs in the geometry
   - Skip features without a name or with invalid geometry
4. Set `Category = "state_park"`, `Source = "pad_us"`, `SourceId = properties.OBJECTID` or feature index
5. Upsert by `Source + SourceId`
6. Batch `SaveChangesAsync()` every 100 records
7. Return count of inserted/updated/skipped

Usage: `dotnet run --project src/RoadTripMap.PoiSeeder -- --pad-us-file /path/to/padus_state.geojson`

**Verification:**
Run: `dotnet build src/RoadTripMap.PoiSeeder/RoadTripMap.PoiSeeder.csproj`
Expected: Build succeeds

**Commit:** `feat: add PAD-US GeoJSON importer for state parks`

<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-6) -->

<!-- START_TASK_5 -->
### Task 5: Cross-source deduplication and Program.cs orchestration

**Verifies:** map-poi.AC5.4

**Files:**
- Create: `src/RoadTripMap.PoiSeeder/Deduplicator.cs`
- Modify: `src/RoadTripMap.PoiSeeder/Program.cs` (wire up all importers and dedup)

**Implementation:**

Cross-source deduplication handles the case where the same location appears in multiple sources (e.g., a national park in both NPS API and PAD-US).

The deduplicator should:
1. Query all POIs grouped by approximate location (round lat/lng to 2 decimal places — ~1km precision)
2. Within each group, find POIs with similar names (case-insensitive substring match or Levenshtein distance)
3. Keep the POI with the highest-priority source: `nps` > `pad_us` > `osm`
4. Delete the lower-priority duplicates
5. Report count of duplicates removed

Update `Program.cs` to:
1. Parse command-line args for `--pad-us-file` (optional — skip PAD-US import if not provided)
2. Parse `--nps-only`, `--overpass-only`, `--pad-us-only` flags for selective imports
3. Create `HttpClient` with `User-Agent: RoadTripMap/1.0` and polite rate limiting
4. Run importers in sequence, printing progress
5. Run deduplicator after all imports
6. Print final summary table

**Verification:**
Run: `dotnet build src/RoadTripMap.PoiSeeder/RoadTripMap.PoiSeeder.csproj`
Expected: Build succeeds

**Commit:** `feat: add cross-source deduplication and CLI orchestration`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Seed script integration tests

**Verifies:** map-poi.AC5.1, map-poi.AC5.2, map-poi.AC5.3, map-poi.AC5.4

**Files:**
- Create: `tests/RoadTripMap.Tests/Seeder/NpsImporterTests.cs`
- Create: `tests/RoadTripMap.Tests/Seeder/OverpassImporterTests.cs`
- Create: `tests/RoadTripMap.Tests/Seeder/DeduplicatorTests.cs`

**Testing:**

Use the project's existing EF Core InMemory database pattern for testing. Mock HTTP responses using the existing `MockHttpMessageHandler` pattern from `tests/RoadTripMap.Tests/Services/GeocodingServiceTests.cs`.

Tests must verify each AC:

- **map-poi.AC5.1 (NPS import):** Mock NPS API response with 3 parks (valid latLong strings). Run NPS importer. Assert 3 POIs created with category `national_park`, source `nps`, correct coordinates parsed from latLong string.

- **map-poi.AC5.3 (Overpass import):** Mock Overpass API response with elements containing tourism, historic, and natural tags. Run Overpass importer. Assert POIs created with correct categories mapped from OSM tags. Assert elements without `name` tag are skipped.

- **map-poi.AC5.2 (PAD-US import):** Create a small test GeoJSON file (2-3 features with polygon geometry and state park properties). Run PAD-US importer against it. Assert POIs created with correct centroids and category `state_park`.

- **map-poi.AC5.4 (Idempotent re-run):** Run NPS importer twice with same mock data. Assert POI count stays the same (no duplicates). Also test: run importer, then run again with updated name — assert name is updated, not duplicated.

- **PAD-US error paths:** Test file not found (importer returns graceful error, no crash). Test empty GeoJSON FeatureCollection (zero imports, no crash). Test malformed JSON (graceful error with descriptive message).

- **Deduplication tests:** Insert POIs with same name at nearby coordinates from different sources. Run deduplicator. Assert lower-priority duplicates removed, highest-priority source kept.

Add test project reference if not already present:

Run: `dotnet add tests/RoadTripMap.Tests/RoadTripMap.Tests.csproj reference src/RoadTripMap.PoiSeeder/RoadTripMap.PoiSeeder.csproj`

**Verification:**
Run: `dotnet test tests/RoadTripMap.Tests/RoadTripMap.Tests.csproj --filter "FullyQualifiedName~Seeder"`
Expected: All tests pass

**Commit:** `test: add seed script integration tests for NPS, Overpass, PAD-US, and dedup`

<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_C -->
