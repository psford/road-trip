# State Park Boundaries Implementation Plan — Phase 1

**Goal:** Create `ParkBoundaries` table with EF Core migration

**Architecture:** New `ParkBoundaryEntity` POCO with bbox float columns (indexed for viewport queries) and three `nvarchar(max)` GeoJSON text columns at different simplification levels. Follows existing entity/DbContext patterns from `PoiEntity`.

**Tech Stack:** C# / .NET 8.0 / EF Core 8.0.23 / SQL Server

**Scope:** Phase 1 of 6 from original design

**Codebase verified:** 2026-04-05

---

## Acceptance Criteria Coverage

This phase is infrastructure (schema creation). It does not implement or test acceptance criteria directly.

**Verifies:** None — verified operationally (migration applies, table exists with correct schema and indexes).

---

<!-- START_TASK_1 -->
### Task 1: Create ParkBoundaryEntity

**Files:**
- Create: `src/RoadTripMap/Entities/ParkBoundaryEntity.cs`

**Step 1: Create the entity file**

Follow the existing entity pattern from `PoiEntity.cs` — file-scoped namespace, simple POCO, `required` keyword for non-nullable reference types, `double` for coordinates.

```csharp
namespace RoadTripMap.Entities;

public class ParkBoundaryEntity
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public required string State { get; set; }
    public required string Category { get; set; }
    public int GisAcres { get; set; }
    public double CentroidLat { get; set; }
    public double CentroidLng { get; set; }
    public double MinLat { get; set; }
    public double MaxLat { get; set; }
    public double MinLng { get; set; }
    public double MaxLng { get; set; }
    public required string GeoJsonFull { get; set; }
    public required string GeoJsonModerate { get; set; }
    public required string GeoJsonSimplified { get; set; }
    public required string Source { get; set; }
    public string? SourceId { get; set; }
}
```

**Step 2: Verify the file compiles**

Run:
```bash
cd /home/patrick/projects/road-trip && dotnet build src/RoadTripMap/RoadTripMap.csproj
```
Expected: Build succeeds with no errors.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Register DbSet and configure entity in DbContext

**Files:**
- Modify: `src/RoadTripMap/Data/RoadTripDbContext.cs`

**Step 1: Add DbSet property and fluent configuration**

Add the DbSet property alongside the existing ones (after `PointsOfInterest`):

```csharp
public DbSet<ParkBoundaryEntity> ParkBoundaries => Set<ParkBoundaryEntity>();
```

Add the entity configuration in `OnModelCreating`, after the existing `PoiEntity` configuration block. Follow the same pattern — `ToTable()` for table name, `HasMaxLength()` for string columns, `HasIndex()` for query indexes:

```csharp
modelBuilder.Entity<ParkBoundaryEntity>(entity =>
{
    entity.ToTable("ParkBoundaries");
    entity.HasKey(e => e.Id);

    entity.Property(e => e.Name).HasMaxLength(300).IsRequired();
    entity.Property(e => e.State).HasMaxLength(2).IsRequired();
    entity.Property(e => e.Category).HasMaxLength(50).IsRequired();
    entity.Property(e => e.Source).HasMaxLength(50).IsRequired();
    entity.Property(e => e.SourceId).HasMaxLength(200);

    // Composite index on bbox columns for viewport queries
    entity.HasIndex(e => new { e.MinLat, e.MaxLat, e.MinLng, e.MaxLng });

    // Index on GisAcres for sorting (largest parks first)
    entity.HasIndex(e => e.GisAcres);

    // Index on SourceId for upsert/dedup during import
    entity.HasIndex(e => e.SourceId);
});
```

Add the `using` directive at the top of the file if not already present:

```csharp
using RoadTripMap.Entities;
```

**Step 2: Verify the project compiles**

Run:
```bash
cd /home/patrick/projects/road-trip && dotnet build src/RoadTripMap/RoadTripMap.csproj
```
Expected: Build succeeds with no errors.

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Generate and apply EF Core migration

**Files:**
- Create: `src/RoadTripMap/Migrations/<timestamp>_AddParkBoundaries.cs` (auto-generated)
- Create: `src/RoadTripMap/Migrations/<timestamp>_AddParkBoundaries.Designer.cs` (auto-generated)
- Modify: `src/RoadTripMap/Migrations/RoadTripDbContextModelSnapshot.cs` (auto-updated)

**Step 1: Generate the migration**

Run:
```bash
cd /home/patrick/projects/road-trip && dotnet ef migrations add AddParkBoundaries --project src/RoadTripMap/RoadTripMap.csproj
```
Expected: Migration files created in `src/RoadTripMap/Migrations/` with naming pattern `YYYYMMDDHHmmss_AddParkBoundaries.cs`.

**Step 2: Review the generated migration**

Open the generated migration file and verify it contains:
- `CreateTable` with schema `"roadtrip"` and table name `"ParkBoundaries"`
- All 16 columns with correct types (`int`, `float`, `nvarchar(300)`, `nvarchar(max)`, etc.)
- Primary key on `Id` with identity
- Three indexes: composite `(MinLat, MaxLat, MinLng, MaxLng)`, single `GisAcres`, single `SourceId`
- `Down()` method drops the table

**Step 3: Verify the full solution builds**

Run:
```bash
cd /home/patrick/projects/road-trip && dotnet build RoadTripMap.sln
```
Expected: Entire solution builds successfully including test project.

**Step 4: Run existing tests to verify no regressions**

Run:
```bash
cd /home/patrick/projects/road-trip && dotnet test RoadTripMap.sln --configuration Release --no-build
```
Expected: All existing tests pass. The new entity/DbSet should not affect existing tests.

**Step 5: Commit**

```bash
git add src/RoadTripMap/Entities/ParkBoundaryEntity.cs src/RoadTripMap/Data/RoadTripDbContext.cs src/RoadTripMap/Migrations/
git commit -m "feat: add ParkBoundaries table schema and EF Core migration"
```

<!-- END_TASK_3 -->
