using System.Text.Json;

namespace RoadTripMap.PoiSeeder.Geometry;

/// <summary>
/// Provides pure geometry processing utilities for PAD-US boundary data.
/// All coordinates are [longitude, latitude] pairs (GeoJSON convention).
/// </summary>
public static class GeoJsonProcessor
{
    /// <summary>
    /// Computes the centroid (average point) of a MultiPolygon.
    /// Returns [longitude, latitude] as a [lon, lat] pair.
    /// </summary>
    public static (double centroidLng, double centroidLat) ComputeCentroid(List<List<double[][]>> polygons)
    {
        double sumLng = 0, sumLat = 0;
        int count = 0;

        foreach (var polygon in polygons)
        {
            foreach (var ring in polygon)
            {
                foreach (var coord in ring)
                {
                    sumLng += coord[0];
                    sumLat += coord[1];
                    count++;
                }
            }
        }

        if (count == 0)
            return (0, 0);

        return (sumLng / count, sumLat / count);
    }

    /// <summary>
    /// Computes the bounding box of a MultiPolygon.
    /// Returns (minLat, maxLat, minLng, maxLng).
    /// </summary>
    public static (double minLat, double maxLat, double minLng, double maxLng) ComputeBbox(List<List<double[][]>> polygons)
    {
        if (polygons.Count == 0)
            return (0, 0, 0, 0);

        double minLng = double.MaxValue, maxLng = double.MinValue;
        double minLat = double.MaxValue, maxLat = double.MinValue;

        foreach (var polygon in polygons)
        {
            foreach (var ring in polygon)
            {
                foreach (var coord in ring)
                {
                    double lng = coord[0];
                    double lat = coord[1];

                    if (lng < minLng) minLng = lng;
                    if (lng > maxLng) maxLng = lng;
                    if (lat < minLat) minLat = lat;
                    if (lat > maxLat) maxLat = lat;
                }
            }
        }

        return (minLat, maxLat, minLng, maxLng);
    }

    /// <summary>
    /// Douglas-Peucker simplification of a ring.
    /// Removes collinear and near-collinear points based on perpendicular distance tolerance.
    /// Preserves first and last point (ring closure).
    /// </summary>
    public static double[][] SimplifyRing(double[][] ring, double tolerance)
    {
        if (ring.Length <= 2)
            return ring;

        var simplified = SimplifyDouglasPeucker(ring, tolerance);

        // Ensure ring closure
        if (simplified.Length > 0 &&
            (simplified[0][0] != simplified[^1][0] || simplified[0][1] != simplified[^1][1]))
        {
            var result = new double[simplified.Length + 1][];
            Array.Copy(simplified, result, simplified.Length);
            result[^1] = new[] { simplified[0][0], simplified[0][1] };
            return result;
        }

        return simplified;
    }

    /// <summary>
    /// Chaikin corner-cutting smoothing algorithm.
    /// For each iteration, replaces each pair of adjacent points with two new points at 25% and 75% along the segment.
    /// Preserves ring closure.
    /// </summary>
    public static double[][] SmoothRing(double[][] ring, int iterations = 2)
    {
        var current = (double[][])ring.Clone();

        for (int iter = 0; iter < iterations; iter++)
        {
            var smoothed = new List<double[]>();

            // Process pairs of consecutive points
            for (int i = 0; i < current.Length - 1; i++)
            {
                double[] p0 = current[i];
                double[] p1 = current[i + 1];

                // First point at 25% along the segment
                double[] p25 = new[]
                {
                    p0[0] + 0.25 * (p1[0] - p0[0]),
                    p0[1] + 0.25 * (p1[1] - p0[1])
                };

                // Second point at 75% along the segment
                double[] p75 = new[]
                {
                    p0[0] + 0.75 * (p1[0] - p0[0]),
                    p0[1] + 0.75 * (p1[1] - p0[1])
                };

                smoothed.Add(p25);
                smoothed.Add(p75);
            }

            current = smoothed.ToArray();

            // Ensure ring closure (first == last)
            if (current.Length > 0)
            {
                if (current[0][0] != current[^1][0] || current[0][1] != current[^1][1])
                {
                    Array.Resize(ref current, current.Length + 1);
                    current[^1] = new[] { current[0][0], current[0][1] };
                }
            }
        }

        return current;
    }

    /// <summary>
    /// Filters out polygons whose area (computed via shoelace formula) is below the threshold.
    /// Area threshold is in square degrees.
    /// </summary>
    public static List<List<double[][]>> FilterTinyPolygons(List<List<double[][]>> polygons, double minAreaDeg2)
    {
        var result = new List<List<double[][]>>();

        foreach (var polygon in polygons)
        {
            // Check if any ring has sufficient area
            bool hasSufficientArea = false;

            foreach (var ring in polygon)
            {
                double area = ComputeRingArea(ring);
                if (Math.Abs(area) >= minAreaDeg2)
                {
                    hasSufficientArea = true;
                    break;
                }
            }

            if (hasSufficientArea)
            {
                result.Add(polygon);
            }
        }

        return result;
    }

