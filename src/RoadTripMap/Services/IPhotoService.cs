namespace RoadTripMap.Services;

public interface IPhotoService
{
    Task<PhotoUploadResult> ProcessAndUploadAsync(Stream imageStream, int tripId, int photoId, string originalFileName);
    Task<Stream> GetPhotoAsync(int tripId, int photoId, string size);
    Task DeletePhotoAsync(int tripId, int photoId, string blobPath);
}

public record PhotoUploadResult(string BlobPath);
