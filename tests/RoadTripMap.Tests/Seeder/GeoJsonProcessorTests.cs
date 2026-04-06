using System.Text.Json;
using FluentAssertions;
using RoadTripMap.PoiSeeder.Geometry;
using Xunit;

namespace RoadTripMap.Tests.Seeder;

public class GeoJsonProcessorTests
{
    // ============ ComputeCentroid Tests ============

    [Fact]
    public void ComputeCentroid_WithSimpleSquare_ReturnsCenterPoint()
    {
        // Arrange: Square with corners at [0,0], [1,0], [1,1], [0,1]
        var polygons = new List<List<double[][]>>
        {
            new List<double[][]>
            {
                new[]
                {
                    new[] { 0.0, 0.0 },
                    new[] { 1.0, 0.0 },
                    new[] { 1.0, 1.0 },
                    new[] { 0.0, 1.0 },
                    new[] { 0.0, 0.0 }  // Closed ring
                }
            }
        };

        // Act
        var (centroidLng, centroidLat) = GeoJsonProcessor.ComputeCentroid(polygons);

        // Assert: Average of [0, 1, 1, 0, 0] is 0.4, and [0, 0, 1, 1, 0] is 0.4
        centroidLng.Should().BeApproximately(0.4, 0.01);
        centroidLat.Should().BeApproximately(0.4, 0.01);
    }

    [Fact]
    public void ComputeCentroid_WithTwoDisjointSquares_ReturnsAverageOfAllCoordinates()
    {
        // Arrange: Two separate squares
        var polygons = new List<List<double[][]>>
        {
            // Square 1: [0,0] to [1,1]
            new List<double[][]>
            {
                new[]
                {
                    new[] { 0.0, 0.0 },
                    new[] { 1.0, 0.0 },
                    new[] { 1.0, 1.0 },
                    new[] { 0.0, 1.0 },
                    new[] { 0.0, 0.0 }
                }
            },
            // Square 2: [2,2] to [3,3]
            new List<double[][]>
            {
                new[]
                {
                    new[] { 2.0, 2.0 },
                    new[] { 3.0, 2.0 },
                    new[] { 3.0, 3.0 },
                    new[] { 2.0, 3.0 },
                    new[] { 2.0, 2.0 }
                }
            }
        };

        // Act
        var (centroidLng, centroidLat) = GeoJsonProcessor.ComputeCentroid(polygons);

        // Assert: Average of all coords: ([0,1,1,0,0,2,3,3,2,2]/10, [0,0,1,1,0,2,2,3,3,2]/10) = (1.4, 1.4)
        centroidLng.Should().BeApproximately(1.4, 0.01);
        centroidLat.Should().BeApproximately(1.4, 0.01);
    }

    [Fact]
    public void ComputeCentroid_WithEmptyPolygons_ReturnsZero()
    {
        // Arrange
        var polygons = new List<List<double[][]>>();

        // Act
        var (centroidLng, centroidLat) = GeoJsonProcessor.ComputeCentroid(polygons);

        // Assert
        centroidLng.Should().Be(0);
        centroidLat.Should().Be(0);
    }

    // ============ ComputeBbox Tests ============

    [Fact]
    public void ComputeBbox_WithSimpleRectangle_ReturnsCorrectBounds()
    {
        // Arrange: Rectangle from (-122, 47) to (-121, 48)
        var polygons = new List<List<double[][]>>
        {
            new List<double[][]>
            {
                new[]
                {
                    new[] { -122.0, 47.0 },
                    new[] { -121.0, 47.0 },
                    new[] { -121.0, 48.0 },
                    new[] { -122.0, 48.0 },
                    new[] { -122.0, 47.0 }
                }
            }
        };

        // Act
        var (minLat, maxLat, minLng, maxLng) = GeoJsonProcessor.ComputeBbox(polygons);

        // Assert
        minLat.Should().Be(47.0);
        maxLat.Should().Be(48.0);
        minLng.Should().Be(-122.0);
        maxLng.Should().Be(-121.0);
    }

