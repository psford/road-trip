using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Entities;

namespace RoadTripMap.Services;

public class NominatimGeocodingService : IGeocodingService
{
    private readonly HttpClient _httpClient;
    private readonly RoadTripDbContext _context;
    private readonly INominatimRateLimiter _rateLimiter;

    public NominatimGeocodingService(HttpClient httpClient, RoadTripDbContext context, INominatimRateLimiter rateLimiter)
    {
        _httpClient = httpClient;
        _context = context;
        _rateLimiter = rateLimiter;
        _httpClient.DefaultRequestHeaders.Add("User-Agent", "RoadTripMap/1.0");
    }

    public async Task<string?> ReverseGeocodeAsync(double latitude, double longitude)
    {
        // Round to 2 decimal places (~1.1km grid at equator) for cache key
        double latRounded = Math.Round(latitude, 2);
        double lngRounded = Math.Round(longitude, 2);

        // Check cache first
        var cachedEntry = await _context.GeoCache
            .FirstOrDefaultAsync(g => g.LatRounded == latRounded && g.LngRounded == lngRounded);

        if (cachedEntry != null)
        {
            return cachedEntry.PlaceName;
        }

        try
        {
            // Acquire rate limit permit (enforces minimum delay between requests)
            await _rateLimiter.AcquireAsync();

            // Call Nominatim API
            string url = $"https://nominatim.openstreetmap.org/reverse?lat={latitude}&lon={longitude}&format=json";
            var response = await _httpClient.GetAsync(url);

            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            var json = await response.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(json);

            if (!doc.RootElement.TryGetProperty("display_name", out var displayNameElement))
            {
                return null;
            }

            string displayName = displayNameElement.GetString() ?? "";
            string simplifiedName = SimplifyPlaceName(displayName);

            // Cache the result
            var geoCacheEntry = new GeoCacheEntity
            {
                LatRounded = latRounded,
                LngRounded = lngRounded,
                PlaceName = simplifiedName,
                CachedAt = DateTime.UtcNow
            };

            _context.GeoCache.Add(geoCacheEntry);
            await _context.SaveChangesAsync();

            return simplifiedName;
        }
        catch
        {
            // If Nominatim fails, don't block photo upload
            return null;
        }
    }

    private static string SimplifyPlaceName(string displayName)
    {
        if (string.IsNullOrWhiteSpace(displayName))
        {
            return displayName;
        }

        // Split by comma and filter out house numbers and postcodes
        var parts = displayName.Split(',')
            .Select(s => s.Trim())
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Where(s => !IsNumericPostcode(s))
            .ToList();

        // Take first 2-3 meaningful components
        int componentCount = Math.Min(3, parts.Count);
        return string.Join(", ", parts.Take(componentCount));
    }

    private static bool IsNumericPostcode(string s)
    {
        // Filter out common postcodes (numbers only or short numeric patterns)
        return s.All(char.IsDigit) && s.Length <= 10;
    }
}
