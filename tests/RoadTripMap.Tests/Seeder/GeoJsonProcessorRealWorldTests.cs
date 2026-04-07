using System.IO;
using System.Text.Json;
using FluentAssertions;
using RoadTripMap.PoiSeeder.Geometry;
using Xunit;

namespace RoadTripMap.Tests.Seeder;

/// <summary>
/// Real-world geometry tests using PAD-US park boundary fixtures.
/// Fixtures:
///   chena_river_moderate.json    — 1 polygon, 6 rings (has holes), ~202 points
///   valley_of_fire_moderate.json — 2 polygons, 1 ring each, ~322 points total
///   chugach_moderate.json        — 5 polygons, first has 3 rings (holes), ~916 points total
/// </summary>
public class GeoJsonProcessorRealWorldTests
{
    // ============ Helpers ============

    private static List<List<double[][]>> LoadFixture(string resourceName)
    {
        var assembly = typeof(GeoJsonProcessorRealWorldTests).Assembly;
        using var stream = assembly.GetManifestResourceStream($"RoadTripMap.Tests.Fixtures.{resourceName}");
        using var reader = new StreamReader(stream!);
        var json = reader.ReadToEnd();
        var doc = JsonDocument.Parse(json);
        var polygons = new List<List<double[][]>>();
        foreach (var polygon in doc.RootElement.GetProperty("coordinates").EnumerateArray())
        {
            var rings = new List<double[][]>();
            foreach (var ring in polygon.EnumerateArray())
            {
                rings.Add(ring.EnumerateArray()
                    .Select(coord => coord.EnumerateArray().Select(c => c.GetDouble()).ToArray())
                    .ToArray());
            }
            polygons.Add(rings);
        }
        return polygons;
    }

    private static int TotalPointCount(List<List<double[][]>> polygons) =>
        polygons.Sum(p => p.Sum(r => r.Length));

    // ============ ComputeCentroid — centroid falls within bounding box ============

    [Fact]
    public void ComputeCentroid_ChenaRiver_IsWithinBoundingBox()
    {
        var polygons = LoadFixture("chena_river_moderate.json");
        var (centroidLng, centroidLat) = GeoJsonProcessor.ComputeCentroid(polygons);
        var (minLat, maxLat, minLng, maxLng) = GeoJsonProcessor.ComputeBbox(polygons);

        centroidLng.Should().BeGreaterThanOrEqualTo(minLng, "centroid lng should be inside park bbox");
        centroidLng.Should().BeLessThanOrEqualTo(maxLng, "centroid lng should be inside park bbox");
        centroidLat.Should().BeGreaterThanOrEqualTo(minLat, "centroid lat should be inside park bbox");
        centroidLat.Should().BeLessThanOrEqualTo(maxLat, "centroid lat should be inside park bbox");
    }

    [Fact]
    public void ComputeCentroid_ValleyOfFire_IsWithinBoundingBox()
    {
        var polygons = LoadFixture("valley_of_fire_moderate.json");
        var (centroidLng, centroidLat) = GeoJsonProcessor.ComputeCentroid(polygons);
        var (minLat, maxLat, minLng, maxLng) = GeoJsonProcessor.ComputeBbox(polygons);

        centroidLng.Should().BeGreaterThanOrEqualTo(minLng);
        centroidLng.Should().BeLessThanOrEqualTo(maxLng);
        centroidLat.Should().BeGreaterThanOrEqualTo(minLat);
        centroidLat.Should().BeLessThanOrEqualTo(maxLat);
    }

    [Fact]
    public void ComputeCentroid_Chugach_IsWithinBoundingBox()
    {
        var polygons = LoadFixture("chugach_moderate.json");
        var (centroidLng, centroidLat) = GeoJsonProcessor.ComputeCentroid(polygons);
        var (minLat, maxLat, minLng, maxLng) = GeoJsonProcessor.ComputeBbox(polygons);

        centroidLng.Should().BeGreaterThanOrEqualTo(minLng);
        centroidLng.Should().BeLessThanOrEqualTo(maxLng);
        centroidLat.Should().BeGreaterThanOrEqualTo(minLat);
        centroidLat.Should().BeLessThanOrEqualTo(maxLat);
    }

    // ============ ComputeBbox — min < max for lat and lng ============

