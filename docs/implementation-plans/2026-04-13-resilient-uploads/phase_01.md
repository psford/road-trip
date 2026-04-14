# Resilient Photo Uploads — Phase 1: Backend API, Storage Model, and Provisioning

**Goal:** Ship the stable API contract (`request-upload`, `commit`, `abort`, `version`), per-trip container provisioning, dual-read photo service, orphan sweeper, version-header middleware, and the Bicep role change needed for managed-identity blob operations. No client-side changes.

**Architecture:** Extend existing minimal-API style in `Program.cs` via a dedicated `UploadEndpoints.MapUploadEndpoints(app)` extension. Services follow existing DI pattern in `src/RoadTripMap/Services/`. User-Delegation SAS is the production path; an `ISasTokenIssuer` abstraction allows an account-key implementation for Azurite-backed tests. Dual-read is driven by a new `storage_tier` column; no blob migration.

**Tech Stack:** .NET 8, ASP.NET Core minimal APIs, EF Core 8 + SQL Server, Azure.Storage.Blobs 12.27.0, Azurite (tests), xUnit + WebApplicationFactory.

**Scope:** Phase 1 of 7 (design `docs/design-plans/2026-04-13-resilient-uploads.md`).

**Codebase verified:** 2026-04-13.

---

## Acceptance Criteria Coverage

### resilient-uploads.AC1: Direct-to-blob upload pipeline

- **resilient-uploads.AC1.1 Success:** A single photo uploaded via `request-upload` → block PUTs → `commit` results in a committed blob in the correct per-trip container and a `photos` row with `status='committed'`.
- **resilient-uploads.AC1.2 Success:** A batch of 20 photos uploads concurrently (respecting the concurrency cap) and all commit successfully.
- **resilient-uploads.AC1.3 Success:** Re-submitting the same `upload_id` to `request-upload` returns the existing `photo_id` and SAS URL (idempotent).
- **resilient-uploads.AC1.4 Failure:** `commit` rejects a block ID list that doesn't match the blocks actually uploaded to Azure (returns 400).
- **resilient-uploads.AC1.5 Failure:** SAS URL expires after 2 hours; a PUT using an expired SAS returns 403 from Azure.
- **resilient-uploads.AC1.6 Failure:** `commit` rejects a `photo_id` belonging to a different trip (returns 404 or 403).
- **resilient-uploads.AC1.7 Edge:** Upload of a photo at the configured size ceiling (currently 15 MB) succeeds with appropriate block count.

### resilient-uploads.AC2: Per-trip container provisioning and dual-read

- **resilient-uploads.AC2.1 Success:** Creating a new trip eagerly provisions the `trip-{secretToken}` container.
- **resilient-uploads.AC2.2 Success:** The backfill migration provisions containers for all existing trips and is idempotent when re-run.
- **resilient-uploads.AC2.3 Success:** `GET /api/trips/{token}/photos` returns legacy photos from `road-trip-photos` and new photos from `trip-{token}` in a single response.
- **resilient-uploads.AC2.4 Success:** Deleting a trip deletes the per-trip container and any legacy blobs.
- **resilient-uploads.AC2.5 Failure:** Provisioning a container for a `secretToken` that produces an invalid container name returns a clear error.
- **resilient-uploads.AC2.6 Edge:** A trip with zero photos (new or legacy) renders without error.

### resilient-uploads.AC6: Orphan cleanup

- **resilient-uploads.AC6.1 Success:** `OrphanSweeperJob` deletes `photos` rows with `status='pending'` and `last_activity_at` older than 48 hours.
- **resilient-uploads.AC6.2 Failure:** Sweeper does not touch rows with `status='committed'` regardless of age.
- **resilient-uploads.AC6.3 Edge:** Sweeper is idempotent — running twice in a row produces the same end state.

### resilient-uploads.AC8: Version protocol

- **resilient-uploads.AC8.1 Success:** Every API response includes `x-server-version` and `x-client-min-version` headers.
- **resilient-uploads.AC8.3 Failure:** Missing version headers on an API response do not crash the client (server-side of this AC: middleware always sets them; client-side in Phase 2).

### resilient-uploads.ACX: Cross-cutting

- **resilient-uploads.ACX.1:** No upload-related operation logs the SAS URL, photo contents, or GPS coordinates in persistent server logs.
- **resilient-uploads.ACX.3:** Existing trips' photos continue to load and render correctly (regression coverage via dual-read tests).

---

## Notes for Implementers

