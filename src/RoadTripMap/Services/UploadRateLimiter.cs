using System.Collections.Concurrent;

namespace RoadTripMap.Services;

/// <summary>
/// In-memory, thread-safe IP-based rate limiter for photo uploads.
/// Tracks upload timestamps per IP address and enforces 200 uploads/hour limit.
/// </summary>
public class UploadRateLimiter
{
    private readonly ConcurrentDictionary<string, (List<DateTime> Timestamps, object Lock)> _uploadLog = new();
    private const int MaxUploadsPerHour = 200;

    /// <summary>
    /// Checks if an upload is allowed for the given IP address.
    /// Returns true if the upload is allowed, false if rate limit exceeded.
    /// </summary>
    public bool IsAllowed(string ipAddress)
    {
        var now = DateTime.UtcNow;
        var cutoff = now.AddHours(-1);

        // Get or create entry for this IP
        var entry = _uploadLog.GetOrAdd(ipAddress, _ => (new List<DateTime>(), new object()));

        // Thread-safe check and update
        lock (entry.Lock)
        {
            // Remove timestamps older than 1 hour
            entry.Timestamps.RemoveAll(t => t < cutoff);

            // Check if limit exceeded
            if (entry.Timestamps.Count >= MaxUploadsPerHour)
                return false;

            // Record this upload
            entry.Timestamps.Add(now);
            return true;
        }
    }
}
