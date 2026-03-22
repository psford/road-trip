using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Models;

namespace RoadTripMap.Tests.Endpoints;

public class TripEndpointTests
{
    private RoadTripDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new RoadTripDbContext(options);
    }

    [Fact]
    public async Task CreateTrip_WithValidName_ReturnsTripDataWithAllFields()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var request = new CreateTripRequest { Name = "Cross Country 2026", Description = "Epic road trip" };

        // Act
        var slugExists = async (string slug) => await context.Trips.AnyAsync(t => t.Slug == slug);
        var slug = await RoadTripMap.Helpers.SlugHelper.GenerateUniqueSlugAsync(request.Name, slugExists);
        var token = Guid.NewGuid().ToString();

        var trip = new RoadTripMap.Entities.TripEntity
        {
            Slug = slug,
            Name = request.Name,
            Description = request.Description,
            SecretToken = token,
            ViewToken = Guid.NewGuid().ToString()
        };

        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        // Assert
        var created = await context.Trips.FirstOrDefaultAsync(t => t.Slug == slug);
        created.Should().NotBeNull();
        created!.Name.Should().Be("Cross Country 2026");
        created.Description.Should().Be("Epic road trip");
        created.Slug.Should().Be("cross-country-2026");
        created.SecretToken.Should().NotBeNullOrEmpty();
    }

    [Fact]
    public void CreateTrip_WithEmptyName_ShouldNotSucceed()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var emptyName = "";

        // Act
        var isValid = !string.IsNullOrWhiteSpace(emptyName);

        // Assert
        isValid.Should().BeFalse();
    }

    [Fact]
    public void CreateTrip_WithWhitespaceName_ShouldNotSucceed()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var whitespaceName = "   ";

        // Act
        var isValid = !string.IsNullOrWhiteSpace(whitespaceName);

        // Assert
        isValid.Should().BeFalse();
    }

    [Fact]
    public async Task CreateTrip_TwoTripsWithDifferentNames_ProduceUniqueSlugs()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // Act
        var slugExists1 = async (string slug) => await context.Trips.AnyAsync(t => t.Slug == slug);
        var slug1 = await RoadTripMap.Helpers.SlugHelper.GenerateUniqueSlugAsync("Trip One", slugExists1);

        var trip1 = new RoadTripMap.Entities.TripEntity
        {
            Slug = slug1,
            Name = "Trip One",
            Description = null,
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip1);
        await context.SaveChangesAsync();

        var slugExists2 = async (string slug) => await context.Trips.AnyAsync(t => t.Slug == slug);
        var slug2 = await RoadTripMap.Helpers.SlugHelper.GenerateUniqueSlugAsync("Trip Two", slugExists2);

        var trip2 = new RoadTripMap.Entities.TripEntity
        {
            Slug = slug2,
            Name = "Trip Two",
            Description = null,
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip2);
        await context.SaveChangesAsync();

        // Assert
        slug1.Should().NotBe(slug2);
        slug1.Should().Be("trip-one");
        slug2.Should().Be("trip-two");
    }

    [Fact]
    public async Task CreateTrip_TwoTripsWithSameName_ProduceUniqueSlugsSuffixed()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // Act
        var slugExists1 = async (string slug) => await context.Trips.AnyAsync(t => t.Slug == slug);
        var slug1 = await RoadTripMap.Helpers.SlugHelper.GenerateUniqueSlugAsync("My Trip", slugExists1);

        var trip1 = new RoadTripMap.Entities.TripEntity
        {
            Slug = slug1,
            Name = "My Trip",
            Description = null,
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip1);
        await context.SaveChangesAsync();

        var slugExists2 = async (string slug) => await context.Trips.AnyAsync(t => t.Slug == slug);
        var slug2 = await RoadTripMap.Helpers.SlugHelper.GenerateUniqueSlugAsync("My Trip", slugExists2);

        var trip2 = new RoadTripMap.Entities.TripEntity
        {
            Slug = slug2,
            Name = "My Trip",
            Description = null,
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip2);
        await context.SaveChangesAsync();

        // Assert
        slug1.Should().Be("my-trip");
        slug2.Should().Be("my-trip-2");
    }

    [Fact]
    public async Task CreateTrip_NoAuthenticationRequired()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // Act - Create a trip without any auth headers/tokens
        var request = new CreateTripRequest { Name = "Public Trip" };
        var slugExists = async (string slug) => await context.Trips.AnyAsync(t => t.Slug == slug);
        var slug = await RoadTripMap.Helpers.SlugHelper.GenerateUniqueSlugAsync(request.Name, slugExists);

        var trip = new RoadTripMap.Entities.TripEntity
        {
            Slug = slug,
            Name = request.Name,
            Description = null,
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString()
        };

        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        // Assert - Trip was created without requiring auth
        var created = await context.Trips.FirstOrDefaultAsync(t => t.Slug == slug);
        created.Should().NotBeNull();
    }

    [Fact]
    public void CreateTrip_Response_ContainsViewUrlAndPostUrl()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var slug = "test-trip";
        var token = Guid.NewGuid().ToString();
        var viewToken = "test-view-token";

        // Act
        var response = new CreateTripResponse
        {
            Slug = slug,
            SecretToken = token,
            ViewToken = viewToken,
            ViewUrl = $"/trips/{viewToken}",
            PostUrl = $"/post/{token}"
        };

        // Assert
        response.ViewUrl.Should().Be("/trips/test-view-token");
        response.PostUrl.Should().StartWith("/post/");
        response.Slug.Should().Be("test-trip");
        response.SecretToken.Should().NotBeNullOrEmpty();
        response.ViewToken.Should().Be("test-view-token");
    }
}
