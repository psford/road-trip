using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Specialized;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Models;
using RoadTripMap.Security;
using RoadTripMap.Versioning;

namespace RoadTripMap.Services;

public class UploadService : IUploadService
{
    private readonly RoadTripDbContext _db;
    private readonly BlobServiceClient _blobServiceClient;
    private readonly ISasTokenIssuer _sasTokenIssuer;
    private readonly IGeocodingService _geocodingService;
    private readonly ILogger<UploadService> _logger;
    private readonly UploadOptions _options;

    public UploadService(
        RoadTripDbContext db,
        BlobServiceClient blobServiceClient,
        ISasTokenIssuer sasTokenIssuer,
        IGeocodingService geocodingService,
        ILogger<UploadService> logger,
        IOptions<UploadOptions> options)
    {
        _db = db;
        _blobServiceClient = blobServiceClient;
        _sasTokenIssuer = sasTokenIssuer;
        _geocodingService = geocodingService;
        _logger = logger;
        _options = options.Value;
    }

    public async Task<RequestUploadResponse> RequestUploadAsync(string tripToken, RequestUploadRequest request, CancellationToken ct)
    {
        // AC1.1: Look up trip by secretToken; 404 if not found
        var trip = await _db.Trips
            .FirstOrDefaultAsync(t => t.SecretToken == tripToken, ct);

        if (trip == null)
        {
            throw new KeyNotFoundException($"Trip not found: {LogSanitizer.SanitizeToken(tripToken)}");
        }

        // AC1.3: Look up existing photo by UploadId; if present and belongs to same trip,
        // regenerate SAS and return existing photo_id (idempotency)
        var existingPhoto = await _db.Photos
            .FirstOrDefaultAsync(p => p.UploadId == request.UploadId && p.TripId == trip.Id, ct);

        if (existingPhoto != null)
        {
            // I3: Increment upload attempt count for idempotent re-requests
            existingPhoto.UploadAttemptCount++;
            existingPhoto.LastActivityAt = DateTime.UtcNow;

            // I4: Delete stale blob with uncommitted blocks to prevent them from being committed in next attempt
            try
            {
                var staleContainerName = $"trip-{tripToken.ToLowerInvariant()}";
                var staleContainerClient = _blobServiceClient.GetBlobContainerClient(staleContainerName);
                var staleBlockBlobClient = staleContainerClient.GetBlockBlobClient(existingPhoto.BlobPath);
                await staleBlockBlobClient.DeleteIfExistsAsync(cancellationToken: ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to delete stale blob during idempotent re-request. trip_token_prefix={prefix}",
                    LogSanitizer.SanitizeToken(tripToken));
                // Continue anyway - blob will be overwritten on commit
            }

            _db.Photos.Update(existingPhoto);
            await _db.SaveChangesAsync(ct);

            _logger.LogInformation(
                "RequestUploadAsync: idempotent call with existing UploadId, returning existing photo_id. trip_token_prefix={prefix}",
                LogSanitizer.SanitizeToken(tripToken));

            var existingSasUrl = await _sasTokenIssuer.IssueWriteSasAsync(
                $"trip-{tripToken.ToLowerInvariant()}",
                existingPhoto.BlobPath,
                _options.SasTokenTtl,
                ct);

            return new RequestUploadResponse
            {
                PhotoId = request.UploadId,
                SasUrl = existingSasUrl.ToString(),
                BlobPath = existingPhoto.BlobPath,
                MaxBlockSizeBytes = _options.MaxBlockSizeBytes,
                ServerVersion = ServerVersion.Current,
                ClientMinVersion = ServerVersion.ClientMin
            };
        }

        // AC1.1: Create new row with status='pending', storage_tier='per-trip'
        // Use the client-provided UploadId as the blob path identifier (enables idempotency)
        var blobPath = $"{request.UploadId}_original.jpg";

        var photo = new PhotoEntity
        {
            TripId = trip.Id,
            BlobPath = blobPath,
            Status = "pending",
            StorageTier = "per-trip",
            UploadId = request.UploadId,
            LastActivityAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow,
            // Persist EXIF metadata from request
            Latitude = request.Exif?.GpsLat ?? 0,
            Longitude = request.Exif?.GpsLon ?? 0,
            TakenAt = request.Exif?.TakenAt?.UtcDateTime,
            // Leave PlaceName and Caption as defaults initially (set on commit via reverse geocoding)
        };

        await _db.Photos.AddAsync(photo, ct);
        await _db.SaveChangesAsync(ct);

        _logger.LogInformation(
            "RequestUploadAsync: created new photo. trip_token_prefix={prefix}, block_count=0",
            LogSanitizer.SanitizeToken(tripToken));

        // AC1.1: Issue SAS via ISasTokenIssuer
        var containerName = $"trip-{tripToken.ToLowerInvariant()}";
        var newSasUrl = await _sasTokenIssuer.IssueWriteSasAsync(
            containerName,
            blobPath,
            _options.SasTokenTtl,
            ct);

        return new RequestUploadResponse
        {
            PhotoId = request.UploadId,
            SasUrl = newSasUrl.ToString(),
            BlobPath = blobPath,
            MaxBlockSizeBytes = _options.MaxBlockSizeBytes,
            ServerVersion = ServerVersion.Current,
            ClientMinVersion = ServerVersion.ClientMin
        };
    }

