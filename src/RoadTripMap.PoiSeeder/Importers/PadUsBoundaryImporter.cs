using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.PoiSeeder.Geometry;

namespace RoadTripMap.PoiSeeder.Importers;

/// <summary>
/// Imports state park boundaries from PAD-US ArcGIS Feature Service.
/// Queries live API with pagination, groups parcels by name+state, applies geometry processing, and upserts to DB.
/// </summary>
public class PadUsBoundaryImporter
{
    private readonly RoadTripDbContext _context;
    private readonly HttpClient _httpClient;
    private const int PageSize = 2000;
    private const int BatchSize = 100;
    private const string BaseUrl = "https://gis1.usgs.gov/arcgis/rest/services/padus3/PAD_US3_0_d_m/FeatureServer/0/query";
    private const double MinPolygonAreaDeg2 = 0.0001; // Default threshold

    public PadUsBoundaryImporter(RoadTripDbContext context, HttpClient httpClient)
    {
        _context = context ?? throw new ArgumentNullException(nameof(context));
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
    }

    /// <summary>
    /// Runs the import pipeline: count → paginate → group → process → upsert.
    /// Returns (imported, skipped, merged).
    /// </summary>
    public async Task<(int imported, int skipped, int merged)> ImportAsync()
    {
        var imported = 0;
        var skipped = 0;
        var merged = 0;

        try
        {
            // Step 1: Count total features
            var totalCount = await GetTotalCountAsync();
            Console.WriteLine($"  Total PAD-US features with State Park/Recreation Area designation: {totalCount}");

            // Step 2: Paginate through all features
            var allFeatures = await FetchAllFeaturesAsync();

            // Step 3: Group by name+state
            var groupedByPark = GroupFeaturesByPark(allFeatures, out var invalidFeatures);
            merged = groupedByPark.Count;
            skipped = invalidFeatures;

            // Step 4: Process each group
            var processed = 0;
            foreach (var (parkKey, features) in groupedByPark)
            {
                if (await ProcessParkGroupAsync(features))
                {
                    imported++;
                    processed++;

                    // Batch save every 100 records
                    if (processed % BatchSize == 0)
                    {
                        await _context.SaveChangesAsync();
                    }
                }
            }

            // Final save
            await _context.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error importing PAD-US boundaries: {ex.Message}");
            throw;
        }

        return (imported, skipped, merged);
    }

    // ============ Private implementation ============

    /// <summary>
    /// Queries PAD-US API with returnCountOnly=true to get total feature count.
    /// </summary>
    private async Task<int> GetTotalCountAsync()
    {
        var queryParams = new Dictionary<string, string>
        {
            { "where", "d_Des_Tp IN ('State Park','State Recreation Area')" },
            { "returnCountOnly", "true" },
            { "f", "json" }
        };

        var url = BuildUrl(queryParams);
        var response = await _httpClient.GetAsync(url);
        response.EnsureSuccessStatusCode();

        using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
        if (doc.RootElement.TryGetProperty("count", out var countEl))
        {
            return countEl.GetInt32();
        }

        return 0;
    }

    /// <summary>
    /// Paginates through all PAD-US features with the filter.
    /// Rate limits: 2 second delay between pages per CLAUDE.md API rules.
    /// </summary>
    private async Task<List<Dictionary<string, JsonElement>>> FetchAllFeaturesAsync()
    {
        var allFeatures = new List<Dictionary<string, JsonElement>>();
        var resultOffset = 0;
        var hasMore = true;

        while (hasMore)
        {
            var queryParams = new Dictionary<string, string>
            {
                { "where", "d_Des_Tp IN ('State Park','State Recreation Area')" },
                { "outFields", "Unit_Nm,State_Nm,d_Des_Tp,GIS_Acres,OBJECTID" },
                { "resultOffset", resultOffset.ToString() },
                { "resultRecordCount", PageSize.ToString() },
                { "f", "geojson" },
                { "outSR", "4326" },
                { "returnGeometry", "true" }
            };

            var url = BuildUrl(queryParams);
            var response = await _httpClient.GetAsync(url);
            response.EnsureSuccessStatusCode();

            using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
            var root = doc.RootElement;

            // Extract features - must clone data before JsonDocument is disposed
            if (root.TryGetProperty("features", out var featuresArray))
            {
                var features = new List<Dictionary<string, JsonElement>>();
                foreach (var feature in featuresArray.EnumerateArray())
                {
                    var featureData = new Dictionary<string, JsonElement>();

                    if (feature.TryGetProperty("type", out var type))
                        featureData["type"] = type.Clone();
                    if (feature.TryGetProperty("properties", out var props))
                        featureData["properties"] = JsonDocument.Parse(props.GetRawText()).RootElement;
                    if (feature.TryGetProperty("geometry", out var geom))
                        featureData["geometry"] = JsonDocument.Parse(geom.GetRawText()).RootElement;

                    features.Add(featureData);
                }
                allFeatures.AddRange(features);

                Console.WriteLine($"  Fetched {features.Count} features at offset {resultOffset}");

                // Check if there are more pages
                hasMore = features.Count == PageSize;
                if (root.TryGetProperty("exceededTransferLimit", out var exceeded) && exceeded.GetBoolean())
                {
                    hasMore = true;
                }
            }
            else
            {
                hasMore = false;
            }

            resultOffset += PageSize;

            // Rate limit: 2 second delay between pages
            if (hasMore)
            {
                await Task.Delay(2000);
            }
        }

        return allFeatures;
    }

