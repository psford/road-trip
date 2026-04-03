using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Entities;

namespace RoadTripMap.PoiSeeder.Importers;

public class PadUsImporter
{
    private readonly RoadTripDbContext _context;
    private const int BatchSize = 100;

    public PadUsImporter(RoadTripDbContext context)
    {
        _context = context ?? throw new ArgumentNullException(nameof(context));
    }

    public async Task<ImportResult> ImportAsync(string filePath)
    {
        var result = new ImportResult();

        if (!File.Exists(filePath))
        {
            throw new FileNotFoundException($"PAD-US file not found: {filePath}");
        }

        try
        {
            using var stream = File.OpenRead(filePath);
            using var doc = await JsonDocument.ParseAsync(stream);

            var root = doc.RootElement;

            if (!root.TryGetProperty("features", out var featuresArray))
            {
                return result; // Empty or invalid GeoJSON
            }

            int processed = 0;

            foreach (var feature in featuresArray.EnumerateArray())
            {
                if (TryParseFeature(feature, out var poi))
                {
                    await UpsertPoiAsync(poi);
                    result.ProcessedCount++;
                    processed++;

                    // Batch save every 100 records
                    if (processed % BatchSize == 0)
                    {
                        await _context.SaveChangesAsync();
                    }
                }
                else
                {
                    result.SkippedCount++;
                }
            }

            // Final save
            await _context.SaveChangesAsync();
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException($"Failed to parse PAD-US GeoJSON: {ex.Message}", ex);
        }

        return result;
    }

    private bool TryParseFeature(JsonElement feature, out PoiEntity poi)
    {
        poi = null!;

        try
        {
            if (!feature.TryGetProperty("properties", out var propsEl) ||
                !feature.TryGetProperty("geometry", out var geometryEl))
            {
                return false;
            }

            // Check if this is a state park
            if (!IsStatePark(propsEl))
            {
                return false;
            }

            // Extract name
            if (!propsEl.TryGetProperty("Unit_Nm", out var nameEl) ||
                string.IsNullOrEmpty(nameEl.GetString()))
            {
                return false;
            }

            var name = nameEl.GetString()!;

            // Get sourceId - try OBJECTID first
            string sourceId = "unknown";
            if (propsEl.TryGetProperty("OBJECTID", out var objIdEl))
            {
                sourceId = objIdEl.GetInt32().ToString();
            }

            // Extract centroid from geometry
            if (!TryExtractCentroid(geometryEl, out var latitude, out var longitude))
            {
                return false;
            }

            poi = new PoiEntity
            {
                Name = name,
                Category = "state_park",
                Latitude = latitude,
                Longitude = longitude,
                Source = "pad_us",
                SourceId = sourceId
            };

            return true;
        }
        catch
        {
            return false;
        }
    }

