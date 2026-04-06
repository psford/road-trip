using Microsoft.EntityFrameworkCore;
using RoadTripMap.Entities;

namespace RoadTripMap.Data;

public class RoadTripDbContext : DbContext
{
    public RoadTripDbContext(DbContextOptions<RoadTripDbContext> options) : base(options) { }

    public DbSet<TripEntity> Trips => Set<TripEntity>();
    public DbSet<PhotoEntity> Photos => Set<PhotoEntity>();
    public DbSet<GeoCacheEntity> GeoCache => Set<GeoCacheEntity>();
    public DbSet<PoiEntity> PointsOfInterest => Set<PoiEntity>();
    public DbSet<ParkBoundaryEntity> ParkBoundaries => Set<ParkBoundaryEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("roadtrip");

        modelBuilder.Entity<TripEntity>(entity =>
        {
            entity.ToTable("Trips");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Slug).HasMaxLength(200).IsRequired();
            entity.HasIndex(e => e.Slug).IsUnique();
            entity.Property(e => e.Name).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(2000);
            entity.Property(e => e.SecretToken).HasMaxLength(36).IsRequired();
            entity.HasIndex(e => e.SecretToken).IsUnique();
            entity.Property(e => e.ViewToken).HasMaxLength(36).IsRequired();
            entity.HasIndex(e => e.ViewToken).IsUnique();
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("GETUTCDATE()");
            entity.Property(e => e.IsActive).HasDefaultValue(true);
        });

        modelBuilder.Entity<PhotoEntity>(entity =>
        {
            entity.ToTable("Photos");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.BlobPath).HasMaxLength(500).IsRequired();
            entity.Property(e => e.PlaceName).HasMaxLength(500);
            entity.Property(e => e.Caption).HasMaxLength(1000);
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("GETUTCDATE()");
            entity.HasOne(e => e.Trip)
                  .WithMany(t => t.Photos)
                  .HasForeignKey(e => e.TripId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<GeoCacheEntity>(entity =>
        {
            entity.ToTable("GeoCache");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.PlaceName).HasMaxLength(500).IsRequired();
            entity.Property(e => e.CachedAt).HasDefaultValueSql("GETUTCDATE()");
            entity.HasIndex(e => new { e.LatRounded, e.LngRounded }).IsUnique();
        });

        modelBuilder.Entity<PoiEntity>(entity =>
        {
            entity.ToTable("PointsOfInterest");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(300).IsRequired();
            entity.Property(e => e.Category).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Source).HasMaxLength(50).IsRequired();
            entity.Property(e => e.SourceId).HasMaxLength(200);
            entity.HasIndex(e => new { e.Latitude, e.Longitude });
            entity.HasIndex(e => e.SourceId);
            entity.HasIndex(e => e.Category);
        });

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
    }
}
