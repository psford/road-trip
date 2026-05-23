# Technical Specification: Road Trip Photo Map

**Version:** 3.0
**Last Updated:** 2026-04-14
**Status:** Phase 1 (Resilient Uploads backend) deployed. iOS Phases 2–7 (Capacitor, TestFlight) pending.

---

## 1. Architecture Overview

**Stack:** ASP.NET Core 8.0 Minimal API + EF Core 8.0.23 + Azure SQL + Azure Blob Storage + MapLibre GL JS v5.21.0

**Deployment:** Azure App Service (Linux B1) → Dedicated Azure SQL instance (`roadtripmap-db`, Basic tier, 5 DTU) + Azure Blob Storage (`stockanalyzerblob` shared account, per-trip containers)

**Frontend:** Vanilla HTML/JS/CSS served as static files from `wwwroot/`

**Database:** Road Trip operates on its own dedicated Azure SQL server instance (`sql-roadtripmap-prod`). It is **not** shared with Stock Analyzer. All tables use the `roadtrip` schema. All schema changes use EF Core migrations only.

**Map rendering:** MapLibre GL JS v5.21.0 loaded from CDN (`unpkg.com`). Vector tiles served by MapTiler (`maps/streets-v2`). No Leaflet dependency remains (migrated 2026-03-24).

---

## 2. Project Structure

```
├── RoadTripMap.sln
├── src/
│   ├── RoadTripMap/                    # Main API project
│   │   ├── Program.cs                  # Minimal API wiring, all endpoints
│   │   ├── EndpointRegistry.cs         # Centralized connection string / key resolution
│   │   ├── Entities/
│   │   │   ├── TripEntity.cs
│   │   │   ├── PhotoEntity.cs          # Includes upload-status columns (Phase 1)
│   │   │   ├── PoiEntity.cs
│   │   │   ├── ParkBoundaryEntity.cs
│   │   │   ├── GeoCacheEntity.cs
│   │   │   └── BlobOptions.cs
│   │   ├── Data/
│   │   │   ├── RoadTripDbContext.cs
│   │   │   └── DesignTimeDbContextFactory.cs
│   │   ├── Models/                     # DTOs
│   │   │   ├── CreateTripRequest.cs / CreateTripResponse.cs
│   │   │   ├── TripResponse.cs
│   │   │   ├── PhotoResponse.cs
│   │   │   ├── PoiResponse.cs
│   │   │   ├── ParkBoundaryResponse.cs
│   │   │   ├── UpdateLocationRequest.cs
│   │   │   └── UploadDtos.cs           # RequestUploadRequest/Response, CommitRequest, ExifDto
│   │   ├── Services/
│   │   │   ├── IAuthStrategy.cs / SecretTokenAuthStrategy.cs
│   │   │   ├── IPhotoService.cs / PhotoService.cs
│   │   │   ├── IPhotoReadService.cs / PhotoReadService.cs  # Dual-read (legacy + per-trip)
│   │   │   ├── IUploadService.cs / UploadService.cs
│   │   │   ├── IBlobContainerProvisioner.cs / BlobContainerProvisioner.cs
│   │   │   ├── ISasTokenIssuer.cs
│   │   │   ├── UserDelegationSasIssuer.cs  # Prod (managed identity)
│   │   │   ├── AccountKeySasIssuer.cs      # Dev (Azurite / account key)
│   │   │   ├── IGeocodingService.cs / NominatimGeocodingService.cs
│   │   │   ├── INominatimRateLimiter.cs / NominatimRateLimiter.cs
│   │   │   ├── UploadRateLimiter.cs
│   │   │   ├── UploadOptions.cs
│   │   │   └── InvalidContainerNameException.cs
│   │   ├── BackgroundJobs/
│   │   │   ├── OrphanSweeperHostedService.cs   # PeriodicTimer, deletes stale pending rows
│   │   │   ├── OrphanSweeper.cs / IOrphanSweeper.cs
│   │   │   └── ContainerBackfillHostedService.cs  # One-time startup backfill
│   │   ├── Endpoints/
│   │   │   └── UploadEndpoints.cs      # request-upload / commit / abort routes
│   │   ├── Versioning/
│   │   │   └── ServerVersion.cs        # x-server-version / x-client-min-version
│   │   ├── Security/
│   │   │   └── LogSanitizer.cs         # Sanitizes tokens, blob paths, SAS URLs for logs
│   │   ├── Helpers/
│   │   │   └── SlugHelper.cs
│   │   ├── Migrations/                 # EF Core migration files (do not edit manually)
│   │   └── wwwroot/
│   │       ├── index.html / create.html / post.html / trips.html
│   │       ├── css/styles.css
│   │       ├── js/
│   │       │   ├── api.js              # API client
│   │       │   ├── exifUtil.js         # Client-side EXIF extraction wrapper
│   │       │   ├── mapService.js       # Pure data layer (trip load, route coords)
│   │       │   ├── mapUI.js            # MapLibre GL JS rendering layer
│   │       │   ├── mapCache.js         # IndexedDB cache for boundary/POI data
│   │       │   ├── parkStyle.js        # Park layer style constants
│   │       │   ├── poiLayer.js         # POI GeoJSON layer for MapLibre
│   │       │   ├── stateParkLayer.js   # State park boundary layer for MapLibre
│   │       │   ├── postService.js      # Photo posting business logic
│   │       │   ├── postUI.js           # Photo posting DOM layer
│   │       │   ├── photoCarousel.js    # Photo carousel UI
│   │       │   ├── tripStorage.js      # Local trip state persistence
│   │       │   └── uploadQueue.js      # IndexedDB-backed resilient upload queue
│   │       └── lib/exifr/              # Local EXIF parsing library
│   └── RoadTripMap.PoiSeeder/          # CLI seeder tool
│       ├── Program.cs                  # Entry point (--overpass-only / --nps-only / --pad-us)
│       ├── Deduplicator.cs
│       ├── PoiUpsertHelper.cs
│       ├── BoundaryUpsertHelper.cs
│       ├── Importers/
│       │   ├── OverpassImporter.cs
│       │   ├── NpsImporter.cs
│       │   ├── PadUsImporter.cs
│       │   └── PadUsBoundaryImporter.cs
│       └── Geometry/
│           └── GeoJsonProcessor.cs     # GeoJSON simplification
├── tests/
│   └── RoadTripMap.Tests/              # xUnit test project
│       ├── Endpoints/                  # HTTP integration tests
│       ├── Services/                   # Service unit tests
│       ├── BackgroundJobs/             # OrphanSweeper tests
│       ├── Seeder/                     # Seeder unit tests
│       ├── Middleware/                 # Security header + version middleware tests
│       └── Infrastructure/            # AzuriteFixture
├── infrastructure/
│   └── azure/
│       ├── main.bicep                  # Source of truth for all prod Azure resources
│       ├── parameters.json             # Deploy-time parameters (no pipeline placeholders)
│       └── modules/
│           └── storage-rbac.bicep      # Cross-RG Storage Blob Data Contributor helper
└── docs/
    ├── FUNCTIONAL_SPEC.md
    ├── TECHNICAL_SPEC.md               # This file
    ├── design-plans/                   # Feature design documents
    └── implementation-plans/           # Phase-by-phase task breakdowns
```

