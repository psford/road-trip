namespace RoadTripMap.Models;

public record PhotoResponse
{
    public required int Id { get; init; }
    public required string ThumbnailUrl { get; init; }
    public required string DisplayUrl { get; init; }
    public required string OriginalUrl { get; init; }
    public required double Lat { get; init; }
    public required double Lng { get; init; }
    public required string PlaceName { get; init; }
    public string? Caption { get; init; }
    public DateTime? TakenAt { get; init; }
}
