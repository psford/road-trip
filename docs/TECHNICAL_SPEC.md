# Technical Specification: Road Trip Photo Map

**Version:** 1.4
**Last Updated:** 2026-03-20 (Phase 3, Tasks 1-2: Auth Strategy)
**Status:** Phase 3 - Auth & Photo Upload

---

## 1. Architecture Overview

**Stack:** ASP.NET Core 8.0 Minimal API + EF Core 8.0.23 + Azure SQL + Azure Blob Storage + Leaflet.js

**Deployment:** Azure App Service (Linux) → Azure SQL (shared `StockAnalyzer` database in `roadtrip` schema)

**Frontend:** Vanilla HTML/JS/CSS served as static files from `wwwroot/`

**Database:** Shared with Stock Analyzer on `StockAnalyzer` database; Road Trip tables isolated in `roadtrip` schema

---

## 2. Project Structure

```
projects/road-trip/
├── RoadTripMap.sln                 # Solution file
├── src/
│   └── RoadTripMap/
│       ├── RoadTripMap.csproj      # Main API project
│       ├── Program.cs               # Minimal API configuration
│       ├── appsettings.json         # Production config (empty connection string)
│       ├── appsettings.Development.json  # Local SQL Express config
│       ├── Entities/                # Domain models
│       │   ├── TripEntity.cs
│       │   ├── PhotoEntity.cs
│       │   └── GeoCacheEntity.cs
│       ├── Data/                    # EF Core context and factories
│       │   ├── RoadTripDbContext.cs
│       │   └── DesignTimeDbContextFactory.cs
│       ├── Helpers/                 # Utility functions
│       │   └── SlugHelper.cs        # URL slug generation and uniqueness
│       ├── Models/                  # DTO models
│       │   ├── CreateTripRequest.cs
│       │   └── CreateTripResponse.cs
│       ├── Migrations/              # EF Core migrations (generated)
│       └── wwwroot/                 # Static files (HTML, JS, CSS)
│           ├── index.html           # Landing page
│           ├── create.html          # Trip creation form
│           ├── css/
│           │   └── styles.css       # Mobile-first responsive styles
│           └── js/
│               └── api.js           # API client
├── tests/
│   └── RoadTripMap.Tests/           # xUnit test project
└── docs/
    ├── FUNCTIONAL_SPEC.md           # User requirements
    └── TECHNICAL_SPEC.md            # This file
```

---

## 3. Entity Model (Phase 1 - Infrastructure)

### 3.1 TripEntity

Represents a named road trip with metadata and photo collection.

**Properties:**
- `Id` (int, PK): Surrogate key
- `Slug` (string, unique, max 200): URL-friendly identifier (e.g., `parents-2026-west`)
- `Name` (string, required, max 500): Human-readable trip name
- `Description` (string, nullable, max 2000): Optional trip description
- `SecretToken` (string, unique, max 36): UUID v4 for secret link authorization
- `CreatedAt` (DateTime): Defaults to `GETUTCDATE()` on insert
- `IsActive` (bool): Soft-delete flag (default: true)
- `Photos` (ICollection<PhotoEntity>): Navigation to photos

**Database Mapping:**
- Table: `roadtrip.Trips`
- Indices: `(Slug)` UNIQUE, `(SecretToken)` UNIQUE
- Constraints: `SecretToken` required, max length 36 (UUID v4 as string)

---

### 3.2 PhotoEntity

Represents a photo uploaded to a trip with geolocation and blob reference.

**Properties:**
- `Id` (int, PK): Surrogate key
- `TripId` (int, FK): Foreign key to Trip
- `BlobPath` (string, required, max 500): Path to original blob in Azure Storage
- `Latitude` (double): GPS latitude (decimal degrees)
- `Longitude` (double): GPS longitude (decimal degrees)
- `PlaceName` (string, nullable, max 500): Reverse-geocoded location name (e.g., "Grand Canyon, AZ")
- `Caption` (string, nullable, max 1000): User-provided photo caption
- `TakenAt` (DateTime): When the photo was taken (from EXIF or user input)
- `CreatedAt` (DateTime): Defaults to `GETUTCDATE()` on insert
- `Trip` (TripEntity): Navigation to parent trip