---

## 3. Entity Model

### 3.1 TripEntity

Represents a named road trip with metadata and photo collection.

**Properties:**
- `Id` (int, PK): Surrogate key
- `Slug` (string, unique, max 200): URL-friendly identifier (e.g., `parents-2026-west`)
- `Name` (string, required, max 500): Human-readable trip name
- `Description` (string, nullable, max 2000): Optional trip description
- `SecretToken` (string, unique, max 36): UUID v4 for upload link authorization (`/post/{token}`)
- `ViewToken` (string, unique, max 36): UUID v4 for view-only link authorization (`/trips/{token}`)
- `CreatedAt` (DateTime): Defaults to `GETUTCDATE()` on insert
- `IsActive` (bool): Soft-delete flag (default: true)
- `Photos` (ICollection<PhotoEntity>): Navigation to photos

**Database Mapping:**
- Table: `roadtrip.Trips`
- Indices: `(Slug)` UNIQUE, `(SecretToken)` UNIQUE, `(ViewToken)` UNIQUE

---

### 3.2 PhotoEntity

Represents a photo uploaded to a trip with geolocation and blob reference.

**Properties (core):**
- `Id` (int, PK): Surrogate key
- `TripId` (int, FK): Foreign key to Trip
- `BlobPath` (string, required, max 500): Path to original blob in Azure Storage
- `Latitude` (double): GPS latitude (decimal degrees)
- `Longitude` (double): GPS longitude (decimal degrees)
- `PlaceName` (string, nullable, max 500): Reverse-geocoded location name
- `Caption` (string, nullable, max 1000): User-provided photo caption
- `TakenAt` (DateTime?): When the photo was taken (nullable; from EXIF or user input)
- `CreatedAt` (DateTime): Defaults to `GETUTCDATE()` on insert

**Properties (upload orchestration — Phase 1):**
- `Status` (string): Upload state machine: `"pending"` → `"committed"`. Default `"committed"` for legacy rows.
- `StorageTier` (string): `"legacy"` (shared `road-trip-photos` container) or `"per-trip"` (per-trip container). Default `"legacy"`.
- `UploadId` (Guid?): Client-generated idempotency key. Used as blob name prefix in per-trip containers.
- `LastActivityAt` (DateTime?): Updated when upload progress occurs; used by `OrphanSweeper`.
- `UploadAttemptCount` (int): Incremented per `request-upload` call; default 0.

**Database Mapping:**
- Table: `roadtrip.Photos`
- Foreign Key: `TripId` → `Trips.Id` with `DELETE CASCADE`

---

### 3.3 PoiEntity

Represents a Point of Interest (POI) from Overpass (OSM) or NPS sources.

**Properties:**
- `Id` (int, PK)
- `Name` (string, required)
- `Category` (string, required): One of `national_park`, `state_park`, `natural_feature`, `historic_site`, `tourism`
- `Latitude` / `Longitude` (double)
- `Source` (string, required): `"osm"` or `"nps"`
- `SourceId` (string, nullable): External ID for deduplication