    [Fact]
    public void ComputeBbox_ChenaRiver_HasValidBounds()
    {
        var polygons = LoadFixture("chena_river_moderate.json");
        var (minLat, maxLat, minLng, maxLng) = GeoJsonProcessor.ComputeBbox(polygons);

        minLat.Should().BeLessThan(maxLat, "minLat should be less than maxLat");
        minLng.Should().BeLessThan(maxLng, "minLng should be less than maxLng");
        // Known approximate location: interior Alaska near Fairbanks
        minLat.Should().BeApproximately(64.7, 0.5);
        minLng.Should().BeApproximately(-146.8, 0.5);
    }

    [Fact]
    public void ComputeBbox_ValleyOfFire_HasValidBounds()
    {
        var polygons = LoadFixture("valley_of_fire_moderate.json");
        var (minLat, maxLat, minLng, maxLng) = GeoJsonProcessor.ComputeBbox(polygons);

        minLat.Should().BeLessThan(maxLat);
        minLng.Should().BeLessThan(maxLng);
        // Known location: southern Nevada
        minLat.Should().BeApproximately(36.4, 0.5);
        minLng.Should().BeApproximately(-114.6, 0.5);
    }

    [Fact]
    public void ComputeBbox_Chugach_HasValidBounds()
    {
        var polygons = LoadFixture("chugach_moderate.json");
        var (minLat, maxLat, minLng, maxLng) = GeoJsonProcessor.ComputeBbox(polygons);

        minLat.Should().BeLessThan(maxLat);
        minLng.Should().BeLessThan(maxLng);
        // Known location: south-central Alaska
        minLat.Should().BeApproximately(60.9, 0.5);
        minLng.Should().BeApproximately(-149.8, 0.5);
    }

    // ============ SimplifyMultiPolygon — moderate tolerance (0.001) ============

    [Fact]
    public void SimplifyMultiPolygon_ChenaRiver_ModerateTolerance_SamePolygonCount()
    {
        var polygons = LoadFixture("chena_river_moderate.json");
        var result = GeoJsonProcessor.SimplifyMultiPolygon(polygons, dpTolerance: 0.001, chaikinIterations: 0);

        result.Should().HaveCount(polygons.Count, "polygon count must be unchanged after simplification");
        // All rings non-empty and closed (minimum 3 points: start, vertex, start again)
        foreach (var poly in result)
            foreach (var ring in poly)
            {
                ring.Length.Should().BeGreaterThanOrEqualTo(3, "a ring must retain at least start + vertex + closure");
                ring[0][0].Should().Be(ring[^1][0], "ring must be closed (first lng == last lng)");
                ring[0][1].Should().Be(ring[^1][1], "ring must be closed (first lat == last lat)");
            }
    }

    [Fact]
    public void SimplifyMultiPolygon_ValleyOfFire_ModerateTolerance_SamePolygonCount()
    {
        var polygons = LoadFixture("valley_of_fire_moderate.json");
        var result = GeoJsonProcessor.SimplifyMultiPolygon(polygons, dpTolerance: 0.001, chaikinIterations: 0);

        result.Should().HaveCount(polygons.Count);
        foreach (var poly in result)
            foreach (var ring in poly)
            {
                ring.Length.Should().BeGreaterThanOrEqualTo(3);
                ring[0][0].Should().Be(ring[^1][0]);
                ring[0][1].Should().Be(ring[^1][1]);
            }
    }

    [Fact]
    public void SimplifyMultiPolygon_Chugach_ModerateTolerance_SamePolygonCount()
    {
        var polygons = LoadFixture("chugach_moderate.json");
        var result = GeoJsonProcessor.SimplifyMultiPolygon(polygons, dpTolerance: 0.001, chaikinIterations: 0);

        result.Should().HaveCount(polygons.Count);
        foreach (var poly in result)
            foreach (var ring in poly)
            {
                ring.Length.Should().BeGreaterThanOrEqualTo(3);
                ring[0][0].Should().Be(ring[^1][0]);
                ring[0][1].Should().Be(ring[^1][1]);
            }
    }

    // ============ SimplifyMultiPolygon — aggressive tolerance (0.01) reduces points ============

