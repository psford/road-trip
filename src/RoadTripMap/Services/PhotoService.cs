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

        // Read EXIF orientation before decoding
        imageStream.Position = 0;
        using var codec = SKCodec.Create(imageStream);
        if (codec == null)
            throw new InvalidOperationException("Failed to decode image");

        var orientation = codec.EncodedOrigin;

        imageStream.Position = 0;
        using var bitmap = SKBitmap.Decode(imageStream);

        if (bitmap == null)
            throw new InvalidOperationException("Failed to decode image");

        // Apply EXIF rotation so stored images are always upright
        var rotated = ApplyExifRotation(bitmap, orientation);

        // Upload original tier: strip EXIF by re-encoding at original dimensions with max quality (no resize)
        var blobPath = await UploadPhotoTierAsync(containerClient, rotated, tripId, photoId, "original", maxWidth: null, 100);

        // Upload display and thumbnail tiers with size constraints
        await UploadPhotoTierAsync(containerClient, rotated, tripId, photoId, "display", 1920, 85);
        await UploadPhotoTierAsync(containerClient, rotated, tripId, photoId, "thumb", 300, 75);

        return new PhotoUploadResult(blobPath);
    }

    public async Task<Stream> GetPhotoAsync(string blobPath, string size)
    {
        var validSizes = new[] { "original", "display", "thumb" };
        if (!validSizes.Contains(size))
            throw new ArgumentException($"Invalid size: {size}. Must be one of: original, display, thumb");

        var containerClient = _blobServiceClient.GetBlobContainerClient(ContainerName);
        var suffix = size == "original" ? "" : $"_{size}";
        // blobPath is "{tripId}/{photoId}.jpg" — insert size suffix before extension
        var sizedPath = blobPath.Replace(".jpg", $"{suffix}.jpg");
        var blobClient = containerClient.GetBlobClient(sizedPath);

        var download = await blobClient.DownloadAsync();
        return download.Value.Content;
    }

    public async Task DeletePhotoAsync(string blobPath)
    {
        var containerClient = _blobServiceClient.GetBlobContainerClient(ContainerName);

        // Delete all three tiers based on stored blobPath
        var suffixes = new[] { "", "_display", "_thumb" };
        foreach (var suffix in suffixes)
        {
            var path = blobPath.Replace(".jpg", $"{suffix}.jpg");
            var blobClient = containerClient.GetBlobClient(path);
            await blobClient.DeleteIfExistsAsync();
        }
    }

    private SKBitmap ApplyExifRotation(SKBitmap bitmap, SKEncodedOrigin orientation)
    {
        if (orientation == SKEncodedOrigin.Default || orientation == SKEncodedOrigin.TopLeft)
            return bitmap;

        SKBitmap rotated;
        switch (orientation)
        {
            case SKEncodedOrigin.RightTop: // 90° CW (most common for portrait photos)
                rotated = new SKBitmap(bitmap.Height, bitmap.Width);
                using (var canvas = new SKCanvas(rotated))
                {
                    canvas.Translate(rotated.Width, 0);
                    canvas.RotateDegrees(90);
                    canvas.DrawBitmap(bitmap, 0, 0);
                }
                return rotated;

            case SKEncodedOrigin.BottomRight: // 180°
                rotated = new SKBitmap(bitmap.Width, bitmap.Height);
                using (var canvas = new SKCanvas(rotated))
                {
                    canvas.Translate(rotated.Width, rotated.Height);
                    canvas.RotateDegrees(180);
                    canvas.DrawBitmap(bitmap, 0, 0);
                }
                return rotated;

            case SKEncodedOrigin.LeftBottom: // 270° CW (90° CCW)
                rotated = new SKBitmap(bitmap.Height, bitmap.Width);
                using (var canvas = new SKCanvas(rotated))
                {
                    canvas.Translate(0, rotated.Height);
                    canvas.RotateDegrees(270);
                    canvas.DrawBitmap(bitmap, 0, 0);
                }
                return rotated;

            default:
                // Other orientations (mirrored) are rare — return as-is
                return bitmap;
        }
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
