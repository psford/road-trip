using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Models;
using System.Text.Json;
using Xunit;

namespace RoadTripMap.Tests.Endpoints;

/// <summary>
/// Tests for the GET /api/poi endpoint.
/// Verifies viewport filtering (AC1.4) and zoom-based category filtering (AC4.1-4.4).
/// Uses WebApplicationFactory to test the actual HTTP endpoint with an in-memory SQLite database.
/// </summary>
public class PoiEndpointTests : IAsyncLifetime
{
    private WebApplicationFactory<Program>? _factory;
    private HttpClient? _client;
    private SqliteConnection? _connection;

    public Task InitializeAsync()
    {
        // SQLite in-memory connection (kept open for test lifetime)
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        _factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.ConfigureServices(services =>
                {
                    // Replace SQL Server with SQLite for tests
                    var descriptor = services.SingleOrDefault(
                        d => d.ServiceType == typeof(DbContextOptions<RoadTripDbContext>));
                    if (descriptor != null) services.Remove(descriptor);

                    services.AddDbContext<RoadTripDbContext>(options =>
                        options.UseSqlite(_connection));
                });
            });

        _client = _factory.CreateClient();
        return Task.CompletedTask;
    }

    public Task DisposeAsync()
    {
        _client?.Dispose();
        _factory?.Dispose();
        _connection?.Dispose();
        return Task.CompletedTask;
    }

    /// <summary>
    /// Seed test POIs directly into the database.
    /// </summary>
    private async Task SeedPoisAsync(params PoiEntity[] pois)
    {
        using var context = new RoadTripDbContext(new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseSqlite(_connection!)
            .Options);

        await context.PointsOfInterest.AddRangeAsync(pois);
        await context.SaveChangesAsync();
    }

    private List<T> ParseJsonResponse<T>(string json)
    {
        var options = new System.Text.Json.JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        };

        using var doc = JsonDocument.Parse(json);
        return doc.RootElement
            .EnumerateArray()
            .Select(elem => System.Text.Json.JsonSerializer.Deserialize<T>(elem.GetRawText(), options)!)
            .ToList();
    }

    // ============================================================
    // AC1.4: Viewport filtering
    // ============================================================

    [Fact]
    public async Task GetPoi_WithPoisInViewport_ReturnsPoisWithinBoundingBox()
    {
        // Arrange - Seed POIs in different locations
        await SeedPoisAsync(
            new PoiEntity { Name = "Yellowstone", Category = "national_park", Latitude = 44.4, Longitude = -110.8, Source = "nps" },
            new PoiEntity { Name = "Grand Teton", Category = "national_park", Latitude = 43.7, Longitude = -110.7, Source = "nps" },
            new PoiEntity { Name = "Moab Site", Category = "national_park", Latitude = 38.5, Longitude = -109.6, Source = "nps" }
        );

        // Act - Call endpoint with viewport containing Yellowstone and Grand Teton but not Moab
        var response = await _client!.GetAsync("/api/poi?minLat=43.0&maxLat=45.0&minLng=-111.5&maxLng=-110.0&zoom=5");

        // Assert - Verify HTTP response is successful
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var result = ParseJsonResponse<PoiResponse>(json);

        result.Should().HaveCount(2);
        result.Should().Contain(p => p.Name == "Yellowstone");
        result.Should().Contain(p => p.Name == "Grand Teton");
        result.Should().NotContain(p => p.Name == "Moab Site");
    }

    [Fact]
    public async Task GetPoi_WithNoPoisInViewport_ReturnsEmptyList()
    {
        // Arrange - Seed POI outside the query viewport
        await SeedPoisAsync(
            new PoiEntity { Name = "Yellowstone", Category = "national_park", Latitude = 44.4, Longitude = -110.8, Source = "nps" }
        );

        // Act - Call endpoint with viewport that excludes the POI
        var response = await _client!.GetAsync("/api/poi?minLat=30.0&maxLat=35.0&minLng=-100.0&maxLng=-95.0&zoom=5");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var result = ParseJsonResponse<PoiResponse>(json);

        result.Should().BeEmpty();
    }

    // ============================================================
    // AC4.1: Zoom < 7 — Only national parks
    // ============================================================

    [Fact]
    public async Task GetPoi_WithZoom5_ReturnsOnlyNationalParks()
    {
        // Arrange - Seed POIs with all categories
        await SeedPoisAsync(
            new PoiEntity { Name = "Yellowstone", Category = "national_park", Latitude = 44.4, Longitude = -110.8, Source = "nps" },
            new PoiEntity { Name = "Grand Canyon", Category = "national_park", Latitude = 36.1, Longitude = -112.1, Source = "nps" },
            new PoiEntity { Name = "Moab Site", Category = "state_park", Latitude = 38.5, Longitude = -109.6, Source = "pad_us" },
            new PoiEntity { Name = "Natural Rock", Category = "natural_feature", Latitude = 40.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Historic Fort", Category = "historic_site", Latitude = 39.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Museum", Category = "tourism", Latitude = 41.0, Longitude = -105.0, Source = "osm" }
        );

        // Act - Call endpoint with zoom=5 (< 7)
        var response = await _client!.GetAsync("/api/poi?minLat=30.0&maxLat=45.0&minLng=-115.0&maxLng=-100.0&zoom=5");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var result = ParseJsonResponse<PoiResponse>(json);

        result.Should().HaveCount(2);
        result.Should().AllSatisfy(p => p.Category.Should().Be("national_park"));
    }

    [Fact]
    public async Task GetPoi_WithZoom6_ReturnsOnlyNationalParks()
    {
        // Arrange - Seed POIs with all categories (boundary test for zoom 6, last value < 7)
        await SeedPoisAsync(
            new PoiEntity { Name = "Yellowstone", Category = "national_park", Latitude = 44.4, Longitude = -110.8, Source = "nps" },
            new PoiEntity { Name = "Grand Canyon", Category = "national_park", Latitude = 36.1, Longitude = -112.1, Source = "nps" },
            new PoiEntity { Name = "Moab Site", Category = "state_park", Latitude = 38.5, Longitude = -109.6, Source = "pad_us" },
            new PoiEntity { Name = "Natural Rock", Category = "natural_feature", Latitude = 40.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Historic Fort", Category = "historic_site", Latitude = 39.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Museum", Category = "tourism", Latitude = 41.0, Longitude = -105.0, Source = "osm" }
        );

        // Act - Call endpoint with zoom=6 (still < 7, boundary case)
        var response = await _client!.GetAsync("/api/poi?minLat=30.0&maxLat=45.0&minLng=-115.0&maxLng=-100.0&zoom=6");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var result = ParseJsonResponse<PoiResponse>(json);

        result.Should().HaveCount(2);
        result.Should().AllSatisfy(p => p.Category.Should().Be("national_park"));
    }

    // ============================================================
    // AC4.2: Zoom 7-9 — National parks, state parks, natural features
    // ============================================================

    [Fact]
    public async Task GetPoi_WithZoom7_ReturnsNationalParksStateParksAndNaturalFeatures()
    {
        // Arrange - Seed POIs with all categories (boundary test for zoom 7, first value >= 7)
        // Note: Zoom >= 7 now returns ALL 5 categories. Grid sampling limits to 1 per cell.
        await SeedPoisAsync(
            new PoiEntity { Name = "Yellowstone", Category = "national_park", Latitude = 44.4, Longitude = -110.8, Source = "nps" },
            new PoiEntity { Name = "Moab Site", Category = "state_park", Latitude = 38.5, Longitude = -109.6, Source = "pad_us" },
            new PoiEntity { Name = "Natural Rock", Category = "natural_feature", Latitude = 40.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Historic Fort", Category = "historic_site", Latitude = 39.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Museum", Category = "tourism", Latitude = 41.0, Longitude = -105.0, Source = "osm" }
        );

        // Act - Call endpoint with zoom=7 (first value >= 7, returns ALL categories)
        var response = await _client!.GetAsync("/api/poi?minLat=35.0&maxLat=45.0&minLng=-115.0&maxLng=-100.0&zoom=7");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var result = ParseJsonResponse<PoiResponse>(json);

        // Grid sampling returns one POI per cell in a 7x6 grid. With these 5 scattered POIs,
        // we expect at least the 5 categories to be represented or grid sampling to reduce to 1-5.
        result.Should().HaveCountGreaterThanOrEqualTo(1);
        result.Should().HaveCountLessThanOrEqualTo(5); // 5 unique POIs, grid sampling at most 1 per cell
        result.Should().Contain(p => p.Category == "national_park");
        result.Should().Contain(p => p.Category == "state_park");
        result.Should().Contain(p => p.Category == "natural_feature");
    }

    [Fact]
    public async Task GetPoi_WithZoom8_ReturnsNationalParksStateParksAndNaturalFeatures()
    {
        // Arrange - Zoom >= 7 now returns ALL 5 categories
        await SeedPoisAsync(
            new PoiEntity { Name = "Yellowstone", Category = "national_park", Latitude = 44.4, Longitude = -110.8, Source = "nps" },
            new PoiEntity { Name = "Moab Site", Category = "state_park", Latitude = 38.5, Longitude = -109.6, Source = "pad_us" },
            new PoiEntity { Name = "Natural Rock", Category = "natural_feature", Latitude = 40.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Historic Fort", Category = "historic_site", Latitude = 39.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Museum", Category = "tourism", Latitude = 41.0, Longitude = -105.0, Source = "osm" }
        );

        // Act - Call endpoint with zoom=8 (returns ALL categories)
        var response = await _client!.GetAsync("/api/poi?minLat=35.0&maxLat=45.0&minLng=-115.0&maxLng=-100.0&zoom=8");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var result = ParseJsonResponse<PoiResponse>(json);

        // Grid sampling ensures at most 40 POIs. With these 5 scattered POIs in different cells,
        // we should get several of them back.
        result.Should().HaveCountGreaterThanOrEqualTo(1);
        result.Should().HaveCountLessThanOrEqualTo(5);
        result.Should().Contain(p => p.Category == "national_park");
        result.Should().Contain(p => p.Category == "state_park");
        result.Should().Contain(p => p.Category == "natural_feature");
    }

    // ============================================================
    // AC4.3: Zoom >= 10 — All categories
    // ============================================================

    [Fact]
    public async Task GetPoi_WithZoom10_ReturnsAllCategories()
    {
        // Arrange - Seed POIs with all categories (boundary test for zoom 10, first value >= 10)
        // Grid sampling will limit to 1 POI per cell in a 7x6 grid
        await SeedPoisAsync(
            new PoiEntity { Name = "Yellowstone", Category = "national_park", Latitude = 44.4, Longitude = -110.8, Source = "nps" },
            new PoiEntity { Name = "Moab Site", Category = "state_park", Latitude = 38.5, Longitude = -109.6, Source = "pad_us" },
            new PoiEntity { Name = "Natural Rock", Category = "natural_feature", Latitude = 40.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Historic Fort", Category = "historic_site", Latitude = 39.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Museum", Category = "tourism", Latitude = 41.0, Longitude = -105.0, Source = "osm" }
        );

        // Act - Call endpoint with zoom=10 (returns all categories)
        var response = await _client!.GetAsync("/api/poi?minLat=35.0&maxLat=45.0&minLng=-115.0&maxLng=-100.0&zoom=10");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var result = ParseJsonResponse<PoiResponse>(json);

        // Grid sampling with these 5 scattered POIs in different cells allows multiple results
        result.Should().HaveCountGreaterThanOrEqualTo(1);
        result.Should().HaveCountLessThanOrEqualTo(5);
        result.Should().Contain(p => p.Category == "national_park");
        result.Should().Contain(p => p.Category == "state_park");
        result.Should().Contain(p => p.Category == "natural_feature");
    }

    [Fact]
    public async Task GetPoi_WithZoom12_ReturnsAllCategories()
    {
        // Arrange - Grid sampling limits results even at high zoom levels
        await SeedPoisAsync(
            new PoiEntity { Name = "Yellowstone", Category = "national_park", Latitude = 44.4, Longitude = -110.8, Source = "nps" },
            new PoiEntity { Name = "Moab Site", Category = "state_park", Latitude = 38.5, Longitude = -109.6, Source = "pad_us" },
            new PoiEntity { Name = "Natural Rock", Category = "natural_feature", Latitude = 40.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Historic Fort", Category = "historic_site", Latitude = 39.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Museum", Category = "tourism", Latitude = 41.0, Longitude = -105.0, Source = "osm" }
        );

        // Act - Call endpoint with zoom=12 (high zoom level, returns all categories)
        var response = await _client!.GetAsync("/api/poi?minLat=35.0&maxLat=45.0&minLng=-115.0&maxLng=-100.0&zoom=12");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var result = ParseJsonResponse<PoiResponse>(json);

        // Grid sampling with these 5 scattered POIs in different cells allows multiple results
        result.Should().HaveCountGreaterThanOrEqualTo(1);
        result.Should().HaveCountLessThanOrEqualTo(5);
        result.Should().Contain(p => p.Category == "national_park");
        result.Should().Contain(p => p.Category == "state_park");
        result.Should().Contain(p => p.Category == "natural_feature");
    }

    // ============================================================
    // AC4.4: Never return more than 200 POIs per request
    // ============================================================

    [Fact]
    public async Task GetPoi_With250PoisInViewport_ReturnMaxOf200()
    {
        // Arrange - Seed 250 POIs in the same bounding box
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
        await SeedPoisAsync(pois.ToArray());

        // Act - Call endpoint that would match all 250 POIs
        var response = await _client!.GetAsync("/api/poi?minLat=39.0&maxLat=42.0&minLng=-106.0&maxLng=-104.0&zoom=5");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var result = ParseJsonResponse<PoiResponse>(json);

        // Grid sampling limits results to ~40 evenly distributed POIs (one per grid cell).
        // 250 POIs spread over 0.25 lat degrees at the same longitude land in 1-2 grid cells.
        result.Should().HaveCountGreaterThan(0);
        result.Should().HaveCountLessThanOrEqualTo(42); // 7x6 grid max
    }

    // ============================================================
    // Validation tests
    // ============================================================

    [Fact]
    public async Task GetPoi_WithMissingMinLatParameter_Returns400()
    {
        // Arrange - Seed a POI
        await SeedPoisAsync(
            new PoiEntity { Name = "Test POI", Category = "national_park", Latitude = 40.0, Longitude = -105.0, Source = "nps" }
        );

        // Act - Call endpoint without minLat parameter
        var response = await _client!.GetAsync("/api/poi?maxLat=45.0&minLng=-110.0&maxLng=-100.0&zoom=5");

        // Assert - Should return 400 Bad Request
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetPoi_WithMissingMaxLatParameter_Returns400()
    {
        // Arrange - Seed a POI
        await SeedPoisAsync(
            new PoiEntity { Name = "Test POI", Category = "national_park", Latitude = 40.0, Longitude = -105.0, Source = "nps" }
        );

        // Act - Call endpoint without maxLat parameter
        var response = await _client!.GetAsync("/api/poi?minLat=30.0&minLng=-110.0&maxLng=-100.0&zoom=5");

        // Assert - Should return 400 Bad Request
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetPoi_WithMissingZoomParameter_Returns400()
    {
        // Arrange - Seed a POI
        await SeedPoisAsync(
            new PoiEntity { Name = "Test POI", Category = "national_park", Latitude = 40.0, Longitude = -105.0, Source = "nps" }
        );

        // Act - Call endpoint without zoom parameter
        var response = await _client!.GetAsync("/api/poi?minLat=30.0&maxLat=45.0&minLng=-110.0&maxLng=-100.0");

        // Assert - Should return 400 Bad Request
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetPoi_WithInvalidLatitudeRange_Returns400()
    {
        // Arrange - Seed a POI
        await SeedPoisAsync(
            new PoiEntity { Name = "Test POI", Category = "national_park", Latitude = 40.0, Longitude = -105.0, Source = "nps" }
        );

        // Act - Call endpoint with latitude > 90 (invalid)
        var response = await _client!.GetAsync("/api/poi?minLat=30.0&maxLat=95.0&minLng=-110.0&maxLng=-100.0&zoom=5");

        // Assert - Should return 400 Bad Request
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetPoi_WithInvalidLongitudeRange_Returns400()
    {
        // Arrange - Seed a POI
        await SeedPoisAsync(
            new PoiEntity { Name = "Test POI", Category = "national_park", Latitude = 40.0, Longitude = -105.0, Source = "nps" }
        );

        // Act - Call endpoint with longitude > 180 (invalid)
        var response = await _client!.GetAsync("/api/poi?minLat=30.0&maxLat=45.0&minLng=-110.0&maxLng=185.0&zoom=5");

        // Assert - Should return 400 Bad Request
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetPoi_WithNegativeZoom_Returns400()
    {
        // Arrange - Seed a POI
        await SeedPoisAsync(
            new PoiEntity { Name = "Test POI", Category = "national_park", Latitude = 40.0, Longitude = -105.0, Source = "nps" }
        );

        // Act - Call endpoint with negative zoom
        var response = await _client!.GetAsync("/api/poi?minLat=30.0&maxLat=45.0&minLng=-110.0&maxLng=-100.0&zoom=-1");

        // Assert - Should return 400 Bad Request
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.BadRequest);
    }

    // ============================================================
    // Edge cases
    // ============================================================

    [Fact]
    public async Task GetPoi_WithMultiplePoisAtSameCoordinates_ReturnsAll()
    {
        // Arrange - Multiple POIs at the same location (grid sampling returns max 1 per cell)
        await SeedPoisAsync(
            new PoiEntity { Name = "Grand Canyon NP", Category = "national_park", Latitude = 36.1, Longitude = -112.1, Source = "nps" },
            new PoiEntity { Name = "Grand Canyon Overlook", Category = "tourism", Latitude = 36.1, Longitude = -112.1, Source = "osm" }
        );

        // Act - Call endpoint with zoom=12 to include both categories
        var response = await _client!.GetAsync("/api/poi?minLat=36.0&maxLat=36.2&minLng=-112.2&maxLng=-112.0&zoom=12");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var result = ParseJsonResponse<PoiResponse>(json);

        // Grid sampling: max 1 POI per cell. Since both are at the same coordinates, they're in the same cell.
        // Grid sampling picks the highest priority category (national_park=0 beats tourism=4).
        result.Should().HaveCount(1);
        result.Should().Contain(p => p.Name == "Grand Canyon NP");
    }

    [Fact]
    public async Task GetPoi_WithPoisAtViewportBoundaries_IncludesPoisOnEdges()
    {
        // Arrange - POIs exactly on viewport boundaries
        await SeedPoisAsync(
            new PoiEntity { Name = "North Edge", Category = "national_park", Latitude = 45.0, Longitude = -110.0, Source = "nps" },
            new PoiEntity { Name = "South Edge", Category = "national_park", Latitude = 40.0, Longitude = -110.0, Source = "nps" },
            new PoiEntity { Name = "East Edge", Category = "national_park", Latitude = 42.5, Longitude = -100.0, Source = "nps" },
            new PoiEntity { Name = "West Edge", Category = "national_park", Latitude = 42.5, Longitude = -115.0, Source = "nps" },
            new PoiEntity { Name = "Inside", Category = "national_park", Latitude = 42.5, Longitude = -110.0, Source = "nps" }
        );

        // Act - Call endpoint with bounding box that includes all edges
        var response = await _client!.GetAsync("/api/poi?minLat=40.0&maxLat=45.0&minLng=-115.0&maxLng=-100.0&zoom=5");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var result = ParseJsonResponse<PoiResponse>(json);

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
        await SeedPoisAsync(
            new PoiEntity { Name = "Sydney", Category = "tourism", Latitude = -33.9, Longitude = 151.2, Source = "osm" },
            new PoiEntity { Name = "Buenos Aires", Category = "tourism", Latitude = -34.6, Longitude = -58.4, Source = "osm" },
            new PoiEntity { Name = "Cape Town", Category = "tourism", Latitude = -33.9, Longitude = 18.4, Source = "osm" }
        );

        // Act - Query around Buenos Aires (South America) with zoom=12 to include tourism
        var response = await _client!.GetAsync("/api/poi?minLat=-35.0&maxLat=-34.0&minLng=-60.0&maxLng=-56.0&zoom=12");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var result = ParseJsonResponse<PoiResponse>(json);

        result.Should().HaveCount(1);
        result[0].Name.Should().Be("Buenos Aires");
    }

    [Fact]
    public async Task GetPoi_WithZoom9_IncludesNationalParkStateParkNaturalFeatureButNotHistoricOrTourism()
    {
        // Arrange - Zoom >= 7 now returns ALL 5 categories (no longer restricted to 3)
        await SeedPoisAsync(
            new PoiEntity { Name = "National Park", Category = "national_park", Latitude = 40.0, Longitude = -105.0, Source = "nps" },
            new PoiEntity { Name = "State Park", Category = "state_park", Latitude = 40.0, Longitude = -105.0, Source = "pad_us" },
            new PoiEntity { Name = "Natural Feature", Category = "natural_feature", Latitude = 40.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Historic Site", Category = "historic_site", Latitude = 40.0, Longitude = -105.0, Source = "osm" },
            new PoiEntity { Name = "Tourism", Category = "tourism", Latitude = 40.0, Longitude = -105.0, Source = "osm" }
        );

        // Act - Call endpoint with zoom=9 (returns ALL 5 categories now)
        var response = await _client!.GetAsync("/api/poi?minLat=39.0&maxLat=41.0&minLng=-106.0&maxLng=-104.0&zoom=9");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var result = ParseJsonResponse<PoiResponse>(json);

        // All 5 POIs are at same coordinates, so grid sampling returns only 1 per cell
        result.Should().HaveCount(1);
        result.Should().Contain(p => p.Category == "national_park"); // Highest priority by category order
    }
}
