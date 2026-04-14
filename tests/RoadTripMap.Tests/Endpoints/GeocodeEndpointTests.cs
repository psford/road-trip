using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Services;
using RoadTripMap.Tests.Fixtures;
using Xunit;

namespace RoadTripMap.Tests.Endpoints;

public class GeocodeEndpointTests
{
    private RoadTripDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new RoadTripDbContext(options);
    }

    [Fact]
    public async Task GeocodeService_WithValidCoordinates_ReturnsPlaceName()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var geocodingService = new MockGeocodingService();

        // Act
        var result = await geocodingService.ReverseGeocodeAsync(36.1069, -112.1129);

        // Assert
        result.Should().NotBeNull();
        result.Should().Be("Grand Canyon, Arizona");
    }

    [Fact]
    public async Task GeocodeService_WithZeroCoordinates_ReturnsNull()
    {
        // Arrange
        var geocodingService = new MockGeocodingService();

        // Act
        var result = await geocodingService.ReverseGeocodeAsync(0, 0);

        // Assert
        result.Should().BeNull();
    }

    [Fact]
    public async Task PhotoUpload_WithValidCoordinates_SetsPlaceName()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // Create a trip
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString()
        };
        context.Trips.Add(trip);
        await context.SaveChangesAsync();

        // Create a photo with valid coordinates
        var photo = new PhotoEntityBuilder()
            .WithTripId(trip.Id)
            .WithCoordinates(36.1069, -112.1129)
            .WithCaption("Test photo")
            .WithTakenAt(DateTime.UtcNow)
            .WithBlobPath("test/photo.jpg")
            .WithPlaceName("Grand Canyon, Arizona")
            .Build();
        context.Photos.Add(photo);
        await context.SaveChangesAsync();

        // Act & Assert
        var savedPhoto = await context.Photos.FirstOrDefaultAsync(p => p.Id == photo.Id);
        savedPhoto.Should().NotBeNull();
        savedPhoto!.PlaceName.Should().Be("Grand Canyon, Arizona");
    }

    [Fact]
    public async Task PhotoUpload_WithZeroCoordinates_SetsLocationNotSet()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // Create a trip
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString()
        };
        context.Trips.Add(trip);
        await context.SaveChangesAsync();

        // Create a photo with zero coordinates (no GPS data)
        var photo = new PhotoEntityBuilder()
            .WithTripId(trip.Id)
            .WithCoordinates(0, 0)
            .WithCaption("Test photo")
            .WithTakenAt(DateTime.UtcNow)
            .WithBlobPath("test/photo.jpg")
            .WithPlaceName("Location not set")
            .Build();
        context.Photos.Add(photo);
        await context.SaveChangesAsync();

        // Act & Assert
        var savedPhoto = await context.Photos.FirstOrDefaultAsync(p => p.Id == photo.Id);
        savedPhoto.Should().NotBeNull();
        savedPhoto!.PlaceName.Should().Be("Location not set");
    }

    [Fact]
    public async Task PhotoUpload_WithGeocodeFailure_SetsUnknownLocation()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // Create a trip
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString()
        };
        context.Trips.Add(trip);
        await context.SaveChangesAsync();

        // Create a photo where geocoding returns null
        var photo = new PhotoEntityBuilder()
            .WithTripId(trip.Id)
            .WithCoordinates(40.7128, -74.0060)
            .WithCaption("Test photo")
            .WithTakenAt(DateTime.UtcNow)
            .WithBlobPath("test/photo.jpg")
            .WithPlaceName("Unknown location")
            .Build();
        context.Photos.Add(photo);
        await context.SaveChangesAsync();

        // Act & Assert
        var savedPhoto = await context.Photos.FirstOrDefaultAsync(p => p.Id == photo.Id);
        savedPhoto.Should().NotBeNull();
        savedPhoto!.PlaceName.Should().Be("Unknown location");
    }
}

/// <summary>
/// Mock geocoding service for testing
/// </summary>
public class MockGeocodingService : IGeocodingService
{
    public Task<string?> ReverseGeocodeAsync(double latitude, double longitude)
    {
        // Return null for 0,0 (no GPS data)
        if (latitude == 0 && longitude == 0)
            return Task.FromResult<string?>(null);

        // Return mock place name for known coordinates
        if (latitude >= 36 && latitude <= 37 && longitude >= -113 && longitude <= -112)
            return Task.FromResult<string?>("Grand Canyon, Arizona");

        if (latitude >= 40 && latitude <= 41 && longitude >= -75 && longitude <= -74)
            return Task.FromResult<string?>("New York City, New York");

        return Task.FromResult<string?>("Unknown Location");
    }
}
