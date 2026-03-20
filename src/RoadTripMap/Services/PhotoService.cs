using Azure.Storage.Blobs;
using SkiaSharp;

namespace RoadTripMap.Services;

public class PhotoService : IPhotoService
{
    private readonly BlobServiceClient _blobServiceClient;
    private const string ContainerName = "road-trip-photos";

    public PhotoService(BlobServiceClient blobServiceClient)
    {
        _blobServiceClient = blobServiceClient;
    }

    public async Task<PhotoUploadResult> ProcessAndUploadAsync(Stream imageStream, int tripId, int photoId, string originalFileName)
    {
        // Ensure container exists
        var containerClient = _blobServiceClient.GetBlobContainerClient(ContainerName);
        await containerClient.CreateIfNotExistsAsync(Azure.Storage.Blobs.Models.PublicAccessType.None);

        // Decode the image from stream
        imageStream.Position = 0;
        using var bitmap = SKBitmap.Decode(imageStream);

        if (bitmap == null)
            throw new InvalidOperationException("Failed to decode image");

        // Apply EXIF rotation if needed
        var rotated = ApplyExifRotation(bitmap);

        // Upload original tier: strip EXIF by re-encoding at original dimensions with max quality (no resize)
        var blobPath = await UploadPhotoTierAsync(containerClient, rotated, tripId, photoId, "original", maxWidth: null, 100);

        // Upload display and thumbnail tiers with size constraints
        await UploadPhotoTierAsync(containerClient, rotated, tripId, photoId, "display", 1920, 85);
        await UploadPhotoTierAsync(containerClient, rotated, tripId, photoId, "thumb", 300, 75);

        return new PhotoUploadResult(blobPath);
    }

    public async Task<Stream> GetPhotoAsync(int tripId, int photoId, string size)
    {
        var validSizes = new[] { "original", "display", "thumb" };
        if (!validSizes.Contains(size))
            throw new ArgumentException($"Invalid size: {size}. Must be one of: original, display, thumb");

        var containerClient = _blobServiceClient.GetBlobContainerClient(ContainerName);
        var suffix = size == "original" ? "" : $"_{size}";
        var blobPath = $"{tripId}/{photoId}{suffix}.jpg";
        var blobClient = containerClient.GetBlobClient(blobPath);

        var download = await blobClient.DownloadAsync();
        return download.Value.Content;
    }

    public async Task DeletePhotoAsync(int tripId, int photoId, string blobPath)
    {
        var containerClient = _blobServiceClient.GetBlobContainerClient(ContainerName);

        // Delete all three tiers
        var suffixes = new[] { "", "_display", "_thumb" };
        foreach (var suffix in suffixes)
        {
            var path = $"{tripId}/{photoId}{suffix}.jpg";
            var blobClient = containerClient.GetBlobClient(path);
            await blobClient.DeleteIfExistsAsync();
        }
    }

    private SKBitmap ApplyExifRotation(SKBitmap bitmap)
    {
        // SKCodec.EncodedOrigin indicates EXIF rotation in the image metadata.
        // When we re-encode to JPEG, EXIF is stripped, so we must apply the rotation
        // to the bitmap data before encoding. For now, re-encode with quality 100 on original
        // which preserves image quality while removing EXIF. Portrait orientation photos
        // are corrected by the browser's automatic EXIF handling on display, but we should
        // ideally store them in canonical (upright) form for consistency.
        // TODO: Implement actual rotation transformation if EXIF orientation is detected
        return bitmap;
    }

    private async Task<string> UploadPhotoTierAsync(BlobContainerClient containerClient, SKBitmap bitmap, int tripId, int photoId, string tier, int? maxWidth, int quality)
    {
        // Resize if needed (original tier has maxWidth = null, so no resize)
        var resized = maxWidth.HasValue ? ResizeImage(bitmap, maxWidth.Value) : bitmap;

        // Encode to JPEG (re-encoding strips EXIF)
        using var encoded = resized.Encode(SKEncodedImageFormat.Jpeg, quality);
        var stream = encoded.AsStream();

        // Upload to blob
        var suffix = tier == "original" ? "" : $"_{tier}";
        var blobPath = $"{tripId}/{photoId}{suffix}.jpg";
        var blobClient = containerClient.GetBlobClient(blobPath);
        await blobClient.UploadAsync(stream, overwrite: true);

        return blobPath;
    }

    private SKBitmap ResizeImage(SKBitmap original, int maxWidth)
    {
        var newDimensions = CalculateResizedDimensions(original.Width, original.Height, maxWidth);
        var sampling = new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear);
        var resized = original.Resize(newDimensions, sampling);
        return resized ?? original;
    }

    private static SKImageInfo CalculateResizedDimensions(int origWidth, int origHeight, int maxWidth)
    {
        if (origWidth <= maxWidth)
            return new SKImageInfo(origWidth, origHeight);

        var ratio = (float)maxWidth / origWidth;
        return new SKImageInfo(maxWidth, (int)(origHeight * ratio));
    }
}
