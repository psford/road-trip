namespace RoadTripMap.Entities;

public class ParkBoundaryEntity
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public required string State { get; set; }
    public required string Category { get; set; }
    public int GisAcres { get; set; }
    public double CentroidLat { get; set; }
    public double CentroidLng { get; set; }
    public double MinLat { get; set; }
    public double MaxLat { get; set; }
    public double MinLng { get; set; }
    public double MaxLng { get; set; }
    public required string GeoJsonFull { get; set; }
    public required string GeoJsonModerate { get; set; }
    public required string GeoJsonSimplified { get; set; }
    public required string Source { get; set; }
    public string? SourceId { get; set; }
}