**Database Mapping:** Table `roadtrip.PointsOfInterest`

---

### 3.4 ParkBoundaryEntity

Represents a state park polygon imported from PAD-US.

**Properties:**
- `Id` (int, PK)
- `Name`, `State`, `Category` (string, required)
- `GisAcres` (int)
- `CentroidLat` / `CentroidLng` (double): Pre-computed polygon centroid
- `MinLat` / `MaxLat` / `MinLng` / `MaxLng` (double): Bounding box for viewport filtering
- `GeoJsonFull`, `GeoJsonModerate`, `GeoJsonSimplified` (string, required): Three pre-computed detail levels
- `Source` (string, required): `"pad-us"`
- `SourceId` (string, nullable)

**Database Mapping:** Table `roadtrip.ParkBoundaries`

---

### 3.5 GeoCacheEntity

Internal reverse geocoding cache.

**Properties:**
- `Id` (int, PK)
- `LatRounded` / `LngRounded` (double): Rounded to 2 decimal places (~1.1 km grid)
- `PlaceName` (string, required, max 500)
- `CachedAt` (DateTime)

**Database Mapping:**
- Table: `roadtrip.GeoCache`
- Index: `(LatRounded, LngRounded)` UNIQUE

---

## 4. Database Configuration

### 4.1 Schema

All tables use the `roadtrip` schema (isolated within the dedicated `roadtripmap-db` database). No shared-DB isolation is required.

### 4.2 EF Core Migrations

Migration files in `src/RoadTripMap/Migrations/`. Key migrations:

| Migration | What it adds |
|-----------|-------------|
| `20260320032254_InitialCreate` | `Trips`, `Photos`, `GeoCache` |
| `20260321220822_AddViewToken` | `ViewToken` on `Trips` |
| `20260324034238_MakeTakenAtNullable` | Nullable `TakenAt` on `Photos` |
| `20260403224304_AddPointsOfInterest` | `PointsOfInterest` table |
| `20260406012136_AddParkBoundaries` | `ParkBoundaries` table |
| `20260414030652_AddUploadStatusColumns` | `Status`, `StorageTier`, `UploadId`, `LastActivityAt`, `UploadAttemptCount` on `Photos` |

### 4.3 Connection Strings

**Development (SQL Express):**
```
Server=.\SQLEXPRESS;Database=RoadTripMap;Trusted_Connection=True;TrustServerCertificate=True
```

**WSL2 development (TCP):**
```bash
export RT_DESIGN_CONNECTION="Server=127.0.0.1,1433;Database=RoadTripMap;User Id=wsl_claude_admin;Password=<password>;TrustServerCertificate=True;"
dotnet ef migrations list
```

**Production (Azure SQL):** Injected at deploy time via App Service config (`ConnectionStrings:DefaultConnection`). Resolved by `EndpointRegistry.Resolve("database")` → reads from `endpoints.json` → Key Vault in prod.

---

## 5. Endpoint Registry

`src/RoadTripMap/EndpointRegistry.cs` centralizes resolution of all connection strings and API keys. It reads `endpoints.json` at the repo root, selects the block matching the current environment (`Development` / `Production`), and resolves each entry by `source` type:

- `literal` — returns the value directly (dev only)
- `env` — reads from an environment variable
- `keyvault` — fetches the secret from Azure Key Vault using `DefaultAzureCredential`

Dot-notation supports compound endpoints (e.g., `EndpointRegistry.Resolve("npsApi.apiKey")`).

**Tests:** `EndpointRegistryTests.cs` (unit), `EndpointRegistryRealContractTests.cs` (integration with real config shape).

---

## 6. API Endpoints

### 6.1 Core Trip Endpoints

#### POST /api/trips — Create Trip

**Request:** `{ "name": "...", "description": "..." }` (name required)

**Response (200):** `{ "slug", "secretToken", "viewUrl", "postUrl" }`

**Behavior:** Generates URL slug via `SlugHelper`, creates `TripEntity`, eagerly provisions per-trip blob container via `IBlobContainerProvisioner.EnsureContainerAsync(secretToken)`.

#### GET /api/trips/view/{viewToken} — Get Trip Info (public)

Returns `TripResponse` (`name`, `description`, `photoCount`, `createdAt`). No auth required.

#### GET /api/trips/view/{viewToken}/photos — Get Trip Photos (public)

Returns array of `PhotoResponse` ordered by `COALESCE(TakenAt, CreatedAt)` ascending (EXIF capture time when available; falls back to upload time so real-time captures missing `DateTimeOriginal` still sort by upload chronology). No auth required.

#### DELETE /api/trips/{secretToken} — Delete Trip (cascade)

Requires valid `secretToken`. Deletes all per-trip blob containers, all legacy blobs for this trip, all `PhotoEntity` rows, and the `TripEntity`. Returns 204.

---

### 6.2 Legacy Photo Upload (direct multipart)

#### POST /api/trips/{secretToken}/photos — Upload Photo