**Database Mapping:**
- Table: `roadtrip.Photos`
- Foreign Key: `TripId` → `Trips.Id` with `DELETE CASCADE`
- No indices on coordinates yet (added in Phase 2 for spatial queries)

---

### 3.3 GeoCacheEntity

Internal cache table for reverse geocoding results to avoid redundant Nominatim API calls.

**Properties:**
- `Id` (int, PK): Surrogate key
- `LatRounded` (double): Latitude rounded to 4 decimal places (~11m precision)
- `LngRounded` (double): Longitude rounded to 4 decimal places (~11m precision)
- `PlaceName` (string, required, max 500): Cached place name result
- `CachedAt` (DateTime): Defaults to `GETUTCDATE()` on insert

**Database Mapping:**
- Table: `roadtrip.GeoCache`
- Index: `(LatRounded, LngRounded)` UNIQUE (composite key)
- Purpose: Avoid flooding Nominatim with duplicate requests for the same location

---

## 4. Database Configuration

### 4.1 Schema

All Road Trip tables use the `roadtrip` schema to isolate from Stock Analyzer's `dbo`, `data`, and `staging` schemas.

```sql
-- Tables created by InitialCreate migration:
CREATE TABLE roadtrip.Trips (
    Id INT PRIMARY KEY IDENTITY,
    Slug NVARCHAR(200) NOT NULL UNIQUE,
    Name NVARCHAR(500) NOT NULL,
    Description NVARCHAR(2000) NULL,
    SecretToken NVARCHAR(36) NOT NULL UNIQUE,
    CreatedAt DATETIME DEFAULT GETUTCDATE(),
    IsActive BIT DEFAULT 1
);

CREATE TABLE roadtrip.Photos (
    Id INT PRIMARY KEY IDENTITY,
    TripId INT NOT NULL,
    BlobPath NVARCHAR(500) NOT NULL,
    Latitude FLOAT NOT NULL,
    Longitude FLOAT NOT NULL,
    PlaceName NVARCHAR(500) NULL,
    Caption NVARCHAR(1000) NULL,
    TakenAt DATETIME NOT NULL,
    CreatedAt DATETIME DEFAULT GETUTCDATE(),
    FOREIGN KEY (TripId) REFERENCES Trips(Id) ON DELETE CASCADE
);

CREATE TABLE roadtrip.GeoCache (
    Id INT PRIMARY KEY IDENTITY,
    LatRounded FLOAT NOT NULL,
    LngRounded FLOAT NOT NULL,
    PlaceName NVARCHAR(500) NOT NULL,
    CachedAt DATETIME DEFAULT GETUTCDATE(),
    UNIQUE (LatRounded, LngRounded)
);
```

### 4.2 Connection String

**Development (SQL Express):**
```
Server=.\SQLEXPRESS;Database=StockAnalyzer;Trusted_Connection=True;TrustServerCertificate=True
```

**Production (Azure SQL):**
Set via App Service configuration variable `DefaultConnection` (not committed in code).

### 4.3 EF Core Context

**RoadTripDbContext** configures:
- Default schema: `roadtrip`
- Three DbSets: `Trips`, `Photos`, `GeoCache`
- Fluent API configuration in `OnModelCreating`

**DesignTimeDbContextFactory** provides connection string to `dotnet ef` CLI for migrations (uses local SQL Express).

---

## 5. Helpers and Models

### 5.1 SlugHelper

Located in `Helpers/SlugHelper.cs`, provides URL slug generation with uniqueness checking.

**Methods:**
- `GenerateSlug(string name)` — Converts human-readable names to URL-friendly slugs
  - Lowercases input
  - Replaces non-alphanumeric characters with hyphens
  - Collapses multiple consecutive hyphens
  - Trims leading/trailing hyphens
  - Truncates to max 80 characters
  - Uses source-generated regex for performance

- `GenerateUniqueSlugAsync(string name, Func<string, Task<bool>> slugExists)` — Ensures slug uniqueness
  - Calls `GenerateSlug` to get base slug
  - Falls back to `"trip"` if base slug is empty
  - Checks uniqueness via callback function
  - Appends `-2`, `-3`, etc. if conflicts detected