- **Project conventions:** See `/home/patrick/projects/road-trip/CLAUDE.md` for tech stack, test commands (`dotnet test RoadTripMap.sln`), EF-migration-only rule, and git flow.
- **Database schema:** default schema is `roadtrip` (`RoadTripDbContext.HasDefaultSchema("roadtrip")`).
- **Secrets:** all secret values flow through `EndpointRegistry.Resolve("database" | "blob-storage" | ...)`; never read env vars directly for prod secrets.
- **Log sanitization:** any user-provided string written to logs must use the existing sanitization wrapper. Do not log SAS URLs, blob paths with GUIDs, or GPS coordinates (ACX.1).
- **Minimal APIs:** do NOT introduce MVC controllers. Add handlers either directly in `Program.cs` or in a static extension method called from `Program.cs`.
- **Azure SDK:** use `Azure.Storage.Blobs` 12.27.0 APIs. Production SAS: `BlobServiceClient.GetUserDelegationKeyAsync` + `BlobSasBuilder`. Tests: `StorageSharedKeyCredential` against Azurite (user delegation keys don't work on Azurite).
- **Tests:** place unit tests in `tests/RoadTripMap.Tests/Services/`; integration in `tests/RoadTripMap.Tests/Endpoints/`. Azurite is introduced this phase — add `docker-compose.azurite.yml` under `tests/` and start it via xUnit `IAsyncLifetime` fixture.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
## Subcomponent A: Schema migration

<!-- START_TASK_1 -->
### Task 1: Extend PhotoEntity and DbContext fluent config

**Verifies:** None (infrastructure precursor).

**Files:**
- Modify: `src/RoadTripMap/Entities/PhotoEntity.cs`
- Modify: `src/RoadTripMap/Data/RoadTripDbContext.cs` (the `OnModelCreating` `Photos` block)

**Implementation:**

Add properties to `PhotoEntity`:
- `string Status` — required, max 20, default `"committed"` for backfill safety of existing rows.
- `string StorageTier` — required, max 16, default `"legacy"`.
- `Guid? UploadId` — nullable.
- `DateTime? LastActivityAt` — nullable (epoch of last state transition).
- `int UploadAttemptCount` — default 0.

In `RoadTripDbContext.OnModelCreating` inside the existing `modelBuilder.Entity<PhotoEntity>(entity => {...})` block, add:
- `Status`: required, max length 20, default value `"committed"`.
- `StorageTier`: required, max length 16, default value `"legacy"`.
- `UploadId`: unique filtered index `WHERE UploadId IS NOT NULL` named `IX_Photos_UploadId`.
- `LastActivityAt`: nullable `DateTime`, column type `datetime2`.
- `UploadAttemptCount`: default 0.

**Verification:**

Run: `dotnet build RoadTripMap.sln`
Expected: Builds with no warnings about missing columns.

**Commit:** `feat(photos): add upload status columns to PhotoEntity`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create and apply EF migration `AddUploadStatusColumns`

**Verifies:** None (infrastructure).

**Files:**
- Create: `src/RoadTripMap/Migrations/YYYYMMDDHHMMSS_AddUploadStatusColumns.cs` (generated)
- Create: `src/RoadTripMap/Migrations/YYYYMMDDHHMMSS_AddUploadStatusColumns.Designer.cs` (generated)
- Modify: `src/RoadTripMap/Migrations/RoadTripDbContextModelSnapshot.cs` (generated)

**Implementation:**

Run: `dotnet ef migrations add AddUploadStatusColumns --project src/RoadTripMap --startup-project src/RoadTripMap`

Inspect generated migration. Confirm:
- `Status` column added with SQL default `'committed'` so existing rows backfill.
- `StorageTier` column added with SQL default `'legacy'`.
- Filtered unique index on `UploadId`.

Apply against WSL SQL: `dotnet ef database update --project src/RoadTripMap --startup-project src/RoadTripMap`.

**Verification:**

Run: `sqlcmd -S "$WSL_SQL_HOST" -d RoadTripMap -Q "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('roadtrip.Photos') AND name IN ('Status','StorageTier','UploadId','LastActivityAt','UploadAttemptCount')"`
Expected: Returns all 5 names.

Run: `dotnet test RoadTripMap.sln --filter "FullyQualifiedName~RoadTripDbContextTests"` (existing tests should still pass).

**Commit:** `feat(db): migration adding upload status columns to roadtrip.Photos`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->
## Subcomponent B: Upload service (SAS issuance + commit validation)

<!-- START_TASK_3 -->
### Task 3: Define service contracts, DTOs, and SAS issuer abstraction

**Verifies:** None (contracts; verified by later task tests).

**Files:**
- Create: `src/RoadTripMap/Services/IUploadService.cs`
- Create: `src/RoadTripMap/Services/ISasTokenIssuer.cs`
- Create: `src/RoadTripMap/Dtos/UploadDtos.cs`

**Implementation:**

`IUploadService`:
- `Task<RequestUploadResponse> RequestUploadAsync(string tripToken, RequestUploadRequest request, CancellationToken ct)`
- `Task<PhotoResponse> CommitAsync(string tripToken, Guid photoId, CommitRequest request, CancellationToken ct)`
- `Task AbortAsync(string tripToken, Guid photoId, CancellationToken ct)`

`ISasTokenIssuer`:
- `Task<Uri> IssueWriteSasAsync(string containerName, string blobPath, TimeSpan ttl, CancellationToken ct)`

DTOs (record types, camelCase via `System.Text.Json` attributes matching existing codebase style):
- `RequestUploadRequest(Guid UploadId, string Filename, string ContentType, long SizeBytes, ExifDto? Exif)`
- `ExifDto(double? GpsLat, double? GpsLon, DateTimeOffset? TakenAt)`
- `RequestUploadResponse(Guid PhotoId, string SasUrl, string BlobPath, int MaxBlockSizeBytes, string ServerVersion, string ClientMinVersion)`
- `CommitRequest(List<string> BlockIds)`

**Verification:**

Run: `dotnet build RoadTripMap.sln`
Expected: No errors; no implementations yet.

**Commit:** `feat(uploads): define IUploadService, ISasTokenIssuer, upload DTOs`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Implement UploadService and two SasTokenIssuer implementations

**Verifies:** AC1.1, AC1.3, AC1.4, AC1.6 (logic implemented; tests in Task 5).

**Files:**
- Create: `src/RoadTripMap/Services/UploadService.cs`
- Create: `src/RoadTripMap/Services/UserDelegationSasIssuer.cs`
- Create: `src/RoadTripMap/Services/AccountKeySasIssuer.cs`
- Modify: `src/RoadTripMap/Program.cs` (DI registration, issuer selection by config)

**Implementation:**

`UploadService` constructor injects: `RoadTripDbContext`, `BlobServiceClient`, `ISasTokenIssuer`, `ILogger<UploadService>`, `IOptions<UploadOptions>` (SAS TTL, max block size — defaults: 2h, 4 MiB).

`RequestUploadAsync`:
1. Look up trip by `secretToken`; 404 if not found.
2. Look up existing `photos` row by `UploadId`; if present and belongs to same trip, regenerate SAS and return existing `photo_id` (AC1.3 idempotency).
3. Create new row: `status='pending'`, `storage_tier='per-trip'`, `upload_id=...`, `last_activity_at=DateTime.UtcNow`, computed `BlobPath = "{photoId}_original.jpg"`.
4. Issue SAS via `ISasTokenIssuer.IssueWriteSasAsync("trip-{secretToken.ToLowerInvariant()}", blobPath, TimeSpan.FromHours(2))`.
5. Return `RequestUploadResponse`.

`CommitAsync`:
1. Load `photos` row by `photo_id`; 404 if not found or `TripId` doesn't match `tripToken` (AC1.6).
2. Call `BlobServiceClient.GetBlobContainerClient(...).GetBlockBlobClient(...)` then `GetBlockListAsync(BlockListTypes.Uncommitted)`.
3. Compare `request.BlockIds` to Azure's uncommitted-block IDs. If any requested block is missing, throw `BadHttpRequestException` with 400 and error body `{code: "BlockListMismatch", missing: [...]}` (AC1.4).
4. Call `CommitBlockListAsync(request.BlockIds)`.
5. Update row: `status='committed'`, `last_activity_at=UtcNow`.
6. Save and return `PhotoResponse` shaped identically to existing `GET /photos` endpoint output.

`AbortAsync`: delete row by `photo_id`+trip match; idempotent (no-op if missing).

`UserDelegationSasIssuer`: uses `BlobServiceClient.GetUserDelegationKeyAsync(UtcNow, UtcNow + ttl)` then `BlobSasBuilder { Resource="b", BlobContainerName=..., BlobName=..., StartsOn=UtcNow, ExpiresOn=UtcNow+ttl }` with `SetPermissions(BlobSasPermissions.Write)`. Return `new BlobUriBuilder(blobClient.Uri) { Sas = builder.ToSasQueryParameters(userDelegationKey, serviceClient.AccountName) }.ToUri()`.

`AccountKeySasIssuer`: uses `StorageSharedKeyCredential(accountName, key)` and the same `BlobSasBuilder` + `ToSasQueryParameters(credential)` path. For Azurite and local/test only.

DI in `Program.cs`:
```csharp
builder.Services.AddScoped<IUploadService, UploadService>();
if (builder.Configuration.GetValue<bool>("Blob:UseDevelopmentStorage"))
    builder.Services.AddScoped<ISasTokenIssuer, AccountKeySasIssuer>();
else
    builder.Services.AddScoped<ISasTokenIssuer, UserDelegationSasIssuer>();
builder.Services.Configure<UploadOptions>(builder.Configuration.GetSection("Upload"));
```

**Log sanitization:** never log `sasUrl` or full `blob_path` with token. Log `trip_token_prefix=<first 4 chars>`, `photo_id`, `block_count`.

**Verification:**

Run: `dotnet build RoadTripMap.sln`
Expected: No errors.

Manual smoke (after Task 15 endpoint wiring): not required here.

**Commit:** `feat(uploads): implement UploadService with user-delegation SAS`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: UploadService unit + integration tests

**Verifies:** AC1.1, AC1.2, AC1.3, AC1.4, AC1.5, AC1.6, AC1.7.

**Files:**
- Create: `tests/RoadTripMap.Tests/Services/UploadServiceTests.cs` (unit — in-memory EF, mock `ISasTokenIssuer`, mock `BlobServiceClient`/`BlockBlobClient` via Moq)
- Create: `tests/RoadTripMap.Tests/Infrastructure/AzuriteFixture.cs` (xUnit `IAsyncLifetime` starting Azurite via docker-compose)
- Create: `tests/docker-compose.azurite.yml`
- Create: `tests/RoadTripMap.Tests/Endpoints/UploadEndpointTests.cs` (integration — real Azurite + account-key SAS)

**Implementation:**

Unit tests cover:
- AC1.3: `RequestUploadAsync` with same `upload_id` returns identical `photo_id` and new SAS; the DB `photos` row count does not increase.
- AC1.4: `CommitAsync` where mocked `GetBlockListAsync` returns a subset of requested block IDs — service throws with 400 error body.
- AC1.6: `CommitAsync` where row's `TripId` mismatches token returns 404 `NotFound` / `Problem`.

Integration tests (Azurite) cover:
- AC1.1: full `request-upload → 4 PUT block → commit` round trip; verify blob exists with expected length; DB row `status='committed'`.
- AC1.2: batch of 20 photos concurrent request-upload + commit succeed (use `Parallel.ForEachAsync` with 5 concurrency). Verifies server-side does not deadlock or produce duplicate rows.
- AC1.5: issue SAS with 1-second TTL, sleep 2 seconds, PUT block expect 403 from Azurite.
- AC1.7: 15 MB synthetic buffer uploaded as 4× ~4 MB blocks; commit succeeds; `blob.Length == 15 MB`.

All tests run under `dotnet test RoadTripMap.sln`; Azurite fixture is scoped via `[CollectionDefinition(nameof(AzuriteCollection))]`.

**Verification:**

Run: `dotnet test RoadTripMap.sln --filter "FullyQualifiedName~UploadServiceTests|UploadEndpointTests"`
Expected: All new tests pass.

**Commit:** `test(uploads): UploadService unit + Azurite integration tests`
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-8) -->
## Subcomponent C: Blob container provisioner

