using System.Text.Json;

namespace RoadTripMap;

public static class EndpointRegistry
{
    private static JsonDocument? _doc;
    private static readonly object _lock = new();

    internal static string? OverrideFilePath { get; set; }

    internal static void Reset()
    {
        lock (_lock)
        {
            _doc?.Dispose();
            _doc = null;
        }
    }

    public static string Resolve(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Endpoint name cannot be null or empty.", nameof(name));

        var doc = GetDocument();
        var env = NormalizeEnvironment(GetEnvironment());

        if (!doc.RootElement.TryGetProperty("environments", out var environments))
            throw new InvalidOperationException("endpoints.json missing 'environments' property");

        if (!environments.TryGetProperty(env, out var envBlock))
        {
            var available = string.Join(", ", environments.EnumerateObject().Select(p => p.Name));
            throw new InvalidOperationException($"Unknown environment '{env}'. Available: {available}");
        }

        // Handle dot notation for compound endpoints (e.g., "npsApi.apiKey")
        var parts = name.Split('.', 2);
        var topName = parts[0];

        if (!envBlock.TryGetProperty(topName, out var endpoint))
        {
            var available = string.Join(", ", envBlock.EnumerateObject().Select(p => p.Name));
            throw new InvalidOperationException($"Unknown endpoint '{name}'. Available: {available}");
        }

        if (parts.Length == 2)
        {
            // Compound endpoint — resolve sub-entry
            var subName = parts[1];
            if (!endpoint.TryGetProperty(subName, out var subEntry))
            {
                var available = string.Join(", ",
                    endpoint.EnumerateObject()
                        .Where(p => p.Name != "description")
                        .Select(p => $"{topName}.{p.Name}"));
                throw new InvalidOperationException($"Unknown endpoint '{name}'. Available: {available}");
            }
            return ResolveEntry(subEntry, name);
        }

        // Simple endpoint — must have "source" property
        if (endpoint.TryGetProperty("source", out _))
        {
            return ResolveEntry(endpoint, name);
        }

        // Compound endpoint accessed without sub-key
        var subKeys = string.Join(", ",
            endpoint.EnumerateObject()
                .Where(p => p.Name != "description")
                .Select(p => $"{topName}.{p.Name}"));
        throw new InvalidOperationException(
            $"'{name}' is a compound endpoint. Use a sub-key: {subKeys}");
    }

    public static void ValidateAll()
    {
        var doc = GetDocument();
        var env = NormalizeEnvironment(GetEnvironment());
        var envBlock = doc.RootElement.GetProperty("environments").GetProperty(env);

        var errors = new List<Exception>();

        foreach (var prop in envBlock.EnumerateObject())
        {
            try
            {
                if (prop.Value.TryGetProperty("source", out _))
                {
                    ResolveEntry(prop.Value, prop.Name);
                }
                else
                {
                    // Compound endpoint — resolve each sub-entry
                    foreach (var sub in prop.Value.EnumerateObject())
                    {
                        if (sub.Name == "description") continue;
                        if (sub.Value.ValueKind == JsonValueKind.Object &&
                            sub.Value.TryGetProperty("source", out _))
                        {
                            try
                            {
                                ResolveEntry(sub.Value, $"{prop.Name}.{sub.Name}");
                            }
                            catch (Exception ex)
                            {
                                errors.Add(ex);
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                errors.Add(ex);
            }
        }

        if (errors.Count > 0)
        {
            throw new AggregateException(
                $"Endpoint validation failed with {errors.Count} error(s):\n" +
                string.Join("\n", errors.Select(e => $"  - {e.Message}")),
                errors);
        }
    }

    private static string ResolveEntry(JsonElement entry, string name)
    {
        var source = entry.GetProperty("source").GetString()!;
        return source switch
        {
            "literal" => entry.GetProperty("value").GetString()!,
            "env" => ResolveEnv(entry, name),
            "keyvault" => throw new NotImplementedException(
                $"Key Vault resolution not yet implemented (endpoint '{name}'). See Phase 3."),
            _ => throw new InvalidOperationException(
                $"Unknown source type '{source}' for endpoint '{name}'")
        };
    }

    private static string ResolveEnv(JsonElement entry, string name)
    {
        var key = entry.GetProperty("key").GetString()!;
        var value = Environment.GetEnvironmentVariable(key);
        if (string.IsNullOrEmpty(value))
            throw new InvalidOperationException(
                $"Environment variable '{key}' not set for endpoint '{name}'");
        return value;
    }

    private static JsonDocument GetDocument()
    {
        if (_doc != null) return _doc;
        lock (_lock)
        {
            if (_doc != null) return _doc;
            var path = OverrideFilePath ?? FindEndpointsFile();
            _doc = JsonDocument.Parse(File.ReadAllText(path));
            return _doc;
        }
    }

    private static string FindEndpointsFile()
    {
        // Check output directory first (published apps)
        var binPath = Path.Combine(AppContext.BaseDirectory, "endpoints.json");
        if (File.Exists(binPath)) return binPath;

        // Walk up from current directory (development with dotnet run)
        var dir = Directory.GetCurrentDirectory();
        while (dir != null)
        {
            var candidate = Path.Combine(dir, "endpoints.json");
            if (File.Exists(candidate)) return candidate;
            dir = Path.GetDirectoryName(dir);
        }

        throw new FileNotFoundException(
            "endpoints.json not found. Searched AppContext.BaseDirectory and parent directories from current directory.");
    }

    private static string GetEnvironment()
    {
        return Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT")
            ?? Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT")
            ?? "Development";
    }

    private static string NormalizeEnvironment(string env)
    {
        return env.ToLowerInvariant() switch
        {
            "development" => "dev",
            "production" => "prod",
            _ => env.ToLowerInvariant()
        };
    }
}
