# Road Trip Photo Map

Last verified: 2026-04-18

## Purpose

Mobile-first road trip photo sharing app. Users create a trip, get two secret links (one for uploading photos, one for view-only map access), and share geotagged photos on an interactive map. Privacy-first: no accounts, no indexing, no tracking.

## Tech Stack

- ASP.NET Core 8.0 Minimal API (no controllers)
- EF Core 8.0 + dedicated Azure SQL instance `sql-roadtripmap-prod` / `roadtripmap-db` (schema `roadtrip`)
- Azure Blob Storage account `stockanalyzerblob` (shared, cross-RG in `rg-stockanalyzer-prod`). Containers: legacy `road-trip-photos` (pre-2026-04) and per-trip `trip-{secretToken}` (Phase 1 resilient uploads onward)
- SkiaSharp for server-side image processing
- MapLibre GL JS v5.21.0 for map rendering (vector tiles via MapTiler)
- Vanilla HTML/JS/CSS frontend (no framework)
- Capacitor 8 iOS shell (`@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`) with SPM (never CocoaPods). `src/bootstrap/` is the Capacitor `webDir` — loads hybrid bundle at runtime from App Service `/bundle/*`
- Node tooling (vitest + jsdom + fake-indexeddb for JS tests; `scripts/build-bundle.js` produces the iOS hybrid bundle)

## Commands

- `dotnet build RoadTripMap.sln` -- Build
- `dotnet test RoadTripMap.sln` -- Run .NET tests
- `dotnet run --project src/RoadTripMap` -- Run locally (port 5100)
- `dotnet run --project src/RoadTripMap.PoiSeeder` -- Seed POI data (flags: `--nps-only`, `--overpass-only`, `--pad-us-only`, `--pad-us-file <path>`, `--boundaries-only`)
- `npm test` -- Run JS tests (vitest: `tests/js/**`). CI does NOT run these yet; run locally before pushing JS changes.
- `npm run build:bundle` -- Concat `src/RoadTripMap/wwwroot/js/*.js` + `css/*.css` into `src/RoadTripMap/wwwroot/bundle/{app.js,app.css,ios.css,manifest.json}`. Runs `node --check` against `app.js` and fails on syntax errors (guards against duplicate-const regressions from naive concatenation).

## Contracts

- **Exposes**: REST API at `/api/` (trips, photos, resilient-upload flow, geocode, poi, park-boundaries, version, health)
- **Guarantees**:
  - Photos stored in 3 tiers: original (full quality), display (1920px), thumb (300px)
  - Original media never degraded (re-encoded at quality 100, EXIF stripped)
  - `TakenAt` is nullable -- null means no EXIF date was available; upload no longer defaults to `DateTime.UtcNow`
  - Photo endpoints return photos ordered by `TakenAt` ascending (nulls sort last)
  - Two-token auth: SecretToken (upload + view), ViewToken (view only) — both GUIDs in URL path, no accounts/cookies
  - All responses include `X-Robots-Tag: noindex, nofollow`
  - All responses include `x-server-version` and `x-client-min-version` headers (resilient-uploads client protocol gate)
  - `GET /bundle/*` -- App Service serves the iOS hybrid bundle as static files (from `src/RoadTripMap/wwwroot/bundle/`) with CORS policy `IosAppOrigin` (allows `capacitor://localhost`, `ionic://localhost`, `https://localhost`; exposes `x-server-version`, `x-client-min-version`, `x-correlation-id`). `manifest.json` shape: `{ version, client_min_version, files: { "app.js": {size, sha256}, "app.css": {...}, "ios.css": {...} } }`. The Capacitor iOS shell's `src/bootstrap/loader.js` is the sole consumer.
  - Geocoding via Nominatim with 1req/sec rate limit and DB cache
  - Upload rate limited to 20/hr per IP (legacy form-POST endpoint `POST /api/trips/{token}/photos`)
  - Resilient upload flow (Phases 1-5 implemented; Phase 5 = client-side image processing, dark-released behind `Upload:ClientSideProcessingEnabled`):
    - `POST /api/trips/{secretToken}/photos/request-upload` → `RequestUploadResponse` with 3 SAS URLs (`sasUrl` for original, `displaySasUrl`, `thumbSasUrl`), `BlobPath`, and current server version. Idempotent on `UploadId` Guid. SAS TTL 2 hours. Display/thumb SAS URLs target `{uploadId}_display.jpg` and `{uploadId}_thumb.jpg` blobs.
    - Client PUTs blocks directly to Azure using the returned SAS.
    - `POST /api/trips/{secretToken}/photos/{photoId:guid}/commit` → `PhotoResponse`, 400 on `BlockListMismatch`, 404 cross-trip.
    - `POST /api/trips/{secretToken}/photos/{photoId:guid}/abort` → 204 (idempotent).
  - Per-trip blob containers are eagerly provisioned on trip create and backfilled on startup when `Backfill:RunOnStartup=true`
  - Dual-read: legacy-tier photos (in `road-trip-photos`) and per-trip-tier photos (in `trip-{secretToken}`) are returned through the same `/api/post/{secretToken}/photos` endpoint with uniform `/api/photos/{tripId}/{photoId}/{size}` URLs
  - `DELETE /api/trips/{secretToken}` cascades: auth-check, legacy blobs, per-trip container, photos, trip row
  - `OrphanSweeperHostedService` deletes `photos` rows with `status='pending'` and `LastActivityAt` older than `OrphanSweeper:StaleThresholdHours` (default 48h)
  - Migrations auto-apply on startup
  - `GET /api/poi` returns max 200 results per request, filtered by viewport bounds and zoom-based category tiers
  - POI categories by zoom: <7 national_park only, 7-9 adds state_park + natural_feature, 10+ adds historic_site + tourism
  - `GET /api/park-boundaries` returns max 50 results per request as GeoJSON FeatureCollection, filtered by viewport bounds; zoom gating returns empty below zoom 8; detail parameter selects geometry fidelity (full, moderate, simplified)
  - Park boundaries stored in 3 geometry tiers: full, moderate (default), simplified -- selected by `detail` query param
