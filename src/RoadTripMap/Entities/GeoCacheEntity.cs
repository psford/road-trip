namespace RoadTripMap.Entities;

public class GeoCacheEntity
{
    public int Id { get; set; }
    public double LatRounded { get; set; }
    public double LngRounded { get; set; }
    public required string PlaceName { get; set; }
    public DateTime CachedAt { get; set; }
}