    /// <summary>
    /// Groups features by Unit_Nm|State_Nm key. Returns (groupedByPark, invalidFeatureCount).
    /// </summary>
    private Dictionary<string, List<Dictionary<string, JsonElement>>> GroupFeaturesByPark(
        List<Dictionary<string, JsonElement>> features,
        out int invalidCount)
    {
        var grouped = new Dictionary<string, List<Dictionary<string, JsonElement>>>();
        invalidCount = 0;

        foreach (var feature in features)
        {
            if (TryExtractParkKey(feature, out var parkKey))
            {
                if (!grouped.ContainsKey(parkKey))
                {
                    grouped[parkKey] = new List<Dictionary<string, JsonElement>>();
                }
                grouped[parkKey].Add(feature);
            }
            else
            {
                invalidCount++;
            }
        }

        return grouped;
    }

    /// <summary>
    /// Tries to extract Unit_Nm|State_Nm key from a feature.
    /// </summary>
    private bool TryExtractParkKey(Dictionary<string, JsonElement> feature, out string parkKey)
    {
        parkKey = string.Empty;

        if (!feature.TryGetValue("properties", out var props))
            return false;

        if (!props.TryGetProperty("Unit_Nm", out var nameEl) ||
            !props.TryGetProperty("State_Nm", out var stateEl))
            return false;

        var name = nameEl.GetString();
        var state = stateEl.GetString();

        if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(state))
            return false;

