namespace RoadTripMap.Services;

/// <summary>
/// Thrown when a trip secret token would produce an invalid Azure container name.
/// </summary>
public class InvalidContainerNameException : ArgumentException
{
    public InvalidContainerNameException(string message) : base(message)
    {
    }

    public InvalidContainerNameException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