    [Fact]
    public void SimplifyMultiPolygon_ChenaRiver_AggressiveTolerance_ReducesPoints()
    {
        var polygons = LoadFixture("chena_river_moderate.json");
        var original = TotalPointCount(polygons);
        var result = GeoJsonProcessor.SimplifyMultiPolygon(polygons, dpTolerance: 0.01, chaikinIterations: 0);

        TotalPointCount(result).Should().BeLessThan(original, "aggressive simplification must reduce point count");
        // Shape not fully erased — every ring retains at least start + closure (2 points minimum)
        foreach (var poly in result)
            foreach (var ring in poly)
                ring.Length.Should().BeGreaterThanOrEqualTo(2, "ring should not be completely erased");
    }

    [Fact]
    public void SimplifyMultiPolygon_ValleyOfFire_AggressiveTolerance_ReducesPoints()
    {
        var polygons = LoadFixture("valley_of_fire_moderate.json");
        var original = TotalPointCount(polygons);
        var result = GeoJsonProcessor.SimplifyMultiPolygon(polygons, dpTolerance: 0.01, chaikinIterations: 0);

        TotalPointCount(result).Should().BeLessThan(original);
        foreach (var poly in result)
            foreach (var ring in poly)
                ring.Length.Should().BeGreaterThanOrEqualTo(2);
    }

    [Fact]
    public void SimplifyMultiPolygon_Chugach_AggressiveTolerance_ReducesPoints()
    {
        var polygons = LoadFixture("chugach_moderate.json");
        var original = TotalPointCount(polygons);
        var result = GeoJsonProcessor.SimplifyMultiPolygon(polygons, dpTolerance: 0.01, chaikinIterations: 0);

        TotalPointCount(result).Should().BeLessThan(original);
        foreach (var poly in result)
            foreach (var ring in poly)
                ring.Length.Should().BeGreaterThanOrEqualTo(2);
    }

    // ============ FilterTinyPolygons — real parks must survive ============

    [Fact]
    public void FilterTinyPolygons_ValleyOfFire_BothPolygonsSurvive()
    {
        // Valley of Fire has 2 real park parcels — neither should be filtered
        var polygons = LoadFixture("valley_of_fire_moderate.json");
        var result = GeoJsonProcessor.FilterTinyPolygons(polygons, minAreaDeg2: 0.0001);

        result.Should().HaveCount(2, "both Valley of Fire parcels are large enough to survive filtering");
    }

    [Fact]
    public void FilterTinyPolygons_ChenaRiver_SinglePolygonSurvives()
    {
        var polygons = LoadFixture("chena_river_moderate.json");
        var result = GeoJsonProcessor.FilterTinyPolygons(polygons, minAreaDeg2: 0.0001);

        result.Should().HaveCount(1, "Chena River State Recreation Area is a large park");
    }

    [Fact]
    public void FilterTinyPolygons_Chugach_AllPolygonsSurvive()
    {
        var polygons = LoadFixture("chugach_moderate.json");
        var result = GeoJsonProcessor.FilterTinyPolygons(polygons, minAreaDeg2: 0.0001);

        result.Should().HaveCount(polygons.Count, "all Chugach parcels are real park land, not tiny slivers");
    }

    // ============ BuildGeoJson — valid JSON with correct type ============

    [Fact]
    public void BuildGeoJson_ChenaRiver_ProducesValidMultiPolygonJson()
    {
        var polygons = LoadFixture("chena_river_moderate.json");
        var json = GeoJsonProcessor.BuildGeoJson(polygons);

        json.Should().NotBeNullOrEmpty();
        var act = () => JsonDocument.Parse(json);
        act.Should().NotThrow("output must be valid JSON");

        using var doc = JsonDocument.Parse(json);
        doc.RootElement.GetProperty("type").GetString().Should().Be("MultiPolygon");
        doc.RootElement.GetProperty("coordinates").GetArrayLength().Should().Be(polygons.Count);
    }

    [Fact]
    public void BuildGeoJson_ValleyOfFire_ProducesValidMultiPolygonJson()
    {
        var polygons = LoadFixture("valley_of_fire_moderate.json");
        var json = GeoJsonProcessor.BuildGeoJson(polygons);

        var act = () => JsonDocument.Parse(json);
        act.Should().NotThrow();

        using var doc = JsonDocument.Parse(json);
        doc.RootElement.GetProperty("type").GetString().Should().Be("MultiPolygon");
        doc.RootElement.GetProperty("coordinates").GetArrayLength().Should().Be(2);
    }

