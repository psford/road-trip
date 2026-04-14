namespace RoadTripMap.Services;

public interface IBlobContainerProvisioner
{
    /// <summary>
    /// Ensures a blob container exists for the given trip secret token.
    /// Container name is formatted as "trip-{secretToken.ToLowerInvariant()}".
    /// Idempotent: returns successfully if container already exists.
    /// </summary>
    /// <param name="secretToken">The trip's secret token (usually a GUID)</param>
    /// <param name="ct">Cancellation token</param>
    /// <returns>The created or existing container name</returns>
    /// <exception cref="InvalidContainerNameException">If the token produces an invalid Azure container name</exception>
    Task<string> EnsureContainerAsync(string secretToken, CancellationToken ct);

    /// <summary>
    /// Deletes the blob container for the given trip secret token.
    /// Idempotent: returns successfully if container doesn't exist.
    /// </summary>
    /// <param name="secretToken">The trip's secret token</param>
    /// <param name="ct">Cancellation token</param>
    Task DeleteContainerAsync(string secretToken, CancellationToken ct);
}