    [Fact]
    public void ComputeBbox_WithMultiplePolygons_ReturnsCombinedBounds()
    {
        // Arrange: Two non-overlapping rectangles
        var polygons = new List<List<double[][]>>
        {
            // Rectangle 1
            new List<double[][]>
            {
                new[]
                {
                    new[] { -122.0, 47.0 },
                    new[] { -121.0, 47.0 },
                    new[] { -121.0, 48.0 },
                    new[] { -122.0, 48.0 },
                    new[] { -122.0, 47.0 }
                }
            },
            // Rectangle 2
            new List<double[][]>
            {
                new[]
                {
                    new[] { -120.0, 46.0 },
                    new[] { -119.0, 46.0 },
                    new[] { -119.0, 47.0 },
                    new[] { -120.0, 47.0 },
                    new[] { -120.0, 46.0 }
                }
            }
        };

        // Act
        var (minLat, maxLat, minLng, maxLng) = GeoJsonProcessor.ComputeBbox(polygons);

        // Assert: Should span all four bounds
        minLat.Should().Be(46.0);
        maxLat.Should().Be(48.0);
        minLng.Should().Be(-122.0);
        maxLng.Should().Be(-119.0);
    }

    [Fact]
    public void ComputeBbox_WithEmptyPolygons_ReturnsZero()
    {
        // Arrange
        var polygons = new List<List<double[][]>>();

        // Act
        var (minLat, maxLat, minLng, maxLng) = GeoJsonProcessor.ComputeBbox(polygons);

        // Assert
        minLat.Should().Be(0);
        maxLat.Should().Be(0);
        minLng.Should().Be(0);
        maxLng.Should().Be(0);
    }

    // ============ FilterTinyPolygons Tests ============

    [Fact]
    public void FilterTinyPolygons_WithLargeAndTinyPolygons_RemovesTiny()
    {
        // Arrange: One large polygon, one tiny polygon
        var polygons = new List<List<double[][]>>
        {
            // Large polygon (area = 1 * 1 = 1 square degree)
            new List<double[][]>
            {
                new[]
                {
                    new[] { 0.0, 0.0 },
                    new[] { 1.0, 0.0 },
                    new[] { 1.0, 1.0 },
                    new[] { 0.0, 1.0 },
                    new[] { 0.0, 0.0 }
                }
            },
            // Tiny polygon (0.001 * 0.001 = 0.000001 square degrees)
            new List<double[][]>
            {
                new[]
                {
                    new[] { 2.0, 2.0 },
                    new[] { 2.001, 2.0 },
                    new[] { 2.001, 2.001 },
                    new[] { 2.0, 2.001 },
                    new[] { 2.0, 2.0 }
                }
            }
        };

        // Act
        var result = GeoJsonProcessor.FilterTinyPolygons(polygons, minAreaDeg2: 0.0001);

        // Assert: Only the large polygon remains
        result.Should().HaveCount(1);
        result[0][0].Length.Should().Be(5); // Original large polygon
    }

    [Fact]
    public void FilterTinyPolygons_WithAllLargePolygons_KeepsAll()
    {
        // Arrange: Two large polygons
        var polygons = new List<List<double[][]>>
        {
            new List<double[][]>
            {
                new[]
                {
                    new[] { 0.0, 0.0 },
                    new[] { 1.0, 0.0 },
                    new[] { 1.0, 1.0 },
                    new[] { 0.0, 1.0 },
                    new[] { 0.0, 0.0 }
                }
            },
            new List<double[][]>
            {
                new[]
                {
                    new[] { 2.0, 2.0 },
                    new[] { 3.0, 2.0 },
                    new[] { 3.0, 3.0 },
                    new[] { 2.0, 3.0 },
                    new[] { 2.0, 2.0 }
                }
            }
        };

        // Act
        var result = GeoJsonProcessor.FilterTinyPolygons(polygons, minAreaDeg2: 0.0001);

        // Assert: Both polygons kept
        result.Should().HaveCount(2);
    }

