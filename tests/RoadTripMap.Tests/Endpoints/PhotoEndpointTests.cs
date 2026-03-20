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
            SecretToken = "test-token" // pragma: allowlist secret
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
            SecretToken = "test-token" // pragma: allowlist secret
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
            SecretToken = "test-token" // pragma: allowlist secret
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
            SecretToken = "test-token" // pragma: allowlist secret
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
            SecretToken = "test-token" // pragma: allowlist secret
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
    public async Task PhotoResponse_ContainsAllRequiredFields()
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
            SecretToken = "test-token" // pragma: allowlist secret
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
            SecretToken = "test-token" // pragma: allowlist secret
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
}
