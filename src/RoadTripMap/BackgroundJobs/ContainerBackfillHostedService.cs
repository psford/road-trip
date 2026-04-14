using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Services;

namespace RoadTripMap.BackgroundJobs;

/// <summary>
/// Hosted service that runs on startup to backfill blob containers for all existing trips.
/// Activated only if Backfill:RunOnStartup is true in configuration.
/// </summary>
public class ContainerBackfillHostedService : IHostedService
{
    private readonly RoadTripDbContext _db;
    private readonly IBlobContainerProvisioner _provisioner;
    private readonly ILogger<ContainerBackfillHostedService> _logger;
    private readonly bool _runOnStartup;

    public ContainerBackfillHostedService(
        RoadTripDbContext db,
        IBlobContainerProvisioner provisioner,
        ILogger<ContainerBackfillHostedService> logger,
        IConfiguration configuration)
    {
        _db = db;
        _provisioner = provisioner;
        _logger = logger;
        _runOnStartup = configuration.GetValue<bool>("Backfill:RunOnStartup");
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        if (!_runOnStartup)
        {
            return;
        }

        _logger.LogInformation("Starting blob container backfill for existing trips");

        var trips = await _db.Trips.ToListAsync();
        var succeeded = 0;
        var failed = 0;

        foreach (var trip in trips)
        {
            try
            {
                await _provisioner.EnsureContainerAsync(trip.SecretToken, cancellationToken);
                succeeded++;
            }
            catch (Exception ex)
            {
                failed++;
                _logger.LogWarning(ex, "Failed to provision container for trip {trip_token_prefix}",
                    trip.SecretToken.Substring(0, Math.Min(4, trip.SecretToken.Length)));
            }
        }

        _logger.LogInformation("Blob container backfill completed: {succeeded} succeeded, {failed} failed",
            succeeded, failed);
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        return Task.CompletedTask;
    }
}
