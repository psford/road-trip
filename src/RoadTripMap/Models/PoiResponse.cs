namespace RoadTripMap.Models;

public record PoiResponse
{
    public required int Id { get; init; }
    public required string Name { get; init; }
    public required string Category { get; init; }
    public required double Lat { get; init; }
    public required double Lng { get; init; }
}
