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
        return new HttpClient(handler) { BaseAddress = new Uri("https://gis1.usgs.gov/") };
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
                        d_Des_Tp = "State Park",
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
                        Unit_Nm = "Deception Pass",
                        State_Nm = "WA",
                        d_Des_Tp = "State Park",
                        GIS_Acres = 2000
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
                        d_Des_Tp = "State Park",
                        GIS_Acres = 2134
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
        boundary.GisAcres.Should().Be(4134); // Sum of both: 2000 + 2134
        boundary.Name.Should().Be("Deception Pass");
        boundary.State.Should().Be("WA");

        // Verify GeoJSON contains MultiPolygon with both polygons merged
        boundary.GeoJsonFull.Should().Contain("MultiPolygon");
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
                        d_Des_Tp = "State Park",
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
                        Unit_Nm = "Test Park",
                        State_Nm = "CA",
                        d_Des_Tp = "State Park",
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
                }
            }
        });

        var httpClient = CreateMockHttpClient(countResponse, featuresResponse);
        var importer = new PadUsBoundaryImporter(context, httpClient);

        // Act - first run
        var result1 = await importer.ImportAsync();

        // Assert first run
        result1.imported.Should().Be(1);
        var boundaries1 = await context.ParkBoundaries.ToListAsync();
        boundaries1.Should().HaveCount(1);
        var originalId = boundaries1[0].Id;
        var originalAcres = boundaries1[0].GisAcres;

        // Act - second run (simulating re-import of same data)
        var httpClient2 = CreateMockHttpClient(countResponse, featuresResponse);
        var importer2 = new PadUsBoundaryImporter(context, httpClient2);
        var result2 = await importer2.ImportAsync();

        // Assert second run - should still be one boundary with same ID
        result2.imported.Should().Be(1); // Upserted, not new
        var boundaries2 = await context.ParkBoundaries.ToListAsync();
        boundaries2.Should().HaveCount(1);
        boundaries2[0].Id.Should().Be(originalId);
        boundaries2[0].GisAcres.Should().Be(originalAcres);
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
                        d_Des_Tp = "State Recreation Area",
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
                        d_Des_Tp = "State Park",
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

    [Trait("Category", "Integration")]
    [Fact(Skip = "Skip integration test by default - requires network")]
    public async Task ImportAsync_WithLiveAPI_FetchesAndProcessesRealData()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        using var httpClient = new HttpClient();
        httpClient.DefaultRequestHeaders.Add("User-Agent", "RoadTripMap/1.0");
        httpClient.Timeout = TimeSpan.FromSeconds(180);

        var importer = new PadUsBoundaryImporter(context, httpClient);

        // Act
        var (imported, skipped, merged) = await importer.ImportAsync();

        // Assert
        imported.Should().BeGreaterThan(0);
        merged.Should().BeGreaterThan(0);

        var boundaries = await context.ParkBoundaries.ToListAsync();
        boundaries.Should().NotBeEmpty();

        // Verify all boundaries have required fields
        foreach (var boundary in boundaries)
        {
            boundary.Name.Should().NotBeNullOrEmpty();
            boundary.State.Should().NotBeNullOrEmpty();
            boundary.Source.Should().Be("pad_us");
            boundary.SourceId.Should().NotBeNullOrEmpty();
            boundary.GeoJsonFull.Should().NotBeNullOrEmpty();
            boundary.GeoJsonModerate.Should().NotBeNullOrEmpty();
            boundary.GeoJsonSimplified.Should().NotBeNullOrEmpty();
            boundary.MinLat.Should().BeLessThanOrEqualTo(boundary.MaxLat);
            boundary.MinLng.Should().BeLessThanOrEqualTo(boundary.MaxLng);
        }
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
