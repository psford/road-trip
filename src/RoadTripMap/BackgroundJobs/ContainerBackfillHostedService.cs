using Microsoft.EntityFrameworkCore;
using RoadTripMap.Services;

namespace RoadTripMap.BackgroundJobs;

/// <summary>
/// Hosted service that runs on startup to backfill blob containers for all existing trips.
/// Activated only if Backfill:RunOnStartup is true in configuration.
/// Creates a new scope per run to avoid captive dependency issues.
/// </summary>
public class ContainerBackfillHostedService : IHostedService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<ContainerBackfillHostedService> _logger;
    private readonly bool _runOnStartup;

    public ContainerBackfillHostedService(
        IServiceProvider serviceProvider,
        ILogger<ContainerBackfillHostedService> logger,
        IConfiguration configuration)
    {
        _serviceProvider = serviceProvider;
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

        // Create a scope to resolve scoped dependencies (db, provisioner)
        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RoadTripMap.Data.RoadTripDbContext>();
        var provisioner = scope.ServiceProvider.GetRequiredService<IBlobContainerProvisioner>();

        var trips = await db.Trips.ToListAsync(cancellationToken);
        var succeeded = 0;
        var failed = 0;

        foreach (var trip in trips)
        {
            try
            {
                await provisioner.EnsureContainerAsync(trip.SecretToken, cancellationToken);
                succeeded++;
            }
            catch (Exception ex)
            {
                failed++;
                _logger.LogWarning(ex, "Failed to provision container for trip {trip_token_prefix}",
                    Security.LogSanitizer.SanitizeToken(trip.SecretToken));
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
