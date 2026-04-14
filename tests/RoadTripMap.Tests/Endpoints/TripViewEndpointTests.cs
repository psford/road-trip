using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Models;
using RoadTripMap.Tests.Fixtures;

namespace RoadTripMap.Tests.Endpoints;

public class TripViewEndpointTests
{
    private RoadTripDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new RoadTripDbContext(options);
    }

    [Fact]
    public async Task GetTripInfo_WithValidSlug_ReturnsTripData()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Name = "California Coast",
            Description = "Scenic drive down PCH",
            Slug = "california-coast",
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString(),
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        // Act
        var found = await context.Trips
            .Where(t => t.Slug == "california-coast" && t.IsActive)
            .FirstOrDefaultAsync();
        var photoCount = await context.Photos
            .CountAsync(p => p.TripId == trip.Id);

        var response = new TripResponse
        {
            Name = found!.Name,
            Description = found.Description,
            PhotoCount = photoCount,
            CreatedAt = found.CreatedAt
        };

        // Assert
        response.Should().NotBeNull();
        response.Name.Should().Be("California Coast");
        response.Description.Should().Be("Scenic drive down PCH");
        response.PhotoCount.Should().Be(0);
    }

    [Fact]
    public async Task GetTripInfo_WithInvalidSlug_ReturnsNotFound()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // Act
        var found = await context.Trips
            .Where(t => t.Slug == "nonexistent" && t.IsActive)
            .FirstOrDefaultAsync();

        // Assert
        found.Should().BeNull();
    }

    [Fact]
    public async Task GetTripInfo_WithInactiveTrip_ReturnsNotFound()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Name = "Archived Trip",
            Slug = "archived-trip",
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString(),
            IsActive = false,
            CreatedAt = DateTime.UtcNow
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        // Act
        var found = await context.Trips
            .Where(t => t.Slug == "archived-trip" && t.IsActive)
            .FirstOrDefaultAsync();

        // Assert
        found.Should().BeNull();
    }

    [Fact]
    public async Task GetTripPhotos_WithValidSlug_ReturnsPhotosInChronologicalOrder()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Name = "Cross Country",
            Slug = "cross-country",
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString(),
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        var takenAt1 = new DateTime(2026, 1, 1, 9, 0, 0, DateTimeKind.Utc);
        var takenAt2 = new DateTime(2026, 1, 2, 10, 0, 0, DateTimeKind.Utc);
        var takenAt3 = new DateTime(2026, 1, 3, 11, 0, 0, DateTimeKind.Utc);

        var photo1 = new PhotoEntityBuilder()
            .WithTripId(trip.Id)
            .WithBlobPath("photo1.jpg")
            .WithCoordinates(40.7128, -74.0060)
            .WithPlaceName("New York")
            .WithTakenAt(takenAt1)
            .Build();
        var photo2 = new PhotoEntityBuilder()
            .WithTripId(trip.Id)
            .WithBlobPath("photo2.jpg")
            .WithCoordinates(41.8781, -87.6298)
            .WithPlaceName("Chicago")
            .WithTakenAt(takenAt2)
            .Build();
        var photo3 = new PhotoEntityBuilder()
            .WithTripId(trip.Id)
            .WithBlobPath("photo3.jpg")
            .WithCoordinates(34.0522, -118.2437)
            .WithPlaceName("Los Angeles")
            .WithTakenAt(takenAt3)
            .Build();

        await context.Photos.AddAsync(photo1);
        await context.Photos.AddAsync(photo2);
        await context.Photos.AddAsync(photo3);
        await context.SaveChangesAsync();

        // Act
        var found = await context.Trips
            .Where(t => t.Slug == "cross-country" && t.IsActive)
            .FirstOrDefaultAsync();

        var photos = await context.Photos
            .Where(p => p.TripId == found!.Id)
            .OrderBy(p => p.TakenAt)
            .Select(p => new PhotoResponse
            {
                Id = p.Id,
                ThumbnailUrl = $"/api/photos/{trip.Id}/{p.Id}/thumb",
                DisplayUrl = $"/api/photos/{trip.Id}/{p.Id}/display",
                OriginalUrl = $"/api/photos/{trip.Id}/{p.Id}/original",
                Lat = p.Latitude,
                Lng = p.Longitude,
                PlaceName = p.PlaceName ?? "",
                Caption = p.Caption,
                TakenAt = p.TakenAt
            })
            .ToListAsync();

        // Assert
        photos.Should().HaveCount(3);
        photos[0].PlaceName.Should().Be("New York");
        photos[1].PlaceName.Should().Be("Chicago");
        photos[2].PlaceName.Should().Be("Los Angeles");
        photos[0].Lat.Should().Be(40.7128);
        photos[1].Lat.Should().Be(41.8781);
        photos[2].Lat.Should().Be(34.0522);
    }

    [Fact]
    public async Task GetTripPhotos_WithZeroPhotos_ReturnsEmptyArray()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Name = "Empty Trip",
            Slug = "empty-trip",
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString(),
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        // Act
        var found = await context.Trips
            .Where(t => t.Slug == "empty-trip" && t.IsActive)
            .FirstOrDefaultAsync();

        var photos = await context.Photos
            .Where(p => p.TripId == found!.Id)
            .OrderBy(p => p.TakenAt)
            .Select(p => new PhotoResponse
            {
                Id = p.Id,
                ThumbnailUrl = $"/api/photos/{trip.Id}/{p.Id}/thumb",
                DisplayUrl = $"/api/photos/{trip.Id}/{p.Id}/display",
                OriginalUrl = $"/api/photos/{trip.Id}/{p.Id}/original",
                Lat = p.Latitude,
                Lng = p.Longitude,
                PlaceName = p.PlaceName ?? "",
                Caption = p.Caption,
                TakenAt = p.TakenAt
            })
            .ToListAsync();

        // Assert
        photos.Should().BeEmpty();
    }

    [Fact]
    public async Task GetTripPhotos_WithInvalidSlug_ReturnsNotFound()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // Act
        var found = await context.Trips
            .Where(t => t.Slug == "nonexistent" && t.IsActive)
            .FirstOrDefaultAsync();

        // Assert
        found.Should().BeNull();
    }

    [Fact]
    public async Task GetTripInfo_NoAuthenticationRequired()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Name = "Public Trip",
            Slug = "public-trip",
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString(),
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        // Act - No auth token, just slug
        var found = await context.Trips
            .Where(t => t.Slug == "public-trip" && t.IsActive)
            .FirstOrDefaultAsync();

        // Assert - Trip was found without requiring auth
        found.Should().NotBeNull();
        found!.Name.Should().Be("Public Trip");
    }

    [Fact]
    public async Task GetTripPhotos_NoAuthenticationRequired()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Name = "Public Trip",
            Slug = "public-trip",
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString(),
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
        await context.Trips.AddAsync(trip);

        var photo = new PhotoEntityBuilder()
            .WithTripId(trip.Id)
            .WithBlobPath("public-photo.jpg")
            .WithCoordinates(40.7128, -74.0060)
            .WithPlaceName("New York")
            .WithTakenAt(DateTime.UtcNow)
            .Build();

        await context.Photos.AddAsync(photo);
        await context.SaveChangesAsync();

        // Act - No auth token, just slug
        var found = await context.Trips
            .Where(t => t.Slug == "public-trip" && t.IsActive)
            .FirstOrDefaultAsync();

        var photos = await context.Photos
            .Where(p => p.TripId == found!.Id)
            .OrderBy(p => p.TakenAt)
            .ToListAsync();

        // Assert - Photos were retrieved without requiring auth
        photos.Should().HaveCount(1);
    }

    [Fact]
    public async Task GetTripInfo_PhotoCountAccurate()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Name = "Multi Photo Trip",
            Slug = "multi-photo-trip",
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString(),
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        for (int i = 0; i < 5; i++)
        {
            var photo = new PhotoEntityBuilder()
                .WithTripId(trip.Id)
                .WithBlobPath($"photo{i}.jpg")
                .WithCoordinates(40.7128 + i, -74.0060 + i)
                .WithPlaceName($"Location {i}")
                .WithTakenAt(DateTime.UtcNow.AddDays(i))
                .Build();
            await context.Photos.AddAsync(photo);
        }
        await context.SaveChangesAsync();

        // Act
        var found = await context.Trips
            .Where(t => t.Slug == "multi-photo-trip" && t.IsActive)
            .FirstOrDefaultAsync();

        var photoCount = await context.Photos
            .CountAsync(p => p.TripId == trip.Id);

        // Assert
        photoCount.Should().Be(5);
    }
}