- **Expects**: All remote resources resolved via `EndpointRegistry.Resolve("name")`. Endpoint definitions in `endpoints.json` (root). Dev uses env vars (`WSL_SQL_CONNECTION`, `RT_DESIGN_CONNECTION`, `NPS_API_KEY`); prod uses Azure Key Vault secrets (`kv-roadtripmap-prod`). Never read env vars directly for endpoint keys -- always go through the registry.

## Dependencies

- **Uses**: Azure SQL (dedicated `sql-roadtripmap-prod`), Azure Blob Storage (shared cross-RG `stockanalyzerblob`), Azure Container Registry (shared cross-RG `acrstockanalyzerer34ug`), Azure Key Vault (`kv-roadtripmap-prod`), Nominatim API (geocoding), MapTiler (vector tile styles), NPS API (park data seeding), Overpass API (OSM features seeding), PAD-US GeoJSON (state park seeding), PAD-US ArcGIS REST API (park boundary polygon fetching)
- **Consumed by**: GitHub Actions CI (`.github/workflows/roadtrip-ci.yml`) and manual deploy workflow (`.github/workflows/deploy.yml`, `workflow_dispatch` with `confirm_deploy=deploy`)
- **Infrastructure topology** (verified 2026-04-14, see memory `reference_roadtrip_prod_infra`): App Service, App Service Plan, SQL, KV all in `rg-roadtripmap-prod`. Storage account and ACR in `rg-stockanalyzer-prod` (shared with stock-analyzer). Bicep at `infrastructure/azure/main.bicep` is the source of truth and rebuilds the environment faithfully.

## Key Decisions

- **Dedicated SQL, shared blob + ACR**: Road Trip owns its SQL server/database; blob storage and container registry are shared cross-RG with stock-analyzer to avoid duplication cost
- **Secret token auth (not accounts)**: Simplest viable auth for MVP; `IAuthStrategy` interface allows upgrade path
- **Nominatim over Google Maps**: Free, no API key, respects OSM usage policy with rate limiter
- **SkiaSharp over ImageSharp**: Already proven in ecosystem; handles EXIF rotation and resize
- **No SPA framework**: Static HTML pages served same-origin; keeps bundle zero
- **MapLibre GL JS over Leaflet**: Leaflet had an unfixed popup auto-pan bug on mobile (popup overflow behind header). MapLibre handles popup positioning natively, supports vector tiles, and eliminates the manual pan workaround.
- **EndpointRegistry over direct env vars**: All connection strings and API keys resolved via `EndpointRegistry.Resolve()` backed by `endpoints.json`. Centralizes endpoint management, supports Key Vault resolution in prod, and enables schema validation via claude-env hooks.
- **Direct-to-blob resilient uploads (Phase 1 design `2026-04-13-resilient-uploads`)**: Clients get a user-delegation SAS (prod) / account-key SAS (Azurite dev) and upload blocks directly to Azure instead of streaming through the API. Survives network churn, avoids the API server memory ceiling on large uploads, and is the foundation for background uploads in native apps (phases 6–7).
- **Client-side image processing (Phase 5)**: When `Upload:ClientSideProcessingEnabled=true`, the client compresses oversize images (>14 MB) and generates display (1920px) and thumb (300px) tiers before upload, reducing server CPU. Uses lazy-loaded CDN libs (browser-image-compression, piexifjs, heic2any). Dark-released: `false` in prod appsettings, `true` in dev. Server `CommitAsync` detects missing tier blobs and falls back to server-side generation, so the feature is fully backward-compatible.
- **Client-provided UploadId as the correlation key**: `RequestUploadResponse.PhotoId` is the same Guid the client sent as `UploadId`. Enables idempotency (duplicate POST returns existing row) and consistent identifiers between request-upload and commit. The EF entity's `int Id` is distinct from this Guid and exposed as `PhotoResponse.id`.
- **Log sanitization via `LogSanitizer`**: Every logger call touching trip tokens, blob paths, SAS URLs, or GPS coordinates goes through `src/RoadTripMap/Security/LogSanitizer.cs`. Never log raw secret values. Enforced by captured-log assertions in `UploadEndpointHttpTests`.