**Request:** multipart/form-data — `file` (image), `lat`, `lng`, `caption?`, `takenAt?`

**Validation:** 401 on bad token, 400 on non-image or >15 MB, 404 on missing trip.

**Response (200):** `PhotoResponse` with `/api/photos/` proxy URLs.

**Behavior:** Calls `IPhotoService.ProcessAndUploadAsync()` → stores three tiers (original 95%, display 1920px 85%, thumb 300px 75%), strips EXIF via SkiaSharp re-encode. Creates `PhotoEntity` with `Status="committed"`, `StorageTier="legacy"`.

#### DELETE /api/trips/{secretToken}/photos/{id} — Delete Photo

Returns 204. Deletes all three blob tiers and DB row.

#### GET /api/photos/{tripId}/{photoId}/{size} — Serve Photo

`size`: `original` | `display` | `thumb`. Proxied — no direct blob URLs exposed (AC6.4). Supports both legacy (`road-trip-photos` container) and per-trip containers via `StorageTier` column.

---

### 6.3 Resilient Upload Pipeline (Phase 1)

All three endpoints are registered in `src/RoadTripMap/Endpoints/UploadEndpoints.cs`.

#### POST /api/trips/{secretToken}/photos/request-upload

Initiates a direct-to-blob upload. Client-generated `uploadId` makes the call idempotent.

**Request (`RequestUploadRequest`):**
```json
{
  "uploadId": "uuid-v4",
  "filename": "IMG_1234.jpg",
  "contentType": "image/jpeg",
  "sizeBytes": 5242880,
  "exif": { "gpsLat": 36.1, "gpsLon": -112.1, "takenAt": "2026-04-14T10:00:00Z" }
}
```

**Response (200, `RequestUploadResponse`):**
```json
{
  "photoId": "uuid-v4",
  "sasUrl": "https://stockanalyzerblob.blob.core.windows.net/trip-<token>/<uploadId>_original.jpg?sv=...&sig=[redacted]",
  "blobPath": "<uploadId>_original.jpg",
  "maxBlockSizeBytes": 4194304,
  "serverVersion": "1.0.0",
  "clientMinVersion": "1.0.0"
}
```

**Behavior:**
- Validates `secretToken` → 401/404 on failure.
- If `uploadId` already exists for this trip, returns existing `photoId` and fresh SAS (idempotent).
- Creates `PhotoEntity` with `Status="pending"`, `StorageTier="per-trip"`, `UploadId=uploadId`.
- Issues write-only SAS via `ISasTokenIssuer.IssueWriteSasAsync()` (2-hour TTL).
- GPS/timestamp from `exif` stored directly on the entity.

#### POST /api/trips/{secretToken}/photos/{photoId:guid}/commit

Client calls after all blocks uploaded to Azure. Commits the block list on the blob and transitions `Status` to `"committed"`.

**Request (`CommitRequest`):** `{ "blockIds": ["base64id1", "base64id2", ...] }`

**Response (200):** `PhotoResponse`

**Behavior:** Calls Azure `CommitBlockListAsync` with provided IDs; updates `Status`, triggers reverse geocoding.

#### POST /api/trips/{secretToken}/photos/{photoId:guid}/abort

Transitions `Status` to `"failed"`. Client calls on permanent failure. Blob deletion deferred to orphan sweeper.

**Response (204 No Content)**

---

### 6.4 Versioning

#### GET /api/version

Returns `{ "server_version": "...", "client_min_version": "..." }`.

**Version middleware:** Every API response carries:
- `x-server-version: <ServerVersion.Current>` (assembly `InformationalVersion`)
- `x-client-min-version: <ServerVersion.ClientMin>` (from `ClientProtocol:MinVersion` config)

---

### 6.5 POI Endpoint

#### GET /api/poi

**Query params:** `minLat`, `maxLat`, `minLng`, `maxLng` (required), `zoom` (required)

**Zoom gating:**
- `zoom < 7` → returns empty array (POIs not meaningful at country-level zoom)
- `zoom >= 7` → returns `state_park`, `natural_feature`, `historic_site`, `tourism`
- `national_park` is always included regardless of zoom (not yet in server-side filter but POI seeder marks them; see design plan)

**Backfill:** If no OSM data exists in the viewport and `zoom >= 8`, triggers a real-time Overpass query and upserts results before responding.

**Grid sampling:** Spatial grid (7 cols × 6 rows) limits response density; target count 40 (30 at zoom ≥ 14).

**Response:** Array of `PoiResponse` objects:
```json
[{ "id": 1, "name": "Grand Canyon NP", "category": "national_park", "lat": 36.1, "lng": -112.1 }]
```

See design plan: `docs/design-plans/2026-04-03-map-poi.md`

---

### 6.6 Park Boundaries Endpoint

#### GET /api/park-boundaries

**Query params:** `minLat`, `maxLat`, `minLng`, `maxLng`, `zoom` (required), `detail` (optional: `full` | `moderate` | `simplified`, default `moderate`)

**Zoom gating:** `zoom < 8` → returns empty `FeatureCollection`.