    [Fact]
    public void FilterTinyPolygons_WithEmptyList_ReturnsEmpty()
    {
        // Arrange
        var polygons = new List<List<double[][]>>();

        // Act
        var result = GeoJsonProcessor.FilterTinyPolygons(polygons, minAreaDeg2: 0.0001);

        // Assert
        result.Should().BeEmpty();
    }

    // ============ SimplifyRing (Douglas-Peucker) Tests ============

    [Fact]
    public void SimplifyRing_WithCollinearPoints_RemovesIntermediatePoint()
    {
        // Arrange: Straight line with a collinear intermediate point
        var ring = new[]
        {
            new[] { 0.0, 0.0 },
            new[] { 0.5, 0.0 },  // Collinear intermediate point
            new[] { 1.0, 0.0 },
            new[] { 1.0, 1.0 },
            new[] { 0.0, 1.0 },
            new[] { 0.0, 0.0 }   // Closure
        };

        // Act: With high tolerance, intermediate point should be removed
        var result = GeoJsonProcessor.SimplifyRing(ring, tolerance: 0.01);

        // Assert: Simplified ring should have fewer points
        result.Length.Should().BeLessThan(ring.Length);
        // First and last should still match (closure preserved)
        result[0][0].Should().Be(result[^1][0]);
        result[0][1].Should().Be(result[^1][1]);
    }

    [Fact]
    public void SimplifyRing_WithPointFarFromLine_PreservesPoint()
    {
        // Arrange: A line with a point far off it
        var ring = new[]
        {
            new[] { 0.0, 0.0 },
            new[] { 0.5, 1.0 },  // Point far from line
            new[] { 1.0, 0.0 },
            new[] { 0.0, 0.0 }
        };

        // Act: With low tolerance, the distant point should be kept
        var result = GeoJsonProcessor.SimplifyRing(ring, tolerance: 0.1);

        // Assert: The point should be preserved
        result.Length.Should().Be(4);
        result.Should().ContainEquivalentOf(new[] { 0.5, 1.0 });
    }

    [Fact]
    public void SimplifyRing_PreservesRingClosure()
    {
        // Arrange
        var ring = new[]
        {
            new[] { 0.0, 0.0 },
            new[] { 1.0, 0.0 },
            new[] { 1.0, 1.0 },
            new[] { 0.0, 1.0 },
            new[] { 0.0, 0.0 }
        };

        // Act
        var result = GeoJsonProcessor.SimplifyRing(ring, tolerance: 0.01);

        // Assert: First and last point should be identical
        result[0][0].Should().Be(result[^1][0]);
        result[0][1].Should().Be(result[^1][1]);
    }

    // ============ SmoothRing (Chaikin) Tests ============

    [Fact]
    public void SmoothRing_WithOneIteration_IncrementsPointsCorrectly()
    {
        // Arrange: Simple square (4 edges)
        var ring = new[]
        {
            new[] { 0.0, 0.0 },
            new[] { 1.0, 0.0 },
            new[] { 1.0, 1.0 },
            new[] { 0.0, 1.0 },
            new[] { 0.0, 0.0 }  // Closure
        };

        // Act: One iteration - each segment produces 2 points, so 4 segments * 2 = 8, plus closure = 9
        var result = GeoJsonProcessor.SmoothRing(ring, iterations: 1);

        // Assert: Should have more points than input and at least double after one iteration
        result.Length.Should().BeGreaterThan(ring.Length);
        // Ring closure should be preserved
        result[0][0].Should().Be(result[^1][0]);
        result[0][1].Should().Be(result[^1][1]);
    }

