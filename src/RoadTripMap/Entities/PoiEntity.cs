namespace RoadTripMap.Entities;

public class PoiEntity
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public required string Category { get; set; }
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public required string Source { get; set; }
    public string? SourceId { get; set; }
}
