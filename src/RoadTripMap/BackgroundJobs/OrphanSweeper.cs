using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;

namespace RoadTripMap.BackgroundJobs;

/// <summary>
/// Core orphan sweep logic - testable with injected time.
/// Deletes pending photos where LastActivityAt is older than the stale threshold.
/// </summary>
public class OrphanSweeper : IOrphanSweeper
{
    private readonly RoadTripDbContext _db;
    private readonly ILogger<OrphanSweeper> _logger;
    private readonly int _staleThresholdHours;

    public OrphanSweeper(RoadTripDbContext db, ILogger<OrphanSweeper> logger, IConfiguration configuration)
    {
        _db = db;
        _logger = logger;
        _staleThresholdHours = configuration.GetValue<int?>("OrphanSweeper:StaleThresholdHours") ?? 48;
    }

    /// <summary>
    /// Sweeps for orphaned pending photos older than threshold.
    /// </summary>
    /// <param name="utcNow">Current UTC time - injected for testability</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>Number of photos deleted</returns>
    public async Task<int> SweepAsync(DateTime utcNow, CancellationToken cancellationToken)
    {
        var threshold = utcNow.AddHours(-_staleThresholdHours);

        // Query orphaned photos: pending status, LastActivityAt set and older than threshold
        var orphanedPhotos = await _db.Photos
            .Where(p => p.Status == "pending" &&
                        p.LastActivityAt != null &&
                        p.LastActivityAt < threshold)
            .ToListAsync(cancellationToken);

        var count = orphanedPhotos.Count;

        if (count > 0)
        {
            // Delete all orphaned photos
            _db.Photos.RemoveRange(orphanedPhotos);
            await _db.SaveChangesAsync(cancellationToken);

            // Log sanitized count only (no photo details)
            _logger.LogInformation("Orphan sweeper deleted {deleted_count} pending photos older than {threshold_hours}h",
                count, _staleThresholdHours);
        }

        return count;
    }
}