        parkKey = $"{name}|{state}";
        return true;
    }

    /// <summary>
    /// Processes a group of features (parcels) for a single park.
    /// Merges geometry, applies simplification, computes bbox/centroid, and upserts.
    /// </summary>
    private async Task<bool> ProcessParkGroupAsync(List<Dictionary<string, JsonElement>> features)
    {
        try
        {
            // Extract first feature for properties
            if (features.Count == 0)
                return false;

            var firstFeature = features[0];
            if (!firstFeature.TryGetValue("properties", out var firstProps))
                return false;

            var name = firstProps.GetProperty("Unit_Nm").GetString()!;
            var state = firstProps.GetProperty("State_Nm").GetString()!;
            var category = ExtractCategory(firstProps);

            // Collect all polygon coordinates from all features
            var allPolygons = new List<List<double[][]>>();
            var totalAcres = 0;

            foreach (var feature in features)
            {
                if (!feature.TryGetValue("properties", out var props) ||
                    !feature.TryGetValue("geometry", out var geometry))
                    continue;

                if (TryExtractPolygons(geometry, out var polygons))
                {
                    allPolygons.AddRange(polygons);

                    // Sum acres
                    if (props.TryGetProperty("GIS_Acres", out var acresEl))
                    {
                        totalAcres += (int)acresEl.GetDouble();
                    }
                }
            }

            // Filter tiny polygons
            var filteredPolygons = GeoJsonProcessor.FilterTinyPolygons(allPolygons, MinPolygonAreaDeg2);
            if (filteredPolygons.Count == 0)
            {
                return false; // Skip if no valid polygons after filtering
            }

            // Compute three detail levels
            var (fullGeoJson, moderateGeoJson, simplifiedGeoJson) =
                GeoJsonProcessor.ComputeThreeDetailLevels(filteredPolygons);

            // Compute centroid and bbox
            var (centroidLng, centroidLat) = GeoJsonProcessor.ComputeCentroid(filteredPolygons);
            var (minLat, maxLat, minLng, maxLng) = GeoJsonProcessor.ComputeBbox(filteredPolygons);

            // Generate SourceId as hash of Unit_Nm|State_Nm
            var sourceId = GenerateSourceId($"{name}|{state}");

            // Create entity and upsert
            var boundary = new ParkBoundaryEntity
            {
                Name = name,
                State = state,
                Category = category,
                GisAcres = totalAcres,
                CentroidLat = centroidLat,
                CentroidLng = centroidLng,
                MinLat = minLat,
                MaxLat = maxLat,
                MinLng = minLng,
                MaxLng = maxLng,
                GeoJsonFull = fullGeoJson,
                GeoJsonModerate = moderateGeoJson,
                GeoJsonSimplified = simplifiedGeoJson,
                Source = "pad_us",
                SourceId = sourceId
            };

            await BoundaryUpsertHelper.UpsertBoundaryAsync(_context, boundary);
            return true;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error processing park group: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Tries to extract polygon coordinates from a geometry object.
    /// Handles both Polygon and MultiPolygon types.
    /// </summary>
    private bool TryExtractPolygons(JsonElement geometry, out List<List<double[][]>> polygons)
    {
        polygons = new List<List<double[][]>>();

        if (!geometry.TryGetProperty("type", out var typeEl))
            return false;

        var geoType = typeEl.GetString();

        if (geoType == "Polygon")
        {
            if (TryExtractPolygonCoordinates(geometry, out var polygon))
            {
                polygons.Add(polygon);
                return true;
            }
        }
        else if (geoType == "MultiPolygon")
        {
            if (TryExtractMultiPolygonCoordinates(geometry, out var multiPolygon))
            {
                polygons.AddRange(multiPolygon);
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Extracts coordinates from a Polygon geometry.
    /// </summary>
    private bool TryExtractPolygonCoordinates(JsonElement geometry, out List<double[][]> polygon)
    {
        polygon = new List<double[][]>();

        if (!geometry.TryGetProperty("coordinates", out var coordsEl))
            return false;

        var rings = new List<double[][]>();
        foreach (var ring in coordsEl.EnumerateArray())
        {
            if (TryConvertRing(ring, out var ringCoords))
            {
                rings.Add(ringCoords);
            }
        }

        if (rings.Count > 0)
        {
            polygon = rings;
            return true;
        }

        return false;
    }

    /// <summary>
    /// Extracts coordinates from a MultiPolygon geometry.
    /// </summary>
    private bool TryExtractMultiPolygonCoordinates(JsonElement geometry, out List<List<double[][]>> multiPolygon)
    {
        multiPolygon = new List<List<double[][]>>();

        if (!geometry.TryGetProperty("coordinates", out var coordsEl))
            return false;

        foreach (var polygonEl in coordsEl.EnumerateArray())
        {
            var rings = new List<double[][]>();
            foreach (var ring in polygonEl.EnumerateArray())
            {
                if (TryConvertRing(ring, out var ringCoords))
                {
                    rings.Add(ringCoords);
                }
            }

            if (rings.Count > 0)
            {
                multiPolygon.Add(rings);
            }
        }

        return multiPolygon.Count > 0;
    }

    /// <summary>
    /// Converts a ring JSON array into a double[][] array.
    /// </summary>
    private bool TryConvertRing(JsonElement ringEl, out double[][] ringCoords)
    {
        ringCoords = Array.Empty<double[]>();
        var coords = new List<double[]>();

        foreach (var coordPair in ringEl.EnumerateArray())
        {
            var values = coordPair.EnumerateArray().ToList();
            if (values.Count >= 2 &&
                double.TryParse(values[0].GetRawText(), out var lng) &&
                double.TryParse(values[1].GetRawText(), out var lat))
            {
                coords.Add(new[] { lng, lat });
            }
        }

        if (coords.Count >= 3)
        {
            ringCoords = coords.ToArray();
            return true;
        }

        return false;
    }

    /// <summary>
    /// Extracts category from properties (d_Des_Tp or similar).
    /// </summary>
    private string ExtractCategory(JsonElement props)
    {
        if (props.TryGetProperty("d_Des_Tp", out var desTp))
        {
            var value = desTp.GetString() ?? string.Empty;
            if (value.Contains("Recreation", StringComparison.OrdinalIgnoreCase))
                return "state_recreation_area";
            if (value.Contains("Park", StringComparison.OrdinalIgnoreCase))
                return "state_park";
        }

        return "state_park"; // Default
    }

    /// <summary>
    /// Generates a SHA256-based SourceId from a string.
    /// Takes first 40 hex characters.
    /// </summary>
    private string GenerateSourceId(string input)
    {
        using var sha256 = SHA256.Create();
        var hash = sha256.ComputeHash(Encoding.UTF8.GetBytes(input));
        var hex = BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
        return hex.Substring(0, Math.Min(40, hex.Length));
    }

    /// <summary>
    /// Builds a URL with query parameters.
    /// </summary>
    private string BuildUrl(Dictionary<string, string> queryParams)
    {
        var queryString = string.Join("&", queryParams.Select(kv =>
            $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
        return $"{BaseUrl}?{queryString}";
    }
}
