namespace RoadTripMap.Services;

/// <summary>
/// Singleton rate limiter for Nominatim API requests.
/// Enforces minimum 1.1 second delay between requests per Nominatim usage policy.
/// </summary>
public class NominatimRateLimiter : INominatimRateLimiter
{
    private readonly SemaphoreSlim _semaphore = new(1, 1);
    private DateTime _lastRequestTime = DateTime.MinValue;
    private const int MinMillisecondsBetweenRequests = 1100;

    public async Task AcquireAsync()
    {
        await _semaphore.WaitAsync();
        try
        {
            // Enforce minimum time between requests
            var timeSinceLastRequest = DateTime.UtcNow - _lastRequestTime;
            if (timeSinceLastRequest.TotalMilliseconds < MinMillisecondsBetweenRequests)
            {
                await Task.Delay((int)(MinMillisecondsBetweenRequests - timeSinceLastRequest.TotalMilliseconds));
            }

            _lastRequestTime = DateTime.UtcNow;
        }
        finally
        {
            _semaphore.Release();
        }
    }
}