    private bool IsStatePark(JsonElement propsElement)
    {
        // Check Mang_Type
        if (propsElement.TryGetProperty("Mang_Type", out var mangTypeEl))
        {
            var mangType = mangTypeEl.GetString() ?? string.Empty;
            if (IsStateParksManagementType(mangType))
            {
                return true;
            }
        }

        // Check d_Mang_Typ
        if (propsElement.TryGetProperty("d_Mang_Typ", out var dMangTypEl))
        {
            var dMangType = dMangTypEl.GetString() ?? string.Empty;
            if (IsStateParksManagementType(dMangType))
            {
                return true;
            }
        }

        // Check d_Des_Tp for state park designation
        if (propsElement.TryGetProperty("d_Des_Tp", out var desTpEl))
        {
            var desTp = desTpEl.GetString() ?? string.Empty;
            if (desTp.Contains("State Park", StringComparison.OrdinalIgnoreCase) ||
                desTp.Contains("State Recreation Area", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private bool IsStateParksManagementType(string mangType)
    {
        // Check for state agency names and state park indicators
        var lowerType = mangType.ToLowerInvariant();

        var stateParksPatterns = new[]
        {
            "state park",
            "state recreation",
            "state forest",
            "state natural area",
            "department of parks",
            "state parks and recreation"
        };

        return stateParksPatterns.Any(pattern => lowerType.Contains(pattern));
    }

    private bool TryExtractCentroid(JsonElement geometry, out double latitude, out double longitude)
    {
        latitude = 0;
        longitude = 0;

        try
        {
            if (!geometry.TryGetProperty("type", out var typeEl))
            {
                return false;
            }

            var geoType = typeEl.GetString();

            if (geoType == "Polygon")
            {
                return TryExtractPolygonCentroid(geometry, out latitude, out longitude);
            }

            if (geoType == "MultiPolygon")
            {
                return TryExtractMultiPolygonCentroid(geometry, out latitude, out longitude);
            }

            if (geoType == "Point")
            {
                return TryExtractPointCoordinates(geometry, out latitude, out longitude);
            }

            return false;
        }
        catch
        {
            return false;
        }
    }

    private bool TryExtractPolygonCentroid(JsonElement geometry, out double latitude, out double longitude)
    {
        latitude = 0;
        longitude = 0;

        if (!geometry.TryGetProperty("coordinates", out var coordsEl))
        {
            return false;
        }

        var coordsArray = coordsEl.EnumerateArray().FirstOrDefault();
        if (coordsArray.ValueKind == JsonValueKind.Undefined)
        {
            return false;
        }

        return CalculateCentroidFromCoordinates(coordsArray, out latitude, out longitude);
    }

    private bool TryExtractMultiPolygonCentroid(JsonElement geometry, out double latitude, out double longitude)
    {
        latitude = 0;
        longitude = 0;

        if (!geometry.TryGetProperty("coordinates", out var coordsEl))
        {
            return false;
        }

        // Get first polygon from multipolygon
        var firstPolygon = coordsEl.EnumerateArray().FirstOrDefault();
        if (firstPolygon.ValueKind == JsonValueKind.Undefined)
        {
            return false;
        }

        var firstRing = firstPolygon.EnumerateArray().FirstOrDefault();
        if (firstRing.ValueKind == JsonValueKind.Undefined)
        {
            return false;
        }

        return CalculateCentroidFromCoordinates(firstRing, out latitude, out longitude);
    }

    private bool TryExtractPointCoordinates(JsonElement geometry, out double latitude, out double longitude)
    {
        latitude = 0;
        longitude = 0;

        if (!geometry.TryGetProperty("coordinates", out var coordsEl))
        {
            return false;
        }

        var coordsArray = coordsEl.EnumerateArray().ToList();
        if (coordsArray.Count < 2)
        {
            return false;
        }

        if (!double.TryParse(coordsArray[0].GetRawText(), out var lon) ||
            !double.TryParse(coordsArray[1].GetRawText(), out var lat))
        {
            return false;
        }

        longitude = lon;
        latitude = lat;
        return true;
    }

    private bool CalculateCentroidFromCoordinates(JsonElement coordinatesArray, out double latitude, out double longitude)
    {
        latitude = 0;
        longitude = 0;

        var coords = new List<(double lon, double lat)>();

        foreach (var coordPair in coordinatesArray.EnumerateArray())
        {
            var coordValues = coordPair.EnumerateArray().ToList();
            if (coordValues.Count >= 2 &&
                double.TryParse(coordValues[0].GetRawText(), out var lon) &&
                double.TryParse(coordValues[1].GetRawText(), out var lat))
            {
                coords.Add((lon, lat));
            }
        }

        if (coords.Count == 0)
        {
            return false;
        }

        // Calculate centroid as average of all coordinates
        longitude = coords.Average(c => c.lon);
        latitude = coords.Average(c => c.lat);

        return true;
    }

    private async Task UpsertPoiAsync(PoiEntity newPoi)
    {
        var existing = await _context.PointsOfInterest
            .FirstOrDefaultAsync(p => p.Source == newPoi.Source && p.SourceId == newPoi.SourceId);

        if (existing == null)
        {
            _context.PointsOfInterest.Add(newPoi);
        }
        else
        {
            existing.Name = newPoi.Name;
            existing.Latitude = newPoi.Latitude;
            existing.Longitude = newPoi.Longitude;
            _context.PointsOfInterest.Update(existing);
        }
    }
}