## Invariants

- Photos always have all 3 blob tiers (original, display, thumb). Tiers may be client-generated (uploaded via display/thumb SAS URLs) or server-generated (fallback in `CommitAsync` when client tier blobs are missing)
- Blob containers are PRIVATE (PublicAccessType.None); photos served via proxy endpoint. Container naming: legacy `road-trip-photos` OR per-trip `trip-{secretToken.ToLowerInvariant()}`
- Trip slugs are unique, lowercase alphanumeric with hyphens, max 200 chars
- Two tokens per trip: SecretToken (upload access via `/post/{token}`), ViewToken (view-only via `/trips/{token}`) — both GUIDs, both unique-indexed
- View endpoints use `/api/trips/view/{viewToken}` (not slug-based)
- Coordinate validation: lat [-90,90], lng [-180,180]
- Caption max 1000 chars, trip name max 500 chars
- POI records have a unique (Source, SourceId) pair; cross-source deduplication merges by name+proximity (100m radius)
- Park boundary records deduplicate by (Source, SourceId) pair; upserts are idempotent via BoundaryUpsertHelper (application-level, no DB unique constraint)
- `photos.Status` is one of `committed` (default, legacy + finalized) or `pending` (resilient-upload in flight). `failed` is reserved for Phase 2 client-side retries and is not written server-side yet.
- `photos.StorageTier` is `legacy` (pre-Phase-1 rows) or `per-trip` (Phase 1 onward); selects container lookup at serve time
- `photos.UploadId` is unique (filtered index, `WHERE UploadId IS NOT NULL`); resilient-upload idempotency key
- All connection strings and API keys resolve through `EndpointRegistry.Resolve()` -- no direct `Environment.GetEnvironmentVariable()` for endpoint keys
- Raw secret tokens, SAS URLs, blob paths with secret tokens, and GPS coordinates MUST NOT appear in logs (enforced by `LogSanitizer` usage + captured-log assertions)
- Bootstrap loader cache (iOS shell) lives in IndexedDB `RoadTripBundle` / object store `files` / key `bundle`. Cached record is `{ version, files, client_min_version }`. Loader refreshes when cached version differs from manifest, and force-refreshes (with `alert('Site updated — reloading')`) when `compareSemver(cached.version, manifest.client_min_version) < 0`. Offline with no cache → renders `fallback.html`.

## Key Files

