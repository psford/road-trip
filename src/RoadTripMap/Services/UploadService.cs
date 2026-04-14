using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Specialized;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Models;

namespace RoadTripMap.Services;

public class UploadService : IUploadService
{
    private readonly RoadTripDbContext _db;
    private readonly BlobServiceClient _blobServiceClient;
    private readonly ISasTokenIssuer _sasTokenIssuer;
    private readonly ILogger<UploadService> _logger;
    private readonly UploadOptions _options;

    public UploadService(
        RoadTripDbContext db,
        BlobServiceClient blobServiceClient,
        ISasTokenIssuer sasTokenIssuer,
        ILogger<UploadService> logger,
        IOptions<UploadOptions> options)
    {
        _db = db;
        _blobServiceClient = blobServiceClient;
        _sasTokenIssuer = sasTokenIssuer;
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
            throw new KeyNotFoundException($"Trip not found: {tripToken}");
        }

        // AC1.3: Look up existing photo by UploadId; if present and belongs to same trip,
        // regenerate SAS and return existing photo_id (idempotency)
        var existingPhoto = await _db.Photos
            .FirstOrDefaultAsync(p => p.UploadId == request.UploadId && p.TripId == trip.Id, ct);

        if (existingPhoto != null)
        {
            _logger.LogInformation(
                "RequestUploadAsync: idempotent call with existing UploadId, returning existing photo_id. trip_token_prefix={prefix}",
                Sanitize(tripToken.Substring(0, 4)));

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
                ServerVersion = "1.0.0",
                ClientMinVersion = "1.0.0"
            };
        }

        // AC1.1: Create new row with status='pending', storage_tier='per-trip'
        var photoId = Guid.NewGuid();
        var blobPath = $"{photoId}_original.jpg";

        var photo = new PhotoEntity
        {
            TripId = trip.Id,
            BlobPath = blobPath,
            Status = "pending",
            StorageTier = "per-trip",
            UploadId = request.UploadId,
            LastActivityAt = DateTime.UtcNow,
            // Leave Latitude, Longitude, PlaceName, Caption, TakenAt as defaults initially
        };

        await _db.Photos.AddAsync(photo, ct);
        await _db.SaveChangesAsync(ct);

        _logger.LogInformation(
            "RequestUploadAsync: created new photo. trip_token_prefix={prefix}, block_count=0",
            Sanitize(tripToken.Substring(0, 4)));

        // AC1.1: Issue SAS via ISasTokenIssuer
        var containerName = $"trip-{tripToken.ToLowerInvariant()}";
        var newSasUrl = await _sasTokenIssuer.IssueWriteSasAsync(
            containerName,
            blobPath,
            _options.SasTokenTtl,
            ct);

        return new RequestUploadResponse
        {
            PhotoId = photoId,
            SasUrl = newSasUrl.ToString(),
            BlobPath = blobPath,
            MaxBlockSizeBytes = _options.MaxBlockSizeBytes,
            ServerVersion = "1.0.0",
            ClientMinVersion = "1.0.0"
        };
    }

    public async Task<PhotoResponse> CommitAsync(string tripToken, Guid photoId, CommitRequest request, CancellationToken ct)
    {
        // AC1.6: Load photos row by photo_id; 404 if not found or TripId doesn't match tripToken
        var trip = await _db.Trips
            .FirstOrDefaultAsync(t => t.SecretToken == tripToken, ct);

        if (trip == null)
        {
            throw new KeyNotFoundException($"Trip not found: {tripToken}");
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

        // AC1.4: Get uncommitted blocks and validate against requested block IDs
        var blockList = await blockBlobClient.GetBlockListAsync(
            Azure.Storage.Blobs.Models.BlockListTypes.Uncommitted,
            cancellationToken: ct);
        var uncommittedBlockIds = blockList.Value.UncommittedBlocks.Select(b => b.Name).ToList();

        var missing = request.BlockIds.Except(uncommittedBlockIds).ToList();
        if (missing.Count > 0)
        {
            _logger.LogWarning(
                "CommitAsync: block list mismatch. missing_blocks={count}, trip_token_prefix={prefix}",
                missing.Count,
                Sanitize(tripToken.Substring(0, 4)));

            throw new BadHttpRequestException(
                "Block list validation failed",
                new InvalidOperationException($"BlockListMismatch: missing blocks"));
        }

        // AC1.4: Commit the block list
        await blockBlobClient.CommitBlockListAsync(request.BlockIds, cancellationToken: ct);

        _logger.LogInformation(
            "CommitAsync: committed photo. block_count={count}, trip_token_prefix={prefix}",
            request.BlockIds.Count,
            Sanitize(tripToken.Substring(0, 4)));

        // AC1.4: Update row: status='committed', last_activity_at=UtcNow
        photo.Status = "committed";
        photo.LastActivityAt = DateTime.UtcNow;
        _db.Photos.Update(photo);
        await _db.SaveChangesAsync(ct);

        // Return PhotoResponse shaped identically to existing GET /photos endpoint
        return new PhotoResponse
        {
            Id = photo.Id,
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
            Sanitize(tripToken.Substring(0, 4)));
    }

    /// <summary>
    /// Sanitize sensitive data (IDs, tokens) for logging.
    /// </summary>
    private static string Sanitize(object value)
    {
        // For now, just return the value as a string.
        // This is a placeholder for future log redaction infrastructure.
        return value.ToString() ?? "?";
    }
}
