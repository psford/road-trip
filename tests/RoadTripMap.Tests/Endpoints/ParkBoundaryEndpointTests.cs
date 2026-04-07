using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using RoadTripMap;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using System.Text.Json;
using Xunit;

namespace RoadTripMap.Tests.Endpoints;

/// <summary>
/// Tests for the GET /api/park-boundaries endpoint.
/// Verifies viewport filtering (AC2.1), detail level selection (AC2.2),
/// result capping and sorting (AC2.3), validation (AC2.4), and zoom gating (AC2.5).
/// Uses WebApplicationFactory to test the actual HTTP endpoint with an in-memory SQLite database.
/// </summary>
[Collection("EndpointRegistry")]
public class ParkBoundaryEndpointTests : IAsyncLifetime
{
    private WebApplicationFactory<Program>? _factory;
    private HttpClient? _client;
    private SqliteConnection? _connection;

    public Task InitializeAsync()
    {
        // Set required environment variables for ValidateAll()
        Environment.SetEnvironmentVariable("WSL_SQL_CONNECTION", "Data Source=:memory:");
        Environment.SetEnvironmentVariable("RT_DESIGN_CONNECTION", "Data Source=:memory:");
        Environment.SetEnvironmentVariable("NPS_API_KEY", "test-key");

        // Ensure EndpointRegistry uses the real endpoints.json, not test fixture
        EndpointRegistry.OverrideFilePath = null;
        EndpointRegistry.Reset();

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
    /// Seed test park boundaries directly into the database.
    /// </summary>
    private async Task SeedParksAsync(params ParkBoundaryEntity[] parks)
    {
        using var context = new RoadTripDbContext(new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseSqlite(_connection!)
            .Options);

        await context.ParkBoundaries.AddRangeAsync(parks);
        await context.SaveChangesAsync();
    }

    private JsonDocument ParseJsonResponse(string json)
    {
        return JsonDocument.Parse(json);
    }

    // ============================================================
    // AC2.1: Viewport-based delivery - GeoJSON FeatureCollection
    // ============================================================

    [Fact]
    public async Task GetParkBoundaries_WithParksInViewport_ReturnsGeoJsonFeatureCollection()
    {
        // Arrange - Seed 3 parks with known bboxes
        var mockGeometry = """{"type":"MultiPolygon","coordinates":[[[[0,0],[0,1],[1,1],[1,0],[0,0]]]]}""";
        await SeedParksAsync(
            new ParkBoundaryEntity
            {
                Name = "Park 1",
                State = "WA",
                Category = "SP",
                GisAcres = 1000,
                CentroidLat = 48.0,
                CentroidLng = -122.0,
                MinLat = 47.0,
                MaxLat = 49.0,
                MinLng = -123.0,
                MaxLng = -121.0,
                GeoJsonFull = mockGeometry,
                GeoJsonModerate = mockGeometry,
                GeoJsonSimplified = mockGeometry,
                Source = "test"
            },
            new ParkBoundaryEntity
            {
                Name = "Park 2",
                State = "OR",
                Category = "SP",
                GisAcres = 2000,
                CentroidLat = 43.0,
                CentroidLng = -121.0,
                MinLat = 42.0,
                MaxLat = 44.0,
                MinLng = -122.0,
                MaxLng = -120.0,
                GeoJsonFull = mockGeometry,
                GeoJsonModerate = mockGeometry,
                GeoJsonSimplified = mockGeometry,
                Source = "test"
            },
            new ParkBoundaryEntity
            {
                Name = "Park 3",
                State = "CA",
                Category = "SP",
                GisAcres = 3000,
                CentroidLat = 35.0,
                CentroidLng = -119.0,
                MinLat = 34.0,
                MaxLat = 36.0,
                MinLng = -120.0,
                MaxLng = -118.0,
                GeoJsonFull = mockGeometry,
                GeoJsonModerate = mockGeometry,
                GeoJsonSimplified = mockGeometry,
                Source = "test"
            }
        );

        // Act - Call endpoint with viewport that overlaps Park 1 and Park 2
        var response = await _client!.GetAsync("/api/park-boundaries?minLat=42.0&maxLat=49.0&minLng=-123.0&maxLng=-120.0&zoom=8");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        using var doc = ParseJsonResponse(json);

        doc.RootElement.TryGetProperty("type", out var typeElement).Should().BeTrue();
        typeElement.GetString().Should().Be("FeatureCollection");

        doc.RootElement.TryGetProperty("features", out var featuresElement).Should().BeTrue();
        var features = featuresElement.EnumerateArray().ToList();
        features.Should().HaveCount(2);

        // Check feature structure
        foreach (var feature in features)
        {
            feature.TryGetProperty("type", out var featureTypeElement).Should().BeTrue();
            featureTypeElement.GetString().Should().Be("Feature");

            feature.TryGetProperty("properties", out var propsElement).Should().BeTrue();
            propsElement.TryGetProperty("id", out _).Should().BeTrue();
            propsElement.TryGetProperty("name", out _).Should().BeTrue();
            propsElement.TryGetProperty("state", out _).Should().BeTrue();
            propsElement.TryGetProperty("category", out _).Should().BeTrue();
            propsElement.TryGetProperty("centroidLat", out _).Should().BeTrue();
            propsElement.TryGetProperty("centroidLng", out _).Should().BeTrue();

            feature.TryGetProperty("geometry", out var geometryElement).Should().BeTrue();
            geometryElement.TryGetProperty("type", out var geoTypeElement).Should().BeTrue();
            geoTypeElement.GetString().Should().Be("MultiPolygon");
        }
    }

    // ============================================================
    // AC2.2: Detail level selection
    // ============================================================

    [Fact]
    public async Task GetParkBoundaries_WithDetailFull_ReturnsFullGeometry()
    {
        // Arrange - Seed 1 park with different geometries
        var fullGeometry = """{"type":"MultiPolygon","coordinates":[[[[0,0],[0,10],[10,10],[10,0],[0,0]]]]}""";
        var moderateGeometry = """{"type":"MultiPolygon","coordinates":[[[[0,0],[0,5],[5,5],[5,0],[0,0]]]]}""";
        var simplifiedGeometry = """{"type":"MultiPolygon","coordinates":[[[[0,0],[0,2],[2,2],[2,0],[0,0]]]]}""";

        await SeedParksAsync(
            new ParkBoundaryEntity
            {
                Name = "Test Park",
                State = "WA",
                Category = "SP",
                GisAcres = 5000,
                CentroidLat = 48.0,
                CentroidLng = -122.0,
                MinLat = 47.0,
                MaxLat = 49.0,
                MinLng = -123.0,
                MaxLng = -121.0,
                GeoJsonFull = fullGeometry,
                GeoJsonModerate = moderateGeometry,
                GeoJsonSimplified = simplifiedGeometry,
                Source = "test"
            }
        );

        // Act - Request with detail=full
        var response = await _client!.GetAsync("/api/park-boundaries?minLat=47.0&maxLat=49.0&minLng=-123.0&maxLng=-121.0&zoom=8&detail=full");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = ParseJsonResponse(json);
        var features = doc.RootElement.GetProperty("features").EnumerateArray().ToList();
        features.Should().HaveCount(1);
        var geometry = features[0].GetProperty("geometry");
        var coords = geometry.GetProperty("coordinates");
        coords.GetRawText().Should().Contain("10");

        // Act - Request with detail=simplified
        var response2 = await _client!.GetAsync("/api/park-boundaries?minLat=47.0&maxLat=49.0&minLng=-123.0&maxLng=-121.0&zoom=8&detail=simplified");

        // Assert
        response2.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);
        var json2 = await response2.Content.ReadAsStringAsync();
        using var doc2 = ParseJsonResponse(json2);
        var features2 = doc2.RootElement.GetProperty("features").EnumerateArray().ToList();
        features2.Should().HaveCount(1);
        var geometry2 = features2[0].GetProperty("geometry");
        var coords2 = geometry2.GetProperty("coordinates");
        coords2.GetRawText().Should().Contain("2");
        coords2.GetRawText().Should().NotContain("10");

        // Act - Request without detail param (should default to moderate)
        var response3 = await _client!.GetAsync("/api/park-boundaries?minLat=47.0&maxLat=49.0&minLng=-123.0&maxLng=-121.0&zoom=8");

        // Assert
        response3.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);
        var json3 = await response3.Content.ReadAsStringAsync();
        using var doc3 = ParseJsonResponse(json3);
        var features3 = doc3.RootElement.GetProperty("features").EnumerateArray().ToList();
        features3.Should().HaveCount(1);
        var geometry3 = features3[0].GetProperty("geometry");
        var coords3 = geometry3.GetProperty("coordinates");
        coords3.GetRawText().Should().Contain("5");
        coords3.GetRawText().Should().NotContain("10");
        coords3.GetRawText().Should().NotContain("[2");
    }

    // ============================================================
    // AC2.3: Result capping at 50 and sorting by GisAcres descending
    // ============================================================

    [Fact]
    public async Task GetParkBoundaries_With60ParksInViewport_ReturnMax50SortedByAcresDescending()
    {
        // Arrange - Seed 60 parks all within viewport
        var mockGeometry = """{"type":"MultiPolygon","coordinates":[[[[0,0],[0,1],[1,1],[1,0],[0,0]]]]}""";
        var parks = new List<ParkBoundaryEntity>();
        for (int i = 0; i < 60; i++)
        {
            parks.Add(new ParkBoundaryEntity
            {
                Name = $"Park {i}",
                State = "WA",
                Category = "SP",
                GisAcres = i * 100, // Vary acres to test sorting
                CentroidLat = 48.0,
                CentroidLng = -122.0,
                MinLat = 47.0,
                MaxLat = 49.0,
                MinLng = -123.0,
                MaxLng = -121.0,
                GeoJsonFull = mockGeometry,
                GeoJsonModerate = mockGeometry,
                GeoJsonSimplified = mockGeometry,
                Source = "test"
            });
        }
        await SeedParksAsync(parks.ToArray());

        // Act
        var response = await _client!.GetAsync("/api/park-boundaries?minLat=47.0&maxLat=49.0&minLng=-123.0&maxLng=-121.0&zoom=8");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = ParseJsonResponse(json);
        var features = doc.RootElement.GetProperty("features").EnumerateArray().ToList();

        features.Should().HaveCount(50);

        // Check sorting: first feature should have highest GisAcres
        var firstProps = features[0].GetProperty("properties");
        var secondProps = features[1].GetProperty("properties");

        int firstAcres = firstProps.GetProperty("gisAcres").GetInt32();
        int secondAcres = secondProps.GetProperty("gisAcres").GetInt32();

        firstAcres.Should().BeGreaterThan(secondAcres);
    }

    // ============================================================
    // AC2.4: Validation failures return 400
    // ============================================================

    [Fact]
    public async Task GetParkBoundaries_WithMissingMinLat_Returns400()
    {
        // Act
        var response = await _client!.GetAsync("/api/park-boundaries?maxLat=45.0&minLng=-110.0&maxLng=-100.0&zoom=8");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetParkBoundaries_WithMissingZoom_Returns400()
    {
        // Act
        var response = await _client!.GetAsync("/api/park-boundaries?minLat=30.0&maxLat=45.0&minLng=-110.0&maxLng=-100.0");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetParkBoundaries_WithInvalidLatitude_Returns400()
    {
        // Act
        var response = await _client!.GetAsync("/api/park-boundaries?minLat=30.0&maxLat=95.0&minLng=-110.0&maxLng=-100.0&zoom=8");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetParkBoundaries_WithInvalidLongitude_Returns400()
    {
        // Act
        var response = await _client!.GetAsync("/api/park-boundaries?minLat=30.0&maxLat=45.0&minLng=-110.0&maxLng=185.0&zoom=8");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetParkBoundaries_WithNegativeZoom_Returns400()
    {
        // Act
        var response = await _client!.GetAsync("/api/park-boundaries?minLat=30.0&maxLat=45.0&minLng=-110.0&maxLng=-100.0&zoom=-1");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetParkBoundaries_WithInvalidDetailValue_Returns400()
    {
        // Act
        var response = await _client!.GetAsync("/api/park-boundaries?minLat=30.0&maxLat=45.0&minLng=-110.0&maxLng=-100.0&zoom=8&detail=ultra");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.BadRequest);
    }

    // ============================================================
    // AC2.5: Zoom gating - zoom < 8 returns empty features
    // ============================================================

    [Fact]
    public async Task GetParkBoundaries_WithZoom7_ReturnsEmptyFeatures()
    {
        // Arrange
        var mockGeometry = """{"type":"MultiPolygon","coordinates":[[[[0,0],[0,1],[1,1],[1,0],[0,0]]]]}""";
        await SeedParksAsync(
            new ParkBoundaryEntity
            {
                Name = "Park in viewport",
                State = "WA",
                Category = "SP",
                GisAcres = 1000,
                CentroidLat = 48.0,
                CentroidLng = -122.0,
                MinLat = 47.0,
                MaxLat = 49.0,
                MinLng = -123.0,
                MaxLng = -121.0,
                GeoJsonFull = mockGeometry,
                GeoJsonModerate = mockGeometry,
                GeoJsonSimplified = mockGeometry,
                Source = "test"
            }
        );

        // Act
        var response = await _client!.GetAsync("/api/park-boundaries?minLat=47.0&maxLat=49.0&minLng=-123.0&maxLng=-121.0&zoom=7");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = ParseJsonResponse(json);

        doc.RootElement.GetProperty("type").GetString().Should().Be("FeatureCollection");
        var features = doc.RootElement.GetProperty("features").EnumerateArray().ToList();
        features.Should().BeEmpty();
    }

    [Fact]
    public async Task GetParkBoundaries_WithZoom8_ReturnsFeatures()
    {
        // Arrange
        var mockGeometry = """{"type":"MultiPolygon","coordinates":[[[[0,0],[0,1],[1,1],[1,0],[0,0]]]]}""";
        await SeedParksAsync(
            new ParkBoundaryEntity
            {
                Name = "Park in viewport",
                State = "WA",
                Category = "SP",
                GisAcres = 1000,
                CentroidLat = 48.0,
                CentroidLng = -122.0,
                MinLat = 47.0,
                MaxLat = 49.0,
                MinLng = -123.0,
                MaxLng = -121.0,
                GeoJsonFull = mockGeometry,
                GeoJsonModerate = mockGeometry,
                GeoJsonSimplified = mockGeometry,
                Source = "test"
            }
        );

        // Act
        var response = await _client!.GetAsync("/api/park-boundaries?minLat=47.0&maxLat=49.0&minLng=-123.0&maxLng=-121.0&zoom=8");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = ParseJsonResponse(json);

        doc.RootElement.GetProperty("type").GetString().Should().Be("FeatureCollection");
        var features = doc.RootElement.GetProperty("features").EnumerateArray().ToList();
        features.Should().HaveCount(1);
    }
}
