# Road Trip Photo Map

Last verified: 2026-04-05

## Purpose

Mobile-first road trip photo sharing app. Users create a trip, get two secret links (one for uploading photos, one for view-only map access), and share geotagged photos on an interactive map. Privacy-first: no accounts, no indexing, no tracking.

## Tech Stack

- ASP.NET Core 8.0 Minimal API (no controllers)
- EF Core 8.0 + Azure SQL (shared DB, `roadtrip` schema — Phase 4 will add dedicated SQL instance)
- Azure Blob Storage (private container `road-trip-photos`)
- SkiaSharp for server-side image processing
- MapLibre GL JS v5.21.0 for map rendering (vector tiles via MapTiler)
- Vanilla HTML/JS/CSS frontend (no framework)

## Commands

- `dotnet build RoadTripMap.sln` -- Build
- `dotnet test RoadTripMap.sln` -- Run tests
- `dotnet run --project src/RoadTripMap` -- Run locally (port 5100)
- `dotnet run --project src/RoadTripMap.PoiSeeder` -- Seed POI data (flags: `--nps-only`, `--overpass-only`, `--pad-us-only`, `--pad-us-file <path>`, `--boundaries-only`)

## Contracts

- **Exposes**: REST API at `/api/` (trips, photos, geocode, poi, park-boundaries, health)
- **Guarantees**:
  - Photos stored in 3 tiers: original (full quality), display (1920px), thumb (300px)
  - Original media never degraded (re-encoded at quality 100, EXIF stripped)
  - `TakenAt` is nullable -- null means no EXIF date was available; upload no longer defaults to `DateTime.UtcNow`
  - Photo endpoints return photos ordered by `TakenAt` ascending (nulls sort last)
  - Two-token auth: SecretToken (upload + view), ViewToken (view only) — both GUIDs in URL path, no accounts/cookies
  - All responses include `X-Robots-Tag: noindex, nofollow`
  - Geocoding via Nominatim with 1req/sec rate limit and DB cache
  - Upload rate limited to 20/hr per IP
  - Migrations auto-apply on startup
  - `GET /api/poi` returns max 200 results per request, filtered by viewport bounds and zoom-based category tiers
  - POI categories by zoom: <7 national_park only, 7-9 adds state_park + natural_feature, 10+ adds historic_site + tourism
  - `GET /api/park-boundaries` returns max 50 results per request as GeoJSON FeatureCollection, filtered by viewport bounds; zoom gating returns empty below zoom 8; detail parameter selects geometry fidelity (full, moderate, simplified)
  - Park boundaries stored in 3 geometry tiers: full, moderate (default), simplified -- selected by `detail` query param
- **Expects**: `ConnectionStrings__DefaultConnection` (SQL), `ConnectionStrings__AzureStorage` (Blob), optionally `WSL_SQL_CONNECTION` (overrides SQL in WSL2), `SA_DESIGN_CONNECTION` (EF Core migrations in WSL2)

## Dependencies

- **Uses**: Azure SQL (shared DB — see Phase 4 migration notes), Azure Blob Storage, Nominatim API (geocoding), MapTiler (vector tile styles), NPS API (park data seeding), Overpass API (OSM features seeding), PAD-US GeoJSON (state park seeding), PAD-US ArcGIS REST API (park boundary polygon fetching)
- **Consumed by**: GitHub Actions deploy workflow (`.github/workflows/roadtrip-deploy.yml`)
- **Decoupling**: Phase 4 of repo-split will add a dedicated Azure SQL instance for Road Trip, eliminating the shared DB dependency with Stock Analyzer

## Key Decisions

- **Shared DB, separate schema**: Avoids second Azure SQL cost; `roadtrip` schema isolates tables
- **Secret token auth (not accounts)**: Simplest viable auth for MVP; `IAuthStrategy` interface allows upgrade path
- **Nominatim over Google Maps**: Free, no API key, respects OSM usage policy with rate limiter
- **SkiaSharp over ImageSharp**: Already proven in ecosystem; handles EXIF rotation and resize
- **No SPA framework**: Static HTML pages served same-origin; keeps bundle zero
- **MapLibre GL JS over Leaflet**: Leaflet had an unfixed popup auto-pan bug on mobile (popup overflow behind header). MapLibre handles popup positioning natively, supports vector tiles, and eliminates the manual pan workaround.

## Invariants

- Photos always have all 3 blob tiers (original, display, thumb)
- Blob container is PRIVATE (PublicAccessType.None); photos served via proxy endpoint
- Trip slugs are unique, lowercase alphanumeric with hyphens, max 200 chars
- Two tokens per trip: SecretToken (upload access via `/post/{token}`), ViewToken (view-only via `/trips/{token}`) — both GUIDs, both unique-indexed
- View endpoints use `/api/trips/view/{viewToken}` (not slug-based)
- Coordinate validation: lat [-90,90], lng [-180,180]
- Caption max 1000 chars, trip name max 500 chars
- POI records have a unique (Source, SourceId) pair; cross-source deduplication merges by name+proximity (100m radius)
- Park boundary records deduplicate by (Source, SourceId) pair; upserts are idempotent via BoundaryUpsertHelper (application-level, no DB unique constraint)

## Key Files