**Detail tiers:** Three pre-computed GeoJSON columns per entity. `moderate` is the default for normal map use; `simplified` for zoomed-out overview; `full` for detail view.

**Ordering:** Top 50 parks by `GisAcres` descending in viewport.

**Response:** GeoJSON `FeatureCollection` (`ParkBoundaryResponse`) with `Feature` objects containing `ParkBoundaryProperties` (id, name, state, category, centroidLat, centroidLng, gisAcres) and the polygon geometry.

See design plan: `docs/design-plans/2026-04-05-state-park-boundaries.md`

---

### 6.7 Other Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Returns `{ "status": "healthy" }` |
| GET | `/api/geocode?lat=&lng=` | Reverse geocode via Nominatim, returns `{ "placeName": "..." }` |
| GET | `/api/post/{secretToken}` | Returns trip info for the post page |
| GET | `/api/post/{secretToken}/photos` | Returns photos for post page management |
| GET | `/create` | Serves `create.html` |
| GET | `/post/{secretToken}` | Serves `post.html` |
| GET | `/trips/{viewToken}` | Serves `trips.html` |

---

## 7. Frontend JavaScript Modules

### 7.1 mapService.js — Data Layer

Pure data/state module with zero DOM references. Designed for portability to native apps.

```javascript
const MapService = {
    async loadTrip(viewToken) { /* Returns { trip, photos } */ },
    getRouteCoordinates(photos) { /* Returns Array<[lng, lat]> for MapLibre LngLatLike */ }
};
```

### 7.2 mapUI.js — MapLibre GL JS Rendering Layer

Web-specific rendering. On `map.on('load')` it calls `applyParkStyling()`, `PoiLayer.init()`, and `StateParkLayer.init()`.

**MapLibre setup:**
- Style: `https://api.maptiler.com/maps/streets-v2/style.json?key=<MAPTILER_KEY>`
- Default center: `[-98.58, 39.83]` (USA center), zoom 4
- Markers for each photo; click opens popup with display image, place name, caption, timestamp, download link
- Route polyline toggle (add/remove from map)
- Auto-fit bounds with padding; single photo → zoom 13

**Map CDN (trips.html and post.html):**
```html
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.21.0/dist/maplibre-gl.css"
      integrity="sha256-dhoRMPCWDqNp2RfshD99GvXKHc8ncBrvHZ1Zghs7qyU=" crossorigin="anonymous">
<script src="https://unpkg.com/maplibre-gl@5.21.0/dist/maplibre-gl.js"
        integrity="sha256-qbkAeuPV31m78vg62R7iyGWC6hUsCZAM1MhPYwevvJs=" crossorigin="anonymous"></script>
```

### 7.3 poiLayer.js — POI Layer

Manages a dynamic GeoJSON source (`poi-source`) and two MapLibre layers (`poi-markers` circle layer, `poi-labels` symbol layer). Attaches a debounced `moveend` handler to refresh POIs for the current viewport. Color-coded by category (national_park=dark green, state_park=light green, natural_feature=brown, historic_site=purple, tourism=gold).

Supports an `onPoiSelect(lat, lng, name)` callback for the pin-drop flow on the post page.

### 7.4 stateParkLayer.js — State Park Boundary Layer

Manages per-map state (stored in a `Map<maplibregl.Map, state>` to support multiple simultaneous map instances). Loads park boundaries from `/api/park-boundaries`, renders them as fill + outline + centroid dot + label layers (`sp-` prefixed IDs). Handles three detail tiers, adaptive prefetching, and click-to-select. Uses `MapCache` for client-side IndexedDB caching.

### 7.5 mapCache.js — IndexedDB Client Cache

Persistent cache for boundary and POI data keyed by `{type}_{id}_{detailLevel}`. No TTL; entries persist until cleared. Falls back gracefully when IndexedDB is unavailable (e.g., private browsing).

### 7.6 uploadQueue.js — Resilient Upload Queue

IndexedDB-backed queue for Phase 1 resilient uploads. Manages upload state machine (`pending → requesting → uploading → committing → committed | failed`). Handles exponential backoff with jitter, per-file concurrency (3 blocks), global concurrency (3 photos, 9 in-flight). On SAS expiry (403), re-calls `request-upload` with same `uploadId` and resumes.

Phase 1 backend is complete. The client-side queue (Phase 1 web UI) and iOS Capacitor integration (Phases 2–7) are deferred.

### 7.7 Other JS Modules

| Module | Purpose |
|--------|---------|
| `postService.js` | EXIF extraction, photo upload, delete, list — zero DOM refs |
| `postUI.js` | DOM layer for post page (file picker, preview, pin-drop map, toasts) |
| `photoCarousel.js` | Full-screen photo carousel in map popups |
| `tripStorage.js` | LocalStorage persistence for draft trip state |
| `exifUtil.js` | Wraps `exifr` library for client-side GPS + timestamp extraction |
| `api.js` | API client (all fetch calls) |
| `parkStyle.js` | Style constants shared by map layers |

---

## 8. Services

### 8.1 IAuthStrategy & SecretTokenAuthStrategy

