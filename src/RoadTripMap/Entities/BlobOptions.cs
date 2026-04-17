namespace RoadTripMap.Entities;

/// <summary>
/// Configuration options for Azure Blob Storage.
/// Supports both production (Azure Managed Identity) and development (Azurite) modes.
/// </summary>
public class BlobOptions
{
    public bool UseDevelopmentStorage { get; set; }
    public string? ConnectionString { get; set; }
    public string? AccountName { get; set; }
    public string? AccountKey { get; set; }
}
