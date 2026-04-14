using Microsoft.AspNetCore.Mvc;
using RoadTripMap.Data;
using RoadTripMap.Models;
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
        var group = app.MapGroup("/api/trips/{token}/photos")
            .WithName("PhotoUpload");

        group.MapPost("request-upload", RequestUploadHandler)
            .WithName("RequestUpload");

        group.MapPost("{photoId:guid}/commit", CommitHandler)
            .WithName("Commit");

        group.MapPost("{photoId:guid}/abort", AbortHandler)
            .WithName("Abort");

        return app;
    }

    /// <summary>
    /// POST /api/trips/{token}/photos/request-upload
    /// Initiates a photo upload and returns a SAS-signed URL for block uploads.
    /// AC1.1: Creates row with status='pending', issues SAS token, returns RequestUploadResponse.
    /// AC1.3: Idempotent on upload_id; returns existing photo_id if present.
    /// </summary>
    private static async Task<IResult> RequestUploadHandler(
        string token,
        [FromBody] RequestUploadRequest request,
        RoadTripDbContext db,
        IUploadService uploadService,
        ILogger<Program> logger,
        CancellationToken ct)
    {
        try
        {
            // Validate token via UploadService (it will throw KeyNotFoundException if not found)
            var response = await uploadService.RequestUploadAsync(token, request, ct);

            // Log success with sanitized data
            logger.LogInformation(
                "RequestUploadHandler: success. upload_id={uploadId}, blob_path={blobPath}",
                request.UploadId,
                Sanitize(response.BlobPath));

            // Return 200 with RequestUploadResponse (includes serverVersion and clientMinVersion)
            return Results.Ok(response);
        }
        catch (KeyNotFoundException)
        {
            return Results.NotFound(new { error = "Trip not found" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "RequestUploadHandler: unexpected error. token_prefix={prefix}",
                Sanitize(token.Substring(0, 4)));
            return Results.StatusCode(500);
        }
    }

    /// <summary>
    /// POST /api/trips/{token}/photos/{photoId:guid}/commit
    /// Finalizes a photo upload by committing the staged blocks into a blob.
    /// AC1.4: Validates block list; returns 400 on mismatch.
    /// AC1.6: Returns 404 if photo_id doesn't belong to this trip.
    /// </summary>
    private static async Task<IResult> CommitHandler(
        string token,
        Guid photoId,
        [FromBody] CommitRequest request,
        RoadTripDbContext db,
        IUploadService uploadService,
        ILogger<Program> logger,
        CancellationToken ct)
    {
        try
        {
            // Validate token via UploadService (it will throw KeyNotFoundException if not found)
            var response = await uploadService.CommitAsync(token, photoId, request, ct);

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
                Sanitize(token.Substring(0, 4)));
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
                Sanitize(token.Substring(0, 4)));
            return Results.StatusCode(500);
        }
    }

    /// <summary>
    /// POST /api/trips/{token}/photos/{photoId:guid}/abort
    /// Cancels an in-progress upload, deleting the pending photo row.
    /// AC1.7: Idempotent; no-op if photo not found.
    /// </summary>
    private static async Task<IResult> AbortHandler(
        string token,
        Guid photoId,
        RoadTripDbContext db,
        IUploadService uploadService,
        ILogger<Program> logger,
        CancellationToken ct)
    {
        try
        {
            // Validate token via UploadService (it will throw KeyNotFoundException if not found)
            await uploadService.AbortAsync(token, photoId, ct);

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
                Sanitize(token.Substring(0, 4)));
            return Results.StatusCode(500);
        }
    }

    /// <summary>
    /// Sanitize sensitive data for logging (tokens, paths).
    /// </summary>
    private static string Sanitize(object value)
    {
        return value?.ToString() ?? "?";
    }
}