**Testing:** Full test coverage in `Tests/Helpers/SlugHelperTests.cs` (15 tests):
- Basic slug generation (lowercase, special chars, hyphens)
- Truncation of long names
- Uniqueness handling with counters
- Edge cases (empty strings, special chars only, whitespace)

### 5.2 DTOs

**CreateTripRequest** (Models/CreateTripRequest.cs)
- `Name` (string, required): Trip name
- `Description` (string, nullable): Optional trip description

**CreateTripResponse** (Models/CreateTripResponse.cs)
- `Slug` (string): URL-friendly identifier
- `SecretToken` (string): UUID v4 for secret link authorization
- `ViewUrl` (string): Public viewing URL (e.g., `/trips/my-slug`)
- `PostUrl` (string): Secret posting URL (e.g., `/post/token-uuid`)

---

## 6. NuGet Packages

### 6.1 Core Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `Microsoft.EntityFrameworkCore.SqlServer` | 8.0.23 | SQL Server provider for EF Core |
| `Microsoft.EntityFrameworkCore.Design` | 8.0.23 | EF Core tools (migrations) |

### 6.2 Testing Dependencies (Phase 2)

| Package | Version | Purpose |
|---------|---------|---------|
| `xunit` | Latest | Unit test framework |
| `Moq` | 4.20.72 | Mocking library |
| `FluentAssertions` | 6.12.2 | Assertion fluency |
| `Microsoft.EntityFrameworkCore.InMemory` | 8.0.23 | In-memory DB for testing |

### 6.3 Phase 3 Dependencies (Photo Upload & Auth)

| Package | Version | Purpose |
|---------|---------|---------|
| `SkiaSharp` | 3.119.2 | Image resizing and EXIF stripping |
| `SkiaSharp.NativeAssets.Linux.NoDependencies` | 3.119.2 | Linux native assets for SkiaSharp |
| `Azure.Storage.Blobs` | 12.27.0 | Azure Blob Storage SDK |
| `Microsoft.Extensions.Azure` | 1.13.1 | Azure DI extensions |

Future phases will add:
- `exifr` — Client-side EXIF (JavaScript)

---

## 7. Minimal API Bootstrap

**Program.cs** configures (Phase 3 additions):
1. Registers `RoadTripDbContext` with connection string from config
2. Registers `BlobServiceClient` via `Microsoft.Extensions.Azure` with `AzureStorage` connection string
3. Registers `IAuthStrategy` → `SecretTokenAuthStrategy` (Phase 3, Task 2)
4. Registers `IPhotoService` → `PhotoService` (Phase 3, Task 3)
5. Maps health check endpoint: `GET /api/health`
6. Maps trip creation endpoint: `POST /api/trips` (Phase 2, Task 2)
7. Serves static files from `wwwroot/`
8. Listens on port 5100 (avoid collision with Stock Analyzer on 5000)

**appsettings.Development.json** (Phase 3 addition):
```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=.\\SQLEXPRESS;Database=StockAnalyzer;Trusted_Connection=True;TrustServerCertificate=True",
    "AzureStorage": "UseDevelopmentStorage=true"
  }
}
```
- `UseDevelopmentStorage=true` connects to Azurite (local Azure Storage emulator)
- Install Azurite: `npm install -g azurite` or use VS Code extension
- Start with: `azurite --silent --location ./azurite-data`

### 7.1 POST /api/trips — Create Trip

**Request:**
```json
{
  "name": "Cross Country 2026",
  "description": "Optional trip description"
}
```

**Validation:**
- `name` is required and must not be empty or whitespace (400 Bad Request if invalid)

**Response (200 OK):**
```json
{
  "slug": "cross-country-2026",
  "secretToken": "550e8400-e29b-41d4-a716-446655440000",
  "viewUrl": "/trips/cross-country-2026",
  "postUrl": "/post/550e8400-e29b-41d4-a716-446655440000"
}
```  <!-- pragma: allowlist secret -->

**Behavior:**
- Generates URL-friendly slug via `SlugHelper.GenerateUniqueSlugAsync`
- Generates secret token as Guid.NewGuid().ToString()
- Checks slug uniqueness in database
- Creates `TripEntity` and persists to DB
- Returns all four response fields
- No authentication required

**Testing:** See `TripEndpointTests.cs` (7 tests covering validation, uniqueness, response format, no-auth requirement)