    [Fact]
    public void BuildGeoJson_Chugach_ProducesValidMultiPolygonJson()
    {
        var polygons = LoadFixture("chugach_moderate.json");
        var json = GeoJsonProcessor.BuildGeoJson(polygons);

        var act = () => JsonDocument.Parse(json);
        act.Should().NotThrow();

        using var doc = JsonDocument.Parse(json);
        doc.RootElement.GetProperty("type").GetString().Should().Be("MultiPolygon");
        doc.RootElement.GetProperty("coordinates").GetArrayLength().Should().Be(polygons.Count);
    }

    // ============ Holes fixture — SimplifyMultiPolygon preserves all rings ============

    [Fact]
    public void SimplifyMultiPolygon_ChenaRiver_PreservesAllRings()
    {
        // chena_river has 1 polygon with 6 rings (outer + 5 holes)
        var polygons = LoadFixture("chena_river_moderate.json");
        var originalRingCount = polygons[0].Count;

        var result = GeoJsonProcessor.SimplifyMultiPolygon(polygons, dpTolerance: 0.001, chaikinIterations: 0);

        result[0].Should().HaveCount(originalRingCount,
            "all rings (outer + holes) must be preserved after simplification");
    }

    [Fact]
    public void SimplifyMultiPolygon_Chugach_PreservesFirstPolygonRings()
    {
        // chugach poly[0] has 3 rings (outer + 2 holes)
        var polygons = LoadFixture("chugach_moderate.json");
        var firstPolyRingCount = polygons[0].Count;

        var result = GeoJsonProcessor.SimplifyMultiPolygon(polygons, dpTolerance: 0.001, chaikinIterations: 0);

        result[0].Should().HaveCount(firstPolyRingCount,
            "holes in the first Chugach polygon must be preserved");
    }

    // ============ ComputeThreeDetailLevels — full >= moderate >= simplified ============

    [Fact]
    public void ComputeThreeDetailLevels_ChenaRiver_DetailLevelsOrderedDescending()
    {
        var polygons = LoadFixture("chena_river_moderate.json");
        var (full, moderate, simplified) = GeoJsonProcessor.ComputeThreeDetailLevels(polygons);

        full.Length.Should().BeGreaterThanOrEqualTo(moderate.Length,
            "full detail JSON must be at least as long as moderate");
        moderate.Length.Should().BeGreaterThanOrEqualTo(simplified.Length,
            "moderate detail JSON must be at least as long as simplified");

        // All three must be valid GeoJSON
        foreach (var json in new[] { full, moderate, simplified })
        {
            var act = () => JsonDocument.Parse(json);
            act.Should().NotThrow();
            json.Should().Contain("MultiPolygon");
        }
    }

    [Fact]
    public void ComputeThreeDetailLevels_ValleyOfFire_DetailLevelsOrderedDescending()
    {
        var polygons = LoadFixture("valley_of_fire_moderate.json");
        var (full, moderate, simplified) = GeoJsonProcessor.ComputeThreeDetailLevels(polygons);

        full.Length.Should().BeGreaterThanOrEqualTo(moderate.Length);
        moderate.Length.Should().BeGreaterThanOrEqualTo(simplified.Length);

        foreach (var json in new[] { full, moderate, simplified })
        {
            var act = () => JsonDocument.Parse(json);
            act.Should().NotThrow();
            json.Should().Contain("MultiPolygon");
        }
    }

    [Fact]
    public void ComputeThreeDetailLevels_Chugach_DetailLevelsOrderedDescending()
    {
        var polygons = LoadFixture("chugach_moderate.json");
        var (full, moderate, simplified) = GeoJsonProcessor.ComputeThreeDetailLevels(polygons);

        full.Length.Should().BeGreaterThanOrEqualTo(moderate.Length);
        moderate.Length.Should().BeGreaterThanOrEqualTo(simplified.Length);

        foreach (var json in new[] { full, moderate, simplified })
        {
            var act = () => JsonDocument.Parse(json);
            act.Should().NotThrow();
            json.Should().Contain("MultiPolygon");
        }
    }
}