<!-- START_TASK_6 -->
### Task 6: Define and implement IBlobContainerProvisioner

**Verifies:** AC2.5 (logic; tests in Task 8).

**Files:**
- Create: `src/RoadTripMap/Services/IBlobContainerProvisioner.cs`
- Create: `src/RoadTripMap/Services/BlobContainerProvisioner.cs`
- Modify: `src/RoadTripMap/Program.cs` (DI registration)

**Implementation:**

`IBlobContainerProvisioner`:
- `Task<string> EnsureContainerAsync(string secretToken, CancellationToken ct)` — returns container name.
- `Task DeleteContainerAsync(string secretToken, CancellationToken ct)`.

Container name: `"trip-" + secretToken.ToLowerInvariant()`.

Name validation: length 4–63, matches regex `^trip-[a-z0-9-]+$`, no consecutive dashes, no trailing dash. If invalid, throw `InvalidContainerNameException` (custom, derives from `ArgumentException`). Existing `secretToken` GUIDs produce valid names — defensive only (AC2.5).

Implementation calls `BlobServiceClient.GetBlobContainerClient(name).CreateIfNotExistsAsync(PublicAccessType.None, ct)`. Idempotent.

**Verification:**

Run: `dotnet build RoadTripMap.sln`
Expected: No errors.