### 7.2 GET /create — Trip Creation Form

Maps to `wwwroot/create.html`. Serves HTML form for creating new trips.

**Features:**
- Mobile-first responsive design
- Trip name input (required)
- Description textarea (optional)
- Client-side form submission to POST /api/trips
- Error display and handling
- Results section with copy-to-clipboard for URLs
- "Create Another Trip" button for reusability

### 7.3 Static Files

**index.html** — Landing page
- Introduction to Road Trip Map
- Link to create trip form
- How-it-works instructions

**create.html** — Trip creation page
- Form with trip name (required) and description (optional)
- Form submission triggers POST /api/trips
- Displays view URL, post URL, and slug
- Copy-to-clipboard buttons for each URL
- No reload needed; form resets for additional trips

**css/styles.css** — Mobile-first responsive CSS
- System font stack for native feel
- Mobile breakpoints (768px tablet, 1024px desktop)
- Color palette with primary, text, border, and message colors
- Form styling (inputs, buttons, error/success messages)
- Copy-button styling and hover states

**js/api.js** — API client
- Single `API.createTrip(name, description)` method
- Handles JSON serialization/deserialization
- Error handling and throwing

### 7.4 POST /api/trips/{secretToken}/photos — Upload Photo (Phase 3, Task 5)

**Request:** multipart/form-data
- `file` (IFormFile, required): Image file
- `lat` (double, required): Latitude
- `lng` (double, required): Longitude
- `caption` (string, optional): User caption
- `takenAt` (DateTime, optional): When photo was taken (defaults to UtcNow)

**Validation:**
- `secretToken` matches trip's token via `IAuthStrategy.ValidatePostAccess()` → 401 if invalid
- File content type starts with `image/` → 400 if not
- File size ≤ 15MB (15,728,640 bytes) → 400 if exceeded
- Trip exists → 404 if not

**Response (200 OK):**
```json
{
  "id": 42,
  "thumbnailUrl": "/api/photos/1/42/thumb",
  "displayUrl": "/api/photos/1/42/display",
  "originalUrl": "/api/photos/1/42/original",
  "lat": 40.7128,
  "lng": -74.0060,
  "placeName": "",
  "caption": "NYC Skyline",
  "takenAt": "2026-03-20T12:34:56Z"
}
```

**Behavior:**
- Creates `PhotoEntity` with `BlobPath = ""`
- Saves to DB to get auto-increment Id
- Calls `IPhotoService.ProcessAndUploadAsync()` (creates three tiers, returns `BlobPath`)
- Updates photo's `BlobPath` and persists
- Returns `PhotoResponse` with `/api/photos/` URLs (not direct blob URLs, per AC6.4)

### 7.5 DELETE /api/trips/{secretToken}/photos/{id} — Delete Photo (Phase 3, Task 5)

**Route parameters:**
- `secretToken`: Trip's secret token
- `id` (int): Photo ID

**Validation:**
- `secretToken` matches trip token → 401 if invalid
- Trip exists → 404 if not
- Photo exists and belongs to trip → 404 if not

**Response (204 No Content)**

**Behavior:**
- Validates auth via `IAuthStrategy.ValidatePostAccess()`
- Calls `IPhotoService.DeletePhotoAsync()` (deletes all three blob tiers)
- Removes `PhotoEntity` from DB
- Persists changes

### 7.6 GET /api/photos/{tripId}/{photoId}/{size} — Serve Photo (Phase 3, Task 6)

**Route parameters:**
- `tripId` (int): Trip ID
- `photoId` (int): Photo ID
- `size` (string): One of `original`, `display`, `thumb`

**Validation:**
- `size` is one of valid sizes → 400 if invalid
- Photo exists with matching `tripId` and `photoId` → 404 if not

**Response (200 OK):** JPEG image stream (Content-Type: image/jpeg)

**Behavior:**
- No auth required — photos are public
- Looks up photo in DB to verify membership
- Calls `IPhotoService.GetPhotoAsync()` to fetch from blob storage
- Returns stream as image/jpeg (proxies through API, never exposes direct blob URLs per AC6.4)