Pluggable DI interface. `SecretTokenAuthStrategy` extracts `secretToken` from route values and compares against `trip.SecretToken`. Returns `AuthResult(IsAuthorized, DeniedReason?)`.

### 8.2 IPhotoService & PhotoService

SkiaSharp-based image pipeline: decode → EXIF-rotate → re-encode three tiers (original JPEG 95%, display 1920px 85%, thumbnail 300px 75%). Re-encoding strips all EXIF metadata (AC6.3).

### 8.3 IPhotoReadService & PhotoReadService

Dual-read abstraction for the photo list endpoint. Queries `Photos` filtered by `Status="committed"`, ordered by `COALESCE(TakenAt, CreatedAt)` ascending so photos with no EXIF capture time still fall into upload chronology. For `StorageTier="per-trip"` photos the blob lives in `trip-{secretToken}/<uploadId>_*.jpg`; for `StorageTier="legacy"` it lives in `road-trip-photos/{tripId}/{photoId}.jpg`. Callers do not need to know which tier.

### 8.4 ISasTokenIssuer

Abstraction for issuing short-lived write-only SAS URIs for blob upload.

- **`UserDelegationSasIssuer`** (prod): Uses `DefaultAzureCredential` managed identity — no account key in config.
- **`AccountKeySasIssuer`** (dev/Azurite): Uses connection string account key.

Both implement `IssueWriteSasAsync(containerName, blobPath, ttl, ct)`.

### 8.5 IBlobContainerProvisioner & BlobContainerProvisioner

Creates `trip-{secretToken}` containers with `PublicAccessType.None` on demand. Called at trip creation and by the backfill service. Validates container name constraints before calling Azure.

### 8.6 IGeocodingService & NominatimGeocodingService

Reverse geocodes via Nominatim (OSM). Caches results in `roadtrip.GeoCache` (rounded to 2 decimal places). Rate-limited to 1 req/sec via `INominatimRateLimiter` singleton. Returns `null` on failure (does not block photo upload).

### 8.7 UploadRateLimiter

IP-based rate limiter: 20 uploads per IP per hour. In-memory sliding window.

---

## 9. Background Jobs

### 9.1 OrphanSweeperHostedService

Runs on `PeriodicTimer` (interval configured via `OrphanSweeper:IntervalHours`, default 1 hour). On each tick delegates to `IOrphanSweeper.SweepAsync()`.

**`OrphanSweeper.SweepAsync()`:** Deletes `PhotoEntity` rows where `Status = "pending"` AND `LastActivityAt < (utcNow - StaleThresholdHours)`. Default threshold: 48 hours (configured via `OrphanSweeper:StaleThresholdHours`). Does NOT touch `"committed"` rows regardless of age.

### 9.2 ContainerBackfillHostedService

Runs once on startup when `Backfill:RunOnStartup = true`. Iterates all `TripEntity` rows and calls `IBlobContainerProvisioner.EnsureContainerAsync(trip.SecretToken)` for each. Idempotent. Used for the initial rollout to provision containers for pre-existing trips.

---

## 10. Security

### 10.1 Authorization

`IAuthStrategy` / `SecretTokenAuthStrategy` — secret token in route parameter is the sole credential. No passwords or accounts.

### 10.2 EXIF Stripping

SkiaSharp re-encode creates fresh pixel data — no EXIF metadata in stored blobs (AC6.3).

### 10.3 Blob Storage

- Legacy container: `road-trip-photos` — `PublicAccessType.None`
- Per-trip containers: `trip-{secretToken}` — `PublicAccessType.None`
- All photo access proxied via `/api/photos/` endpoint. SAS URLs are short-lived (2 hours, write-only) and are never stored in the DB.

### 10.4 Log Sanitization

`src/RoadTripMap/Security/LogSanitizer.cs` provides:
- `SanitizeToken(token)` → `"abcd...{32}"`
- `SanitizeContainerName(name)` → `"trip-abcd...{32}"`
- `SanitizeBlobPath(path)` → sanitizes GUID prefix, preserves legacy paths
- `SanitizeUrl(url)` → strips query string (`?[sig-redacted]`)

**Rule:** Any logger call touching secret tokens, blob paths, SAS URLs, or GPS coordinates must go through `LogSanitizer`. Enforced by captured-log assertions in `UploadEndpointHttpTests.cs`.

### 10.5 HTTPS

Azure App Service terminates TLS. Application created with `--no-https`. `X-Forwarded-Proto` should be trusted in production.

---

## 11. POI Seeder (`RoadTripMap.PoiSeeder`)

CLI tool to seed the `PointsOfInterest` and `ParkBoundaries` tables from external sources.

**Entry point:** `src/RoadTripMap.PoiSeeder/Program.cs`

**Flags:**
- `--overpass-only` — Fetch POIs from Overpass (OSM) only
- `--nps-only` — Fetch national park POIs from NPS API only
- `--pad-us` — Import PAD-US state park polygons (boundaries table)

