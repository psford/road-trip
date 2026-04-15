using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Models;
using RoadTripMap.Security;
using RoadTripMap.Services;

namespace RoadTripMap.Endpoints;

/// <summary>
/// Minimal API endpoints for resilient photo uploads.
/// Maps POST request-upload, commit, and abort operations.
/// </summary>
public static class UploadEndpoints
{
    /// <summary>
    /// Register upload endpoints on the WebApplication.
    /// </summary>
    public static WebApplication MapUploadEndpoints(this WebApplication app)
    {
        // POST /api/trips/{secretToken}/photos/request-upload
        app.MapPost("/api/trips/{secretToken}/photos/request-upload", RequestUploadHandler)
            .WithName("RequestUpload");

        // POST /api/trips/{secretToken}/photos/{photoId:guid}/commit
        app.MapPost("/api/trips/{secretToken}/photos/{photoId:guid}/commit", CommitHandler)
            .WithName("Commit");

        // POST /api/trips/{secretToken}/photos/{photoId:guid}/abort
        app.MapPost("/api/trips/{secretToken}/photos/{photoId:guid}/abort", AbortHandler)
            .WithName("Abort");

        // POST /api/trips/{secretToken}/photos/{photoId:guid}/pin-drop
        app.MapPost("/api/trips/{secretToken}/photos/{photoId:guid}/pin-drop", PinDropHandler)
            .WithName("PinDrop");

        return app;
    }

