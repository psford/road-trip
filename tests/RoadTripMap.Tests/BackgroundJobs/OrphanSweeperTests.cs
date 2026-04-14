using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using RoadTripMap.BackgroundJobs;
using RoadTripMap.Data;
using RoadTripMap.Entities;

namespace RoadTripMap.Tests.BackgroundJobs;

public class OrphanSweeperTests
{
    private RoadTripDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new RoadTripDbContext(options);
    }

    private IConfiguration CreateTestConfiguration()
    {
        var configDict = new Dictionary<string, string?>
        {
            { "OrphanSweeper:StaleThresholdHours", "48" }
        };
        return new ConfigurationBuilder()
            .AddInMemoryCollection(configDict)
            .Build();
    }

    [Fact]
    public async Task SweepAsync_DeletesStalePhotosWith_pending_Status_AndLastActivityAtThresholdExceeded()
    {
        // Arrange - AC6.1: Delete pending rows older than threshold
        using var context = CreateInMemoryContext();

        var utcNow = DateTime.UtcNow;
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString()
        };
        context.Trips.Add(trip);
        await context.SaveChangesAsync();

        // 5 test rows as specified in phase file
        // Row 1: status='pending', last_activity_at = utcNow - 49h → DELETED (exceeds 48h threshold)
        var stalePhoto = new PhotoEntity
        {
            TripId = trip.Id,
            BlobPath = "stale_original.jpg",
            Status = "pending",
            StorageTier = "per-trip",
            LastActivityAt = utcNow.AddHours(-49),
            Latitude = 40.0,
            Longitude = -105.0
        };
        context.Photos.Add(stalePhoto);

        // Row 2: status='pending', last_activity_at = utcNow - 10h → RETAINED (within 48h threshold)
        var freshPhoto = new PhotoEntity
        {
            TripId = trip.Id,
            BlobPath = "fresh_original.jpg",
            Status = "pending",
            StorageTier = "per-trip",
            LastActivityAt = utcNow.AddHours(-10),
            Latitude = 40.1,
            Longitude = -105.1
        };
        context.Photos.Add(freshPhoto);

        // Row 3: status='committed', last_activity_at = utcNow - 365d → RETAINED (AC6.2: not pending)
        var committedOldPhoto = new PhotoEntity
        {
            TripId = trip.Id,
            BlobPath = "committed_old_original.jpg",
            Status = "committed",
            StorageTier = "per-trip",
            LastActivityAt = utcNow.AddDays(-365),
            Latitude = 40.2,
            Longitude = -105.2
        };
        context.Photos.Add(committedOldPhoto);

        // Row 4: status='failed', last_activity_at = utcNow - 49h → RETAINED (AC6.2: not pending)
        var failedPhoto = new PhotoEntity
        {
            TripId = trip.Id,
            BlobPath = "failed_original.jpg",
            Status = "failed",
            StorageTier = "per-trip",
            LastActivityAt = utcNow.AddHours(-49),
            Latitude = 40.3,
            Longitude = -105.3
        };
        context.Photos.Add(failedPhoto);

        // Row 5: no LastActivityAt → RETAINED (null safety)
        var nullActivityPhoto = new PhotoEntity
        {
            TripId = trip.Id,
            BlobPath = "null_activity_original.jpg",
            Status = "pending",
            StorageTier = "per-trip",
            LastActivityAt = null,
            Latitude = 40.4,
            Longitude = -105.4
        };
        context.Photos.Add(nullActivityPhoto);

        await context.SaveChangesAsync();

        var mockLogger = new Mock<ILogger<OrphanSweeper>>();
        var config = CreateTestConfiguration();
        var sweeper = new OrphanSweeper(context, mockLogger.Object, config);

        // Act - Sweep with 48h threshold
        var staleThresholdHours = 48;
        var threshold = utcNow.AddHours(-staleThresholdHours);
        var deletedCount = await sweeper.SweepAsync(utcNow, CancellationToken.None);

        // Assert - AC6.1: Only stalePhoto should be deleted (1 row)
        deletedCount.Should().Be(1);

        var remainingPhotos = await context.Photos.ToListAsync();
        remainingPhotos.Should().HaveCount(4);
        remainingPhotos.Should().NotContain(p => p.Id == stalePhoto.Id);
        remainingPhotos.Should().Contain(p => p.Id == freshPhoto.Id);
        remainingPhotos.Should().Contain(p => p.Id == committedOldPhoto.Id);
        remainingPhotos.Should().Contain(p => p.Id == failedPhoto.Id);
        remainingPhotos.Should().Contain(p => p.Id == nullActivityPhoto.Id);
    }

    [Fact]
    public async Task SweepAsync_RetainsPhotosWithNullLastActivityAt()
    {
        // Arrange - AC6.2: null LastActivityAt rows are retained
        using var context = CreateInMemoryContext();

        var utcNow = DateTime.UtcNow;
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString()
        };
        context.Trips.Add(trip);
        await context.SaveChangesAsync();

        var pendingNoActivity = new PhotoEntity
        {
            TripId = trip.Id,
            BlobPath = "pending_no_activity_original.jpg",
            Status = "pending",
            StorageTier = "per-trip",
            LastActivityAt = null,
            Latitude = 40.0,
            Longitude = -105.0
        };
        context.Photos.Add(pendingNoActivity);
        await context.SaveChangesAsync();

        var mockLogger = new Mock<ILogger<OrphanSweeper>>();
        var config = CreateTestConfiguration();
        var sweeper = new OrphanSweeper(context, mockLogger.Object, config);

        // Act
        var deletedCount = await sweeper.SweepAsync(utcNow, CancellationToken.None);

        // Assert
        deletedCount.Should().Be(0);
        var photos = await context.Photos.ToListAsync();
        photos.Should().HaveCount(1);
        photos[0].Id.Should().Be(pendingNoActivity.Id);
    }

    [Fact]
    public async Task SweepAsync_IsIdempotent_SecondSweepDeletesZeroRows()
    {
        // Arrange - AC6.3: Running sweep twice leaves state identical
        using var context = CreateInMemoryContext();

        var utcNow = DateTime.UtcNow;
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString()
        };
        context.Trips.Add(trip);
        await context.SaveChangesAsync();

        var stalePhoto = new PhotoEntity
        {
            TripId = trip.Id,
            BlobPath = "stale_original.jpg",
            Status = "pending",
            StorageTier = "per-trip",
            LastActivityAt = utcNow.AddHours(-49),
            Latitude = 40.0,
            Longitude = -105.0
        };
        context.Photos.Add(stalePhoto);

        var freshPhoto = new PhotoEntity
        {
            TripId = trip.Id,
            BlobPath = "fresh_original.jpg",
            Status = "pending",
            StorageTier = "per-trip",
            LastActivityAt = utcNow.AddHours(-10),
            Latitude = 40.1,
            Longitude = -105.1
        };
        context.Photos.Add(freshPhoto);
        await context.SaveChangesAsync();

        var mockLogger = new Mock<ILogger<OrphanSweeper>>();
        var config = CreateTestConfiguration();
        var sweeper = new OrphanSweeper(context, mockLogger.Object, config);

        // Act - First sweep
        var firstDeleteCount = await sweeper.SweepAsync(utcNow, CancellationToken.None);
        var afterFirstSweep = await context.Photos.ToListAsync();

        // Act - Second sweep (same utcNow, so same threshold)
        var secondDeleteCount = await sweeper.SweepAsync(utcNow, CancellationToken.None);
        var afterSecondSweep = await context.Photos.ToListAsync();

        // Assert - First sweep deletes 1 row
        firstDeleteCount.Should().Be(1);
        afterFirstSweep.Should().HaveCount(1);

        // Assert - Second sweep deletes 0 rows (idempotent)
        secondDeleteCount.Should().Be(0);
        afterSecondSweep.Should().HaveCount(1);

        // Assert - State unchanged after second sweep
        afterFirstSweep.Should().Equal(afterSecondSweep);
        afterSecondSweep[0].Id.Should().Be(freshPhoto.Id);
    }
}