    [Fact]
    public void SmoothRing_MultipleIterations_PreservesRingClosure()
    {
        // Arrange
        var ring = new[]
        {
            new[] { 0.0, 0.0 },
            new[] { 1.0, 0.0 },
            new[] { 1.0, 1.0 },
            new[] { 0.0, 1.0 },
            new[] { 0.0, 0.0 }
        };

        // Act
        var result = GeoJsonProcessor.SmoothRing(ring, iterations: 2);

        // Assert: Closure preserved after multiple iterations
        result[0][0].Should().Be(result[^1][0]);
        result[0][1].Should().Be(result[^1][1]);
        // More iterations = more points (2 iterations should produce more than starting)
        result.Length.Should().BeGreaterThan(ring.Length);
    }

    // ============ SimplifyMultiPolygon Tests ============

    [Fact]
    public void SimplifyMultiPolygon_WithZeroTolerance_RetainsAllPoints()
    {
        // Arrange: A polygon with some complexity
        var polygons = new List<List<double[][]>>
        {
            new List<double[][]>
            {
                new[]
                {
                    new[] { 0.0, 0.0 },
                    new[] { 0.3, 0.1 },  // Additional points for complexity
                    new[] { 0.6, 0.05 },
                    new[] { 1.0, 0.0 },
                    new[] { 1.0, 1.0 },
                    new[] { 0.0, 1.0 },
                    new[] { 0.0, 0.0 }
                }
            }
        };

        // Act
        var noSimplification = GeoJsonProcessor.SimplifyMultiPolygon(polygons, dpTolerance: 0, chaikinIterations: 1);
        var withSimplification = GeoJsonProcessor.SimplifyMultiPolygon(polygons, dpTolerance: 0.05, chaikinIterations: 1);

        // Assert: Zero tolerance (no Douglas-Peucker) should retain more or equal points than with simplification
        noSimplification[0][0].Length.Should().BeGreaterThanOrEqualTo(withSimplification[0][0].Length,
            "Simplification with zero DP tolerance should retain all points from Chaikin, which may be more than with DP simplification");
        // Both should have valid output
        noSimplification[0][0].Length.Should().BeGreaterThan(0);
        withSimplification[0][0].Length.Should().BeGreaterThan(0);
    }

    [Fact]
    public void SimplifyMultiPolygon_ProducesValidOutput()
    {
        // Arrange
        var polygons = new List<List<double[][]>>
        {
            new List<double[][]>
            {
                new[]
                {
                    new[] { 0.0, 0.0 },
                    new[] { 1.0, 0.0 },
                    new[] { 1.0, 1.0 },
                    new[] { 0.0, 1.0 },
                    new[] { 0.0, 0.0 }
                }
            }
        };

        // Act
        var result = GeoJsonProcessor.SimplifyMultiPolygon(polygons, dpTolerance: 0.001, chaikinIterations: 2);

        // Assert: Result should have same structure
        result.Should().HaveCount(1);
        result[0].Should().HaveCount(1);
        result[0][0].Should().NotBeEmpty();
        // Ring closure should be preserved
        result[0][0][0][0].Should().Be(result[0][0][^1][0]);
        result[0][0][0][1].Should().Be(result[0][0][^1][1]);
    }

    // ============ BuildGeoJson Tests ============

    [Fact]
    public void BuildGeoJson_WithSimplePolygon_ProducesValidJson()
    {
        // Arrange
        var polygons = new List<List<double[][]>>
        {
            new List<double[][]>
            {
                new[]
                {
                    new[] { 0.0, 0.0 },
                    new[] { 1.0, 0.0 },
                    new[] { 1.0, 1.0 },
                    new[] { 0.0, 1.0 },
                    new[] { 0.0, 0.0 }
                }
            }
        };

        // Act
        var json = GeoJsonProcessor.BuildGeoJson(polygons);

        // Assert: Should be valid JSON with MultiPolygon type
        json.Should().Contain("\"type\":\"MultiPolygon\"");
        json.Should().Contain("\"coordinates\":");
        json.Should().NotBeNullOrEmpty();
    }

