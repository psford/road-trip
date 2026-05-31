using RoadTripMap.Models;

namespace RoadTripMap.Services;

/// <summary>
/// Service for reading photos from either legacy or per-trip storage containers.
/// Handles dual-read logic: legacy photos come from road-trip-photos container,
/// per-trip photos come from trip-{secretToken} containers.
/// </summary>
public interface IPhotoReadService
{
    /// <summary>
    /// Get all committed photos for a trip, supporting both legacy and per-trip storage tiers.
    /// </summary>
    /// <param name="secretToken">The secret token identifying the trip</param>
    /// <param name="ct">Cancellation token</param>
    /// <returns>List of PhotoResponse objects, ordered by TakenAt (chronological)</returns>
    Task<List<PhotoResponse>> GetPhotosForTripAsync(string secretToken, CancellationToken ct);
}