**Key classes:**
- `OverpassImporter` — Queries Overpass for amenity/leisure/historic POIs in a bbox
- `NpsImporter` — Calls NPS API for national park locations
- `PadUsImporter` — Bulk imports PAD-US state park point data
- `PadUsBoundaryImporter` — Imports and simplifies PAD-US polygon geometries
- `GeoJsonProcessor` — Simplifies GeoJSON polygons for three detail tiers
- `Deduplicator` — Prevents duplicate inserts by `(Source, SourceId)`
- `PoiUpsertHelper` — Upsert logic for `PointsOfInterest`
- `BoundaryUpsertHelper` — Upsert logic for `ParkBoundaries`

---

## 12. Infrastructure

### 12.1 Azure Topology (Production)

| Resource | Name | Resource Group |
|----------|------|---------------|
| App Service Plan | `asp-roadtripmap-prod` | `rg-roadtripmap-prod` |
| App Service | `app-roadtripmap-prod` | `rg-roadtripmap-prod` |
| SQL Server | `sql-roadtripmap-prod` | `rg-roadtripmap-prod` |
| SQL Database | `roadtripmap-db` | `rg-roadtripmap-prod` |
| Key Vault | (road-trip KV) | `rg-roadtripmap-prod` |
| Blob Storage | `stockanalyzerblob` | `rg-stockanalyzer-prod` (cross-RG) |
| Container Registry | `acrstockanalyzerer34ug` | `rg-stockanalyzer-prod` (cross-RG) |

**Cross-RG dependency:** Road Trip writes blobs to `stockanalyzerblob` in `rg-stockanalyzer-prod`. The App Service MSI holds **Storage Blob Data Contributor** on that account, assigned via `infrastructure/azure/modules/storage-rbac.bicep` with a deterministic role-assignment GUID.

### 12.2 Bicep Source of Truth

`infrastructure/azure/main.bicep` is the authoritative description of all prod resources in `rg-roadtripmap-prod`. It is authored so that `az deployment group what-if` against the current prod state shows zero drift.

Key design points:
- `@secure()` params for SQL admin password and ACR registry password — never stored in the file.
- Key Vault secrets referenced with `existing` keyword — Bicep never overwrites secret values.
- `parameters.json` contains no pipeline placeholders; all dynamic values are passed at deploy time.
- `containerImageTag` parameter (`default: 'prod-33'`) reflects the current live tag; the GitHub Actions workflow updates the tag via `az webapp config container set` after each deploy.
- Service principal object IDs (`githubDeployRtObjectId`, `githubDeployObjectId`) are pinned explicitly as parameters for deterministic RBAC assignments.

`infrastructure/azure/modules/storage-rbac.bicep` is a thin helper that creates a `Microsoft.Authorization/roleAssignments` resource scoped to a storage account in a different resource group.

### 12.3 Docker

Multi-stage build: SDK 8.0 → runtime 8.0. Port 5100, `ASPNETCORE_URLS=http://+:5100`. SkiaSharp Linux native assets included. `.dockerignore` excludes test projects, docs, build artifacts.

### 12.4 GitHub Actions CI/CD

**`.github/workflows/roadtrip-deploy.yml`:**
- Build & Test: restore → build → test on `ubuntu-latest` (tests must pass)
- Deploy: requires `confirm=deploy` dispatch input + `environment: production` approval
- Logs in to Azure via OIDC, builds Docker image (tagged with commit SHA + `latest`), pushes to `acrstockanalyzerer34ug`, updates App Service container, waits 30s, health-checks 5× at 15s intervals, rolls back on failure

**Invocation:**
```bash
gh workflow run roadtrip-deploy.yml -f confirm=deploy
```

### 12.5 Startup Migration

On every startup, `Program.cs` runs:
```csharp
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<RoadTripDbContext>();
    db.Database.Migrate();
}
```
Runs before static file serving. Idempotent (EF Core tracks applied migrations in `__EFMigrationsHistory`). Propagates exceptions to prevent startup on migration failure.

---

## 13. Local Development

### 13.1 Prerequisites

- .NET 8 SDK
- SQL Server Express (Windows) or TCP SQL auth from WSL2
- Azurite (`npm install -g azurite`) for local blob storage