**Acceptance Criteria Verification:**
- **AC2.5 (Original downloadable):** Original size served via `/api/photos/{tripId}/{photoId}/original`
- **AC6.4 (No direct blob URLs):** All photo URLs follow `/api/photos/` pattern; endpoint validates existence before returning

Future phases will add:
- Photo list endpoint: `GET /api/trips/{slug}/photos`
- Reverse geocode endpoint: `GET /api/geocode`
- Trip view page: GET /trips/{slug}
- Photo upload page: GET /post/{token}

---

## 8. Migration Strategy

### 8.1 Creating Migrations

```bash
cd projects/road-trip/src/RoadTripMap
dotnet ef migrations add <MigrationName>
```

Migrations are stored in `Migrations/` folder and tracked in Git.

### 8.2 Applying Migrations

**Local (SQL Express):**
```bash
dotnet ef database update
```

**Production (Azure SQL):**
Applied automatically on app startup via `DbContext.Database.Migrate()` call in `Program.cs` (will be added in Phase 5).

---

## 9. Services (Phase 3)

### 9.1 IAuthStrategy & SecretTokenAuthStrategy

Pluggable authentication interface for validating POST access via secret token.

**IAuthStrategy** (Services/IAuthStrategy.cs):
```csharp
public interface IAuthStrategy
{
    Task<AuthResult> ValidatePostAccess(HttpContext context, TripEntity trip);
}

public record AuthResult(bool IsAuthorized, string? DeniedReason = null);
```

**SecretTokenAuthStrategy** (Services/SecretTokenAuthStrategy.cs):
- Extracts `secretToken` from route values via `HttpContext.GetRouteValue("secretToken")`
- Compares against `trip.SecretToken`
- Returns `AuthResult(true)` on match; `AuthResult(false, "Invalid or missing secret token")` on mismatch

**DI Registration** (Program.cs):
```csharp
builder.Services.AddScoped<IAuthStrategy, SecretTokenAuthStrategy>();
```

**Testing:** 6 unit tests verify:
- Matching token → authorized
- Mismatched token → unauthorized with reason
- Missing token → unauthorized
- Empty token → unauthorized
- Interface implementation
- AuthResult type correctness

**Design (AC6.1, AC5.2, AC2.6):**
- Auth strategy is DI-injected and swappable without endpoint code changes
- Secret token is the only credential (no passwords, accounts, headers)
- Invalid tokens return 401 Unauthorized

### 9.2 IPhotoService & PhotoService (Phase 3, Tasks 3-4)

Image processing pipeline using SkiaSharp with three-tier Azure Blob Storage uploads.

**IPhotoService** (Services/IPhotoService.cs):
```csharp
public interface IPhotoService
{
    Task<PhotoUploadResult> ProcessAndUploadAsync(Stream imageStream, int tripId, int photoId, string originalFileName);
    Task<Stream> GetPhotoAsync(int tripId, int photoId, string size);
    Task DeletePhotoAsync(int tripId, int photoId, string blobPath);
}

public record PhotoUploadResult(string BlobPath);
```

**PhotoService** (Services/PhotoService.cs):
- **ProcessAndUploadAsync:**
  1. Decode image via `SKBitmap.Decode(stream)` (reads pixel data)
  2. Check `SKBitmap.Origin` for EXIF rotation and apply if needed
  3. Upload three tiers: original, display, thumbnail
  4. **Original:** Re-encode as JPEG quality 95, no resize → blob path `{tripId}/{photoId}.jpg`
  5. **Display:** Resize to max 1920px width (aspect ratio preserved), JPEG quality 85 → `{tripId}/{photoId}_display.jpg`
  6. **Thumbnail:** Resize to max 300px width, JPEG quality 75 → `{tripId}/{photoId}_thumb.jpg`
  7. All re-encoding via `SKBitmap.Encode()` creates fresh pixel data, stripping EXIF by design (AC6.3)

- **GetPhotoAsync:**
  - Validates size is one of: `original`, `display`, `thumb`
  - Maps size to blob path suffix (empty, `_display`, `_thumb`)
  - Downloads and returns stream

- **DeletePhotoAsync:**
  - Deletes all three tiers by blob path

