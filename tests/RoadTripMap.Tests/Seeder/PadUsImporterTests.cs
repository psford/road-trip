using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.PoiSeeder.Importers;
using Xunit;

namespace RoadTripMap.Tests.Seeder;

public class PadUsImporterTests
{
    private RoadTripDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new RoadTripDbContext(options);
    }

    private string CreateTempGeoJsonFile(object geoJson)
    {
        var tempFile = Path.Combine(Path.GetTempPath(), $"padus-test-{Guid.NewGuid()}.geojson");
        var json = JsonSerializer.Serialize(geoJson);
        File.WriteAllText(tempFile, json);
        return tempFile;
    }

    [Fact]
    public async Task ImportAsync_WithValidStateParkPolygon_CreatesPoi()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var geoJson = new
        {
            type = "FeatureCollection",
            features = new object[]
            {
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        OBJECTID = 1,
                        Unit_Nm = "Anza-Borrego Desert State Park",
                        Mang_Type = "State Park",
                        d_Mang_Typ = "California Department of Parks and Recreation",
                        d_Des_Tp = "State Park"
                    },
                    geometry = new
                    {
                        type = "Polygon",
                        coordinates = new object[][][]
                        {
                            new object[][]
                            {
                                new object[] { -116.0, 33.0 },
                                new object[] { -115.0, 33.0 },
                                new object[] { -115.0, 32.0 },
                                new object[] { -116.0, 32.0 },
                                new object[] { -116.0, 33.0 }
                            }
                        }
                    }
                }
            }
        };

        var filePath = CreateTempGeoJsonFile(geoJson);

        try
        {
            var importer = new PadUsImporter(context);

            // Act
            var result = await importer.ImportAsync(filePath);

            // Assert
            result.ProcessedCount.Should().Be(1);
            result.SkippedCount.Should().Be(0);

            var pois = await context.PointsOfInterest.ToListAsync();
            pois.Should().HaveCount(1);

            var poi = pois[0];
            poi.Name.Should().Be("Anza-Borrego Desert State Park");
            poi.Category.Should().Be("state_park");
            poi.Source.Should().Be("pad_us");
            poi.SourceId.Should().Be("1");
            // Centroid is average of all coordinates: (-116, -115, -115, -116, -116) → -115.6 avg,
            // (33, 33, 32, 32, 33) → 32.6 avg
            poi.Latitude.Should().BeApproximately(32.6, 0.1);
            poi.Longitude.Should().BeApproximately(-115.6, 0.1);
        }
        finally
        {
            if (File.Exists(filePath))
            {
                File.Delete(filePath);
            }
        }
    }

    [Fact]
    public async Task ImportAsync_WithMultipleFeatures_CreatesMultiplePois()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var geoJson = new
        {
            type = "FeatureCollection",
            features = new object[]
            {
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        OBJECTID = 1,
                        Unit_Nm = "Park One",
                        Mang_Type = "State Park",
                        d_Des_Tp = "State Park"
                    },
                    geometry = new
                    {
                        type = "Polygon",
                        coordinates = new object[][][]
                        {
                            new object[][]
                            {
                                new object[] { -100.0, 40.0 },
                                new object[] { -99.0, 40.0 },
                                new object[] { -99.0, 39.0 },
                                new object[] { -100.0, 39.0 },
                                new object[] { -100.0, 40.0 }
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
                        Unit_Nm = "Park Two",
                        Mang_Type = "State Recreation Area",
                        d_Des_Tp = "State Recreation Area"
                    },
                    geometry = new
                    {
                        type = "Polygon",
                        coordinates = new object[][][]
                        {
                            new object[][]
                            {
                                new object[] { -98.0, 40.0 },
                                new object[] { -97.0, 40.0 },
                                new object[] { -97.0, 39.0 },
                                new object[] { -98.0, 39.0 },
                                new object[] { -98.0, 40.0 }
                            }
                        }
                    }
                }
            }
        };

        var filePath = CreateTempGeoJsonFile(geoJson);

        try
        {
            var importer = new PadUsImporter(context);

            // Act
            var result = await importer.ImportAsync(filePath);

            // Assert
            result.ProcessedCount.Should().Be(2);

            var pois = await context.PointsOfInterest.ToListAsync();
            pois.Should().HaveCount(2);
            pois.Should().Contain(p => p.Name == "Park One");
            pois.Should().Contain(p => p.Name == "Park Two");
        }
        finally
        {
            if (File.Exists(filePath))
            {
                File.Delete(filePath);
            }
        }
    }

    [Fact]
    public async Task ImportAsync_WithNonStatePark_SkipsFeature()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var geoJson = new
        {
            type = "FeatureCollection",
            features = new object[]
            {
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        OBJECTID = 1,
                        Unit_Nm = "Valid Park",
                        Mang_Type = "State Park",
                        d_Des_Tp = "State Park"
                    },
                    geometry = new
                    {
                        type = "Polygon",
                        coordinates = new object[][][]
                        {
                            new object[][]
                            {
                                new object[] { -100.0, 40.0 },
                                new object[] { -99.0, 40.0 },
                                new object[] { -99.0, 39.0 },
                                new object[] { -100.0, 39.0 },
                                new object[] { -100.0, 40.0 }
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
                        Unit_Nm = "National Park",
                        Mang_Type = "National Park",
                        d_Des_Tp = "National Park"
                    },
                    geometry = new
                    {
                        type = "Polygon",
                        coordinates = new object[][][]
                        {
                            new object[][]
                            {
                                new object[] { -98.0, 40.0 },
                                new object[] { -97.0, 40.0 },
                                new object[] { -97.0, 39.0 },
                                new object[] { -98.0, 39.0 },
                                new object[] { -98.0, 40.0 }
                            }
                        }
                    }
                }
            }
        };

        var filePath = CreateTempGeoJsonFile(geoJson);

        try
        {
            var importer = new PadUsImporter(context);

            // Act
            var result = await importer.ImportAsync(filePath);

            // Assert
            result.ProcessedCount.Should().Be(1);
            result.SkippedCount.Should().Be(1);

            var pois = await context.PointsOfInterest.ToListAsync();
            pois.Should().HaveCount(1);
            pois[0].Name.Should().Be("Valid Park");
        }
        finally
        {
            if (File.Exists(filePath))
            {
                File.Delete(filePath);
            }
        }
    }

    [Fact]
    public async Task ImportAsync_WithMissingName_SkipsFeature()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var geoJson = new
        {
            type = "FeatureCollection",
            features = new object[]
            {
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        OBJECTID = 1,
                        Unit_Nm = (string?)null,
                        Mang_Type = "State Park",
                        d_Des_Tp = "State Park"
                    },
                    geometry = new
                    {
                        type = "Polygon",
                        coordinates = new object[][][]
                        {
                            new object[][]
                            {
                                new object[] { -100.0, 40.0 },
                                new object[] { -99.0, 40.0 },
                                new object[] { -99.0, 39.0 },
                                new object[] { -100.0, 39.0 },
                                new object[] { -100.0, 40.0 }
                            }
                        }
                    }
                }
            }
        };

        var filePath = CreateTempGeoJsonFile(geoJson);

        try
        {
            var importer = new PadUsImporter(context);

            // Act
            var result = await importer.ImportAsync(filePath);

            // Assert
            result.ProcessedCount.Should().Be(0);
            result.SkippedCount.Should().Be(1);

            var pois = await context.PointsOfInterest.ToListAsync();
            pois.Should().HaveCount(0);
        }
        finally
        {
            if (File.Exists(filePath))
            {
                File.Delete(filePath);
            }
        }
    }

    [Fact]
    public async Task ImportAsync_WithFileNotFound_ThrowsFileNotFoundException()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var importer = new PadUsImporter(context);

        // Act & Assert
        await Assert.ThrowsAsync<FileNotFoundException>(
            () => importer.ImportAsync("/nonexistent/path/padus.geojson"));
    }

    [Fact]
    public async Task ImportAsync_WithEmptyFeatureCollection_ReturnsZeroProcessed()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var geoJson = new
        {
            type = "FeatureCollection",
            features = Array.Empty<object>()
        };

        var filePath = CreateTempGeoJsonFile(geoJson);

        try
        {
            var importer = new PadUsImporter(context);

            // Act
            var result = await importer.ImportAsync(filePath);

            // Assert
            result.ProcessedCount.Should().Be(0);
            result.SkippedCount.Should().Be(0);

            var pois = await context.PointsOfInterest.ToListAsync();
            pois.Should().HaveCount(0);
        }
        finally
        {
            if (File.Exists(filePath))
            {
                File.Delete(filePath);
            }
        }
    }

    [Fact]
    public async Task ImportAsync_WithMalformedJson_ThrowsInvalidOperationException()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var tempFile = Path.Combine(Path.GetTempPath(), $"padus-test-{Guid.NewGuid()}.geojson");
        File.WriteAllText(tempFile, "{ invalid json }");

        try
        {
            var importer = new PadUsImporter(context);

            // Act & Assert
            await Assert.ThrowsAsync<InvalidOperationException>(
                () => importer.ImportAsync(tempFile));
        }
        finally
        {
            if (File.Exists(tempFile))
            {
                File.Delete(tempFile);
            }
        }
    }

    [Fact]
    public async Task ImportAsync_WithDuplicateSourceId_UpdatesExisting()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // Pre-populate with existing POI
        var existingPoi = new RoadTripMap.Entities.PoiEntity
        {
            Name = "Old Name",
            Category = "state_park",
            Latitude = 0,
            Longitude = 0,
            Source = "pad_us",
            SourceId = "1"
        };
        context.PointsOfInterest.Add(existingPoi);
        await context.SaveChangesAsync();

        var geoJson = new
        {
            type = "FeatureCollection",
            features = new object[]
            {
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        OBJECTID = 1,
                        Unit_Nm = "Updated Name",
                        Mang_Type = "State Park",
                        d_Des_Tp = "State Park"
                    },
                    geometry = new
                    {
                        type = "Polygon",
                        coordinates = new object[][][]
                        {
                            new object[][]
                            {
                                new object[] { -100.0, 40.0 },
                                new object[] { -99.0, 40.0 },
                                new object[] { -99.0, 39.0 },
                                new object[] { -100.0, 39.0 },
                                new object[] { -100.0, 40.0 }
                            }
                        }
                    }
                }
            }
        };

        var filePath = CreateTempGeoJsonFile(geoJson);

        try
        {
            var importer = new PadUsImporter(context);

            // Act
            var result = await importer.ImportAsync(filePath);

            // Assert
            result.ProcessedCount.Should().Be(1);

            var pois = await context.PointsOfInterest.ToListAsync();
            pois.Should().HaveCount(1);
            pois[0].Name.Should().Be("Updated Name");
        }
        finally
        {
            if (File.Exists(filePath))
            {
                File.Delete(filePath);
            }
        }
    }

    [Fact]
    public async Task ImportAsync_WithMultiPolygon_ExtractsCentroidFromFirstPolygon()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var geoJson = new
        {
            type = "FeatureCollection",
            features = new object[]
            {
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        OBJECTID = 1,
                        Unit_Nm = "Multi Park",
                        Mang_Type = "State Park",
                        d_Des_Tp = "State Park"
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
                                    new object[] { -100.0, 40.0 },
                                    new object[] { -99.0, 40.0 },
                                    new object[] { -99.0, 39.0 },
                                    new object[] { -100.0, 39.0 },
                                    new object[] { -100.0, 40.0 }
                                }
                            },
                            new object[][][]
                            {
                                new object[][]
                                {
                                    new object[] { -98.0, 38.0 },
                                    new object[] { -97.0, 38.0 },
                                    new object[] { -97.0, 37.0 },
                                    new object[] { -98.0, 37.0 },
                                    new object[] { -98.0, 38.0 }
                                }
                            }
                        }
                    }
                }
            }
        };

        var filePath = CreateTempGeoJsonFile(geoJson);

        try
        {
            var importer = new PadUsImporter(context);

            // Act
            var result = await importer.ImportAsync(filePath);

            // Assert
            result.ProcessedCount.Should().Be(1);

            var pois = await context.PointsOfInterest.ToListAsync();
            pois.Should().HaveCount(1);
            // Centroid of first polygon: lon (-100, -99, -99, -100, -100) → -99.6 avg,
            // lat (40, 40, 39, 39, 40) → 39.6 avg
            pois[0].Latitude.Should().BeApproximately(39.6, 0.1);
            pois[0].Longitude.Should().BeApproximately(-99.6, 0.1);
        }
        finally
        {
            if (File.Exists(filePath))
            {
                File.Delete(filePath);
            }
        }
    }
}