    public async Task<PhotoResponse> CommitAsync(string tripToken, Guid photoId, CommitRequest request, CancellationToken ct)
    {
        // AC1.6: Load photos row by photo_id; 404 if not found or TripId doesn't match tripToken
        var trip = await _db.Trips
            .FirstOrDefaultAsync(t => t.SecretToken == tripToken, ct);

        if (trip == null)
        {
            throw new KeyNotFoundException($"Trip not found: {LogSanitizer.SanitizeToken(tripToken)}");
        }

        var photo = await _db.Photos
            .FirstOrDefaultAsync(p => p.UploadId == photoId && p.TripId == trip.Id, ct);

        if (photo == null)
        {
            throw new KeyNotFoundException($"Photo not found: {photoId}");
        }

        var containerName = $"trip-{tripToken.ToLowerInvariant()}";
        var containerClient = _blobServiceClient.GetBlobContainerClient(containerName);
        var blockBlobClient = containerClient.GetBlockBlobClient(photo.BlobPath);

        // AC1.4: Get uncommitted blocks and validate against requested block IDs.
        // If the blob was never created (no blocks staged), treat it as an empty block list.
        List<string> uncommittedBlockIds;
        try
        {
            var blockList = await blockBlobClient.GetBlockListAsync(
                Azure.Storage.Blobs.Models.BlockListTypes.Uncommitted,
                cancellationToken: ct);
            uncommittedBlockIds = blockList.Value.UncommittedBlocks.Select(b => b.Name).ToList();
        }
        catch (Azure.RequestFailedException ex) when (ex.Status == 404)
        {
            uncommittedBlockIds = new List<string>();
        }

        var missing = request.BlockIds.Except(uncommittedBlockIds).ToList();
        if (missing.Count > 0)
        {
            _logger.LogWarning(
                "CommitAsync: block list mismatch. missing_blocks={count}, trip_token_prefix={prefix}",
                missing.Count,
                LogSanitizer.SanitizeToken(tripToken));

            throw new BadHttpRequestException("BlockListMismatch: uploaded blocks do not match committed block IDs");
        }

        // AC1.4: Commit the block list
        await blockBlobClient.CommitBlockListAsync(request.BlockIds, cancellationToken: ct);

        _logger.LogInformation(
            "CommitAsync: committed photo. block_count={count}, trip_token_prefix={prefix}",
            request.BlockIds.Count,
            LogSanitizer.SanitizeToken(tripToken));

        // AC1.4 & C7: Reverse-geocode to set PlaceName if GPS coordinates present
        if (photo.Latitude != 0 && photo.Longitude != 0 && string.IsNullOrEmpty(photo.PlaceName))
        {
            try
            {
                var placeName = await _geocodingService.ReverseGeocodeAsync(photo.Latitude, photo.Longitude);
                if (!string.IsNullOrEmpty(placeName))
                {
                    photo.PlaceName = placeName;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to reverse-geocode photo location during commit");
                // Continue with empty PlaceName if geocoding fails
            }
        }

        // AC1.4: Update row: status='committed', last_activity_at=UtcNow
        photo.Status = "committed";
        photo.LastActivityAt = DateTime.UtcNow;
        _db.Photos.Update(photo);
        await _db.SaveChangesAsync(ct);

        // Return PhotoResponse with both int Id and Guid UploadId for client correlation (I2)
        return new PhotoResponse
        {
            Id = photo.Id,
            UploadId = photo.UploadId,
            ThumbnailUrl = $"/api/blobs/{photo.BlobPath}/thumbnail",
            DisplayUrl = $"/api/blobs/{photo.BlobPath}/display",
            OriginalUrl = $"/api/blobs/{photo.BlobPath}",
            Lat = photo.Latitude,
            Lng = photo.Longitude,
            PlaceName = photo.PlaceName ?? string.Empty,
            Caption = photo.Caption,
            TakenAt = photo.TakenAt
        };
    }

    public async Task AbortAsync(string tripToken, Guid photoId, CancellationToken ct)
    {
        // AC1.7: Delete row by photo_id+trip match; idempotent (no-op if missing)
        var trip = await _db.Trips
            .FirstOrDefaultAsync(t => t.SecretToken == tripToken, ct);

        if (trip == null)
        {
            _logger.LogInformation("AbortAsync: trip not found, no-op");
            return;
        }

        var photo = await _db.Photos
            .FirstOrDefaultAsync(p => p.UploadId == photoId && p.TripId == trip.Id, ct);

        if (photo == null)
        {
            _logger.LogInformation("AbortAsync: photo not found, no-op");
            return;
        }

        _db.Photos.Remove(photo);
        await _db.SaveChangesAsync(ct);

        _logger.LogInformation(
            "AbortAsync: deleted photo. trip_token_prefix={prefix}",
            LogSanitizer.SanitizeToken(tripToken));
    }

    /// <summary>
    /// PinDropAsync: Update photo GPS coordinates via manual pin-drop.
    /// AC5.3, AC7.3: User clicks [📍 Pin manually] on a committed photo → manual pin location saved.
    /// Scope: Only succeeds on committed photos (409 on failed/pending photos).
    /// </summary>
    public async Task<PhotoResponse> PinDropAsync(string tripToken, Guid photoId, double gpsLat, double gpsLon, CancellationToken ct)
    {
        // Load trip by secretToken
        var trip = await _db.Trips
            .FirstOrDefaultAsync(t => t.SecretToken == tripToken, ct);

        if (trip == null)
        {
            throw new KeyNotFoundException($"Trip not found: {LogSanitizer.SanitizeToken(tripToken)}");
        }

        // Load photo by photoId (using UploadId) and trip match
        var photo = await _db.Photos
            .FirstOrDefaultAsync(p => p.UploadId == photoId && p.TripId == trip.Id, ct);

        if (photo == null)
        {
            throw new KeyNotFoundException($"Photo not found: {photoId}");
        }

        // Only allow pin-drop on committed photos (AC7.3 scope)
        if (photo.Status != "committed")
        {
            throw new BadHttpRequestException($"Pin-drop only allowed on committed photos, current status: {photo.Status}");
        }

        // Validate GPS coordinates per CLAUDE.md invariants: lat [-90,90], lng [-180,180]
        if (gpsLat < -90 || gpsLat > 90 || gpsLon < -180 || gpsLon > 180)
        {
            throw new BadHttpRequestException("Invalid coordinates: latitude must be between -90 and 90, longitude between -180 and 180");
        }

        // Update GPS coordinates and timestamp
        photo.Latitude = gpsLat;
        photo.Longitude = gpsLon;
        photo.LastActivityAt = DateTime.UtcNow;

        // Always reverse-geocode on pin-drop (user is explicitly changing location)
        try
        {
            var placeName = await _geocodingService.ReverseGeocodeAsync(gpsLat, gpsLon);
            if (!string.IsNullOrEmpty(placeName))
            {
                photo.PlaceName = placeName;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to reverse-geocode photo location during pin-drop");
            // Continue with existing PlaceName if geocoding fails
        }

        _db.Photos.Update(photo);
        await _db.SaveChangesAsync(ct);

        _logger.LogInformation(
            "PinDropAsync: updated photo GPS. photo_id={photoId}, trip_token_prefix={prefix}",
            photoId,
            LogSanitizer.SanitizeToken(tripToken));

        // Return updated PhotoResponse
        return new PhotoResponse
        {
            Id = photo.Id,
            UploadId = photo.UploadId,
            ThumbnailUrl = $"/api/blobs/{photo.BlobPath}/thumbnail",
            DisplayUrl = $"/api/blobs/{photo.BlobPath}/display",
            OriginalUrl = $"/api/blobs/{photo.BlobPath}",
            Lat = photo.Latitude,
            Lng = photo.Longitude,
            PlaceName = photo.PlaceName ?? string.Empty,
            Caption = photo.Caption,
            TakenAt = photo.TakenAt
        };
    }

}
