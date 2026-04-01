namespace RoadTripMap.Services;

public interface IPhotoService
{
    Task<PhotoUploadResult> ProcessAndUploadAsync(Stream imageStream, int tripId, int photoId, string originalFileName);
    Task<Stream> GetPhotoAsync(string blobPath, string size);
    Task DeletePhotoAsync(string blobPath);
}

public record PhotoUploadResult(string BlobPath);
