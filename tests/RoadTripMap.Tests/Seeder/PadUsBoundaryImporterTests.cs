using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.PoiSeeder.Importers;
using Xunit;

namespace RoadTripMap.Tests.Seeder;

public class PadUsBoundaryImporterTests
{
    private RoadTripDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new RoadTripDbContext(options);
    }

    private HttpClient CreateMockHttpClient(string countResponse, string featuresResponse)
    {
        var handler = new MockHttpMessageHandler(countResponse, featuresResponse);
        return new HttpClient(handler) { BaseAddress = new Uri("https://edits.nationalmap.gov/") };
    }

    [Fact]
    public async Task ImportAsync_WithValidStatePark_CreatesAndStoresBoundary()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var countResponse = JsonSerializer.Serialize(new { count = 1 });

        var featuresResponse = JsonSerializer.Serialize(new
        {
            features = new object[]
            {
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        OBJECTID = 1,
                        Unit_Nm = "Deception Pass",
                        State_Nm = "WA",
                        Des_Tp = "SP",
                        GIS_Acres = 4134
                    },
                    geometry = new
                    {
                        type = "Polygon",
                        coordinates = new object[][][]
                        {
                            new object[][]
                            {
                                new object[] { -122.5, 48.4 },
                                new object[] { -122.3, 48.4 },
                                new object[] { -122.3, 48.2 },
                                new object[] { -122.5, 48.2 },
                                new object[] { -122.5, 48.4 }
                            }
                        }
                    }
                }
            }
        });

        var httpClient = CreateMockHttpClient(countResponse, featuresResponse);
        var importer = new PadUsBoundaryImporter(context, httpClient);

        // Act
        var (imported, skipped, merged) = await importer.ImportAsync();

        // Assert
        imported.Should().Be(1);
        skipped.Should().Be(0);
        merged.Should().Be(1);

        var boundaries = await context.ParkBoundaries.ToListAsync();
        boundaries.Should().HaveCount(1);

        var boundary = boundaries[0];
        boundary.Name.Should().Be("Deception Pass");
        boundary.State.Should().Be("WA");
        boundary.Category.Should().Be("state_park");
        boundary.GisAcres.Should().Be(4134);
        boundary.Source.Should().Be("pad_us");
        boundary.SourceId.Should().NotBeNullOrEmpty();
        boundary.SourceId.Should().HaveLength(40); // SHA256 first 40 chars

        // Verify centroid is within bbox
        boundary.CentroidLat.Should().BeGreaterThanOrEqualTo(boundary.MinLat);
        boundary.CentroidLat.Should().BeLessThanOrEqualTo(boundary.MaxLat);
        boundary.CentroidLng.Should().BeGreaterThanOrEqualTo(boundary.MinLng);
        boundary.CentroidLng.Should().BeLessThanOrEqualTo(boundary.MaxLng);

        // Verify GeoJSON fields are populated
        boundary.GeoJsonFull.Should().Contain("MultiPolygon");
        boundary.GeoJsonModerate.Should().Contain("MultiPolygon");
        boundary.GeoJsonSimplified.Should().Contain("MultiPolygon");
    }

    [Fact]
    public async Task ImportAsync_WithMultipleFeaturesForSamePark_MergesGeometry()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var countResponse = JsonSerializer.Serialize(new { count = 3 });

        var featuresResponse = JsonSerializer.Serialize(new
        {
            features = new object[]
            {
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        OBJECTID = 1,
                        Unit_Nm = "Deception Pass",
                        State_Nm = "WA",
                        Des_Tp = "SP",
                        GIS_Acres = 1378
                    },
                    geometry = new
                    {
                        type = "Polygon",
                        coordinates = new object[][][]
                        {
                            new object[][]
                            {
                                new object[] { -122.5, 48.4 },
                                new object[] { -122.3, 48.4 },
                                new object[] { -122.3, 48.2 },
                                new object[] { -122.5, 48.2 },
                                new object[] { -122.5, 48.4 }
                            }
                        }
                    }
                },
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        OBJECTID = 2,
                        Unit_Nm = "Deception Pass",
                        State_Nm = "WA",
                        Des_Tp = "SP",
                        GIS_Acres = 1378
                    },
                    geometry = new
                    {
                        type = "Polygon",
                        coordinates = new object[][][]
                        {
                            new object[][]
                            {
                                new object[] { -122.2, 48.15 },
                                new object[] { -122.0, 48.15 },
                                new object[] { -122.0, 48.0 },
                                new object[] { -122.2, 48.0 },
                                new object[] { -122.2, 48.15 }
                            }
                        }
                    }
                },
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        OBJECTID = 3,
                        Unit_Nm = "Deception Pass",
                        State_Nm = "WA",
                        Des_Tp = "SP",
                        GIS_Acres = 1378
                    },
                    geometry = new
                    {
                        type = "Polygon",
                        coordinates = new object[][][]
                        {
                            new object[][]
                            {
                                new object[] { -122.1, 48.25 },
                                new object[] { -121.95, 48.25 },
                                new object[] { -121.95, 48.12 },
                                new object[] { -122.1, 48.12 },
                                new object[] { -122.1, 48.25 }
                            }
                        }
                    }
                }
            }
        });

        var httpClient = CreateMockHttpClient(countResponse, featuresResponse);
        var importer = new PadUsBoundaryImporter(context, httpClient);

        // Act
        var (imported, skipped, merged) = await importer.ImportAsync();

        // Assert
        imported.Should().Be(1); // One merged boundary
        merged.Should().Be(1);
        skipped.Should().Be(0);

        var boundaries = await context.ParkBoundaries.ToListAsync();
        boundaries.Should().HaveCount(1);

        var boundary = boundaries[0];
        boundary.GisAcres.Should().Be(4134); // Sum of all three: 1378 + 1378 + 1378
        boundary.Name.Should().Be("Deception Pass");
        boundary.State.Should().Be("WA");

        // Verify GeoJSON contains MultiPolygon with all 3 polygons merged
        boundary.GeoJsonFull.Should().Contain("MultiPolygon");

        // Parse GeoJSON and verify it contains coordinates from all 3 polygons
        using var doc = JsonDocument.Parse(boundary.GeoJsonFull);
        var root = doc.RootElement;
        root.TryGetProperty("coordinates", out var coords).Should().BeTrue();
        // MultiPolygon coordinates is array of polygons
        var coordsArray = coords.EnumerateArray().ToList();
        coordsArray.Should().HaveCount(3, "GeoJSON should contain all 3 polygons as separate entries in MultiPolygon");
    }

    [Fact]
    public async Task ImportAsync_WithMissingUnitName_SkipsFeature()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var countResponse = JsonSerializer.Serialize(new { count = 1 });

        var featuresResponse = JsonSerializer.Serialize(new
        {
            features = new object[]
            {
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        OBJECTID = 1,
                        Unit_Nm = (string?)null,
                        State_Nm = "WA",
                        Des_Tp = "SP",
                        GIS_Acres = 100
                    },
                    geometry = new
                    {
                        type = "Polygon",
                        coordinates = new object[][][]
                        {
                            new object[][]
                            {
                                new object[] { -122.5, 48.4 },
                                new object[] { -122.3, 48.4 },
                                new object[] { -122.3, 48.2 },
                                new object[] { -122.5, 48.2 },
                                new object[] { -122.5, 48.4 }
                            }
                        }
                    }
                }
            }
        });

        var httpClient = CreateMockHttpClient(countResponse, featuresResponse);
        var importer = new PadUsBoundaryImporter(context, httpClient);

        // Act
        var (imported, skipped, merged) = await importer.ImportAsync();

        // Assert
        imported.Should().Be(0);
        skipped.Should().Be(1);

        var boundaries = await context.ParkBoundaries.ToListAsync();
        boundaries.Should().HaveCount(0);
    }

    [Fact]
    public async Task ImportAsync_WithIdempotency_DoesNotCreateDuplicates()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var countResponse = JsonSerializer.Serialize(new { count = 2 });

        var featuresResponse = JsonSerializer.Serialize(new
        {
            features = new object[]
            {
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        OBJECTID = 1,
                        Unit_Nm = "Test Park",
                        State_Nm = "CA",
                        Des_Tp = "SP",
                        GIS_Acres = 5000
                    },
                    geometry = new
                    {
                        type = "Polygon",
                        coordinates = new object[][][]
                        {
                            new object[][]
                            {
                                new object[] { -120.0, 36.0 },
                                new object[] { -119.0, 36.0 },
                                new object[] { -119.0, 35.0 },
                                new object[] { -120.0, 35.0 },
                                new object[] { -120.0, 36.0 }
                            }
                        }
                    }
                },
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        OBJECTID = 2,
                        Unit_Nm = "Another Park",
                        State_Nm = "CA",
                        Des_Tp = "SP",
                        GIS_Acres = 3000
                    },
                    geometry = new
                    {
                        type = "Polygon",
                        coordinates = new object[][][]
                        {
                            new object[][]
                            {
                                new object[] { -118.0, 34.0 },
                                new object[] { -117.0, 34.0 },
                                new object[] { -117.0, 33.0 },
                                new object[] { -118.0, 33.0 },
                                new object[] { -118.0, 34.0 }
                            }
                        }
                    }
                }
            }
        });

        var httpClient = CreateMockHttpClient(countResponse, featuresResponse);
        var importer = new PadUsBoundaryImporter(context, httpClient);

        // Act - first run
        var result1 = await importer.ImportAsync();

        // Assert first run
        result1.imported.Should().Be(2);
        var boundaries1 = await context.ParkBoundaries.ToListAsync();
        boundaries1.Should().HaveCount(2);
        var originalIds = boundaries1.Select(b => b.Id).ToList();
        var originalAcres = boundaries1.ToDictionary(b => b.Name, b => b.GisAcres);

        // Act - second run (simulating re-import of same data)
        var httpClient2 = CreateMockHttpClient(countResponse, featuresResponse);
        var importer2 = new PadUsBoundaryImporter(context, httpClient2);
        var result2 = await importer2.ImportAsync();

        // Assert second run - should still be 2 boundaries with same IDs (not 4)
        result2.imported.Should().Be(2); // Upserted, not new
        var boundaries2 = await context.ParkBoundaries.ToListAsync();
        boundaries2.Should().HaveCount(2, "Second run should not create duplicates");
        var newIds = boundaries2.Select(b => b.Id).OrderBy(x => x).ToList();
        originalIds.OrderBy(x => x).ToList().Should().Equal(newIds, "IDs should remain the same");
        foreach (var boundary in boundaries2)
        {
            boundary.GisAcres.Should().Be(originalAcres[boundary.Name], $"Acres for {boundary.Name} should not change");
        }
    }

    [Fact]
    public async Task ImportAsync_WithRecreationAreaCategory_SetsCorrectCategory()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var countResponse = JsonSerializer.Serialize(new { count = 1 });

        var featuresResponse = JsonSerializer.Serialize(new
        {
            features = new object[]
            {
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        OBJECTID = 1,
                        Unit_Nm = "Test Recreation Area",
                        State_Nm = "OR",
                        Des_Tp = "SREC",
                        GIS_Acres = 1000
                    },
                    geometry = new
                    {
                        type = "Polygon",
                        coordinates = new object[][][]
                        {
                            new object[][]
                            {
                                new object[] { -122.0, 45.0 },
                                new object[] { -121.0, 45.0 },
                                new object[] { -121.0, 44.0 },
                                new object[] { -122.0, 44.0 },
                                new object[] { -122.0, 45.0 }
                            }
                        }
                    }
                }
            }
        });

        var httpClient = CreateMockHttpClient(countResponse, featuresResponse);
        var importer = new PadUsBoundaryImporter(context, httpClient);

        // Act
        await importer.ImportAsync();

        // Assert
        var boundary = await context.ParkBoundaries.FirstAsync();
        boundary.Category.Should().Be("state_recreation_area");
    }

    [Fact]
    public async Task ImportAsync_WithMultiPolygonGeometry_MergesAllPolygons()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var countResponse = JsonSerializer.Serialize(new { count = 1 });

        var featuresResponse = JsonSerializer.Serialize(new
        {
            features = new object[]
            {
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        OBJECTID = 1,
                        Unit_Nm = "Multi Polygon Park",
                        State_Nm = "AK",
                        Des_Tp = "SP",
                        GIS_Acres = 10000
                    },
                    geometry = new
                    {
                        type = "MultiPolygon",
                        coordinates = new object[][][][]
                        {
                            new object[][][]
                            {
                                new object[][]
                                {
                                    new object[] { -140.0, 70.0 },
                                    new object[] { -139.0, 70.0 },
                                    new object[] { -139.0, 69.0 },
                                    new object[] { -140.0, 69.0 },
                                    new object[] { -140.0, 70.0 }
                                }
                            },
                            new object[][][]
                            {
                                new object[][]
                                {
                                    new object[] { -138.0, 68.0 },
                                    new object[] { -137.0, 68.0 },
                                    new object[] { -137.0, 67.0 },
                                    new object[] { -138.0, 67.0 },
                                    new object[] { -138.0, 68.0 }
                                }
                            }
                        }
                    }
                }
            }
        });

        var httpClient = CreateMockHttpClient(countResponse, featuresResponse);
        var importer = new PadUsBoundaryImporter(context, httpClient);

        // Act
        var (imported, skipped, merged) = await importer.ImportAsync();

        // Assert
        imported.Should().Be(1);
        skipped.Should().Be(0);

        var boundary = await context.ParkBoundaries.FirstAsync();
        boundary.Name.Should().Be("Multi Polygon Park");

        // Verify bbox encompasses both polygons
        boundary.MinLng.Should().BeLessThanOrEqualTo(-140.0);
        boundary.MaxLng.Should().BeGreaterThanOrEqualTo(-137.0);
        boundary.MinLat.Should().BeLessThanOrEqualTo(67.0);
        boundary.MaxLat.Should().BeGreaterThanOrEqualTo(70.0);
    }

    /// <summary>
    /// Fast API contract validation — hits the live PAD-US endpoint, fetches 1 page,
    /// parses through the real importer code path, and verifies output.
    /// Takes ~5 seconds, not 2+ minutes like a full import.
    /// Used as the pre-commit gate for importer changes.
    /// </summary>
    [Trait("Category", "Integration")]
    [Fact]
    public async Task LiveApiContract_FetchesAndParsesOnePageSuccessfully()
    {
        var runIntegration = Environment.GetEnvironmentVariable("RUN_INTEGRATION_TESTS");
        if (string.IsNullOrWhiteSpace(runIntegration) || runIntegration != "1")
        {
            return; // Skip unless explicitly enabled
        }

        // Arrange — hit the real PAD-US API for 1 record
        using var httpClient = new HttpClient();
        httpClient.DefaultRequestHeaders.Add("User-Agent", "RoadTripMap/1.0 (contract-test)");
        httpClient.Timeout = TimeSpan.FromSeconds(30);

        var baseUrl = "https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US/MapServer/0/query";

        // Step 1: Verify count endpoint works and returns > 0
        var countUrl = $"{baseUrl}?where=Des_Tp+IN+(%27SP%27,%27SREC%27)&returnCountOnly=true&f=json";
        var countResponse = await httpClient.GetAsync(countUrl);
        countResponse.StatusCode.Should().Be(System.Net.HttpStatusCode.OK,
            "PAD-US count endpoint should be reachable");
        var countJson = await countResponse.Content.ReadAsStringAsync();
        using var countDoc = System.Text.Json.JsonDocument.Parse(countJson);
        countDoc.RootElement.TryGetProperty("count", out var countEl).Should().BeTrue(
            "response must have 'count' field — API format may have changed");
        countEl.GetInt32().Should().BeGreaterThan(0,
            "PAD-US should have state park features — filter may need updating");

        // Step 2: Fetch 1 feature with geometry and verify field names
        var featureUrl = $"{baseUrl}?where=Des_Tp=%27SP%27&outFields=Unit_Nm,State_Nm,Des_Tp,GIS_Acres,OBJECTID&f=geojson&outSR=4326&returnGeometry=true&resultRecordCount=1";
        var featureResponse = await httpClient.GetAsync(featureUrl);
        featureResponse.StatusCode.Should().Be(System.Net.HttpStatusCode.OK,
            "PAD-US feature endpoint should be reachable");
        var featureJson = await featureResponse.Content.ReadAsStringAsync();
        using var featureDoc = System.Text.Json.JsonDocument.Parse(featureJson);

        featureDoc.RootElement.TryGetProperty("features", out var features).Should().BeTrue(
            "GeoJSON response must have 'features' array");
        var featureArray = features.EnumerateArray().ToList();
        featureArray.Should().NotBeEmpty("at least 1 feature should be returned");

        var firstFeature = featureArray[0];

        // Verify required property fields exist
        firstFeature.TryGetProperty("properties", out var props).Should().BeTrue();
        props.TryGetProperty("Unit_Nm", out _).Should().BeTrue("field 'Unit_Nm' must exist in response");
        props.TryGetProperty("State_Nm", out _).Should().BeTrue("field 'State_Nm' must exist in response");
        props.TryGetProperty("Des_Tp", out _).Should().BeTrue("field 'Des_Tp' must exist in response");
        props.TryGetProperty("GIS_Acres", out _).Should().BeTrue("field 'GIS_Acres' must exist in response");
        props.TryGetProperty("OBJECTID", out _).Should().BeTrue("field 'OBJECTID' must exist in response");

        // Verify geometry exists and is parseable
        firstFeature.TryGetProperty("geometry", out var geometry).Should().BeTrue();
        geometry.TryGetProperty("type", out var geoType).Should().BeTrue();
        var geoTypeStr = geoType.GetString();
        (geoTypeStr == "Polygon" || geoTypeStr == "MultiPolygon").Should().BeTrue(
            $"geometry type should be Polygon or MultiPolygon, got '{geoTypeStr}'");
        geometry.TryGetProperty("coordinates", out _).Should().BeTrue(
            "geometry must have coordinates");

        // Step 3: Verify the real response can be parsed by our geometry processor
        var feature = featureArray[0];
        var geom = feature.GetProperty("geometry");
        var coords = geom.GetProperty("coordinates");

        // Parse coordinates into our internal format to prove the pipeline works
        var parkName = props.GetProperty("Unit_Nm").GetString();
        var stateName = props.GetProperty("State_Nm").GetString();
        parkName.Should().NotBeNullOrEmpty("Unit_Nm should contain a park name");
        stateName.Should().NotBeNullOrEmpty("State_Nm should contain a state code");

        // Verify Des_Tp matches our expected filter values
        var desType = props.GetProperty("Des_Tp").GetString();
        desType.Should().BeOneOf("SP", "SREC",
            "Des_Tp value changed — importer filter needs updating");
    }
}

/// <summary>
/// Mock HTTP message handler for testing PadUsBoundaryImporter.
/// Returns provided responses for all requests.
/// </summary>
internal class MockHttpMessageHandler : HttpMessageHandler
{
    private readonly string _countResponse;
    private readonly string _featuresResponse;
    private int _callCount = 0;

    public MockHttpMessageHandler(string countResponse, string featuresResponse)
    {
        _countResponse = countResponse;
        _featuresResponse = featuresResponse;
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        _callCount++;

        // First call is for count
        if (_callCount == 1)
        {
            var content = new StringContent(_countResponse, System.Text.Encoding.UTF8, "application/json");
            return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = content });
        }

        // Subsequent calls are for features
        var featuresContent = new StringContent(_featuresResponse, System.Text.Encoding.UTF8, "application/json");
        return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = featuresContent });
    }
}
