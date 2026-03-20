namespace RoadTripMap.Models;

public record TripResponse
{
    public required string Name { get; init; }
    public string? Description { get; init; }
    public required int PhotoCount { get; init; }
    public required DateTime CreatedAt { get; init; }
}
