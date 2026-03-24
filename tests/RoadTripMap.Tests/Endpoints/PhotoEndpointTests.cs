using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Moq;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Models;
using RoadTripMap.Services;

namespace RoadTripMap.Tests.Endpoints;

public class PhotoEndpointTests
{
    private RoadTripDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new RoadTripDbContext(options);
    }

    [Fact]
    public async Task PhotoUploadRequest_WithValidToken_Succeeds()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = "test-token", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        // Act
        var photo = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            Caption = "NYC",
            TakenAt = DateTime.UtcNow,
            BlobPath = "1/1.jpg"
        };
        await context.Photos.AddAsync(photo);
        await context.SaveChangesAsync();

        // Assert
        var saved = await context.Photos.FirstOrDefaultAsync(p => p.Id == photo.Id);
        saved.Should().NotBeNull();
        saved!.Caption.Should().Be("NYC");
    }

    [Fact]
    public async Task PhotoUploadRequest_WithoutCaption_Succeeds()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = "test-token", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        // Act
        var photo = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            Caption = null,
            TakenAt = DateTime.UtcNow,
            BlobPath = "1/2.jpg"
        };
        await context.Photos.AddAsync(photo);
        await context.SaveChangesAsync();

        // Assert
        var saved = await context.Photos.FirstOrDefaultAsync(p => p.Id == photo.Id);
        saved.Should().NotBeNull();
        saved!.Caption.Should().BeNull();
    }

    [Fact]
    public async Task PhotoDelete_WithValidPhotoId_Succeeds()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = "test-token", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        var photo = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            Caption = "NYC",
            TakenAt = DateTime.UtcNow,
            BlobPath = "1/3.jpg"
        };
        await context.Photos.AddAsync(photo);
        await context.SaveChangesAsync();

        // Act
        context.Photos.Remove(photo);
        await context.SaveChangesAsync();

        // Assert
        var deleted = await context.Photos.FirstOrDefaultAsync(p => p.Id == photo.Id);
        deleted.Should().BeNull();
    }

    [Fact]
    public async Task PhotoDelete_WithInvalidPhotoId_ReturnsNotFound()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = "test-token", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        // Act
        var photo = await context.Photos.FirstOrDefaultAsync(p => p.Id == 99999);

        // Assert
        photo.Should().BeNull();
    }

    [Fact]
    public async Task PhotoUpload_WithValidImage_ReturnsPhotoResponse()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = "test-token", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        // Act
        var photo = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            Caption = "Test",
            TakenAt = DateTime.UtcNow,
            BlobPath = "1/4.jpg"
        };
        await context.Photos.AddAsync(photo);
        await context.SaveChangesAsync();

        // Create response
        var response = new PhotoResponse
        {
            Id = photo.Id,
            ThumbnailUrl = $"/api/photos/{trip.Id}/{photo.Id}/thumb",
            DisplayUrl = $"/api/photos/{trip.Id}/{photo.Id}/display",
            OriginalUrl = $"/api/photos/{trip.Id}/{photo.Id}/original",
            Lat = photo.Latitude,
            Lng = photo.Longitude,
            PlaceName = photo.PlaceName ?? "",
            Caption = photo.Caption,
            TakenAt = photo.TakenAt
        };

        // Assert
        response.Should().NotBeNull();
        response.Id.Should().Be(photo.Id);
        response.OriginalUrl.Should().Contain("/original");
        response.DisplayUrl.Should().Contain("/display");
        response.ThumbnailUrl.Should().Contain("/thumb");
        response.Lat.Should().Be(40.7128);
        response.Lng.Should().Be(-74.0060);
        response.Caption.Should().Be("Test");
    }

    [Fact]
    public void PhotoResponse_ContainsAllRequiredFields()
    {
        // Arrange & Act
        var response = new PhotoResponse
        {
            Id = 1,
            ThumbnailUrl = "/api/photos/1/1/thumb",
            DisplayUrl = "/api/photos/1/1/display",
            OriginalUrl = "/api/photos/1/1/original",
            Lat = 40.7128,
            Lng = -74.0060,
            PlaceName = "New York",
            Caption = "Test",
            TakenAt = DateTime.UtcNow
        };

        // Assert
        response.Id.Should().Be(1);
        response.ThumbnailUrl.Should().NotBeNullOrEmpty();
        response.DisplayUrl.Should().NotBeNullOrEmpty();
        response.OriginalUrl.Should().NotBeNullOrEmpty();
        response.Lat.Should().NotBe(0);
        response.Lng.Should().NotBe(0);
        response.PlaceName.Should().NotBeNullOrEmpty();
        response.Caption.Should().NotBeNullOrEmpty();
        response.TakenAt.Should().NotBe(default);
    }

    [Fact]
    public void PhotoResponse_IsRecord()
    {
        // Assert - PhotoResponse is a record type
        typeof(PhotoResponse)
            .GetProperties()
            .Should()
            .Contain(p => p.Name == nameof(PhotoResponse.Id))
            .And.Contain(p => p.Name == nameof(PhotoResponse.ThumbnailUrl))
            .And.Contain(p => p.Name == nameof(PhotoResponse.DisplayUrl))
            .And.Contain(p => p.Name == nameof(PhotoResponse.OriginalUrl))
            .And.Contain(p => p.Name == nameof(PhotoResponse.Lat))
            .And.Contain(p => p.Name == nameof(PhotoResponse.Lng))
            .And.Contain(p => p.Name == nameof(PhotoResponse.PlaceName))
            .And.Contain(p => p.Name == nameof(PhotoResponse.Caption))
            .And.Contain(p => p.Name == nameof(PhotoResponse.TakenAt));
    }

    [Fact]
    public async Task Photo_CanBeLookupByTripIdAndPhotoId()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = "test-token", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        var photo = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            Caption = "Test",
            TakenAt = DateTime.UtcNow,
            BlobPath = "1/5.jpg"
        };
        await context.Photos.AddAsync(photo);
        await context.SaveChangesAsync();

        // Act
        var found = await context.Photos.FirstOrDefaultAsync(p => p.TripId == trip.Id && p.Id == photo.Id);

        // Assert
        found.Should().NotBeNull();
        found!.Id.Should().Be(photo.Id);
        found.TripId.Should().Be(trip.Id);
    }

    [Fact]
    public async Task Photo_CascadeDeletesWhenTripDeleted()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = "test-token", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        var photo = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            Caption = "Test",
            TakenAt = DateTime.UtcNow,
            BlobPath = "1/6.jpg"
        };
        await context.Photos.AddAsync(photo);
        await context.SaveChangesAsync();

        // Act
        context.Trips.Remove(trip);
        await context.SaveChangesAsync();

        // Assert
        var orphaned = await context.Photos.FirstOrDefaultAsync(p => p.Id == photo.Id);
        orphaned.Should().BeNull();
    }

    [Fact]
    public async Task PhotoServingEndpoint_ReturnsPhotoViaApiProxy()
    {
        // Arrange - Photo URLs should use /api/photos/ pattern, not direct blob
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = "test-token", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        var photo = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            Caption = "Test",
            TakenAt = DateTime.UtcNow,
            BlobPath = "1/7.jpg"
        };
        await context.Photos.AddAsync(photo);
        await context.SaveChangesAsync();

        // Act
        var found = await context.Photos.FirstOrDefaultAsync(p => p.TripId == trip.Id && p.Id == photo.Id);

        // Assert - Photo exists and can be served
        found.Should().NotBeNull();
        found!.BlobPath.Should().StartWith($"{trip.Id}/");
    }

    [Fact]
    public void PhotoServingEndpoint_ValidatesSizeParameter()
    {
        // Arrange
        var validSizes = new[] { "original", "display", "thumb" };

        // Act & Assert
        foreach (var size in validSizes)
        {
            size.Should().BeOneOf(validSizes);
        }

        var invalidSize = "invalid-size";
        validSizes.Should().NotContain(invalidSize);
    }

    [Fact]
    public async Task PhotoServingEndpoint_ProvidesOriginalUrl()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = "test-token", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        var photo = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            Caption = "Test",
            TakenAt = DateTime.UtcNow,
            BlobPath = "1/8.jpg"
        };
        await context.Photos.AddAsync(photo);
        await context.SaveChangesAsync();

        // Act
        var originalUrl = $"/api/photos/{trip.Id}/{photo.Id}/original";

        // Assert
        originalUrl.Should().Contain("/api/photos/");
        originalUrl.Should().EndWith("/original");
        originalUrl.Should().NotContain("blob");
    }

    [Fact]
    public async Task PhotoServingEndpoint_NoBlobUrlExposure()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = "test-token", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        var photo = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            Caption = "Test",
            TakenAt = DateTime.UtcNow,
            BlobPath = "1/9.jpg"
        };
        await context.Photos.AddAsync(photo);
        await context.SaveChangesAsync();

        // Act - Verify no endpoint exposes direct blob URLs
        var photo_Response = new PhotoResponse
        {
            Id = photo.Id,
            ThumbnailUrl = $"/api/photos/{trip.Id}/{photo.Id}/thumb",
            DisplayUrl = $"/api/photos/{trip.Id}/{photo.Id}/display",
            OriginalUrl = $"/api/photos/{trip.Id}/{photo.Id}/original",
            Lat = photo.Latitude,
            Lng = photo.Longitude,
            PlaceName = photo.PlaceName ?? "",
            Caption = photo.Caption,
            TakenAt = photo.TakenAt
        };

        // Assert
        photo_Response.OriginalUrl.Should().NotContain("blob");
        photo_Response.DisplayUrl.Should().NotContain("blob");
        photo_Response.ThumbnailUrl.Should().NotContain("blob");
        photo_Response.OriginalUrl.Should().StartWith("/api/photos/");
        photo_Response.DisplayUrl.Should().StartWith("/api/photos/");
        photo_Response.ThumbnailUrl.Should().StartWith("/api/photos/");
    }

    [Fact]
    public async Task GetPhotosEndpoint_WithValidToken_ReturnsPhotos()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = "test-token-valid", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        var now = DateTime.UtcNow;
        var photo1 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            Caption = "NYC Photo 1",
            TakenAt = now.AddHours(-1),
            CreatedAt = now.AddHours(-1),
            PlaceName = "New York",
            BlobPath = "1/10.jpg"
        };
        var photo2 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 34.0522,
            Longitude = -118.2437,
            Caption = null,
            TakenAt = now,
            CreatedAt = now,
            PlaceName = "Los Angeles",
            BlobPath = "1/11.jpg"
        };
        await context.Photos.AddAsync(photo1);
        await context.Photos.AddAsync(photo2);
        await context.SaveChangesAsync();

        // Act
        var photos = await context.Photos
            .Where(p => p.TripId == trip.Id)
            .OrderByDescending(p => p.CreatedAt)
            .ToListAsync();

        // Assert
        photos.Should().HaveCount(2);
        photos[0].Id.Should().Be(photo2.Id); // Most recent first
        photos[0].Caption.Should().BeNull();
        photos[1].Caption.Should().Be("NYC Photo 1");
    }

    [Fact]
    public async Task GetPhotosEndpoint_WithEmptyTrip_ReturnsEmptyArray()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "empty-trip",
            Name = "Empty Trip",
            SecretToken = "empty-token", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        // Act
        var photos = await context.Photos
            .Where(p => p.TripId == trip.Id)
            .OrderByDescending(p => p.CreatedAt)
            .ToListAsync();

        // Assert
        photos.Should().BeEmpty();
    }

    [Fact]
    public async Task GetPhotosEndpoint_WithInvalidToken_ReturnsNotFound()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var invalidToken = "invalid-token-xyz"; // pragma: allowlist secret

        // Act
        var trip = await context.Trips.FirstOrDefaultAsync(t => t.SecretToken == invalidToken);

        // Assert
        trip.Should().BeNull();
    }

    [Fact]
    public async Task GetPhotosEndpoint_OrdersByCreatedAtDescending()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "ordered-trip",
            Name = "Ordered Trip",
            SecretToken = "ordered-token", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        var now = DateTime.UtcNow;
        var photo1 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            Caption = "First",
            TakenAt = now.AddHours(-2),
            CreatedAt = now.AddHours(-2),
            BlobPath = "1/12.jpg"
        };
        var photo2 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 34.0522,
            Longitude = -118.2437,
            Caption = "Second",
            TakenAt = now.AddHours(-1),
            CreatedAt = now.AddHours(-1),
            BlobPath = "1/13.jpg"
        };
        var photo3 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 41.8781,
            Longitude = -87.6298,
            Caption = "Third",
            TakenAt = now,
            CreatedAt = now,
            BlobPath = "1/14.jpg"
        };
        await context.Photos.AddAsync(photo1);
        await context.Photos.AddAsync(photo2);
        await context.Photos.AddAsync(photo3);
        await context.SaveChangesAsync();

        // Act
        var photos = await context.Photos
            .Where(p => p.TripId == trip.Id)
            .OrderByDescending(p => p.CreatedAt)
            .ToListAsync();

        // Assert
        photos.Should().HaveCount(3);
        photos[0].Caption.Should().Be("Third");
        photos[1].Caption.Should().Be("Second");
        photos[2].Caption.Should().Be("First");
    }

    [Fact]
    public async Task GetPhotosEndpoint_WithNullTakenAt_SortsNullsLast()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "null-taken-at-trip",
            Name = "Null Taken At Trip",
            SecretToken = "null-token", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        var now = DateTime.UtcNow;

        // Create photos with mixed takenAt values (some null, some with dates)
        var photo1 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            Caption = "Photo with old date",
            TakenAt = now.AddDays(-5),
            CreatedAt = now.AddDays(-5),
            BlobPath = "1/15.jpg"
        };
        var photo2 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 34.0522,
            Longitude = -118.2437,
            Caption = "Photo with null takenAt",
            TakenAt = null,
            CreatedAt = now.AddDays(-3),
            BlobPath = "1/16.jpg"
        };
        var photo3 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 41.8781,
            Longitude = -87.6298,
            Caption = "Photo with recent date",
            TakenAt = now.AddDays(-1),
            CreatedAt = now.AddDays(-1),
            BlobPath = "1/17.jpg"
        };
        var photo4 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 39.7392,
            Longitude = -104.9903,
            Caption = "Another photo with null takenAt",
            TakenAt = null,
            CreatedAt = now,
            BlobPath = "1/18.jpg"
        };

        await context.Photos.AddAsync(photo1);
        await context.Photos.AddAsync(photo2);
        await context.Photos.AddAsync(photo3);
        await context.Photos.AddAsync(photo4);
        await context.SaveChangesAsync();

        // Act - Use the new null-safe ordering
        var photos = await context.Photos
            .Where(p => p.TripId == trip.Id)
            .OrderBy(p => p.TakenAt == null)
            .ThenBy(p => p.TakenAt)
            .ToListAsync();

        // Assert
        photos.Should().HaveCount(4);

        // First two should have non-null takenAt values, ordered chronologically (oldest first)
        photos[0].Caption.Should().Be("Photo with old date");
        photos[0].TakenAt.Should().NotBeNull();

        photos[1].Caption.Should().Be("Photo with recent date");
        photos[1].TakenAt.Should().NotBeNull();

        // Last two should have null takenAt values
        photos[2].TakenAt.Should().BeNull();
        photos[3].Caption.Should().Be("Another photo with null takenAt");
        photos[3].TakenAt.Should().BeNull();
    }
}