    /// <summary>
    /// Simplifies a MultiPolygon using Douglas-Peucker and then Chaikin smoothing.
    /// Applies the same simplification to every ring of every polygon.
    /// </summary>
    public static List<List<double[][]>> SimplifyMultiPolygon(
        List<List<double[][]>> polygons,
        double dpTolerance,
        int chaikinIterations)
    {
        var result = new List<List<double[][]>>();

        foreach (var polygon in polygons)
        {
            var simplifiedPolygon = new List<double[][]>();

            foreach (var ring in polygon)
            {
                double[][] simplified = ring;

                // Apply Douglas-Peucker if tolerance > 0
                if (dpTolerance > 0)
                {
                    simplified = SimplifyRing(simplified, dpTolerance);
                }

                // Apply Chaikin smoothing
                simplified = SmoothRing(simplified, chaikinIterations);

                simplifiedPolygon.Add(simplified);
            }

            result.Add(simplifiedPolygon);
        }

        return result;
    }

    /// <summary>
    /// Serializes polygon coordinates to a GeoJSON MultiPolygon geometry object string.
    /// </summary>
    public static string BuildGeoJson(List<List<double[][]>> polygons)
    {
        var coordinates = new List<object>();

        foreach (var polygon in polygons)
        {
            var polygonCoords = new List<object>();
            foreach (var ring in polygon)
            {
                var ringCoords = new List<object>();
                foreach (var coord in ring)
                {
                    ringCoords.Add(coord);
                }
                polygonCoords.Add(ringCoords);
            }
            coordinates.Add(polygonCoords);
        }

        var geoJson = new
        {
            type = "MultiPolygon",
            coordinates = coordinates
        };

        return JsonSerializer.Serialize(geoJson);
    }

    /// <summary>
    /// Computes three detail levels of GeoJSON simplification for a MultiPolygon.
    /// Returns (fullGeoJson, moderateGeoJson, simplifiedGeoJson).
    /// </summary>
    public static (string full, string moderate, string simplified) ComputeThreeDetailLevels(
        List<List<double[][]>> polygons)
    {
        // Full: no Douglas-Peucker, just Chaikin
        var fullSimplified = SimplifyMultiPolygon(polygons, dpTolerance: 0, chaikinIterations: 2);
        var full = BuildGeoJson(fullSimplified);

        // Moderate: Douglas-Peucker at 0.001 + Chaikin
        var moderateSimplified = SimplifyMultiPolygon(polygons, dpTolerance: 0.001, chaikinIterations: 2);
        var moderate = BuildGeoJson(moderateSimplified);

        // Simplified: Douglas-Peucker at 0.005 + Chaikin
        var simplifiedSimplified = SimplifyMultiPolygon(polygons, dpTolerance: 0.005, chaikinIterations: 2);
        var simplified = BuildGeoJson(simplifiedSimplified);

        return (full, moderate, simplified);
    }

    // ============ Private helpers ============

    /// <summary>
    /// Douglas-Peucker algorithm implementation.
    /// Recursively simplifies a polyline by removing points with perpendicular distance less than tolerance.
    /// </summary>
    private static double[][] SimplifyDouglasPeucker(double[][] points, double tolerance)
    {
        if (points.Length <= 2)
            return points;

        // Find the point with maximum distance from line segment
        double maxDistance = 0;
        int maxIndex = 0;

        for (int i = 1; i < points.Length - 1; i++)
        {
            double distance = PerpendicularDistance(points[i], points[0], points[^1]);
            if (distance > maxDistance)
            {
                maxDistance = distance;
                maxIndex = i;
            }
        }

        // If max distance is greater than tolerance, recursively simplify
        if (maxDistance > tolerance)
        {
            var leftPoints = new ArraySegment<double[]>(points, 0, maxIndex + 1);
            var rightPoints = new ArraySegment<double[]>(points, maxIndex, points.Length - maxIndex);

            var leftSimplified = SimplifyDouglasPeucker(leftPoints.ToArray(), tolerance);
            var rightSimplified = SimplifyDouglasPeucker(rightPoints.ToArray(), tolerance);

            // Combine results (skip duplicate middle point)
            var combined = new List<double[]>();
            combined.AddRange(leftSimplified);
            combined.AddRange(rightSimplified.Skip(1));

            return combined.ToArray();
        }

        // Keep only endpoints
        return new[] { points[0], points[^1] };
    }

    /// <summary>
    /// Computes perpendicular distance from a point to a line segment.
    /// </summary>
    private static double PerpendicularDistance(double[] point, double[] lineStart, double[] lineEnd)
    {
        double x = point[0], y = point[1];
        double x1 = lineStart[0], y1 = lineStart[1];
        double x2 = lineEnd[0], y2 = lineEnd[1];

        double numerator = Math.Abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1);
        double denominator = Math.Sqrt((y2 - y1) * (y2 - y1) + (x2 - x1) * (x2 - x1));

        if (denominator == 0)
            return Math.Sqrt((x - x1) * (x - x1) + (y - y1) * (y - y1));

        return numerator / denominator;
    }

    /// <summary>
    /// Computes the area of a ring using the shoelace formula.
    /// Returns the absolute area of a ring using the shoelace formula.
    /// </summary>
    private static double ComputeRingArea(double[][] ring)
    {
        if (ring.Length < 3)
            return 0;

        double area = 0;

        for (int i = 0; i < ring.Length - 1; i++)
        {
            double x0 = ring[i][0];
            double y0 = ring[i][1];
            double x1 = ring[i + 1][0];
            double y1 = ring[i + 1][1];

            area += (x0 * y1 - x1 * y0);
        }

        return Math.Abs(area) / 2.0;
    }
}
