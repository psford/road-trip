namespace RoadTripMap.BackgroundJobs;

/// <summary>
/// Interface for orphan sweep logic - testable with injected time.
/// </summary>
public interface IOrphanSweeper
{
    /// <summary>
    /// Sweeps and deletes pending photos where LastActivityAt is older than the configured threshold.
    /// </summary>
    /// <param name="utcNow">Current UTC time - injected for test control</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>Number of photos deleted</returns>
    Task<int> SweepAsync(DateTime utcNow, CancellationToken cancellationToken);
}
