namespace RoadTripMap.Models;

public record CreateTripRequest
{
    public required string Name { get; init; }
    public string? Description { get; init; }
}