- `endpoints.json` -- Single source of truth for all remote resource endpoints (DB, blob, APIs)
- `src/RoadTripMap/EndpointRegistry.cs` -- Static resolver: `EndpointRegistry.Resolve("name")` reads endpoints.json, resolves env vars or Key Vault secrets
- `src/RoadTripMap/Program.cs` -- All endpoints (Minimal API) including legacy photo upload, POI, park boundaries, trip CRUD, DELETE /api/trips cascade, `/api/version`, global version-header middleware
- `src/RoadTripMap/Endpoints/UploadEndpoints.cs` -- Phase 1 resilient upload endpoints (`request-upload`, `commit`, `abort`) wired via `app.MapUploadEndpoints()`
- `src/RoadTripMap/Services/IAuthStrategy.cs` -- Auth abstraction (upgradeable)
- `src/RoadTripMap/Services/PhotoService.cs` -- Image processing + legacy blob storage (`road-trip-photos` container)
- `src/RoadTripMap/Services/PhotoReadService.cs` -- Dual-read photo listing (legacy + per-trip tiers merged in one response)
- `src/RoadTripMap/Services/UploadService.cs` -- Resilient upload orchestration (idempotent request with 3 SAS URLs, block-list validation on commit, conditional server-side tier generation, EXIF persistence, reverse geocode on commit)
- `src/RoadTripMap/Services/ISasTokenIssuer.cs` + `UserDelegationSasIssuer.cs` / `AccountKeySasIssuer.cs` -- SAS minting; user-delegation in prod, account-key for Azurite
- `src/RoadTripMap/Services/BlobContainerProvisioner.cs` -- Per-trip container creation with naming validation
- `src/RoadTripMap/Services/NominatimGeocodingService.cs` -- Reverse geocoding with cache
- `src/RoadTripMap/BackgroundJobs/OrphanSweeperHostedService.cs` + `OrphanSweeper.cs` -- Periodic cleanup of stale `pending` photos
- `src/RoadTripMap/BackgroundJobs/ContainerBackfillHostedService.cs` -- On-demand (`Backfill:RunOnStartup=true`) backfill of per-trip containers
- `src/RoadTripMap/Versioning/ServerVersion.cs` + version middleware in Program.cs -- `x-server-version` / `x-client-min-version` headers on every response
- `src/RoadTripMap/Security/LogSanitizer.cs` -- Mandatory wrappers for any logger call that touches tokens, blob paths, SAS URLs, or GPS
- `src/RoadTripMap/wwwroot/js/photoCarousel.js` -- Carousel UI module (scroll-snap strip, fullscreen viewer, map sync)
- `src/RoadTripMap/wwwroot/js/poiLayer.js` -- POI marker overlay for maps (viewport-based fetch, tap-to-pin)
- `src/RoadTripMap/wwwroot/js/parkStyle.js` -- MapTiler park polygon restyling
- `src/RoadTripMap/wwwroot/js/stateParkLayer.js` -- State park boundary polygon rendering (fill, outline, dots, labels, adaptive detail, predictive prefetch)
- `src/RoadTripMap/wwwroot/js/mapCache.js` -- IndexedDB persistent cache for map data (boundaries, POIs)
- `src/RoadTripMap/wwwroot/js/imageProcessor.js` -- Client-side image processing module: oversize compression (>14 MB), HEIC conversion, display/thumb tier generation. Gated by `Upload:ClientSideProcessingEnabled` meta tag. Public API: `ImageProcessor.processForUpload(file)`
- `src/RoadTripMap/wwwroot/js/uploadQueue.js` -- Client-side upload state machine (resilient upload flow with block uploads, SAS refresh, tier blob uploads, retry logic)
- `capacitor.config.js` -- Capacitor iOS shell config (`appId: com.psford.roadtripmap`, `webDir: src/bootstrap`)
- `src/bootstrap/loader.js` -- iOS hybrid bootstrap: fetches `/bundle/manifest.json`, caches bundle in IndexedDB, injects CSS+JS at runtime, falls back to cached bundle when offline, renders `fallback.html` when offline with no cache. Sets `platform-ios` class on `<body>` before paint (AC10.1).
- `src/bootstrap/index.html`, `src/bootstrap/fallback.html` -- Capacitor `webDir` entry point and offline-no-cache fallback
- `ios/App/` -- Xcode + SPM project tree generated by `npx cap add ios` (standard Capacitor layout; no custom native code yet)
- `scripts/build-bundle.js` -- Node script that concatenates `wwwroot/js/*.js` + `wwwroot/css/*.css` into the `/bundle/*` assets + `manifest.json` (sha256 + size per file). Runs `node --check` on the output and fails the build on syntax errors.
- `src/RoadTripMap/wwwroot/bundle/` -- Build output served at `/bundle/*`. Regenerated by `npm run build:bundle`; checked in so prod App Service serves it without a JS build step.
- `tests/js/bootstrap-loader.test.js` -- Bootstrap loader AC9.1–9.5 coverage + IDB write-error scenario + compareSemver unit tests
- `src/RoadTripMap.PoiSeeder/` -- Console app for importing POI data from NPS, Overpass, and PAD-US sources
- `src/RoadTripMap.PoiSeeder/Importers/PadUsBoundaryImporter.cs` -- Fetches park boundary polygons from PAD-US ArcGIS API with geometry simplification
- `src/RoadTripMap.PoiSeeder/Geometry/GeoJsonProcessor.cs` -- Geometry utilities for boundary simplification and centroid calculation
- `infrastructure/azure/main.bicep` -- Faithful IaC: App Service, plan, SQL, KV, role assignments (incl. cross-RG storage blob). Source of truth — `what-if` is expected to show only cosmetic ARM diffs.
- `infrastructure/azure/modules/storage-rbac.bicep` -- Helper for cross-RG role assignments on the shared storage account
- `infrastructure/azure/parameters.json` -- Non-secret Bicep parameters (image tag, environment, WSL firewall IP). Secrets passed via `--parameters` inline on deploy.
- `.github/workflows/roadtrip-ci.yml` -- Push/PR CI (build + unit tests with `Category!=Integration` filter)
- `.github/workflows/deploy.yml` -- Manual `workflow_dispatch` prod deploy (builds/pushes container + `az webapp config container set`). Does NOT run Bicep or EF migrations — those are manual per the runbook.
- `docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md` -- Step-by-step Phase 1 deploy playbook (manual EF migration + Bicep + runbook verification)
- `docs/TECHNICAL_SPEC.md` -- Full technical specification

