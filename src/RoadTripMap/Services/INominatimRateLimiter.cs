namespace RoadTripMap.Services;

/// <summary>
/// Enforces rate limiting for Nominatim API requests (singleton).
/// Nominatim's usage policy requires ~1.1 second minimum between requests.
/// </summary>
public interface INominatimRateLimiter
{
    /// <summary>
    /// Acquire rate limit permit. Blocks if necessary to enforce minimum delay.
    /// </summary>
    Task AcquireAsync();
}
