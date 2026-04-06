using System.Text.Json.Serialization;
using System.Text.Json.Nodes;

namespace RoadTripMap.Models;

/// <summary>
/// Represents a single park boundary feature in GeoJSON format.
/// </summary>
public record ParkBoundaryFeature
{
    [JsonPropertyName("type")]
    public required string Type { get; init; } = "Feature";

    [JsonPropertyName("properties")]
    public required ParkBoundaryProperties Properties { get; init; }

    [JsonPropertyName("geometry")]
    public required JsonNode Geometry { get; init; }
}

/// <summary>
/// Properties for a park boundary feature.
/// </summary>
public record ParkBoundaryProperties
{
    [JsonPropertyName("id")]
    public required int Id { get; init; }

    [JsonPropertyName("name")]
    public required string Name { get; init; }

    [JsonPropertyName("state")]
    public required string State { get; init; }

    [JsonPropertyName("category")]
    public required string Category { get; init; }

    [JsonPropertyName("centroidLat")]
    public required double CentroidLat { get; init; }

    [JsonPropertyName("centroidLng")]
    public required double CentroidLng { get; init; }

    [JsonPropertyName("gisAcres")]
    public required int GisAcres { get; init; }
}

/// <summary>
/// GeoJSON FeatureCollection response for park boundaries.
/// </summary>
public record ParkBoundaryResponse
{
    [JsonPropertyName("type")]
    public required string Type { get; init; } = "FeatureCollection";

    [JsonPropertyName("features")]
    public required ParkBoundaryFeature[] Features { get; init; }
}