**Commit:** `feat(uploads): blob container provisioner for per-trip containers`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Hook provisioner into trip-create and trip-delete endpoints

**Verifies:** AC2.1, AC2.4.

**Files:**
- Modify: `src/RoadTripMap/Program.cs` (existing `POST /api/trips` and `DELETE /api/trips/{secretToken}` handlers)

**Implementation:**

In the trip-create handler, after `db.SaveChangesAsync()` on the new trip row, call `await provisioner.EnsureContainerAsync(trip.SecretToken, ct)`.

In the trip-delete handler, before the final `SaveChanges`, enumerate existing legacy blobs (existing code path) and also call `await provisioner.DeleteContainerAsync(trip.SecretToken, ct)` for the per-trip container.

On provisioner failure during create, log and return 500 — do NOT roll back the trip row (design: container provisioning retried by a startup backfill if missed).

**Verification:**

Run existing trip endpoint tests: `dotnet test --filter "FullyQualifiedName~TripEndpointTests"` — must still pass.

**Commit:** `feat(trips): eagerly provision per-trip blob container on trip create`
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Backfill startup job + provisioner tests

**Verifies:** AC2.1, AC2.2, AC2.4, AC2.5.

**Files:**
- Create: `src/RoadTripMap/BackgroundJobs/ContainerBackfillHostedService.cs`
- Modify: `src/RoadTripMap/Program.cs` (register hosted service conditionally on `Backfill:RunOnStartup`)
- Create: `tests/RoadTripMap.Tests/Services/BlobContainerProvisionerTests.cs` (Azurite integration)

