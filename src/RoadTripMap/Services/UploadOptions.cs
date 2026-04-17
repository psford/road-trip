namespace RoadTripMap.Services;

/// <summary>
/// Configuration options for SAS token issuance and upload behavior.
/// Bound from configuration section "Upload".
/// </summary>
public class UploadOptions
{
    /// <summary>
    /// Time-to-live for SAS tokens (default: 2 hours).
    /// </summary>
    public TimeSpan SasTokenTtl { get; set; } = TimeSpan.FromHours(2);

    /// <summary>
    /// Maximum size of a single blob block (default: 4 MiB).
    /// Azure SDK limits are 4 GiB, but we enforce 4 MiB for client safety.
    /// </summary>
    public int MaxBlockSizeBytes { get; set; } = 4 * 1024 * 1024; // 4 MiB
}
