# Technical Specification: Road Trip Photo Map

**Version:** 1.0
**Last Updated:** 2026-03-19 (Task 3: DbContext created)
**Status:** Phase 1 - Infrastructure

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
│       ├── Migrations/              # EF Core migrations (generated)
│       └── wwwroot/                 # Static files (HTML, JS, CSS)
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

## 5. NuGet Packages

### 5.1 Core Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `Microsoft.EntityFrameworkCore.SqlServer` | 8.0.23 | SQL Server provider for EF Core |
| `Microsoft.EntityFrameworkCore.Design` | 8.0.23 | EF Core tools (migrations) |

### 5.2 Testing Dependencies (Phase 1)

| Package | Version | Purpose |
|---------|---------|---------|
| `xunit` | Latest | Unit test framework |
| `Moq` | 4.20.72 | Mocking library |
| `FluentAssertions` | 6.12.2 | Assertion fluency |
| `Microsoft.EntityFrameworkCore.InMemory` | 8.0.23 | In-memory DB for testing |

Future phases will add:
- `SkiaSharp` — Image resizing
- `exifr` — Client-side EXIF (JavaScript)
- Azure Storage SDK

---

## 6. Minimal API Bootstrap

**Program.cs** currently:
1. Registers `RoadTripDbContext` with connection string from config
2. Maps a health check endpoint: `GET /api/health`
3. Serves static files from `wwwroot/`
4. Listens on port 5100 (avoid collision with Stock Analyzer on 5000)

Future phases will add:
- Trip creation endpoint: `POST /api/trips`
- Photo upload endpoint: `POST /api/trips/{secretToken}/photos`
- Photo list endpoint: `GET /api/trips/{slug}/photos`
- Reverse geocode endpoint: `GET /api/geocode`

---

## 7. Migration Strategy

### 7.1 Creating Migrations

```bash
cd projects/road-trip/src/RoadTripMap
dotnet ef migrations add <MigrationName>
```

Migrations are stored in `Migrations/` folder and tracked in Git.

### 7.2 Applying Migrations

**Local (SQL Express):**
```bash
dotnet ef database update
```

**Production (Azure SQL):**
Applied automatically on app startup via `DbContext.Database.Migrate()` call in `Program.cs` (will be added in Phase 5).

---

## 8. Security Considerations (Phase 1)

### 8.1 Authorization

Currently placeholder — no authorization logic. Future phases (Phase 3) will implement:
- **Secret Token Auth:** POST requests with `secret-token` query param or header
- **Pluggable Strategy:** DI-based `IAuthorizationStrategy` allows swapping secret tokens for PIN codes or OAuth later

### 8.2 HTTPS & TLS

ASP.NET Core project created with `--no-https` because Azure App Service terminates TLS. Ensure `X-Forwarded-Proto` header is trusted in production.

### 8.3 EXIF Stripping

Not yet implemented — Phase 2 (Photo Upload) will strip EXIF from stored tiers via SkiaSharp.

---

## 9. Deployment

### 9.1 Build & Publish

```bash
cd projects/road-trip
dotnet publish -c Release -o ./publish
```

Outputs to `publish/` folder for Docker or direct deployment.

### 9.2 App Service Configuration

Must set via Azure Portal or Bicep:
- `ConnectionStrings:DefaultConnection` = Azure SQL connection string

### 9.3 Shared Database Note

Road Trip and Stock Analyzer share the `StockAnalyzer` Azure SQL database. Migrations are run independently but operate on the same SQL instance. The `roadtrip` schema isolation prevents table name conflicts.

---

## 10. Testing Strategy (Phase 1)

### 10.1 Test Project Setup

**RoadTripMap.Tests** (xUnit) with:
- In-memory EF Core context for unit tests
- Moq for service mocking
- FluentAssertions for readable assertions

### 10.2 Test Scope (Phase 1)

- Entity model validation (nullable fields, required fields)
- DbContext configuration (schema, indices, constraints)
- Migration smoke test (verify migrations apply cleanly)

Future phases will test:
- API endpoints (integration tests)
- Photo processing pipeline
- Authorization logic

---

## 11. Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-19 | Phase 1 infrastructure: project scaffold, entity model, EF Core context, initial migration. |
