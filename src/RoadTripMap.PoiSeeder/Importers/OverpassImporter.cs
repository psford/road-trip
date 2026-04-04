using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Entities;

namespace RoadTripMap.PoiSeeder.Importers;

public class OverpassImporter
{
    private readonly HttpClient _httpClient;
    private readonly RoadTripDbContext _context;
    private const string OverpassApiUrl = "https://overpass-api.de/api/interpreter";
    private readonly int _rateLimitDelayMs;
    private const int BatchSize = 100;

    public OverpassImporter(HttpClient httpClient, RoadTripDbContext context, int rateLimitDelayMs = 5000)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        _context = context ?? throw new ArgumentNullException(nameof(context));
        _rateLimitDelayMs = rateLimitDelayMs;
    }

    /// <summary>
    /// Import using a single bounding box (for testing or targeted imports).
    /// </summary>
    public Task<ImportResult> ImportAsync(double south, double west, double north, double east)
    {
        return ImportAsyncInternal(new[] { (south, west, north, east) });
    }

    /// <summary>
    /// Import across all US tiles (production use).
    /// </summary>
    public Task<ImportResult> ImportAsync()
    {
        return ImportAsyncInternal(UsTiles);
    }

    private async Task<ImportResult> ImportAsyncInternal(
        (double south, double west, double north, double east)[] tiles)
    {
        var result = new ImportResult();

        try
        {
            // Run each query type across all tiles
            await RunQueryAsync("tourism", result, tiles);
            await Task.Delay(_rateLimitDelayMs);

            await RunQueryAsync("historic", result, tiles);
            await Task.Delay(_rateLimitDelayMs);

            await RunQueryAsync("natural", result, tiles);
            await Task.Delay(_rateLimitDelayMs);

            await RunQueryAsync("nature_reserve", result, tiles);

            // Final save
            await _context.SaveChangesAsync();
        }
        catch (HttpRequestException ex)
        {
            throw new InvalidOperationException("Failed to fetch Overpass API data: " + ex.Message, ex);
        }

        return result;
    }

    private const int MaxRetries = 3;
    private const int RetryDelayMs = 30000; // 30s backoff on 504/429

    // US bounding box split into 5°×5° tiles to avoid Overpass 504 timeouts.
    // PNW prioritized first (Patrick's area of interest).
    private static readonly (double south, double west, double north, double east)[] UsTiles = GenerateUsTiles();

    private static (double, double, double, double)[] GenerateUsTiles()
    {
        // 5-degree grid across continental US: lat 25-50, lng -125 to -65
        // PNW tiles (lat >= 40, lng <= -110) sorted first
        var tiles = new List<(double south, double west, double north, double east)>();
        var pnwTiles = new List<(double south, double west, double north, double east)>();

        for (double lat = 25; lat < 50; lat += 5)
        {
            for (double lng = -125; lng < -65; lng += 5)
            {
                var tile = (lat, lng, Math.Min(lat + 5, 50), Math.Min(lng + 5, -65));
                if (lat >= 40 && lng <= -110)
                    pnwTiles.Add(tile);
                else
                    tiles.Add(tile);
            }
        }

        pnwTiles.AddRange(tiles);
        return pnwTiles.ToArray();
    }

    private async Task RunQueryAsync(string queryType, ImportResult result,
        (double south, double west, double north, double east)[]? tilesToUse = null)
    {
        var tiles = tilesToUse ?? UsTiles;
        for (int i = 0; i < tiles.Length; i++)
        {
            var tile = tiles[i];
            Console.WriteLine($"    {queryType} tile {i + 1}/{tiles.Length} ({tile.south},{tile.west},{tile.north},{tile.east})...");

            var success = false;
            for (int retry = 0; retry <= MaxRetries; retry++)
            {
                try
                {
                    var query = BuildQuery(queryType, tile.south, tile.west, tile.north, tile.east);
                    var content = new FormUrlEncodedContent(new[] { new KeyValuePair<string, string>("data", query) });

                    var response = await _httpClient.PostAsync(OverpassApiUrl, content);

                    if ((int)response.StatusCode == 429 || (int)response.StatusCode == 504 || (int)response.StatusCode == 503)
                    {
                        if (retry < MaxRetries)
                        {
                            Console.Error.WriteLine($"      {(int)response.StatusCode} — retrying in {RetryDelayMs / 1000}s (attempt {retry + 1}/{MaxRetries})...");
                            await Task.Delay(RetryDelayMs);
                            continue;
                        }
                        Console.Error.WriteLine($"      {(int)response.StatusCode} — giving up on this tile after {MaxRetries} retries");
                        break;
                    }

                    response.EnsureSuccessStatusCode();

                    var responseContent = await response.Content.ReadAsStringAsync();
                    var doc = JsonDocument.Parse(responseContent);

                    if (doc.RootElement.TryGetProperty("elements", out var elementsArray))
                    {
                        int processed = 0;

                        foreach (var element in elementsArray.EnumerateArray())
                        {
                            if (TryParseElement(element, queryType, out var poi))
                            {
                                await UpsertPoiAsync(poi);
                                result.ProcessedCount++;
                                processed++;

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

                        Console.WriteLine($"      {processed} POIs from this tile");
                    }

                    success = true;
                    break;
                }
                catch (TaskCanceledException) when (retry < MaxRetries)
                {
                    Console.Error.WriteLine($"      Timeout — retrying in {RetryDelayMs / 1000}s (attempt {retry + 1}/{MaxRetries})...");
                    await Task.Delay(RetryDelayMs);
                }
            }

            if (!success)
            {
                Console.Error.WriteLine($"      SKIPPED tile {i + 1} after all retries");
            }

            // Rate limit between tiles
            if (i < tiles.Length - 1)
            {
                await Task.Delay(_rateLimitDelayMs);
            }
        }
    }

    private string BuildQuery(string queryType, double south, double west, double north, double east)
    {
        var bbox = $"({south},{west},{north},{east})";
        return queryType switch
        {
            "tourism" => $"[out:json][timeout:120];\nnode[\"tourism\"~\"attraction|museum|viewpoint\"]{bbox};\nout body;",
            "historic" => $"[out:json][timeout:120];\nnode[\"historic\"~\"monument|memorial|castle|ruins|archaeological_site|battlefield\"]{bbox};\nout body;",
            "natural" => $"[out:json][timeout:120];\n(\n  node[\"natural\"=\"peak\"]{bbox};\n  node[\"natural\"=\"waterfall\"]{bbox};\n  node[\"natural\"=\"volcano\"]{bbox};\n  node[\"natural\"=\"cave_entrance\"]{bbox};\n);\nout body;",
            "nature_reserve" => $"[out:json][timeout:120];\nnode[\"leisure\"=\"nature_reserve\"]{bbox};\nout body;",
            _ => throw new ArgumentException($"Unknown query type: {queryType}")
        };
    }

    private bool TryParseElement(JsonElement element, string queryType, out PoiEntity poi)
    {
        poi = null!;

        try
        {
            if (!element.TryGetProperty("type", out var typeEl) ||
                typeEl.GetString() != "node")
            {
                return false;
            }

            if (!element.TryGetProperty("id", out var idEl) ||
                !element.TryGetProperty("lat", out var latEl) ||
                !element.TryGetProperty("lon", out var lonEl) ||
                !element.TryGetProperty("tags", out var tagsEl))
            {
                return false;
            }

            if (!tagsEl.TryGetProperty("name", out var nameEl) ||
                string.IsNullOrEmpty(nameEl.GetString()))
            {
                return false; // Skip unnamed nodes
            }

            var id = idEl.GetInt64();
            var latitude = latEl.GetDouble();
            var longitude = lonEl.GetDouble();
            var name = nameEl.GetString()!;
            var category = MapCategory(tagsEl, queryType);

            poi = new PoiEntity
            {
                Name = name,
                Category = category,
                Latitude = latitude,
                Longitude = longitude,
                Source = "osm",
                SourceId = id.ToString()
            };

            return true;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error parsing Overpass element data: {ex.Message}");
            return false;
        }
    }

    private string MapCategory(JsonElement tagsElement, string queryType)
    {
        if (queryType == "tourism")
        {
            return "tourism";
        }

        if (queryType == "historic")
        {
            return "historic_site";
        }

        if (queryType == "natural" || queryType == "nature_reserve")
        {
            return "natural_feature";
        }

        return "tourism"; // Default fallback
    }

    private async Task UpsertPoiAsync(PoiEntity newPoi)
    {
        await PoiUpsertHelper.UpsertPoiAsync(_context, newPoi);
    }
}