**Aspect-Ratio-Preserving Resize:**
```csharp
private static SKImageInfo CalculateResizedDimensions(int origWidth, int origHeight, int maxWidth)
{
    if (origWidth <= maxWidth) return new SKImageInfo(origWidth, origHeight);
    var ratio = (float)maxWidth / origWidth;
    return new SKImageInfo(maxWidth, (int)(origHeight * ratio));
}
```

**Testing:** 14 unit tests verify:
- Interface implementation
- Image decode/encode round-trip
- Aspect ratio preservation
- EXIF stripping via re-encoding
- Valid size acceptance
- Invalid size rejection

---

## 10. Security Considerations (Phase 3)

### 10.1 Authorization

**Phase 3 Implementation:**
- **IAuthStrategy:** Pluggable interface via DI (AC6.1)
- **SecretTokenAuthStrategy:** Validates `{secretToken}` route parameter against `Trip.SecretToken` (AC5.2, AC2.6)
- **Future swapping:** PIN codes, OAuth, or other strategies without endpoint changes

### 10.2 HTTPS & TLS

ASP.NET Core project created with `--no-https` because Azure App Service terminates TLS. Ensure `X-Forwarded-Proto` header is trusted in production.

### 10.3 EXIF Stripping (Phase 3, Task 3)

**Implementation via SkiaSharp:**
- Decode JPEG with `SKBitmap.Decode(stream)` (reads pixels)
- Re-encode with `SKBitmap.Encode()` as fresh JPEG (no metadata)
- Creates three tiers: original, display, thumbnail
- All tiers have EXIF stripped (AC6.3)

### 10.4 Blob Storage Security (Phase 3, Task 6)

**Private Blob Storage:**
- Azure Blob container `road-trip-photos` created with `PublicAccessType.None`
- Photos are NOT accessible via direct blob URLs (AC6.4)
- All photo access through `GET /api/photos/{tripId}/{photoId}/{size}` endpoint (API proxy)

---

## 9. Deployment

### 10.1 Build & Publish

```bash
cd projects/road-trip
dotnet publish -c Release -o ./publish
```

Outputs to `publish/` folder for Docker or direct deployment.

### 10.2 App Service Configuration

Must set via Azure Portal or Bicep:
- `ConnectionStrings:DefaultConnection` = Azure SQL connection string

### 10.3 Shared Database Note

Road Trip and Stock Analyzer share the `StockAnalyzer` Azure SQL database. Migrations are run independently but operate on the same SQL instance. The `roadtrip` schema isolation prevents table name conflicts.

---

## 11. Testing Strategy (Phase 2)

### 11.1 Test Project Setup

**RoadTripMap.Tests** (xUnit) with:
- In-memory EF Core context for unit tests
- Moq for service mocking
- FluentAssertions for readable assertions

### 11.2 Test Scope (Phase 2)

- SlugHelper utility functions (15 tests covering generation, uniqueness, truncation, edge cases)
- Trip creation DTOs (structure, required fields)
- API endpoints (integration tests) — coming in Task 2
- Homepage static files — coming in Task 3

Future phases will test:
- Photo upload pipeline
- Authorization logic
- Photo processing and EXIF stripping

---

## 12. Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.4 | 2026-03-20 | Phase 3, Tasks 1-2: NuGet packages for image processing (SkiaSharp 3.119.2) and Azure Blob Storage (Azure.Storage.Blobs 12.27.0). IAuthStrategy interface and SecretTokenAuthStrategy implementation with DI registration. 6 unit tests verify secret token validation, error handling, and interface compliance. Pluggable auth design supports future strategy swapping without code changes. |
| 1.3 | 2026-03-20 | Phase 2, Task 3: Landing page (index.html), trip creation form (create.html), mobile-first CSS (styles.css), and API client (api.js). All static files served from wwwroot with responsive design and copy-to-clipboard functionality. |
| 1.2 | 2026-03-20 | Phase 2, Task 2: POST /api/trips endpoint with validation, slug generation, token creation, and full test coverage (7 tests). |
| 1.1 | 2026-03-20 | Phase 2, Task 1: SlugHelper utility class and trip creation DTOs (CreateTripRequest, CreateTripResponse) with comprehensive test coverage (15 tests). |
| 1.0 | 2026-03-19 | Phase 1 infrastructure: project scaffold, entity model, EF Core context, initial migration. |