- `src/RoadTripMap/Program.cs` -- All endpoints (Minimal API)
- `src/RoadTripMap/Services/IAuthStrategy.cs` -- Auth abstraction (upgradeable)
- `src/RoadTripMap/Services/PhotoService.cs` -- Image processing + blob storage
- `src/RoadTripMap/Services/NominatimGeocodingService.cs` -- Reverse geocoding with cache
- `src/RoadTripMap/wwwroot/js/photoCarousel.js` -- Carousel UI module (scroll-snap strip, fullscreen viewer, map sync)
- `src/RoadTripMap/wwwroot/js/poiLayer.js` -- POI marker overlay for maps (viewport-based fetch, tap-to-pin)
- `src/RoadTripMap/wwwroot/js/parkStyle.js` -- MapTiler park polygon restyling
- `src/RoadTripMap/wwwroot/js/stateParkLayer.js` -- State park boundary polygon rendering (fill, outline, dots, labels, adaptive detail, predictive prefetch)
- `src/RoadTripMap/wwwroot/js/mapCache.js` -- IndexedDB persistent cache for map data (boundaries, POIs)
- `src/RoadTripMap.PoiSeeder/` -- Console app for importing POI data from NPS, Overpass, and PAD-US sources
- `src/RoadTripMap.PoiSeeder/Importers/PadUsBoundaryImporter.cs` -- Fetches park boundary polygons from PAD-US ArcGIS API with geometry simplification
- `src/RoadTripMap.PoiSeeder/Geometry/GeoJsonProcessor.cs` -- Geometry utilities for boundary simplification and centroid calculation
- `infrastructure/azure/main.bicep` -- Azure App Service definition
- `docs/TECHNICAL_SPEC.md` -- Full technical specification

## Gotchas

- EXIF rotation is TODO -- `ApplyExifRotation()` is a no-op stub
- DB is currently shared via Azure SQL; Phase 4 will add dedicated SQL instance. Schema changes use EF Core migrations only.
- Deploy is Docker-based (App Service with containerized builds)
- Port 5100 locally (distinct from other .NET apps)
- CI workflow is `workflow_dispatch` only (manual trigger via GitHub UI)

---

## Git Flow

This repository follows a standard develop → main flow with branch protection on main.

### Branching Strategy

```
develop (work here) → PR → main (production)
                      ↑
               NEVER reverse this
```

| Branch | Purpose | Protection |
|--------|---------|------------|
| `develop` | Working branch | None — commit directly for small fixes |
| `main` | Production ONLY | PR required, CI must pass |

- **Feature branches** for: new services, architecture changes, multi-file refactors, big UI changes, multi-session work, 5+ files
- **Direct on develop** for: small fixes, tweaks, internal docs
- **NEVER** commit directly to main, merge to main via CLI, or deploy without explicit approval

### Forbidden Operations (on develop)

| Operation | Why |
|-----------|-----|
| `git merge main` | Develop flows TO main only |
| `git pull origin main` | Pulls and merges main into develop |
| `git rebase main` | Rewrites develop history based on main |

If main and develop diverge, merge develop into main via PR — never the reverse.

### PR Rules

**Before Pushing:**
1. `git fetch origin` (ALWAYS fetch first)
2. Verify your branch against main (if using a feature branch)
3. Test locally: `dotnet build RoadTripMap.sln --configuration Release && dotnet test RoadTripMap.sln --configuration Release --no-build`

**After Creating a PR:**
1. Wait for CI to pass (roadtrip-ci.yml)
2. Patrick reviews and merges via GitHub web interface
3. Never use `gh pr merge` — Patrick merges only

**Merged PRs:** Once closed, a PR is DEAD. After any merge:
1. Check: `gh pr list --head develop --base main --state open`
2. No open PR → create NEW one if more work remains

### Pre-Commit Protocol

Before committing, verify:
1. `git status` — check staged, unstaged, untracked files
2. `git diff` — review actual code changes
3. Commit message is clear and follows the project style
4. No credentials, API keys, or sensitive data included

Commit with a message describing the "why" not just the "what":
```
git commit -m "feat: add photo upload rate limiting

Implement 20/hr per IP limit using sliding window in Redis.
Protects API from abuse while maintaining user experience."
```

---

## Database Migrations

Road Trip uses EF Core for all schema changes. Never write raw SQL migration scripts.

**Local Development (Windows):**
```powershell
cd src/RoadTripMap
dotnet ef migrations add YourMigrationName
# Verify the migration in Migrations/ folder
dotnet ef database update
```

**WSL2 Development:**
Set `SA_DESIGN_CONNECTION` environment variable (configured by claude-env WSL2 setup scripts) to apply migrations in WSL environment. This connection string supports DDL operations for EF Core migrations. Additionally, `WSL_SQL_CONNECTION` is set for runtime SQL access.

---

## Principles

Key principles for this repository:

- **Rules are hard blocks** — Git flow rules are enforced. Breaking them causes CI to fail.
- **Test before suggesting** — Never tell someone to do something untested. Run commands locally first.
- **No feature regression** — Changes should never lose existing functionality.
- **EF Core only** — Database schema changes use migrations, never raw SQL.
- **CI must pass** — All PRs to main require passing CI before merge.
- **Deploy only when ready** — Docker build, Azure deployment, monitoring all handled by CI/CD workflows.
