namespace RoadTripMap.Services;

public interface ISasTokenIssuer
{
    /// <summary>
    /// Issues a short-lived write-only SAS URI for uploading a blob to a container.
    /// The URI includes query parameters with the token; it can be passed directly to the client.
    /// </summary>
    /// <param name="containerName">Azure Blob Storage container name.</param>
    /// <param name="blobPath">Blob path (relative to container).</param>
    /// <param name="ttl">Token time-to-live (e.g., 2 hours).</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Complete SAS URI ready to use for blob uploads.</returns>
    Task<Uri> IssueWriteSasAsync(string containerName, string blobPath, TimeSpan ttl, CancellationToken ct);
}
