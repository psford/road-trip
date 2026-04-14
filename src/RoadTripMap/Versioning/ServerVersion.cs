using System.Reflection;
using Microsoft.Extensions.Configuration;

namespace RoadTripMap.Versioning;

/// <summary>
/// Server version holder reading assembly InformationalVersion and config ClientProtocol:MinVersion.
/// Provides static properties for version headers and endpoint responses.
/// </summary>
public static class ServerVersion
{
    /// <summary>
    /// Gets the server's semantic version from the assembly's InformationalVersion attribute.
    /// Defaults to "0.0.0" if the attribute is not set.
    /// </summary>
    public static string Current { get; private set; } = "0.0.0";

    /// <summary>
    /// Gets the minimum client protocol version required to communicate with this server.
    /// Defaults to "1.0.0" if not configured.
    /// </summary>
    public static string ClientMin { get; private set; } = "1.0.0";

    /// <summary>
    /// Initializes ServerVersion from configuration and assembly metadata.
    /// Must be called during application startup before any requests are handled.
    /// </summary>
    public static void Initialize(IConfiguration config)
    {
        // Read assembly InformationalVersion
        var attr = typeof(ServerVersion).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>();
        Current = attr?.InformationalVersion ?? "0.0.0";

        // Read config with nullable-safe default
        var configMinVersion = config.GetValue<string?>("ClientProtocol:MinVersion");
        ClientMin = configMinVersion ?? "1.0.0";
    }
}
