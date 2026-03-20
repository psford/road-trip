using RoadTripMap.Entities;

namespace RoadTripMap.Services;

public interface IAuthStrategy
{
    Task<AuthResult> ValidatePostAccess(HttpContext context, TripEntity trip);
}

public record AuthResult(bool IsAuthorized, string? DeniedReason = null);
