using RoadTripMap.BackgroundJobs;

namespace RoadTripMap.BackgroundJobs;

/// <summary>
/// Hosted service that runs orphan sweep on a periodic timer.
/// Reads configuration from OrphanSweeper section.
/// </summary>
public class OrphanSweeperHostedService : IHostedService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<OrphanSweeperHostedService> _logger;
    private readonly int _intervalHours;
    private PeriodicTimer? _timer;

    public OrphanSweeperHostedService(
        IServiceProvider serviceProvider,
        ILogger<OrphanSweeperHostedService> logger,
        IConfiguration configuration)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;

        // Read interval from config
        _intervalHours = configuration.GetValue<int?>("OrphanSweeper:IntervalHours") ?? 1;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("OrphanSweeper hosted service starting with interval {interval_hours}h",
            _intervalHours);

        _timer = new PeriodicTimer(TimeSpan.FromHours(_intervalHours));

        // Fire immediately on startup
        await PerformSweepAsync(cancellationToken);

        // Then run on periodic timer
        _ = Task.Run(async () =>
        {
            try
            {
                while (await _timer.WaitForNextTickAsync(cancellationToken))
                {
                    await PerformSweepAsync(cancellationToken);
                }
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation("OrphanSweeper timer cancelled");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "OrphanSweeper timer error");
            }
        }, cancellationToken);
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("OrphanSweeper hosted service stopping");

        if (_timer is not null)
        {
            _timer.Dispose();
        }

        await Task.CompletedTask;
    }

    private async Task PerformSweepAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _serviceProvider.CreateScope();
            var sweeper = scope.ServiceProvider.GetRequiredService<IOrphanSweeper>();
            await sweeper.SweepAsync(DateTime.UtcNow, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error performing orphan sweep");
        }
    }
}
