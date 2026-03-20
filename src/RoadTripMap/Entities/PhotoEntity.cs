namespace RoadTripMap.Entities;

public class PhotoEntity
{
    public int Id { get; set; }
    public int TripId { get; set; }
    public required string BlobPath { get; set; }
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public string? PlaceName { get; set; }
    public string? Caption { get; set; }
    public DateTime TakenAt { get; set; }
    public DateTime CreatedAt { get; set; }

    public TripEntity Trip { get; set; } = null!;
}
