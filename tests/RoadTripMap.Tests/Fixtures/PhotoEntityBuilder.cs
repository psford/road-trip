using RoadTripMap.Entities;

namespace RoadTripMap.Tests.Fixtures;

/// <summary>
/// Builder for creating PhotoEntity instances in tests with sensible defaults
/// for required properties (Status, StorageTier).
/// </summary>
public class PhotoEntityBuilder
{
    private int _tripId = 1;
    private string _blobPath = "test/photo.jpg";
    private double _latitude = 0;
    private double _longitude = 0;
    private string? _placeName;
    private string? _caption;
    private DateTime? _takenAt;
    private string _status = "committed";
    private string _storageTier = "legacy";
    private Guid? _uploadId;
    private DateTime? _lastActivityAt;
    private int _uploadAttemptCount = 0;

    public PhotoEntityBuilder WithTripId(int tripId)
    {
        _tripId = tripId;
        return this;
    }

    public PhotoEntityBuilder WithBlobPath(string blobPath)
    {
        _blobPath = blobPath;
        return this;
    }

    public PhotoEntityBuilder WithCoordinates(double latitude, double longitude)
    {
        _latitude = latitude;
        _longitude = longitude;
        return this;
    }

    public PhotoEntityBuilder WithPlaceName(string? placeName)
    {
        _placeName = placeName;
        return this;
    }

    public PhotoEntityBuilder WithCaption(string? caption)
    {
        _caption = caption;
        return this;
    }

    public PhotoEntityBuilder WithTakenAt(DateTime? takenAt)
    {
        _takenAt = takenAt;
        return this;
    }

    public PhotoEntityBuilder WithStatus(string status)
    {
        _status = status;
        return this;
    }

    public PhotoEntityBuilder WithStorageTier(string storageTier)
    {
        _storageTier = storageTier;
        return this;
    }

    public PhotoEntityBuilder WithUploadId(Guid? uploadId)
    {
        _uploadId = uploadId;
        return this;
    }

    public PhotoEntityBuilder WithLastActivityAt(DateTime? lastActivityAt)
    {
        _lastActivityAt = lastActivityAt;
        return this;
    }

    public PhotoEntityBuilder WithUploadAttemptCount(int count)
    {
        _uploadAttemptCount = count;
        return this;
    }

    public PhotoEntity Build()
    {
        return new PhotoEntity
        {
            TripId = _tripId,
            BlobPath = _blobPath,
            Latitude = _latitude,
            Longitude = _longitude,
            PlaceName = _placeName,
            Caption = _caption,
            TakenAt = _takenAt,
            Status = _status,
            StorageTier = _storageTier,
            UploadId = _uploadId,
            LastActivityAt = _lastActivityAt,
            UploadAttemptCount = _uploadAttemptCount
        };
    }
}