**Implementation:**

`ContainerBackfillHostedService` implements `IHostedService`. On `StartAsync`: if config `Backfill:RunOnStartup=true`, enumerate all trips and call `EnsureContainerAsync` for each, logging a single summary line. Idempotent by nature.

Tests cover: create-idempotent (AC2.2), delete (AC2.4), invalid name throws (AC2.5), fresh trip creates container (AC2.1).

**Verification:**

Run: `dotnet test --filter "FullyQualifiedName~BlobContainerProvisionerTests"`
Expected: Pass.

**Commit:** `feat(uploads): container backfill hosted service + provisioner tests`
<!-- END_TASK_8 -->
<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D (tasks 9-10) -->
## Subcomponent D: Dual-read photo service

<!-- START_TASK_9 -->
### Task 9: Implement IPhotoReadService dual-read logic

**Verifies:** AC2.3, AC2.6, ACX.3.

**Files:**
- Create: `src/RoadTripMap/Services/IPhotoReadService.cs`
- Create: `src/RoadTripMap/Services/PhotoReadService.cs`
- Modify: `src/RoadTripMap/Program.cs` — existing `GET /api/trips/{token}/photos` handler now delegates to `IPhotoReadService`.

**Implementation:**

`GetPhotosForTripAsync(string secretToken, CancellationToken ct) → Task<List<PhotoResponse>>`:
1. Look up trip by `secretToken`; 404 if not found.
2. Query `db.Photos.Where(p => p.TripId == trip.Id && p.Status == "committed")`.
3. For each row, compute blob URL base:
   - `storage_tier == "legacy"`: `"{blobPublicBase}/road-trip-photos/{TripId}/{Id}_display.jpg"` and `..._thumb.jpg` (existing scheme; keep existing code path).
   - `storage_tier == "per-trip"`: `"{blobPublicBase}/trip-{secretToken.ToLowerInvariant()}/{PhotoId}_display.jpg"` etc.
4. Return `PhotoResponse` list shaped identically to current handler output (no contract change for clients).

**Log sanitization:** no logging of blob URLs or token in this path.

**Verification:**

Run existing photo list tests: `dotnet test --filter "FullyQualifiedName~PhotoEndpointTests"` — must pass unchanged (legacy-only data round-trips identically).

**Commit:** `feat(photos): dual-read service for legacy + per-trip containers`
<!-- END_TASK_9 -->

<!-- START_TASK_10 -->
### Task 10: Dual-read tests

**Verifies:** AC2.3, AC2.6, ACX.3.

**Files:**
- Create: `tests/RoadTripMap.Tests/Services/PhotoReadServiceTests.cs`

**Implementation:**

Unit tests over in-memory EF Sqlite:
- Seed mixed trip: 2 legacy photos + 2 per-trip photos. Assert response contains 4 entries with correct URLs for each tier (AC2.3).
- Zero-photo trip: empty list, 200 OK (AC2.6).
- Snapshot compare an all-legacy response against a frozen JSON baseline to guard against regressions (ACX.3).

**Verification:**

Run: `dotnet test --filter "FullyQualifiedName~PhotoReadServiceTests"`
Expected: All pass.

**Commit:** `test(photos): dual-read PhotoReadService unit tests`
<!-- END_TASK_10 -->
<!-- END_SUBCOMPONENT_D -->

<!-- START_SUBCOMPONENT_E (tasks 11-12) -->
## Subcomponent E: Orphan sweeper

<!-- START_TASK_11 -->
### Task 11: OrphanSweeperHostedService

**Verifies:** AC6.1 (implementation; tests in Task 12).

**Files:**
- Create: `src/RoadTripMap/BackgroundJobs/OrphanSweeperHostedService.cs`
- Create: `src/RoadTripMap/BackgroundJobs/IOrphanSweeper.cs` + `OrphanSweeper.cs` (unit-testable core)
- Modify: `src/RoadTripMap/Program.cs` (DI + `AddHostedService<OrphanSweeperHostedService>()`)
- Modify: `src/RoadTripMap/appsettings.json` — add `"OrphanSweeper": { "IntervalHours": 1, "StaleThresholdHours": 48 }`

**Implementation:**

Keep the actual sweep logic as `OrphanSweeper.SweepAsync(DateTime utcNow, CancellationToken ct)` so tests can inject time (AC6.3 idempotence + time control).

Logic:
```
threshold = utcNow - StaleThresholdHours
query: db.Photos.Where(p => p.Status == "pending" && p.LastActivityAt != null && p.LastActivityAt < threshold)
delete all returned rows, log sanitized count
```

