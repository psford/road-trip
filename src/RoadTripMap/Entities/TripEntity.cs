namespace RoadTripMap.Entities;

public class TripEntity
{
    public int Id { get; set; }
    public required string Slug { get; set; }
    public required string Name { get; set; }
    public string? Description { get; set; }
    public required string SecretToken { get; set; }
    public DateTime CreatedAt { get; set; }
    public bool IsActive { get; set; } = true;

    public ICollection<PhotoEntity> Photos { get; set; } = new List<PhotoEntity>();
}
