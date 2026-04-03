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
    private const int RateLimitDelayMs = 5000; // 5 seconds between queries
    private const int BatchSize = 100;

    public OverpassImporter(HttpClient httpClient, RoadTripDbContext context)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        _context = context ?? throw new ArgumentNullException(nameof(context));
    }

    public async Task<ImportResult> ImportAsync()
    {
        var result = new ImportResult();

        try
        {
            // Run each query with rate limiting
            await RunQueryAsync("tourism", result);
            await Task.Delay(RateLimitDelayMs);

            await RunQueryAsync("historic", result);
            await Task.Delay(RateLimitDelayMs);

            await RunQueryAsync("natural", result);
            await Task.Delay(RateLimitDelayMs);

            await RunQueryAsync("nature_reserve", result);

            // Final save
            await _context.SaveChangesAsync();
        }
        catch (HttpRequestException ex)
        {
            throw new InvalidOperationException("Failed to fetch Overpass API data: " + ex.Message, ex);
        }

        return result;
    }

    private async Task RunQueryAsync(string queryType, ImportResult result)
    {
        var query = BuildQuery(queryType);
        var content = new FormUrlEncodedContent(new[] { new KeyValuePair<string, string>("data", query) });

        var response = await _httpClient.PostAsync(OverpassApiUrl, content);
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
        }
    }

    private string BuildQuery(string queryType)
    {
        return queryType switch
        {
            "tourism" => @"[out:json][timeout:120];
node[""tourism""~""attraction|museum|viewpoint""](24,-125,50,-66);
out body;",
            "historic" => @"[out:json][timeout:120];
node[""historic""~""monument|memorial|castle|ruins|archaeological_site|battlefield""](24,-125,50,-66);
out body;",
            "natural" => @"[out:json][timeout:120];
(
  node[""natural""=""peak""](24,-125,50,-66);
  node[""natural""=""waterfall""](24,-125,50,-66);
  node[""natural""=""volcano""](24,-125,50,-66);
  node[""natural""=""cave_entrance""](24,-125,50,-66);
);
out body;",
            "nature_reserve" => @"[out:json][timeout:120];
node[""leisure""=""nature_reserve""](24,-125,50,-66);
out body;",
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