`OrphanSweeperHostedService` hosts `PeriodicTimer(TimeSpan.FromHours(IntervalHours))` calling `SweepAsync(DateTime.UtcNow)`. Respect cancellation.

**Verification:**

Run: `dotnet build RoadTripMap.sln`.

**Commit:** `feat(jobs): OrphanSweeper hosted service and core sweep logic`
<!-- END_TASK_11 -->

<!-- START_TASK_12 -->
### Task 12: OrphanSweeper tests

**Verifies:** AC6.1, AC6.2, AC6.3.

**Files:**
- Create: `tests/RoadTripMap.Tests/BackgroundJobs/OrphanSweeperTests.cs`

**Implementation:**

Against in-memory Sqlite seed:
- 1 row `status='pending'`, `last_activity_at = utcNow - 49h` → deleted (AC6.1).
- 1 row `status='pending'`, `last_activity_at = utcNow - 10h` → retained.
- 1 row `status='committed'`, `last_activity_at = utcNow - 365d` → retained (AC6.2).
- 1 row `status='failed'`, `last_activity_at = utcNow - 49h` → retained (design explicitly sweeps only `pending`).
- Run `SweepAsync` twice in a row; second pass deletes 0 rows; final state identical (AC6.3).

**Verification:**

Run: `dotnet test --filter "FullyQualifiedName~OrphanSweeperTests"`
Expected: All pass.

**Commit:** `test(jobs): OrphanSweeper unit tests covering AC6.1-AC6.3`
<!-- END_TASK_12 -->
<!-- END_SUBCOMPONENT_E -->

<!-- START_SUBCOMPONENT_F (tasks 13-14) -->
## Subcomponent F: Server version middleware

<!-- START_TASK_13 -->
### Task 13: Inline version middleware + /api/version endpoint

**Verifies:** AC8.1 (implementation; tests in Task 14).

**Files:**
- Create: `src/RoadTripMap/Versioning/ServerVersion.cs` (static holder reading assembly `InformationalVersion` + config `ClientProtocol:MinVersion`)
- Modify: `src/RoadTripMap/Program.cs` — inline `app.Use` middleware + `MapGet("/api/version", ...)`
- Modify: `src/RoadTripMap/appsettings.json` — add `"ClientProtocol": { "MinVersion": "1.0.0" }`

**Implementation:**

`ServerVersion.Current` = `Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0"`.
`ServerVersion.ClientMin` = config value (nullable-safe default `"1.0.0"`).

Middleware placed BEFORE the existing global exception handler so headers set before exception-response path writes:
```csharp
app.Use(async (context, next) =>
{
    context.Response.OnStarting(() =>
    {
        context.Response.Headers["x-server-version"] = ServerVersion.Current;
        context.Response.Headers["x-client-min-version"] = ServerVersion.ClientMin;
        return Task.CompletedTask;
    });
    await next();
});
```

(`OnStarting` is used because headers must be set before response body flushes; setting headers directly in the `app.Use` lambda fails if a handler has already started writing.)

`MapGet("/api/version")` returns `new { server_version = ServerVersion.Current, client_min_version = ServerVersion.ClientMin }`.

**Verification:**

Run: `dotnet run --project src/RoadTripMap` then `curl -i http://localhost:5000/api/version` — expect both headers in response.

**Commit:** `feat(version): server version middleware + /api/version endpoint`
<!-- END_TASK_13 -->

<!-- START_TASK_14 -->
### Task 14: Version middleware tests

**Verifies:** AC8.1.

**Files:**
- Create: `tests/RoadTripMap.Tests/Middleware/ServerVersionMiddlewareTests.cs`

**Implementation:**

Using `WebApplicationFactory`:
- GET `/api/version`: response body matches; both headers present.
- GET `/api/trips/nonexistent-token/photos` (404 path): both headers present on error response.
- GET `/api/version` when `ClientProtocol:MinVersion` is unset: header value = `"1.0.0"` (default).
- Header values are consistent across 10 rapid requests.

**Verification:**

Run: `dotnet test --filter "FullyQualifiedName~ServerVersionMiddlewareTests"`
Expected: Pass.

**Commit:** `test(version): server version middleware integration tests`
<!-- END_TASK_14 -->
<!-- END_SUBCOMPONENT_F -->

<!-- START_SUBCOMPONENT_G (tasks 15-16) -->
## Subcomponent G: Upload endpoints wiring

<!-- START_TASK_15 -->
### Task 15: MapUploadEndpoints extension

**Verifies:** AC1.1, AC1.3, AC1.4, AC1.6 (surfaces service behavior at HTTP layer).

**Files:**
- Create: `src/RoadTripMap/Endpoints/UploadEndpoints.cs`
- Modify: `src/RoadTripMap/Program.cs` — call `app.MapUploadEndpoints()`