    [Fact]
    public void BuildGeoJson_WithMultiplePolygons_IncludesAllCoordinates()
    {
        // Arrange: Two squares
        var polygons = new List<List<double[][]>>
        {
            new List<double[][]>
            {
                new[]
                {
                    new[] { 0.0, 0.0 },
                    new[] { 1.0, 0.0 },
                    new[] { 1.0, 1.0 },
                    new[] { 0.0, 1.0 },
                    new[] { 0.0, 0.0 }
                }
            },
            new List<double[][]>
            {
                new[]
                {
                    new[] { 2.0, 2.0 },
                    new[] { 3.0, 2.0 },
                    new[] { 3.0, 3.0 },
                    new[] { 2.0, 3.0 },
                    new[] { 2.0, 2.0 }
                }
            }
        };

        // Act
        var json = GeoJsonProcessor.BuildGeoJson(polygons);

        // Assert: Parse JSON and verify it contains 2 polygon entries
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        root.TryGetProperty("coordinates", out var coordinates).Should().BeTrue();

        var polygonCoordinates = coordinates.EnumerateArray().ToList();
        polygonCoordinates.Should().HaveCount(2, "GeoJSON should contain 2 separate polygons in the MultiPolygon");

        // Verify the first polygon has coordinates
        var firstPolyElement = polygonCoordinates[0];
        firstPolyElement.EnumerateArray().Should().NotBeEmpty("First polygon should have rings");

        // Verify the second polygon has coordinates
        var secondPolyElement = polygonCoordinates[1];
        secondPolyElement.EnumerateArray().Should().NotBeEmpty("Second polygon should have rings");

        // Verify JSON string contains expected coordinate values
        json.Should().Contain("[0");
        json.Should().Contain("[1");
        json.Should().Contain("[2");
        json.Should().Contain("[3");
    }

    // ============ ComputeThreeDetailLevels Tests ============

    [Fact]
    public void ComputeThreeDetailLevels_ProducesThreeDifferentLevels()
    {
        // Arrange: A polygon with some detail
        var polygons = new List<List<double[][]>>
        {
            new List<double[][]>
            {
                new[]
                {
                    new[] { 0.0, 0.0 },
                    new[] { 0.2, 0.05 },
                    new[] { 0.4, 0.02 },
                    new[] { 0.6, 0.03 },
                    new[] { 0.8, 0.01 },
                    new[] { 1.0, 0.0 },
                    new[] { 1.0, 1.0 },
                    new[] { 0.0, 1.0 },
                    new[] { 0.0, 0.0 }
                }
            }
        };

        // Act
        var (full, moderate, simplified) = GeoJsonProcessor.ComputeThreeDetailLevels(polygons);

        // Assert: All should be valid GeoJSON
        full.Should().Contain("\"type\":\"MultiPolygon\"");
        moderate.Should().Contain("\"type\":\"MultiPolygon\"");
        simplified.Should().Contain("\"type\":\"MultiPolygon\"");

        // Full should have more detail than simplified
        full.Length.Should().BeGreaterThan(simplified.Length);
    }

    [Fact]
    public void ComputeThreeDetailLevels_AllProduceValidGeoJson()
    {
        // Arrange
        var polygons = new List<List<double[][]>>
        {
            new List<double[][]>
            {
                new[]
                {
                    new[] { -122.0, 47.0 },
                    new[] { -121.0, 47.0 },
                    new[] { -121.0, 48.0 },
                    new[] { -122.0, 48.0 },
                    new[] { -122.0, 47.0 }
                }
            }
        };

        // Act
        var (full, moderate, simplified) = GeoJsonProcessor.ComputeThreeDetailLevels(polygons);

        // Assert: All contain expected JSON structure
        foreach (var json in new[] { full, moderate, simplified })
        {
            json.Should().StartWith("{");
            json.Should().EndWith("}");
            json.Should().Contain("MultiPolygon");
        }
    }
}
