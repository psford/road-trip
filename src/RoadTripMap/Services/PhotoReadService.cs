using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Models;

namespace RoadTripMap.Services;

/// <summary>
/// Implements dual-read logic for photos stored in either legacy or per-trip containers.
///
/// PhotoEntity.UploadId is used as the PhotoId placeholder in per-trip URLs:
/// - Legacy: /api/photos/{tripId}/{photoId}/display (proxy URLs unchanged)
/// - Per-trip: internally references trip-{secretToken}/{uploadId}_display.jpg
///
/// This service abstracts the storage tier details from the HTTP layer.
/// </summary>
public class PhotoReadService : IPhotoReadService
{
    private readonly RoadTripDbContext _db;
    private readonly ILogger<PhotoReadService> _logger;

    public PhotoReadService(RoadTripDbContext db, ILogger<PhotoReadService> logger)
    {
        _db = db ?? throw new ArgumentNullException(nameof(db));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<List<PhotoResponse>> GetPhotosForTripAsync(string secretToken, CancellationToken ct)
    {
        // Look up trip by secret token
        var trip = await _db.Trips
            .FirstOrDefaultAsync(t => t.SecretToken == secretToken, ct);

        if (trip == null)
            throw new KeyNotFoundException($"Trip not found");

        // Query photos with "committed" status, ordered by TakenAt (chronological)
        // Nulls sort last: OrderBy(p => p.TakenAt == null) returns false (0) for non-null, true (1) for null
        var photos = await _db.Photos
            .Where(p => p.TripId == trip.Id && p.Status == "committed")
            .OrderBy(p => p.TakenAt == null)
            .ThenBy(p => p.TakenAt)
            .ToListAsync(ct);

        // Transform to PhotoResponse, using storage tier to determine URL scheme
        var responses = new List<PhotoResponse>();
        foreach (var photo in photos)
        {
            // All PhotoResponse objects use the same /api/photos API proxy URL scheme
            // (never exposing direct blob URLs to clients)
            var response = new PhotoResponse
            {
                Id = photo.Id,
                ThumbnailUrl = $"/api/photos/{trip.Id}/{photo.Id}/thumb",
                DisplayUrl = $"/api/photos/{trip.Id}/{photo.Id}/display",
                OriginalUrl = $"/api/photos/{trip.Id}/{photo.Id}/original",
                Lat = photo.Latitude,
                Lng = photo.Longitude,
                PlaceName = photo.PlaceName ?? "",
                Caption = photo.Caption,
                TakenAt = photo.TakenAt
            };

            responses.Add(response);
        }

        return responses;
    }
}
