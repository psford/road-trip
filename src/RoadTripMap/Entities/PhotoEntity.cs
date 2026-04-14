namespace RoadTripMap.Entities;

public class PhotoEntity
{
    public int Id { get; set; }
    public int TripId { get; set; }
    public required string BlobPath { get; set; }
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public string? PlaceName { get; set; }
    public string? Caption { get; set; }
    public DateTime? TakenAt { get; set; }
    public DateTime CreatedAt { get; set; }

    // Upload orchestration columns (pending → committed or failed)
    public required string Status { get; set; } = "committed";
    public required string StorageTier { get; set; } = "legacy";

    // Lifecycle tracking for idempotency and cleanup
    public Guid? UploadId { get; set; }
    public DateTime? LastActivityAt { get; set; }
    public int UploadAttemptCount { get; set; } = 0;

    public TripEntity Trip { get; set; } = null!;
}
