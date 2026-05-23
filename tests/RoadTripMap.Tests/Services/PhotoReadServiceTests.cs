using FluentAssertions;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Models;
using RoadTripMap.Services;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RoadTripMap.Tests.Services;

public class PhotoReadServiceTests
{
    private RoadTripDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new RoadTripDbContext(options);
    }

    private PhotoReadService CreateService(RoadTripDbContext db)
    {
        var logger = new Microsoft.Extensions.Logging.Abstractions.NullLogger<PhotoReadService>();
        return new PhotoReadService(db, logger);
    }

    [Fact]
    public async Task GetPhotosForTripAsync_WithMixedLegacyAndPerTripPhotos_ReturnsAllPhotosWithCorrectUrls()
    {
        // Arrange
        using var db = CreateInMemoryContext();
        var service = CreateService(db);

        var secretToken = "mixed-trip-secret"; // pragma: allowlist secret
        var trip = new TripEntity
        {
            Slug = "mixed-trip",
            Name = "Mixed Trip",
            SecretToken = secretToken,
            ViewToken = Guid.NewGuid().ToString()
        };
        await db.Trips.AddAsync(trip);
        await db.SaveChangesAsync();

        // Add 2 legacy photos
        var legacyPhoto1 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            PlaceName = "New York",
            Caption = "Legacy Photo 1",
            TakenAt = DateTime.UtcNow.AddHours(-2),
            BlobPath = "1/1.jpg",
            Status = "committed",
            StorageTier = "legacy",
            UploadId = Guid.NewGuid()
        };
        var legacyPhoto2 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 34.0522,
            Longitude = -118.2437,
            PlaceName = "Los Angeles",
            Caption = "Legacy Photo 2",
            TakenAt = DateTime.UtcNow.AddHours(-1),
            BlobPath = "1/2.jpg",
            Status = "committed",
            StorageTier = "legacy",
            UploadId = Guid.NewGuid()
        };
        await db.Photos.AddRangeAsync(legacyPhoto1, legacyPhoto2);
        await db.SaveChangesAsync();

        // Add 2 per-trip photos
        var perTripPhoto1 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 37.7749,
            Longitude = -122.4194,
            PlaceName = "San Francisco",
            Caption = "Per-trip Photo 1",
            TakenAt = DateTime.UtcNow,
            BlobPath = "ignored-for-per-trip",
            Status = "committed",
            StorageTier = "per-trip",
            UploadId = Guid.NewGuid()
        };
        var perTripPhoto2 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 47.6062,
            Longitude = -122.3321,
            PlaceName = "Seattle",
            Caption = "Per-trip Photo 2",
            TakenAt = DateTime.UtcNow.AddHours(1),
            BlobPath = "ignored-for-per-trip",
            Status = "committed",
            StorageTier = "per-trip",
            UploadId = Guid.NewGuid()
        };
        await db.Photos.AddRangeAsync(perTripPhoto1, perTripPhoto2);
        await db.SaveChangesAsync();

        // Act
        var photos = await service.GetPhotosForTripAsync(secretToken, CancellationToken.None);

        // Assert
        photos.Should().HaveCount(4);

        // Verify all photos use API proxy URL scheme (regardless of storage tier)
        photos.Should().AllSatisfy(p =>
        {
            p.ThumbnailUrl.Should().StartWith($"/api/photos/{trip.Id}/");
            p.DisplayUrl.Should().StartWith($"/api/photos/{trip.Id}/");
            p.OriginalUrl.Should().StartWith($"/api/photos/{trip.Id}/");
        });

        // Verify chronological ordering (by TakenAt ascending; in this fixture every
        // photo has a TakenAt, so the COALESCE fallback to CreatedAt is irrelevant here).
        var nonNullPhotos = photos.Where(p => p.TakenAt.HasValue).ToList();
        if (nonNullPhotos.Count > 1)
        {
            for (int i = 0; i < nonNullPhotos.Count - 1; i++)
            {
                (nonNullPhotos[i].TakenAt <= nonNullPhotos[i + 1].TakenAt).Should().BeTrue();
            }
        }

        // Verify metadata preserved
        var nyPhoto = photos.First(p => p.PlaceName == "New York");
        nyPhoto.Caption.Should().Be("Legacy Photo 1");
        nyPhoto.Lat.Should().Be(40.7128);
        nyPhoto.Lng.Should().Be(-74.0060);
    }

    [Fact]
    public async Task GetPhotosForTripAsync_WithZeroPhotos_ReturnsEmptyList()
    {
        // Arrange
        using var db = CreateInMemoryContext();
        var service = CreateService(db);

        var secretToken = "empty-trip-secret"; // pragma: allowlist secret
        var trip = new TripEntity
        {
            Slug = "empty-trip",
            Name = "Empty Trip",
            SecretToken = secretToken,
            ViewToken = Guid.NewGuid().ToString()
        };
        await db.Trips.AddAsync(trip);
        await db.SaveChangesAsync();

        // Act
        var photos = await service.GetPhotosForTripAsync(secretToken, CancellationToken.None);

        // Assert
        photos.Should().BeEmpty();
    }

    [Fact]
    public async Task GetPhotosForTripAsync_WithInvalidToken_ThrowsKeyNotFoundException()
    {
        // Arrange
        using var db = CreateInMemoryContext();
        var service = CreateService(db);

        // Act & Assert
        var exception = await Assert.ThrowsAsync<KeyNotFoundException>(
            () => service.GetPhotosForTripAsync("nonexistent-token", CancellationToken.None)
        );
        exception.Message.Should().Contain("Trip not found");
    }

    [Fact]
    public async Task GetPhotosForTripAsync_WithLegacyOnlyPhotos_MatchesSnapshot()
    {
        // Arrange
        using var db = CreateInMemoryContext();
        var service = CreateService(db);

        var secretToken = "legacy-only-secret"; // pragma: allowlist secret
        var trip = new TripEntity
        {
            Slug = "legacy-trip",
            Name = "Legacy Trip",
            SecretToken = secretToken,
            ViewToken = Guid.NewGuid().ToString()
        };
        await db.Trips.AddAsync(trip);
        await db.SaveChangesAsync();

        // Seed 2 legacy photos with deterministic data
        var photo1TakenAt = new DateTime(2026, 1, 15, 10, 30, 0, DateTimeKind.Utc);
        var photo2TakenAt = new DateTime(2026, 1, 15, 14, 45, 0, DateTimeKind.Utc);

        var photo1 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            PlaceName = "New York",
            Caption = "Empire State Building",
            TakenAt = photo1TakenAt,
            BlobPath = "1/1.jpg",
            Status = "committed",
            StorageTier = "legacy",
            UploadId = Guid.NewGuid()
        };
        var photo2 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 34.0522,
            Longitude = -118.2437,
            PlaceName = "Los Angeles",
            Caption = null,
            TakenAt = photo2TakenAt,
            BlobPath = "1/2.jpg",
            Status = "committed",
            StorageTier = "legacy",
            UploadId = Guid.NewGuid()
        };
        await db.Photos.AddRangeAsync(photo1, photo2);
        await db.SaveChangesAsync();

        // Act
        var photos = await service.GetPhotosForTripAsync(secretToken, CancellationToken.None);

        // Serialize to JSON for snapshot comparison
        var jsonOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
        var json = JsonSerializer.Serialize(photos, jsonOptions);

        // Assert against baseline snapshot to guard against regressions
        var snapshotPath = Path.Combine(AppContext.BaseDirectory, "Services", "Snapshots", "PhotoReadService_LegacyOnly.json");
        var expectedJson = File.ReadAllText(snapshotPath);
        json.Should().Be(expectedJson);
    }

    [Fact]
    public async Task GetPhotosForTripAsync_IgnoresPendingAndFailedPhotos()
    {
        // Arrange
        using var db = CreateInMemoryContext();
        var service = CreateService(db);

        var secretToken = "mixed-status-secret"; // pragma: allowlist secret
        var trip = new TripEntity
        {
            Slug = "mixed-status-trip",
            Name = "Mixed Status Trip",
            SecretToken = secretToken,
            ViewToken = Guid.NewGuid().ToString()
        };
        await db.Trips.AddAsync(trip);
        await db.SaveChangesAsync();

        // Add photos with different statuses
        var committedPhoto = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            PlaceName = "New York",
            Caption = "Committed",
            TakenAt = DateTime.UtcNow,
            BlobPath = "1/1.jpg",
            Status = "committed",
            StorageTier = "legacy",
            UploadId = Guid.NewGuid()
        };
        var pendingPhoto = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 34.0522,
            Longitude = -118.2437,
            PlaceName = "Los Angeles",
            Caption = "Pending",
            TakenAt = DateTime.UtcNow,
            BlobPath = "1/2.jpg",
            Status = "pending",
            StorageTier = "per-trip",
            UploadId = Guid.NewGuid()
        };
        var failedPhoto = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 37.7749,
            Longitude = -122.4194,
            PlaceName = "San Francisco",
            Caption = "Failed",
            TakenAt = DateTime.UtcNow,
            BlobPath = "1/3.jpg",
            Status = "failed",
            StorageTier = "legacy",
            UploadId = Guid.NewGuid()
        };
        await db.Photos.AddRangeAsync(committedPhoto, pendingPhoto, failedPhoto);
        await db.SaveChangesAsync();

        // Act
        var photos = await service.GetPhotosForTripAsync(secretToken, CancellationToken.None);

        // Assert - only committed photos should be returned
        photos.Should().HaveCount(1);
        photos.Single().Caption.Should().Be("Committed");
    }

    [Fact]
    public async Task GetPhotosForTripAsync_PreservesNullTakenAt()
    {
        // Arrange
        using var db = CreateInMemoryContext();
        var service = CreateService(db);

        var secretToken = "null-date-secret"; // pragma: allowlist secret
        var trip = new TripEntity
        {
            Slug = "null-date-trip",
            Name = "Null Date Trip",
            SecretToken = secretToken,
            ViewToken = Guid.NewGuid().ToString()
        };
        await db.Trips.AddAsync(trip);
        await db.SaveChangesAsync();

        var photoWithDate = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            PlaceName = "New York",
            Caption = "With Date",
            TakenAt = new DateTime(2026, 1, 15, 10, 0, 0, DateTimeKind.Utc),
            CreatedAt = new DateTime(2026, 1, 15, 10, 5, 0, DateTimeKind.Utc),
            BlobPath = "1/1.jpg",
            Status = "committed",
            StorageTier = "legacy",
            UploadId = Guid.NewGuid()
        };
        var photoWithoutDate = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 34.0522,
            Longitude = -118.2437,
            PlaceName = "Los Angeles",
            Caption = "Without Date",
            TakenAt = null,
            CreatedAt = new DateTime(2026, 2, 1, 12, 0, 0, DateTimeKind.Utc),
            BlobPath = "1/2.jpg",
            Status = "committed",
            StorageTier = "per-trip",
            UploadId = Guid.NewGuid()
        };
        await db.Photos.AddRangeAsync(photoWithDate, photoWithoutDate);
        await db.SaveChangesAsync();

        // Act
        var photos = await service.GetPhotosForTripAsync(secretToken, CancellationToken.None);

        // Assert: both photos returned, null TakenAt preserved in response (not coerced)
        photos.Should().HaveCount(2);
        photos.Should().ContainSingle(p => p.Caption == "With Date" && p.TakenAt.HasValue);
        photos.Should().ContainSingle(p => p.Caption == "Without Date" && !p.TakenAt.HasValue);
    }

    [Fact]
    public async Task GetPhotosForTripAsync_OrdersByTakenAtThenCreatedAt_WhenTakenAtIsNull()
    {
        // Regression test for: photos uploaded in real-time via browser camera capture
        // have null TakenAt (no EXIF DateTimeOriginal), while photos picked from the
        // library have TakenAt populated. The first-posted photo (low CreatedAt, null
        // TakenAt) was being banished to the end of the carousel by a "nulls last" sort.
        // Expected: order by COALESCE(TakenAt, CreatedAt) so upload chronology is the
        // fallback when EXIF capture time is missing.

        // Arrange
        using var db = CreateInMemoryContext();
        var service = CreateService(db);

        var secretToken = "mixed-exif-secret"; // pragma: allowlist secret
        var trip = new TripEntity
        {
            Slug = "mixed-exif-trip",
            Name = "Mixed EXIF Trip",
            SecretToken = secretToken,
            ViewToken = Guid.NewGuid().ToString()
        };
        await db.Trips.AddAsync(trip);
        await db.SaveChangesAsync();

        // Posted FIRST in real-time, but EXIF DateTimeOriginal is missing (camera capture).
        var firstPostedNoExif = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 44.5,
            Longitude = -67.85,
            PlaceName = "I-95 (first posted, no EXIF)",
            Caption = "First posted",
            TakenAt = null,
            CreatedAt = new DateTime(2026, 5, 16, 15, 20, 0, DateTimeKind.Utc),
            BlobPath = "1/1.jpg",
            Status = "committed",
            StorageTier = "legacy",
            UploadId = Guid.NewGuid()
        };

        // Posted LATER from the user's library; EXIF says it was taken a day after the first photo.
        var laterPostedWithExif = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 44.46,
            Longitude = -67.83,
            PlaceName = "Milbridge (later post, with EXIF)",
            Caption = "Later post",
            TakenAt = new DateTime(2026, 5, 17, 20, 57, 0, DateTimeKind.Utc),
            CreatedAt = new DateTime(2026, 5, 18, 16, 3, 0, DateTimeKind.Utc),
            BlobPath = "1/2.jpg",
            Status = "committed",
            StorageTier = "legacy",
            UploadId = Guid.NewGuid()
        };

        await db.Photos.AddRangeAsync(laterPostedWithExif, firstPostedNoExif);
        await db.SaveChangesAsync();

        // Act
        var photos = await service.GetPhotosForTripAsync(secretToken, CancellationToken.None);

        // Assert: the first-posted (lower CreatedAt) photo comes first, even though the
        // other photo has a non-null TakenAt.
        photos.Should().HaveCount(2);
        photos[0].Caption.Should().Be("First posted");
        photos[1].Caption.Should().Be("Later post");
    }

    [Fact]
    public async Task GetPhotosForTripAsync_OrdersTakenAtBeforeLaterCreatedAt()
    {
        // The other direction of the same property: a photo TAKEN earlier but UPLOADED
        // later (typical "got home from the trip, then uploaded the library") should
        // still appear before a photo whose CreatedAt is earlier but TakenAt is later.
        // Confirms TakenAt remains the primary sort key when present.

        // Arrange
        using var db = CreateInMemoryContext();
        var service = CreateService(db);

        var secretToken = "taken-vs-uploaded-secret"; // pragma: allowlist secret
        var trip = new TripEntity
        {
            Slug = "taken-vs-uploaded-trip",
            Name = "Taken vs Uploaded Trip",
            SecretToken = secretToken,
            ViewToken = Guid.NewGuid().ToString()
        };
        await db.Trips.AddAsync(trip);
        await db.SaveChangesAsync();

        var takenEarlyUploadedLate = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 44.5,
            Longitude = -67.85,
            PlaceName = "Taken early, uploaded late",
            Caption = "Taken early",
            TakenAt = new DateTime(2026, 5, 14, 9, 0, 0, DateTimeKind.Utc),
            CreatedAt = new DateTime(2026, 5, 20, 9, 0, 0, DateTimeKind.Utc),
            BlobPath = "1/1.jpg",
            Status = "committed",
            StorageTier = "legacy",
            UploadId = Guid.NewGuid()
        };

        var takenLateUploadedEarly = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 44.46,
            Longitude = -67.83,
            PlaceName = "Taken late, uploaded early",
            Caption = "Taken late",
            TakenAt = new DateTime(2026, 5, 19, 9, 0, 0, DateTimeKind.Utc),
            CreatedAt = new DateTime(2026, 5, 19, 10, 0, 0, DateTimeKind.Utc),
            BlobPath = "1/2.jpg",
            Status = "committed",
            StorageTier = "legacy",
            UploadId = Guid.NewGuid()
        };

        await db.Photos.AddRangeAsync(takenLateUploadedEarly, takenEarlyUploadedLate);
        await db.SaveChangesAsync();

        // Act
        var photos = await service.GetPhotosForTripAsync(secretToken, CancellationToken.None);

        // Assert: photo TAKEN earlier appears first, even though it was uploaded later.
        photos.Should().HaveCount(2);
        photos[0].Caption.Should().Be("Taken early");
        photos[1].Caption.Should().Be("Taken late");
    }
}
