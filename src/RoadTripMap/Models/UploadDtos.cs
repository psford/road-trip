using System.Text.Json.Serialization;

namespace RoadTripMap.Models;

/// <summary>
/// Request to initiate a photo upload to a trip.
/// </summary>
public record RequestUploadRequest
{
    [JsonPropertyName("uploadId")]
    public required Guid UploadId { get; init; }

    [JsonPropertyName("filename")]
    public required string Filename { get; init; }

    [JsonPropertyName("contentType")]
    public required string ContentType { get; init; }

    [JsonPropertyName("sizeBytes")]
    public required long SizeBytes { get; init; }

    [JsonPropertyName("exif")]
    public ExifDto? Exif { get; init; }
}

/// <summary>
/// EXIF metadata extracted from a photo before upload.
/// GPS coordinates and taken timestamp are sensitive; logged via sanitization wrappers.
/// </summary>
public record ExifDto
{
    [JsonPropertyName("gpsLat")]
    public double? GpsLat { get; init; }

    [JsonPropertyName("gpsLon")]
    public double? GpsLon { get; init; }

    [JsonPropertyName("takenAt")]
    public DateTimeOffset? TakenAt { get; init; }
}

/// <summary>
/// Response to a successful RequestUploadAsync call.
/// Contains SAS URL for client-side block uploads and blob metadata.
/// </summary>
public record RequestUploadResponse
{
    [JsonPropertyName("photoId")]
    public required Guid PhotoId { get; init; }

    [JsonPropertyName("sasUrl")]
    public required string SasUrl { get; init; }

    [JsonPropertyName("blobPath")]
    public required string BlobPath { get; init; }

    [JsonPropertyName("maxBlockSizeBytes")]
    public required int MaxBlockSizeBytes { get; init; }

    [JsonPropertyName("serverVersion")]
    public required string ServerVersion { get; init; }

    [JsonPropertyName("clientMinVersion")]
    public required string ClientMinVersion { get; init; }
}

/// <summary>
/// Request to commit a photo upload after all blocks have been uploaded.
/// </summary>
public record CommitRequest
{
    [JsonPropertyName("blockIds")]
    public required List<string> BlockIds { get; init; }
}