### 13.2 appsettings.Development.json

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=.\\SQLEXPRESS;Database=RoadTripMap;Trusted_Connection=True;TrustServerCertificate=True",
    "AzureStorage": "UseDevelopmentStorage=true"
  },
  "ClientProtocol": {
    "MinVersion": "1.0.0"
  },
  "OrphanSweeper": {
    "IntervalHours": 1,
    "StaleThresholdHours": 48
  },
  "Backfill": {
    "RunOnStartup": false
  }
}
```

Start Azurite before running the app:
```bash
azurite --silent --location ./azurite-data
```

---

## 14. Testing Strategy

### 14.1 Test Project

`tests/RoadTripMap.Tests` (xUnit). Uses:
- `Microsoft.EntityFrameworkCore.InMemory` for unit tests
- `AzuriteFixture` for blob integration tests
- `Moq` for service mocking
- `FluentAssertions` for assertions
- `Microsoft.AspNetCore.Mvc.Testing` for HTTP integration tests

### 14.2 Coverage Areas

| Area | Test file(s) |
|------|-------------|
| Slug generation | `Helpers/SlugHelperTests.cs` |
| Trip / photo / view endpoints | `Endpoints/TripEndpointTests.cs`, `TripViewEndpointTests.cs`, `PhotoEndpointTests.cs` |
| Upload endpoints (HTTP) | `Endpoints/UploadEndpointHttpTests.cs` — includes log-sanitization assertions |
| Upload endpoints (unit) | `Endpoints/UploadEndpointTests.cs` |
| POI endpoint | `Endpoints/PoiEndpointTests.cs` |
| Park boundary endpoint | `Endpoints/ParkBoundaryEndpointTests.cs` |
| Orphan sweeper | `BackgroundJobs/OrphanSweeperTests.cs` |
| PhotoReadService (dual-read) | `Services/PhotoReadServiceTests.cs` |
| BlobContainerProvisioner | `Services/BlobContainerProvisionerTests.cs` |
| GeocodingService | `Services/GeocodingServiceTests.cs` |
| EndpointRegistry | `EndpointRegistryTests.cs`, `EndpointRegistryRealContractTests.cs` |
| Server version middleware | `Middleware/ServerVersionMiddlewareTests.cs` |
| Security headers | `Middleware/SecurityHeaderTests.cs` |
| POI seeder components | `Seeder/DeduplicatorTests.cs`, `OverpassImporterTests.cs`, `NpsImporterTests.cs`, `PadUsBoundaryImporterTests.cs`, `GeoJsonProcessorTests.cs` |

---

## 15. Current State (2026-04-14)

**Deployed and operational:**
- Full trip/photo CRUD with MapLibre GL JS map view
- POI layer (Overpass + NPS) with zoom-gated category tiers
- State park boundary polygons (PAD-US import, 3 detail tiers, IndexedDB client cache)
- Resilient uploads Phase 1 (backend only): `request-upload` / `commit` / `abort` endpoints, per-trip containers, dual-read, orphan sweeper, container backfill, version headers, log sanitization
- Dedicated Azure SQL (`roadtripmap-db`, `sql-roadtripmap-prod`), not shared with Stock Analyzer
- Bicep (`infrastructure/azure/main.bicep`) reconciled to prod state — source of truth for all Azure resources
- Endpoint registry (`EndpointRegistry.Resolve()`) for all connection strings and API keys

**Pending (iOS Phases 2–7):**
- Capacitor iOS app with hybrid bundle bootstrap
- Native PHPicker + ImageIO EXIF extraction
- `URLSession` background upload queue with native SQLite persistence
- iOS-specific CSS (`ios.css`) and platform adapter seams
- TestFlight distribution

**Key design plans:**
- `docs/design-plans/2026-03-24-maplibre-migration.md`
- `docs/design-plans/2026-04-03-map-poi.md`
- `docs/design-plans/2026-04-05-state-park-boundaries.md`
- `docs/design-plans/2026-04-13-resilient-uploads.md`

---

## 16. Version History

| Version | Date | Changes |
|---------|------|---------|
| 3.0 | 2026-04-14 | Major rewrite: MapLibre GL JS migration, POI feature, state park boundaries, resilient uploads Phase 1 (request-upload/commit/abort, per-trip containers, dual-read, orphan sweeper, version headers, log sanitization), Bicep reconcile (PR #38), endpoint registry. Purged Leaflet references. |
| 2.8 | 2026-03-22 | Repo split: standalone Road Trip repository. Dedicated Azure SQL (`sql-roadtripmap-prod` / `roadtripmap-db`). |
| 2.4 | 2026-03-20 | Code review fixes: route ambiguity, original tier quality, photo upload error handling, HttpContext auth, EXIF rotation, rate limiting refactor. All 106 tests passing. |
| 2.3 | 2026-03-20 | Phase 8: Docker, Bicep template, GitHub Actions CI/CD, startup migration. |
| 2.2 | 2026-03-20 | Phase 6, Task 3: Responsive map view styling (migrated from Leaflet to full-viewport map). |
| 2.1 | 2026-03-20 | Phase 6, Task 2: Map view frontend (MapService + MapUI; Leaflet at the time, later migrated). |
| 2.0 | 2026-03-20 | Phase 6, Task 1: Public trip info and photos endpoints. |
| 1.9 | 2026-03-20 | Phase 5, Task 2: post.html + postUI.js, pin-drop map, toast notifications. |
| 1.8 | 2026-03-20 | Phase 5, Task 1: postService.js pure data module, api.js extensions. |
| 1.6 | 2026-03-20 | Phase 4, Task 3: Reverse geocoding endpoint, Nominatim integration. |
| 1.5 | 2026-03-20 | Phase 4, Task 1: exifr library + exifUtil.js wrapper. |
| 1.4 | 2026-03-20 | Phase 3: SkiaSharp + Azure Blob Storage, IAuthStrategy/SecretTokenAuthStrategy. |
| 1.1–1.3 | 2026-03-20 | Phase 2: SlugHelper, POST /api/trips, landing page, static files. |