**Implementation:**

Static class exposing `public static WebApplication MapUploadEndpoints(this WebApplication app)` mapping:
- `POST /api/trips/{token}/photos/request-upload` → validates token (existing `TripTokenValidator`), deserializes `RequestUploadRequest`, delegates to `IUploadService.RequestUploadAsync`, returns 200 with `RequestUploadResponse`.
- `POST /api/trips/{token}/photos/{photoId:guid}/commit` → delegates to `IUploadService.CommitAsync`, 200 + `PhotoResponse`, 400 on block mismatch (AC1.4), 404 on cross-trip photo (AC1.6).
- `POST /api/trips/{token}/photos/{photoId:guid}/abort` → delegates to `IUploadService.AbortAsync`, 204.

Rate-limit and CORS follow existing endpoint conventions in `Program.cs`.

**Verification:**

Run: `dotnet build RoadTripMap.sln`.

**Commit:** `feat(uploads): expose request-upload/commit/abort minimal-API endpoints`
<!-- END_TASK_15 -->

<!-- START_TASK_16 -->
### Task 16: End-to-end upload endpoint integration tests

**Verifies:** AC1.1, AC1.2, AC1.3, AC1.4, AC1.5, AC1.6, AC1.7, AC8.1 (headers on upload responses), ACX.1 (log sanitization).

**Files:**
- Create or extend: `tests/RoadTripMap.Tests/Endpoints/UploadEndpointTests.cs`

**Implementation:**

`WebApplicationFactory` with Azurite via `AzuriteFixture` and account-key SAS issuer. Seed a test trip via the existing factory helper.

Scenarios:
- Happy path (AC1.1): call `request-upload`, PUT 4 real blocks to returned SAS, call `commit`, assert 200 + `PhotoResponse`, assert DB row `status='committed'`, assert blob exists in Azurite with expected length.
- Batch of 20 photos (AC1.2): `Parallel.ForEachAsync` with 5 concurrency.
- Idempotency (AC1.3): repeat `request-upload` with same `upload_id` → same `photo_id`, only one row in DB.
- Block mismatch (AC1.4): call `commit` with a fake block ID → 400 with `BlockListMismatch` body.
- Expired SAS (AC1.5): issue with 1-second TTL, wait 2 s, PUT → 403 from Azurite.
- Cross-trip (AC1.6): create two trips; call `commit` on trip B with photo_id from trip A → 404.
- 15 MB (AC1.7): upload synthetic 15 MB buffer as 4 blocks, commit, blob length = 15 MB.
- Log sanitization (ACX.1): capture logs during full round-trip, assert no log record contains the SAS URL, blob path segments, or GPS coordinates.

**Verification:**

Run: `dotnet test --filter "FullyQualifiedName~UploadEndpointTests"`
Expected: All scenarios pass. Azurite container logs clean on teardown.

**Commit:** `test(uploads): end-to-end upload endpoint + Azurite integration tests`
<!-- END_TASK_16 -->
<!-- END_SUBCOMPONENT_G -->

<!-- START_SUBCOMPONENT_H (task 17) -->
## Subcomponent H: Bicep role assignment

<!-- START_TASK_17 -->
### Task 17: Add Storage Blob Data Contributor to App Service MSI

**Verifies:** None directly — production enablement; verified via deployment runbook.

**Files:**
- Modify: `infrastructure/azure/main.bicep`

**Implementation:**

Add a role-assignment resource on the existing `storageAccount` scope for `appService.identity.principalId`, role definition ID `ba92f5b4-2d11-453d-a403-e96b0029c9fe` (Storage Blob Data Contributor). Named via `guid(resourceGroup().id, storageAccount.name, appService.name, 'blob-contributor')` for idempotent naming.

Follow existing role-assignment patterns in `main.bicep` lines 161–194 (Key Vault Secrets User).

Respect hooks:
- `infra_commit_checklist.py` — may require checklist marker comment in commit message.
- `azure_sp_identity_guard.py` — must run `az deployment` as the allowed SP in `.claude/azure-identity.json`.
- `bicep_infra_task_guard.py` — this phase file references Bicep changes and IS the corresponding task. No bypass needed.

**Verification:**

Run (from WSL bash, after `az login` as the road-trip deployment SP):
`az deployment group create --resource-group <rg> --template-file infrastructure/azure/main.bicep --parameters @infrastructure/azure/main.parameters.json --what-if`
Expected: `+ Microsoft.Authorization/roleAssignments` showing Storage Blob Data Contributor on `storageAccount` scope to App Service principal, no other changes.

Actual apply is gated on the deployment runbook (Task 18) and happens at deploy time, not during CI.

**Commit:** `feat(infra): grant App Service MSI Storage Blob Data Contributor`
<!-- END_TASK_17 -->
<!-- END_SUBCOMPONENT_H -->

<!-- START_SUBCOMPONENT_I (task 18) -->
## Subcomponent I: Deployment runbook

