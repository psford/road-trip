using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.PoiSeeder;
using Xunit;

namespace RoadTripMap.Tests.Seeder;

public class DeduplicatorTests
{
    private RoadTripDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new RoadTripDbContext(options);
    }

    [Fact]
    public async Task DeduplicateAsync_WithNoDuplicates_ReturnsZeroDeleted()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var poi1 = new PoiEntity
        {
            Name = "Grand Canyon National Park",
            Category = "national_park",
            Latitude = 36.10,
            Longitude = -112.11,
            Source = "nps",
            SourceId = "grca"
        };

        var poi2 = new PoiEntity
        {
            Name = "Death Valley National Park",
            Category = "national_park",
            Latitude = 36.50,
            Longitude = -116.85,
            Source = "nps",
            SourceId = "deva"
        };

        context.PointsOfInterest.AddRange(poi1, poi2);
        await context.SaveChangesAsync();

        var deduplicator = new Deduplicator(context);

        // Act
        var result = await deduplicator.DeduplicateAsync();

        // Assert
        result.DeletedCount.Should().Be(0);
        var pois = await context.PointsOfInterest.ToListAsync();
        pois.Should().HaveCount(2);
    }

    [Fact]
    public async Task DeduplicateAsync_WithDuplicateLocationsAndNames_KeepsHighestPrioritySource()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // Same location (all round to 36.10, -112.11), same name, different sources - NPS should win (priority 3)
        var npsParks = new PoiEntity
        {
            Name = "Grand Canyon National Park",
            Category = "national_park",
            Latitude = 36.104,
            Longitude = -112.114,
            Source = "nps",
            SourceId = "grca"
        };

        var padUsParks = new PoiEntity
        {
            Name = "Grand Canyon National Park",
            Category = "state_park",
            Latitude = 36.102,
            Longitude = -112.112,
            Source = "pad_us",
            SourceId = "pad123"
        };

        var osmParks = new PoiEntity
        {
            Name = "Grand Canyon",
            Category = "tourism",
            Latitude = 36.103,
            Longitude = -112.113,
            Source = "osm",
            SourceId = "osm456"
        };

        context.PointsOfInterest.AddRange(npsParks, padUsParks, osmParks);
        await context.SaveChangesAsync();

        var deduplicator = new Deduplicator(context);

        // Act
        var result = await deduplicator.DeduplicateAsync();

        // Assert
        result.DeletedCount.Should().Be(2);
        var remaining = await context.PointsOfInterest.ToListAsync();
        remaining.Should().HaveCount(1);
        remaining[0].Source.Should().Be("nps");
        remaining[0].SourceId.Should().Be("grca");
    }

    [Fact]
    public async Task DeduplicateAsync_WithPadUsHigherPriorityThanOsm_KeepsPadUs()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // Both round to 40.50, -75.25
        var padUsParks = new PoiEntity
        {
            Name = "State Park",
            Category = "state_park",
            Latitude = 40.501,
            Longitude = -75.251,
            Source = "pad_us",
            SourceId = "pad999"
        };

        var osmParks = new PoiEntity
        {
            Name = "State Park",
            Category = "tourism",
            Latitude = 40.502,
            Longitude = -75.252,
            Source = "osm",
            SourceId = "osm777"
        };

        context.PointsOfInterest.AddRange(padUsParks, osmParks);
        await context.SaveChangesAsync();

        var deduplicator = new Deduplicator(context);

        // Act
        var result = await deduplicator.DeduplicateAsync();

        // Assert
        result.DeletedCount.Should().Be(1);
        var remaining = await context.PointsOfInterest.ToListAsync();
        remaining.Should().HaveCount(1);
        remaining[0].Source.Should().Be("pad_us");
    }

    [Fact]
    public async Task DeduplicateAsync_WithSubstringMatchingNames_IdentifiesDuplicates()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // "Grand Canyon" is substring of "Grand Canyon National Park"
        // Both round to same cell: 36.10, -112.11
        var npsParks = new PoiEntity
        {
            Name = "Grand Canyon National Park",
            Category = "national_park",
            Latitude = 36.101,
            Longitude = -112.111,
            Source = "nps",
            SourceId = "grca"
        };

        var osmParks = new PoiEntity
        {
            Name = "Grand Canyon",
            Category = "tourism",
            Latitude = 36.102,
            Longitude = -112.112,
            Source = "osm",
            SourceId = "osm999"
        };

        context.PointsOfInterest.AddRange(npsParks, osmParks);
        await context.SaveChangesAsync();

        var deduplicator = new Deduplicator(context);

        // Act
        var result = await deduplicator.DeduplicateAsync();

        // Assert
        result.DeletedCount.Should().Be(1);
        var remaining = await context.PointsOfInterest.ToListAsync();
        remaining[0].Name.Should().Be("Grand Canyon National Park");
    }

    [Fact]
    public async Task DeduplicateAsync_WithLevenshteinDistance_IdentifiesMisspellings()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // "Yellowstone" vs "Yellowstone National Park" - close match
        // Both round to 44.43, -110.59
        var npsParks = new PoiEntity
        {
            Name = "Yellowstone National Park",
            Category = "national_park",
            Latitude = 44.431,
            Longitude = -110.591,
            Source = "nps",
            SourceId = "yell"
        };

        var osmParks = new PoiEntity
        {
            Name = "Yellowstone",
            Category = "tourism",
            Latitude = 44.432,
            Longitude = -110.592,
            Source = "osm",
            SourceId = "osm111"
        };

        context.PointsOfInterest.AddRange(npsParks, osmParks);
        await context.SaveChangesAsync();

        var deduplicator = new Deduplicator(context);

        // Act
        var result = await deduplicator.DeduplicateAsync();

        // Assert
        result.DeletedCount.Should().Be(1);
    }

    [Fact]
    public async Task DeduplicateAsync_WithCaseInsensitiveMatching_IdentifiesDuplicates()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // Both round to 36.10, -112.11
        var poi1 = new PoiEntity
        {
            Name = "Grand Canyon National Park",
            Category = "national_park",
            Latitude = 36.101,
            Longitude = -112.111,
            Source = "nps",
            SourceId = "grca"
        };

        var poi2 = new PoiEntity
        {
            Name = "GRAND CANYON NATIONAL PARK",
            Category = "tourism",
            Latitude = 36.102,
            Longitude = -112.112,
            Source = "osm",
            SourceId = "osm222"
        };

        context.PointsOfInterest.AddRange(poi1, poi2);
        await context.SaveChangesAsync();

        var deduplicator = new Deduplicator(context);

        // Act
        var result = await deduplicator.DeduplicateAsync();

        // Assert
        result.DeletedCount.Should().Be(1);
    }

    [Fact]
    public async Task DeduplicateAsync_WithMultipleGroupsAtDifferentLocations_DeduplicatesEachGroup()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // Group 1: Grand Canyon area (all round to 36.10, -112.11)
        var grandCanyonNps = new PoiEntity
        {
            Name = "Grand Canyon National Park",
            Category = "national_park",
            Latitude = 36.101,
            Longitude = -112.111,
            Source = "nps",
            SourceId = "grca"
        };

        var grandCanyonOsm = new PoiEntity
        {
            Name = "Grand Canyon",
            Category = "tourism",
            Latitude = 36.102,
            Longitude = -112.112,
            Source = "osm",
            SourceId = "osm1"
        };

        // Group 2: Yosemite area (all round to 37.87, -119.54)
        var yosemiteNps = new PoiEntity
        {
            Name = "Yosemite National Park",
            Category = "national_park",
            Latitude = 37.871,
            Longitude = -119.541,
            Source = "nps",
            SourceId = "yose"
        };

        var yosemiteOsm = new PoiEntity
        {
            Name = "Yosemite",
            Category = "tourism",
            Latitude = 37.872,
            Longitude = -119.542,
            Source = "osm",
            SourceId = "osm2"
        };

        context.PointsOfInterest.AddRange(grandCanyonNps, grandCanyonOsm, yosemiteNps, yosemiteOsm);
        await context.SaveChangesAsync();

        var deduplicator = new Deduplicator(context);

        // Act
        var result = await deduplicator.DeduplicateAsync();

        // Assert
        result.DeletedCount.Should().Be(2);
        var remaining = await context.PointsOfInterest.ToListAsync();
        remaining.Should().HaveCount(2);
        remaining.Should().AllSatisfy(p => p.Source.Should().Be("nps"));
    }

    [Fact]
    public async Task DeduplicateAsync_WithEmptyDatabase_ReturnsZeroDeleted()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var deduplicator = new Deduplicator(context);

        // Act
        var result = await deduplicator.DeduplicateAsync();

        // Assert
        result.DeletedCount.Should().Be(0);
    }

    [Fact]
    public async Task DeduplicateAsync_WithSinglePoi_ReturnsZeroDeleted()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var poi = new PoiEntity
        {
            Name = "Single POI",
            Category = "tourism",
            Latitude = 40.0,
            Longitude = -75.0,
            Source = "nps",
            SourceId = "single"
        };

        context.PointsOfInterest.Add(poi);
        await context.SaveChangesAsync();

        var deduplicator = new Deduplicator(context);

        // Act
        var result = await deduplicator.DeduplicateAsync();

        // Assert
        result.DeletedCount.Should().Be(0);
        var pois = await context.PointsOfInterest.ToListAsync();
        pois.Should().HaveCount(1);
    }

    [Fact]
    public async Task DeduplicateAsync_WithLocationBoundaryCase_CorrectlyGroups()
    {
        // Arrange - Test that rounding to 2 decimals works correctly
        using var context = CreateInMemoryContext();

        // These should be in the same group (both round to 36.10, -112.11)
        var poi1 = new PoiEntity
        {
            Name = "Park",
            Category = "national_park",
            Latitude = 36.101,
            Longitude = -112.111,
            Source = "nps",
            SourceId = "a"
        };

        var poi2 = new PoiEntity
        {
            Name = "Park",
            Category = "tourism",
            Latitude = 36.102,
            Longitude = -112.112,
            Source = "osm",
            SourceId = "b"
        };

        // This should NOT be in the same group (rounds to 36.11, -112.11)
        var poi3 = new PoiEntity
        {
            Name = "OtherPark",
            Category = "national_park",
            Latitude = 36.114,
            Longitude = -112.114,
            Source = "nps",
            SourceId = "c"
        };

        context.PointsOfInterest.AddRange(poi1, poi2, poi3);
        await context.SaveChangesAsync();

        var deduplicator = new Deduplicator(context);

        // Act
        var result = await deduplicator.DeduplicateAsync();

        // Assert
        result.DeletedCount.Should().Be(1);
        var remaining = await context.PointsOfInterest.ToListAsync();
        remaining.Should().HaveCount(2);
        remaining.Should().Contain(p => p.SourceId == "a");
        remaining.Should().Contain(p => p.SourceId == "c");
    }

    [Fact]
    public async Task DeduplicateAsync_WithComplexScenario_HandlesAllPriorities()
    {
        // Arrange - Mix of all three sources, all rounding to 36.10, -112.11
        using var context = CreateInMemoryContext();

        var nps = new PoiEntity
        {
            Name = "Grand Canyon National Park",
            Category = "national_park",
            Latitude = 36.104,
            Longitude = -112.114,
            Source = "nps",
            SourceId = "grca"
        };

        var padUs = new PoiEntity
        {
            Name = "Grand Canyon State Park",
            Category = "state_park",
            Latitude = 36.102,
            Longitude = -112.112,
            Source = "pad_us",
            SourceId = "pad1"
        };

        var osm1 = new PoiEntity
        {
            Name = "Grand Canyon",
            Category = "tourism",
            Latitude = 36.101,
            Longitude = -112.111,
            Source = "osm",
            SourceId = "osm1"
        };

        var osm2 = new PoiEntity
        {
            Name = "Grand Canyon Overlook",
            Category = "tourism",
            Latitude = 36.103,
            Longitude = -112.113,
            Source = "osm",
            SourceId = "osm2"
        };

        context.PointsOfInterest.AddRange(nps, padUs, osm1, osm2);
        await context.SaveChangesAsync();

        var deduplicator = new Deduplicator(context);

        // Act
        var result = await deduplicator.DeduplicateAsync();

        // Assert - Should keep NPS (priority 3) and remove the others
        result.DeletedCount.Should().BeGreaterThan(0);
        var remaining = await context.PointsOfInterest.ToListAsync();
        remaining.Should().Contain(p => p.Source == "nps" && p.SourceId == "grca");
    }
}
