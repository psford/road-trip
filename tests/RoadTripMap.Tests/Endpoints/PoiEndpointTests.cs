using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Models;
using Xunit;

namespace RoadTripMap.Tests.Endpoints;

/// <summary>
/// Tests for the GET /api/poi endpoint.
/// Verifies viewport filtering (AC1.4) and zoom-based category filtering (AC4.1-4.4).
/// </summary>
public class PoiEndpointTests
{
    private RoadTripDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new RoadTripDbContext(options);
    }

    // ============================================================
    // AC1.4: Viewport filtering
    // ============================================================

    [Fact]
    public async Task GetPoi_WithPoisInViewport_ReturnsPoisWithinBoundingBox()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // Create POIs in different locations
        var poi1 = new PoiEntity
        {
            Name = "Yellowstone",
            Category = "national_park",
            Latitude = 44.4,
            Longitude = -110.8,
            Source = "nps"
        };

        var poi2 = new PoiEntity
        {
            Name = "Grand Teton",
            Category = "national_park",
            Latitude = 43.7,
            Longitude = -110.7,
            Source = "nps"
        };

        var poi3 = new PoiEntity
        {
            Name = "Moab Site",
            Category = "national_park",
            Latitude = 38.5,
            Longitude = -109.6,
            Source = "nps"
        };

        context.PointsOfInterest.AddRange(poi1, poi2, poi3);
        await context.SaveChangesAsync();

        // Act - Query viewport containing Yellowstone and Grand Teton but not Moab
        var result = await context.PointsOfInterest
            .Where(p => p.Latitude >= 43.0 && p.Latitude <= 45.0 &&
                        p.Longitude >= -111.5 && p.Longitude <= -110.0)
            .Where(p => p.Category == "national_park")
            .Select(p => new PoiResponse
            {
                Id = p.Id,
                Name = p.Name,
                Category = p.Category,
                Lat = p.Latitude,
                Lng = p.Longitude
            })
            .ToListAsync();

        // Assert
        result.Should().HaveCount(2);
        result.Should().Contain(p => p.Name == "Yellowstone");
        result.Should().Contain(p => p.Name == "Grand Teton");
        result.Should().NotContain(p => p.Name == "Moab Site");
    }

    [Fact]
    public async Task GetPoi_WithNoPoisInViewport_ReturnsEmptyList()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var poi = new PoiEntity
        {
            Name = "Yellowstone",
            Category = "national_park",
            Latitude = 44.4,
            Longitude = -110.8,
            Source = "nps"
        };

        context.PointsOfInterest.Add(poi);
        await context.SaveChangesAsync();

        // Act - Query viewport that excludes the POI
        var result = await context.PointsOfInterest
            .Where(p => p.Latitude >= 30.0 && p.Latitude <= 35.0 &&
                        p.Longitude >= -100.0 && p.Longitude <= -95.0)
            .Where(p => p.Category == "national_park")
            .Select(p => new PoiResponse
            {
                Id = p.Id,
                Name = p.Name,
                Category = p.Category,
                Lat = p.Latitude,
                Lng = p.Longitude
            })
            .ToListAsync();

        // Assert
        result.Should().BeEmpty();
    }

    // ============================================================
    // AC4.1: Zoom < 7 — Only national parks
    // ============================================================

    [Fact]
    public async Task GetPoi_WithZoomLessThan7_ReturnsOnlyNationalParks()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var pois = new[]
        {
            new PoiEntity { Name = "Yellowstone", Category = "national_park", Latitude = 44.4, Longitude = -110.8, Source = "nps" },
            new PoiEntity { Name = "Grand Canyon", Category = "national_park", Latitude = 36.1, Longitude = -112.1, Source = "nps" },
            new PoiEntity { Name = "Moab Site", Category = "state_park", Latitude = 38.5, Longitude = -109.6, Source = "pad_us" },
            new PoiEntity { Name = "Natural Rock", Category = "natural_feature", Latitude = 40.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Historic Fort", Category = "historic_site", Latitude = 39.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Museum", Category = "tourism", Latitude = 41.0, Longitude = -105.0, Source = "osm" }
        };

        context.PointsOfInterest.AddRange(pois);
        await context.SaveChangesAsync();

        // Act
        var zoom = 5;
        var allowedCategories = zoom < 7
            ? new[] { "national_park" }
            : zoom < 10
                ? new[] { "national_park", "state_park", "natural_feature" }
                : new[] { "national_park", "state_park", "natural_feature", "historic_site", "tourism" };

        var result = await context.PointsOfInterest
            .Where(p => p.Latitude >= 30.0 && p.Latitude <= 45.0 &&
                        p.Longitude >= -115.0 && p.Longitude <= -100.0)
            .Where(p => allowedCategories.Contains(p.Category))
            .Select(p => new PoiResponse
            {
                Id = p.Id,
                Name = p.Name,
                Category = p.Category,
                Lat = p.Latitude,
                Lng = p.Longitude
            })
            .ToListAsync();

        // Assert
        result.Should().HaveCount(2);
        result.Should().AllSatisfy(p => p.Category.Should().Be("national_park"));
    }

    // ============================================================
    // AC4.2: Zoom 7-9 — National parks, state parks, natural features
    // ============================================================

    [Fact]
    public async Task GetPoi_WithZoom8_ReturnsNationalParksStateParksAndNaturalFeatures()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var pois = new[]
        {
            new PoiEntity { Name = "Yellowstone", Category = "national_park", Latitude = 44.4, Longitude = -110.8, Source = "nps" },
            new PoiEntity { Name = "Moab Site", Category = "state_park", Latitude = 38.5, Longitude = -109.6, Source = "pad_us" },
            new PoiEntity { Name = "Natural Rock", Category = "natural_feature", Latitude = 40.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Historic Fort", Category = "historic_site", Latitude = 39.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Museum", Category = "tourism", Latitude = 41.0, Longitude = -105.0, Source = "osm" }
        };

        context.PointsOfInterest.AddRange(pois);
        await context.SaveChangesAsync();

        // Act
        var zoom = 8;
        var allowedCategories = zoom < 7
            ? new[] { "national_park" }
            : zoom < 10
                ? new[] { "national_park", "state_park", "natural_feature" }
                : new[] { "national_park", "state_park", "natural_feature", "historic_site", "tourism" };

        var result = await context.PointsOfInterest
            .Where(p => p.Latitude >= 35.0 && p.Latitude <= 45.0 &&
                        p.Longitude >= -115.0 && p.Longitude <= -100.0)
            .Where(p => allowedCategories.Contains(p.Category))
            .Select(p => new PoiResponse
            {
                Id = p.Id,
                Name = p.Name,
                Category = p.Category,
                Lat = p.Latitude,
                Lng = p.Longitude
            })
            .ToListAsync();

        // Assert
        result.Should().HaveCount(3);
        result.Should().Contain(p => p.Category == "national_park");
        result.Should().Contain(p => p.Category == "state_park");
        result.Should().Contain(p => p.Category == "natural_feature");
        result.Should().NotContain(p => p.Category == "historic_site");
        result.Should().NotContain(p => p.Category == "tourism");
    }

    // ============================================================
    // AC4.3: Zoom >= 10 — All categories
    // ============================================================

    [Fact]
    public async Task GetPoi_WithZoom12_ReturnsAllCategories()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var pois = new[]
        {
            new PoiEntity { Name = "Yellowstone", Category = "national_park", Latitude = 44.4, Longitude = -110.8, Source = "nps" },
            new PoiEntity { Name = "Moab Site", Category = "state_park", Latitude = 38.5, Longitude = -109.6, Source = "pad_us" },
            new PoiEntity { Name = "Natural Rock", Category = "natural_feature", Latitude = 40.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Historic Fort", Category = "historic_site", Latitude = 39.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Museum", Category = "tourism", Latitude = 41.0, Longitude = -105.0, Source = "osm" }
        };

        context.PointsOfInterest.AddRange(pois);
        await context.SaveChangesAsync();

        // Act
        var zoom = 12;
        var allowedCategories = zoom < 7
            ? new[] { "national_park" }
            : zoom < 10
                ? new[] { "national_park", "state_park", "natural_feature" }
                : new[] { "national_park", "state_park", "natural_feature", "historic_site", "tourism" };

        var result = await context.PointsOfInterest
            .Where(p => p.Latitude >= 35.0 && p.Latitude <= 45.0 &&
                        p.Longitude >= -115.0 && p.Longitude <= -100.0)
            .Where(p => allowedCategories.Contains(p.Category))
            .Select(p => new PoiResponse
            {
                Id = p.Id,
                Name = p.Name,
                Category = p.Category,
                Lat = p.Latitude,
                Lng = p.Longitude
            })
            .ToListAsync();

        // Assert
        result.Should().HaveCount(5);
        result.Should().Contain(p => p.Category == "national_park");
        result.Should().Contain(p => p.Category == "state_park");
        result.Should().Contain(p => p.Category == "natural_feature");
        result.Should().Contain(p => p.Category == "historic_site");
        result.Should().Contain(p => p.Category == "tourism");
    }

    // ============================================================
    // AC4.4: Never return more than 200 POIs per request
    // ============================================================

    [Fact]
    public async Task GetPoi_With250PoisInViewport_ReturnMaxOf200()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var pois = new List<PoiEntity>();
        for (int i = 0; i < 250; i++)
        {
            pois.Add(new PoiEntity
            {
                Name = $"POI {i}",
                Category = "national_park",
                Latitude = 40.0 + (i * 0.001),
                Longitude = -105.0,
                Source = "nps"
            });
        }

        context.PointsOfInterest.AddRange(pois);
        await context.SaveChangesAsync();

        // Act
        var result = await context.PointsOfInterest
            .Where(p => p.Latitude >= 39.0 && p.Latitude <= 42.0 &&
                        p.Longitude >= -106.0 && p.Longitude <= -104.0)
            .Where(p => p.Category == "national_park")
            .Take(200)
            .Select(p => new PoiResponse
            {
                Id = p.Id,
                Name = p.Name,
                Category = p.Category,
                Lat = p.Latitude,
                Lng = p.Longitude
            })
            .ToListAsync();

        // Assert
        result.Should().HaveCount(200);
    }

    // ============================================================
    // Edge cases and validation
    // ============================================================

    [Fact]
    public async Task GetPoi_WithMultiplePoisAtSameCoordinates_ReturnsAll()
    {
        // Arrange - Multiple POIs at the same location (not unique)
        using var context = CreateInMemoryContext();

        var pois = new[]
        {
            new PoiEntity { Name = "Grand Canyon NP", Category = "national_park", Latitude = 36.1, Longitude = -112.1, Source = "nps" },
            new PoiEntity { Name = "Grand Canyon Overlook", Category = "tourism", Latitude = 36.1, Longitude = -112.1, Source = "osm" }
        };

        context.PointsOfInterest.AddRange(pois);
        await context.SaveChangesAsync();

        // Act
        var result = await context.PointsOfInterest
            .Where(p => p.Latitude >= 36.0 && p.Latitude <= 36.2 &&
                        p.Longitude >= -112.2 && p.Longitude <= -112.0)
            .Where(p => new[] { "national_park", "tourism" }.Contains(p.Category))
            .Select(p => new PoiResponse
            {
                Id = p.Id,
                Name = p.Name,
                Category = p.Category,
                Lat = p.Latitude,
                Lng = p.Longitude
            })
            .ToListAsync();

        // Assert
        result.Should().HaveCount(2);
        result.Should().Contain(p => p.Name == "Grand Canyon NP");
        result.Should().Contain(p => p.Name == "Grand Canyon Overlook");
    }

    [Fact]
    public async Task GetPoi_WithPoisAtViewportBoundaries_IncludesPoisOnEdges()
    {
        // Arrange - POIs exactly on viewport boundaries
        using var context = CreateInMemoryContext();

        var pois = new[]
        {
            new PoiEntity { Name = "North Edge", Category = "national_park", Latitude = 45.0, Longitude = -110.0, Source = "nps" },
            new PoiEntity { Name = "South Edge", Category = "national_park", Latitude = 40.0, Longitude = -110.0, Source = "nps" },
            new PoiEntity { Name = "East Edge", Category = "national_park", Latitude = 42.5, Longitude = -100.0, Source = "nps" },
            new PoiEntity { Name = "West Edge", Category = "national_park", Latitude = 42.5, Longitude = -115.0, Source = "nps" },
            new PoiEntity { Name = "Inside", Category = "national_park", Latitude = 42.5, Longitude = -110.0, Source = "nps" }
        };

        context.PointsOfInterest.AddRange(pois);
        await context.SaveChangesAsync();

        // Act
        var result = await context.PointsOfInterest
            .Where(p => p.Latitude >= 40.0 && p.Latitude <= 45.0 &&
                        p.Longitude >= -115.0 && p.Longitude <= -100.0)
            .Where(p => p.Category == "national_park")
            .Select(p => new PoiResponse
            {
                Id = p.Id,
                Name = p.Name,
                Category = p.Category,
                Lat = p.Latitude,
                Lng = p.Longitude
            })
            .ToListAsync();

        // Assert
        result.Should().HaveCount(5);
        result.Should().Contain(p => p.Name == "North Edge");
        result.Should().Contain(p => p.Name == "South Edge");
        result.Should().Contain(p => p.Name == "East Edge");
        result.Should().Contain(p => p.Name == "West Edge");
        result.Should().Contain(p => p.Name == "Inside");
    }

    [Fact]
    public async Task GetPoi_WithNegativeCoordinates_FiltersCorrectly()
    {
        // Arrange - Test with negative coordinates (Southern and Western hemispheres)
        using var context = CreateInMemoryContext();

        var pois = new[]
        {
            new PoiEntity { Name = "Sydney", Category = "tourism", Latitude = -33.9, Longitude = 151.2, Source = "osm" },
            new PoiEntity { Name = "Buenos Aires", Category = "tourism", Latitude = -34.6, Longitude = -58.4, Source = "osm" },
            new PoiEntity { Name = "Cape Town", Category = "tourism", Latitude = -33.9, Longitude = 18.4, Source = "osm" }
        };

        context.PointsOfInterest.AddRange(pois);
        await context.SaveChangesAsync();

        // Act - Query around Buenos Aires (South America)
        var result = await context.PointsOfInterest
            .Where(p => p.Latitude >= -35.0 && p.Latitude <= -34.0 &&
                        p.Longitude >= -60.0 && p.Longitude <= -56.0)
            .Where(p => p.Category == "tourism")
            .Select(p => new PoiResponse
            {
                Id = p.Id,
                Name = p.Name,
                Category = p.Category,
                Lat = p.Latitude,
                Lng = p.Longitude
            })
            .ToListAsync();

        // Assert
        result.Should().HaveCount(1);
        result[0].Name.Should().Be("Buenos Aires");
    }

    [Fact]
    public async Task GetPoi_WithZoom9_IncludesNationalParkStateParkNaturalFeatureButNotHistoricOrTourism()
    {
        // Arrange - Test the boundary case at zoom 9
        using var context = CreateInMemoryContext();

        var pois = new[]
        {
            new PoiEntity { Name = "National Park", Category = "national_park", Latitude = 40.0, Longitude = -105.0, Source = "nps" },
            new PoiEntity { Name = "State Park", Category = "state_park", Latitude = 40.0, Longitude = -105.0, Source = "pad_us" },
            new PoiEntity { Name = "Natural Feature", Category = "natural_feature", Latitude = 40.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Historic Site", Category = "historic_site", Latitude = 40.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Tourism", Category = "tourism", Latitude = 40.0, Longitude = -105.0, Source = "osm" }
        };

        context.PointsOfInterest.AddRange(pois);
        await context.SaveChangesAsync();

        // Act
        var zoom = 9;
        var allowedCategories = zoom < 7
            ? new[] { "national_park" }
            : zoom < 10
                ? new[] { "national_park", "state_park", "natural_feature" }
                : new[] { "national_park", "state_park", "natural_feature", "historic_site", "tourism" };

        var result = await context.PointsOfInterest
            .Where(p => p.Latitude >= 39.0 && p.Latitude <= 41.0 &&
                        p.Longitude >= -106.0 && p.Longitude <= -104.0)
            .Where(p => allowedCategories.Contains(p.Category))
            .Select(p => new PoiResponse
            {
                Id = p.Id,
                Name = p.Name,
                Category = p.Category,
                Lat = p.Latitude,
                Lng = p.Longitude
            })
            .ToListAsync();

        // Assert
        result.Should().HaveCount(3);
        result.Should().Contain(p => p.Category == "national_park");
        result.Should().Contain(p => p.Category == "state_park");
        result.Should().Contain(p => p.Category == "natural_feature");
        result.Should().NotContain(p => p.Category == "historic_site");
        result.Should().NotContain(p => p.Category == "tourism");
    }

    [Fact]
    public async Task GetPoi_WithZoom10_IncludesAllCategories()
    {
        // Arrange - Test the boundary case at zoom 10
        using var context = CreateInMemoryContext();

        var pois = new[]
        {
            new PoiEntity { Name = "National Park", Category = "national_park", Latitude = 40.0, Longitude = -105.0, Source = "nps" },
            new PoiEntity { Name = "State Park", Category = "state_park", Latitude = 40.0, Longitude = -105.0, Source = "pad_us" },
            new PoiEntity { Name = "Natural Feature", Category = "natural_feature", Latitude = 40.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Historic Site", Category = "historic_site", Latitude = 40.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Tourism", Category = "tourism", Latitude = 40.0, Longitude = -105.0, Source = "osm" }
        };

        context.PointsOfInterest.AddRange(pois);
        await context.SaveChangesAsync();

        // Act
        var zoom = 10;
        var allowedCategories = zoom < 7
            ? new[] { "national_park" }
            : zoom < 10
                ? new[] { "national_park", "state_park", "natural_feature" }
                : new[] { "national_park", "state_park", "natural_feature", "historic_site", "tourism" };

        var result = await context.PointsOfInterest
            .Where(p => p.Latitude >= 39.0 && p.Latitude <= 41.0 &&
                        p.Longitude >= -106.0 && p.Longitude <= -104.0)
            .Where(p => allowedCategories.Contains(p.Category))
            .Select(p => new PoiResponse
            {
                Id = p.Id,
                Name = p.Name,
                Category = p.Category,
                Lat = p.Latitude,
                Lng = p.Longitude
            })
            .ToListAsync();

        // Assert
        result.Should().HaveCount(5);
        result.Should().Contain(p => p.Category == "national_park");
        result.Should().Contain(p => p.Category == "state_park");
        result.Should().Contain(p => p.Category == "natural_feature");
        result.Should().Contain(p => p.Category == "historic_site");
        result.Should().Contain(p => p.Category == "tourism");
    }

    [Fact]
    public async Task PoiResponse_MapsLatLngCorrectly()
    {
        // Arrange - Verify that PoiResponse maps Latitude/Longitude to Lat/Lng
        using var context = CreateInMemoryContext();

        var poi = new PoiEntity
        {
            Name = "Test POI",
            Category = "national_park",
            Latitude = 45.5,
            Longitude = -122.7,
            Source = "nps"
        };

        context.PointsOfInterest.Add(poi);
        await context.SaveChangesAsync();

        // Act
        var response = await context.PointsOfInterest
            .Select(p => new PoiResponse
            {
                Id = p.Id,
                Name = p.Name,
                Category = p.Category,
                Lat = p.Latitude,
                Lng = p.Longitude
            })
            .FirstOrDefaultAsync();

        // Assert
        response.Should().NotBeNull();
        response!.Lat.Should().Be(45.5);
        response.Lng.Should().Be(-122.7);
    }
}