## Gotchas

- EXIF rotation is TODO -- `ApplyExifRotation()` is a no-op stub
- Schema changes use EF Core migrations only (never raw SQL migration scripts). Migrations auto-apply on app startup; for prod they are also applied manually via the deployment runbook before the App Service deploy.
- Deploy is Docker-based (App Service with containerized builds)
- Port 5100 locally (distinct from other .NET apps)
- Two workflows: `roadtrip-ci.yml` runs on every push/PR; `deploy.yml` is `workflow_dispatch` only (manual trigger via GitHub UI)
- The Phase 1 resilient-upload flow requires client-provided `UploadId` Guid for idempotency; the same Guid is used as the response `PhotoId`. Clients must store it before PUTting blocks.
- `Status='failed'` is reserved for Phase 2 client-state; nothing server-side writes it yet. `OrphanSweeper` filters strictly `status='pending'`.
- `Upload:ClientSideProcessingEnabled` is a dark-release flag (default `false` in prod, `true` in dev). When disabled, `ImageProcessor.processForUpload()` returns the original file unmodified with no tier blobs. Server always falls back to server-side tier generation when client tier blobs are absent.
- Azurite dev tests require Docker; CI unit tests skip them via `--filter "Category!=Integration"`. To run the full suite locally: `dotnet test RoadTripMap.sln`.
- iOS dependencies use Swift Package Manager. Never introduce a Podfile / CocoaPods — this is a standing project decision (`ios/App/CapApp-SPM/Package.swift` is the canonical manifest).
- `storageAdapter.js` and `uploadTransport.js` expose their public module via `const StorageAdapter = _storageAdapterImpl` (and same pattern for transport). The two-name rename is a Phase 6 swap seam — iOS will replace `_storageAdapterImpl` with a SQLite-backed adapter and `_uploadTransportImpl` with a native `BackgroundUpload.enqueue` adapter. Do NOT collapse the rename back into a single declaration; do NOT introduce a sibling `_platform` variable in either file (an earlier attempt produced a duplicate-const SyntaxError in the concatenated bundle, which the `node --check` step in `build:bundle` now catches).
- JS tests do not run in CI. Run `npm test` locally before pushing any change to `src/RoadTripMap/wwwroot/js/*`, `src/bootstrap/*`, or `scripts/build-bundle.js`.

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
Set `RT_DESIGN_CONNECTION` environment variable (admin login for DDL) to apply migrations in WSL. Additionally `WSL_SQL_CONNECTION` is set for runtime SQL access. Both are populated from `claude-env/.env` (template values must be replaced with real DB name `RoadTripMap` per companion-repo setup).

**Prod migrations:** apply via the deployment runbook (`docs/implementation-plans/<plan>/deployment-runbook.md`). Fetch the prod connection string with `az keyvault secret show --vault-name kv-roadtripmap-prod --name DbConnectionString --query value -o tsv`, set it as `RT_DESIGN_CONNECTION`, and run `dotnet ef database update --project src/RoadTripMap --startup-project src/RoadTripMap --connection "<prod-conn>"`.

---

## Principles

Key principles for this repository:

- **Rules are hard blocks** — Git flow rules are enforced. Breaking them causes CI to fail.
- **Test before suggesting** — Never tell someone to do something untested. Run commands locally first.
- **No feature regression** — Changes should never lose existing functionality.
- **EF Core only** — Database schema changes use migrations, never raw SQL.
- **CI must pass** — All PRs to main require passing CI before merge.
- **Deploy only when ready** — Docker build, Azure deployment, monitoring all handled by CI/CD workflows.
