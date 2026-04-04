using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Entities;

namespace RoadTripMap.PoiSeeder.Importers;

public class NpsImporter
{
    private readonly HttpClient _httpClient;
    private readonly RoadTripDbContext _context;
    private const string NpsApiBaseUrl = "https://developer.nps.gov/api/v1/parks";
    private const int PageSize = 50;
    private const int RateLimitDelayMs = 1000;

    public NpsImporter(HttpClient httpClient, RoadTripDbContext context)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        _context = context ?? throw new ArgumentNullException(nameof(context));
    }

    public async Task<ImportResult> ImportAsync(string apiKey)
    {
        var result = new ImportResult();

        if (string.IsNullOrEmpty(apiKey))
        {
            result.SkippedCount = -1; // Indicate API key missing
            return result;
        }

        try
        {
            var total = 0;
            var processed = 0;

            // Fetch first page to get total count and parse initial parks
            var firstPageUri = BuildUri(apiKey, 0);
            var firstPageResponse = await _httpClient.GetAsync(firstPageUri);
            firstPageResponse.EnsureSuccessStatusCode();
            var firstPageContent = await firstPageResponse.Content.ReadAsStringAsync();
            var firstPageDoc = JsonDocument.Parse(firstPageContent);

            if (firstPageDoc.RootElement.TryGetProperty("total", out var totalElement))
            {
                // NPS API returns total as a string ("474"), not an integer
                total = totalElement.ValueKind == JsonValueKind.String
                    ? int.Parse(totalElement.GetString()!)
                    : totalElement.GetInt32();
            }

            // Process parks from first page
            if (firstPageDoc.RootElement.TryGetProperty("data", out var firstPageDataArray))
            {
                foreach (var park in firstPageDataArray.EnumerateArray())
                {
                    if (TryParsePark(park, out var poi))
                    {
                        await UpsertPoiAsync(poi);
                        processed++;

                        // Batch save every 50 records
                        if (processed % 50 == 0)
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

            // Paginate through remaining pages (start at PageSize offset)
            for (int offset = PageSize; offset < total; offset += PageSize)
            {
                await Task.Delay(RateLimitDelayMs); // Rate limit before each request

                var uri = BuildUri(apiKey, offset);
                var response = await _httpClient.GetAsync(uri);
                response.EnsureSuccessStatusCode();

                var content = await response.Content.ReadAsStringAsync();
                var doc = JsonDocument.Parse(content);

                if (doc.RootElement.TryGetProperty("data", out var dataArray))
                {
                    foreach (var park in dataArray.EnumerateArray())
                    {
                        if (TryParsePark(park, out var poi))
                        {
                            await UpsertPoiAsync(poi);
                            processed++;

                            // Batch save every 50 records
                            if (processed % 50 == 0)
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

            // Final save
            await _context.SaveChangesAsync();
            result.ProcessedCount = processed;
        }
        catch (HttpRequestException ex)
        {
            throw new InvalidOperationException("Failed to fetch NPS API data: " + ex.Message, ex);
        }

        return result;
    }

    private string BuildUri(string apiKey, int offset)
    {
        return $"{NpsApiBaseUrl}?limit={PageSize}&start={offset}&api_key={apiKey}";
    }

    private bool TryParsePark(JsonElement parkElement, out PoiEntity poi)
    {
        poi = null!;

        try
        {
            if (!parkElement.TryGetProperty("fullName", out var fullNameEl) ||
                !parkElement.TryGetProperty("parkCode", out var parkCodeEl) ||
                !parkElement.TryGetProperty("latLong", out var latLongEl))
            {
                return false;
            }

            var fullName = fullNameEl.GetString();
            var parkCode = parkCodeEl.GetString();
            var latLongString = latLongEl.GetString();

            if (string.IsNullOrEmpty(fullName) || string.IsNullOrEmpty(parkCode) ||
                string.IsNullOrEmpty(latLongString))
            {
                return false;
            }

            // Parse latLong string: "lat:XX.XXX, long:YY.YYY"
            if (!ParseLatLong(latLongString, out var latitude, out var longitude))
            {
                return false;
            }

            // Map NPS designation to POI category
            var designation = parkElement.TryGetProperty("designation", out var desEl)
                ? desEl.GetString() ?? ""
                : "";
            var category = MapDesignationToCategory(designation);

            poi = new PoiEntity
            {
                Name = fullName,
                Category = category,
                Latitude = latitude,
                Longitude = longitude,
                Source = "nps",
                SourceId = parkCode
            };

            return true;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error parsing NPS park data: {ex.Message}");
            return false;
        }
    }

    private static string MapDesignationToCategory(string designation)
    {
        var d = designation.ToLowerInvariant();

        if (d.Contains("national park"))
            return "national_park";
        if (d.Contains("historic") || d.Contains("historical") || d.Contains("battlefield") || d.Contains("memorial") || d.Contains("monument"))
            return "historic_site";
        if (d.Contains("seashore") || d.Contains("lakeshore") || d.Contains("river") || d.Contains("preserve") || d.Contains("recreation"))
            return "natural_feature";
        if (d.Contains("trail") || d.Contains("parkway") || d.Contains("scenic"))
            return "natural_feature";

        // Fallback: "Park", "", or anything else from NPS is still national-level
        return "national_park";
    }

    private bool ParseLatLong(string latLongString, out double latitude, out double longitude)
    {
        latitude = 0;
        longitude = 0;

        // Format: "lat:44.409286, long:-68.239166"
        var pattern = @"lat:([-\d.]+),\s*long:([-\d.]+)";
        var match = Regex.Match(latLongString, pattern);

        if (!match.Success || match.Groups.Count < 3)
        {
            return false;
        }

        if (!double.TryParse(match.Groups[1].Value, out latitude) ||
            !double.TryParse(match.Groups[2].Value, out longitude))
        {
            return false;
        }

        return true;
    }

    private async Task UpsertPoiAsync(PoiEntity newPoi)
    {
        await PoiUpsertHelper.UpsertPoiAsync(_context, newPoi);
    }
}
