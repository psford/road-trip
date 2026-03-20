namespace RoadTripMap.Services;

public interface IGeocodingService
{
    Task<string?> ReverseGeocodeAsync(double latitude, double longitude);
}
