namespace RoadTripMap.Services;

public interface IPhotoService
{
    Task<PhotoUploadResult> ProcessAndUploadAsync(Stream imageStream, int tripId, int photoId, string originalFileName);
    Task<Stream> GetPhotoAsync(string blobPath, string size);
    Task<Stream> GetPhotoAsync(string blobPath, string size, string storageTier, string? containerName);
    Task DeletePhotoAsync(string blobPath);

    /// <summary>
    /// Generate display (1920px) and thumb (300px) tiers from an existing original blob
    /// in a per-trip container. The original blob must already exist at {uploadId}_original.jpg.
    /// Creates {uploadId}_display.jpg and {uploadId}_thumb.jpg in the same container.
    /// </summary>
    Task GenerateDerivedTiersAsync(string containerName, Guid uploadId, CancellationToken ct);
}

public record PhotoUploadResult(string BlobPath);
