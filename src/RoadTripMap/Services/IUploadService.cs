using RoadTripMap.Models;

namespace RoadTripMap.Services;

public interface IUploadService
{
    /// <summary>
    /// Requests permission to upload a photo to a trip's blob container.
    /// Issues a short-lived SAS URL for block uploads.
    /// Idempotent: calling with the same UploadId returns the same photo_id and new SAS.
    /// </summary>
    Task<RequestUploadResponse> RequestUploadAsync(string tripToken, RequestUploadRequest request, CancellationToken ct);

    /// <summary>
    /// Commits a block blob after all blocks have been uploaded.
    /// Validates that all requested block IDs match uncommitted blocks on the server.
    /// Updates the photo row status to 'committed'.
    /// </summary>
    Task<PhotoResponse> CommitAsync(string tripToken, Guid photoId, CommitRequest request, CancellationToken ct);

    /// <summary>
    /// Aborts an upload in progress, deleting the photo row.
    /// Idempotent: no-op if the photo doesn't exist.
    /// </summary>
    Task AbortAsync(string tripToken, Guid photoId, CancellationToken ct);
}
