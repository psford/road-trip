namespace RoadTripMap.Models;

public record CreateTripResponse
{
    public required string Slug { get; init; }
    public required string SecretToken { get; init; }
    public required string ViewToken { get; init; }
    public required string ViewUrl { get; init; }
    public required string PostUrl { get; init; }
}