    /// <summary>
    /// POST /api/trips/{secretToken}/photos/request-upload
    /// Initiates a photo upload and returns a SAS-signed URL for block uploads.
    /// AC1.1: Creates row with status='pending', issues SAS token, returns RequestUploadResponse.
    /// AC1.3: Idempotent on upload_id; returns existing photo_id if present.
    /// </summary>
    private static async Task<IResult> RequestUploadHandler(
        string secretToken,
        [FromBody] RequestUploadRequest request,
        IUploadService uploadService,
        IAuthStrategy authStrategy,
        RoadTripDbContext db,
        ILogger<Program> logger,
        HttpContext context,
        CancellationToken ct)
    {
        try
        {
            // Look up trip and validate auth
            var trip = await db.Trips.FirstOrDefaultAsync(t => t.SecretToken == secretToken, ct);
            if (trip == null)
                return Results.NotFound(new { error = "Trip not found" });

            var authResult = await authStrategy.ValidatePostAccess(context, trip);
            if (!authResult.IsAuthorized)
                return Results.Unauthorized();

            // Initiate upload via UploadService
            var response = await uploadService.RequestUploadAsync(secretToken, request, ct);

            // Log success with sanitized data
            logger.LogInformation(
                "RequestUploadHandler: success. upload_id={uploadId}, blob_path={blobPath}",
                request.UploadId,
                LogSanitizer.SanitizeBlobPath(response.BlobPath));

            // Return 200 with RequestUploadResponse (includes serverVersion and clientMinVersion)
            return Results.Ok(response);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "RequestUploadHandler: unexpected error. token_prefix={prefix}",
                LogSanitizer.SanitizeToken(secretToken));
            return Results.StatusCode(500);
        }
    }

    /// <summary>
    /// POST /api/trips/{secretToken}/photos/{photoId:guid}/commit
    /// Finalizes a photo upload by committing the staged blocks into a blob.
    /// AC1.4: Validates block list; returns 400 on mismatch.
    /// AC1.6: Returns 404 if photo_id doesn't belong to this trip.
    /// </summary>
    private static async Task<IResult> CommitHandler(
        string secretToken,
        Guid photoId,
        [FromBody] CommitRequest request,
        IUploadService uploadService,
        IAuthStrategy authStrategy,
        RoadTripDbContext db,
        ILogger<Program> logger,
        HttpContext context,
        CancellationToken ct)
    {
        try
        {
            // Look up trip and validate auth
            var trip = await db.Trips.FirstOrDefaultAsync(t => t.SecretToken == secretToken, ct);
            if (trip == null)
                return Results.NotFound(new { error = "Trip not found" });

            var authResult = await authStrategy.ValidatePostAccess(context, trip);
            if (!authResult.IsAuthorized)
                return Results.Unauthorized();

            // Commit via UploadService
            var response = await uploadService.CommitAsync(secretToken, photoId, request, ct);

            logger.LogInformation(
                "CommitHandler: success. photo_id={photoId}, block_count={blockCount}",
                photoId,
                request.BlockIds.Count);

            // Return 200 with PhotoResponse
            return Results.Ok(response);
        }
        catch (KeyNotFoundException)
        {
            logger.LogInformation(
                "CommitHandler: photo not found. photo_id={photoId}, token_prefix={prefix}",
                photoId,
                LogSanitizer.SanitizeToken(secretToken));
            return Results.NotFound(new { error = "Photo not found or does not belong to this trip" });
        }
        catch (BadHttpRequestException ex) when (ex.Message.Contains("BlockListMismatch"))
        {
            logger.LogWarning(
                "CommitHandler: block list mismatch. photo_id={photoId}",
                photoId);
            return Results.BadRequest(new { error = "BlockListMismatch", details = "Uploaded blocks do not match committed block IDs" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "CommitHandler: unexpected error. photo_id={photoId}, token_prefix={prefix}",
                photoId,
                LogSanitizer.SanitizeToken(secretToken));
            return Results.StatusCode(500);
        }
    }

    /// <summary>
    /// POST /api/trips/{secretToken}/photos/{photoId:guid}/abort
    /// Cancels an in-progress upload, deleting the pending photo row.
    /// AC1.7: Idempotent; no-op if photo not found.
    /// </summary>
    private static async Task<IResult> AbortHandler(
        string secretToken,
        Guid photoId,
        IUploadService uploadService,
        IAuthStrategy authStrategy,
        RoadTripDbContext db,
        ILogger<Program> logger,
        HttpContext context,
        CancellationToken ct)
    {
        try
        {
            // Look up trip and validate auth (M3)
            var trip = await db.Trips.FirstOrDefaultAsync(t => t.SecretToken == secretToken, ct);
            if (trip == null)
                return Results.NotFound(new { error = "Trip not found" });

            var authResult = await authStrategy.ValidatePostAccess(context, trip);
            if (!authResult.IsAuthorized)
                return Results.Unauthorized();

            // Abort via UploadService (idempotent if photo not found)
            await uploadService.AbortAsync(secretToken, photoId, ct);

            logger.LogInformation(
                "AbortHandler: success (or idempotent no-op). photo_id={photoId}",
                photoId);

            // Return 204 No Content
            return Results.NoContent();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "AbortHandler: unexpected error. photo_id={photoId}, token_prefix={prefix}",
                photoId,
                LogSanitizer.SanitizeToken(secretToken));
            return Results.StatusCode(500);
        }
    }

    /// <summary>
    /// POST /api/trips/{secretToken}/photos/{photoId:guid}/pin-drop
    /// Manually updates photo GPS coordinates via pin-drop UI.
    /// AC5.3, AC7.3: User clicks [📍 Pin manually] on a failed/committed photo → saves manual location.
    /// Returns 409 if photo is not in committed status.
    /// </summary>
    private static async Task<IResult> PinDropHandler(
        string secretToken,
        Guid photoId,
        [FromBody] PinDropRequest request,
        IUploadService uploadService,
        IAuthStrategy authStrategy,
        RoadTripDbContext db,
        ILogger<Program> logger,
        HttpContext context,
        CancellationToken ct)
    {
        try
        {
            // Look up trip and validate auth
            var trip = await db.Trips.FirstOrDefaultAsync(t => t.SecretToken == secretToken, ct);
            if (trip == null)
                return Results.NotFound(new { error = "Trip not found" });

            var authResult = await authStrategy.ValidatePostAccess(context, trip);
            if (!authResult.IsAuthorized)
                return Results.Unauthorized();

            // Pin-drop via UploadService
            var response = await uploadService.PinDropAsync(secretToken, photoId, request.GpsLat, request.GpsLon, ct);

            logger.LogInformation(
                "PinDropHandler: success. photo_id={photoId}, gps=({lat}, {lng})",
                photoId,
                request.GpsLat,
                request.GpsLon);

            // Return 200 with PhotoResponse
            return Results.Ok(response);
        }
        catch (KeyNotFoundException)
        {
            logger.LogInformation(
                "PinDropHandler: photo not found. photo_id={photoId}, token_prefix={prefix}",
                photoId,
                LogSanitizer.SanitizeToken(secretToken));
            return Results.NotFound(new { error = "Photo not found or does not belong to this trip" });
        }
        catch (BadHttpRequestException ex) when (ex.Message.Contains("Pin-drop only allowed"))
        {
            logger.LogWarning(
                "PinDropHandler: pin-drop rejected on non-committed photo. photo_id={photoId}",
                photoId);
            return Results.StatusCode(409, new { error = "Conflict: pin-drop only allowed on committed photos" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "PinDropHandler: unexpected error. photo_id={photoId}, token_prefix={prefix}",
                photoId,
                LogSanitizer.SanitizeToken(secretToken));
            return Results.StatusCode(500);
        }
    }

}
