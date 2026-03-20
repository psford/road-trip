using RoadTripMap.Entities;

namespace RoadTripMap.Services;

public class SecretTokenAuthStrategy : IAuthStrategy
{
    public Task<AuthResult> ValidatePostAccess(HttpContext context, TripEntity trip)
    {
        var secretToken = context.GetRouteValue("secretToken") as string;

        if (string.IsNullOrEmpty(secretToken) || secretToken != trip.SecretToken)
        {
            return Task.FromResult(new AuthResult(false, "Invalid or missing secret token"));
        }

        return Task.FromResult(new AuthResult(true));
    }
}