<!-- START_TASK_18 -->
### Task 18: Author deployment-runbook.md for Phase 1

**Verifies:** None directly — gates Definition of Done per Patrick's feedback memory (see `feedback_deployment_runbook.md`).

**Files:**
- Create: `docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md`

**Implementation:**

Runbook must contain the following sections, each step labeled with the required shell in brackets (`[bash/WSL]`, `[Windows PowerShell]`, `[Azure Portal]`, `[GitHub web]`):

1. **Pre-flight**
   - `[Azure Portal | bash/WSL]` Confirm `.claude/azure-identity.json` matches the SP you'll deploy as; `az account show` in the shell you'll use.
   - `[GitHub web]` Confirm PR is merged to `main` and CI is green.
   - `[bash/WSL]` `git fetch origin && git log origin/main..develop --oneline` — must be empty.

2. **DB migration**
   - `[bash/WSL]` Pull prod connection string: `az keyvault secret show --vault-name kv-roadtripmap-prod --name RoadTripDbConnection --query value -o tsv`.
   - `[bash/WSL]` Apply: `dotnet ef database update --project src/RoadTripMap --startup-project src/RoadTripMap --connection "<prod-conn>"`.
   - Verify columns present: `sqlcmd -S <host> -d RoadTripMap -Q "SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('roadtrip.Photos') AND name IN ('Status','StorageTier','UploadId','LastActivityAt','UploadAttemptCount')"` — expect 5 rows.
   - Rollback: `dotnet ef database update <previous-migration-name> --connection "<prod-conn>"`.

3. **Bicep deploy**
   - `[bash/WSL]` What-if: `az deployment group create --resource-group <rg> --template-file infrastructure/azure/main.bicep --parameters @infrastructure/azure/main.parameters.json --what-if`. Review diff: must show exactly one new `Microsoft.Authorization/roleAssignments` resource.
   - `[bash/WSL]` Apply (remove `--what-if`).
   - `[Azure Portal]` Navigate to Storage Account → IAM → confirm App Service MSI has Storage Blob Data Contributor.
   - If `az login` requires MFA on this machine: `[Windows PowerShell]` `az login` there instead, then proceed from WSL after the refresh token propagates.

4. **App Service deploy**
   - `[GitHub web]` Trigger workflow (auto on merge to `main`, or manual dispatch of `deploy-roadtripmap-prod.yml`).
   - `[GitHub web]` Wait for green; link to workflow run.
   - `[bash/WSL]` `curl -i https://<prod-url>/api/version` — expect `x-server-version` matching the new build's assembly version and `x-client-min-version`.

5. **Container backfill**
   - `[bash/WSL]` Set `Backfill:RunOnStartup=true` via App Service config (or one-shot `az webapp config appsettings set ...`). Restart. Watch logs for `ContainerBackfillHostedService` summary line.
   - `[bash/WSL]` Verify: `az storage container list --account-name <acct> --auth-mode login --query "[?starts_with(name, 'trip-')].name" -o tsv | wc -l` — count equals number of trips in DB.
   - `[bash/WSL]` Clear `Backfill:RunOnStartup` and restart.

6. **Post-deploy smoke**
   - Existing-trip regression: `curl https://<prod-url>/api/trips/<real-token>/photos` — compare photo count to pre-deploy baseline.
   - New-upload round trip: create test trip, call `request-upload`, PUT one block to returned SAS via `curl --upload-file ...?comp=block&blockid=...`, call `commit`, GET photos, expect new photo.
   - Orphan sweeper: tail logs; within 1 hour see `OrphanSweeperHostedService: swept N rows`.

7. **Rollback**
   - Revert App Service deploy slot (existing blue/green pattern).
   - Revert Bicep: `az deployment group create ... --template-file <previous> ...` (the old role assignment remains harmless).
   - Revert EF migration per step 2.

8. **Sign-off**
   - Patrick initials + UTC timestamp per section.

**Verification:**

Runbook is reviewed by Patrick before Task 17 Bicep apply. During deploy, every step is executed in order; deviations are annotated directly into the runbook document and committed as an amendment.

**Commit:** `docs(uploads): deployment runbook for resilient-uploads Phase 1`
<!-- END_TASK_18 -->
<!-- END_SUBCOMPONENT_I -->

---

## Phase 1 Done When

- All 18 tasks committed.
- `dotnet test RoadTripMap.sln` green including new Azurite-backed integration tests.
- `az deployment group create --what-if` on `main.bicep` shows only the expected Storage Blob Data Contributor role addition.
- `curl /api/version` in local dev returns body + both headers.
- Deployment runbook at `docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md` is complete, every step reviewed, and a dry-run in staging (if available) has been executed.
- No regression in existing photo-list endpoint: `GET /api/trips/{token}/photos` for any pre-existing trip returns the same payload shape and count as before the deploy.
