# Road Trip Photo Map

Last verified: 2026-03-21

## Purpose

Mobile-first road trip photo sharing app. Users create a trip, get a secret link for uploading geotagged photos, and share a public map view showing pins and route lines. Privacy-first: no accounts, no indexing, no tracking.

## Tech Stack

- ASP.NET Core 8.0 Minimal API (no controllers)
- EF Core 8.0 + Azure SQL (shared `StockAnalyzer` DB, `roadtrip` schema)
- Azure Blob Storage (private container `road-trip-photos`)
- SkiaSharp for server-side image processing
- Leaflet.js for map rendering
- Vanilla HTML/JS/CSS frontend (no framework)

## Commands

- `dotnet build projects/road-trip/RoadTripMap.sln` -- Build
- `dotnet test projects/road-trip/RoadTripMap.sln` -- Run tests
- `dotnet run --project projects/road-trip/src/RoadTripMap` -- Run locally (port 5100)

## Contracts

- **Exposes**: REST API at `/api/` (trips, photos, geocode, health)
- **Guarantees**:
  - Photos stored in 3 tiers: original (full quality), display (1920px), thumb (300px)
  - Original media never degraded (re-encoded at quality 100, EXIF stripped)
  - Auth via secret token in URL path (no accounts, no cookies)
  - All responses include `X-Robots-Tag: noindex, nofollow`
  - Geocoding via Nominatim with 1req/sec rate limit and DB cache
  - Upload rate limited to 20/hr per IP
  - Migrations auto-apply on startup
- **Expects**: `ConnectionStrings__DefaultConnection` (SQL), `ConnectionStrings__AzureStorage` (Blob), optionally `WSL_SQL_CONNECTION` (overrides SQL in WSL2), `SA_DESIGN_CONNECTION` (EF Core migrations in WSL2)

## Dependencies

- **Uses**: Azure SQL (shared DB), Azure Blob Storage, Nominatim API (geocoding)
- **Used by**: GitHub Actions deploy workflow (`.github/workflows/roadtrip-deploy.yml`)
- **Boundary**: Completely independent from Stock Analyzer code. Shares only the Azure SQL server and resource group.

## Key Decisions

- **Shared DB, separate schema**: Avoids second Azure SQL cost; `roadtrip` schema isolates tables
- **Secret token auth (not accounts)**: Simplest viable auth for MVP; `IAuthStrategy` interface allows upgrade path
- **Nominatim over Google Maps**: Free, no API key, respects OSM usage policy with rate limiter
- **SkiaSharp over ImageSharp**: Already proven in ecosystem; handles EXIF rotation and resize
- **No SPA framework**: Static HTML pages served same-origin; keeps bundle zero

## Invariants

- Photos always have all 3 blob tiers (original, display, thumb)
- Blob container is PRIVATE (PublicAccessType.None); photos served via proxy endpoint
- Trip slugs are unique, lowercase alphanumeric with hyphens, max 200 chars
- Secret tokens are GUIDs -- never exposed in public-facing URLs
- Coordinate validation: lat [-90,90], lng [-180,180]
- Caption max 1000 chars, trip name max 500 chars

## Key Files

- `src/RoadTripMap/Program.cs` -- All endpoints (Minimal API)
- `src/RoadTripMap/Services/IAuthStrategy.cs` -- Auth abstraction (upgradeable)
- `src/RoadTripMap/Services/PhotoService.cs` -- Image processing + blob storage
- `src/RoadTripMap/Services/NominatimGeocodingService.cs` -- Reverse geocoding with cache
- `infrastructure/azure/main.bicep` -- Azure App Service definition
- `docs/TECHNICAL_SPEC.md` -- Full technical specification

## Gotchas

- EXIF rotation is TODO -- `ApplyExifRotation()` is a no-op stub
- DB is shared with Stock Analyzer; schema changes need EF Core migration in this project
- Deploy is Docker-based (not zip deploy like Stock Analyzer)
- Port 5100 locally (not 5000 like Stock Analyzer)
- CI workflow is `workflow_dispatch` only (manual trigger, type "deploy")
