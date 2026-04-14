using System.Security.Cryptography;
using System.Text;

namespace RoadTripMap.Security;

/// <summary>
/// Sanitizes sensitive tokens and secrets for safe logging.
/// All user inputs and secrets must be sanitized before logging.
/// </summary>
public static class LogSanitizer
{
    /// <summary>
    /// Sanitizes a secret token (trip secret token, upload ID, etc.) for safe logging.
    /// Returns first 4 characters followed by ellipsis and length indicator.
    /// Example: "abcd...{32}" for a 32-character token.
    /// </summary>
    public static string SanitizeToken(string? token)
    {
        if (string.IsNullOrEmpty(token))
            return "[empty]";

        if (token.Length <= 4)
            return new string('*', token.Length);

        return $"{token.Substring(0, 4)}...{{{token.Length}}}";
    }

    /// <summary>
    /// Sanitizes a container name (which embeds the secret token).
    /// Extracts and sanitizes the embedded token.
    /// Example: "trip-abcd...{32}" for container "trip-{fulltoken}".
    /// </summary>
    public static string SanitizeContainerName(string? containerName)
    {
        if (string.IsNullOrEmpty(containerName))
            return "[empty]";

        // Container names follow pattern "trip-{secretToken}" or "road-trip-photos"
        if (containerName.StartsWith("trip-"))
        {
            var token = containerName.Substring("trip-".Length);
            return $"trip-{SanitizeToken(token)}";
        }

        return containerName; // Legacy containers are not sensitive
    }

    /// <summary>
    /// Sanitizes a blob path that may contain sensitive data.
    /// For per-trip blobs: "{uploadId}_original.jpg" → "guid...{36}".
    /// For legacy blobs: "{tripId}/{photoId}.jpg" → preserved (IDs are not sensitive).
    /// </summary>
    public static string SanitizeBlobPath(string? blobPath)
    {
        if (string.IsNullOrEmpty(blobPath))
            return "[empty]";

        // Per-trip blob paths start with a GUID (UploadId)
        if (Guid.TryParse(blobPath.Split('_')[0], out _))
        {
            var uploadId = blobPath.Split('_')[0];
            return $"{SanitizeToken(uploadId)}_{blobPath.Substring(uploadId.Length + 1)}";
        }

        return blobPath; // Legacy paths are not sensitive
    }

    /// <summary>
    /// Sanitizes a SAS URL query string to mask secrets.
    /// Removes all query parameters (sig, se, sv, etc.) from logs.
    /// </summary>
    public static string SanitizeUrl(string? url)
    {
        if (string.IsNullOrEmpty(url))
            return "[empty]";

        // Remove query string entirely; SAS contains secrets
        var uri = new Uri(url, UriKind.RelativeOrAbsolute);
        if (uri.IsAbsoluteUri)
            return $"{uri.Scheme}://{uri.Host}{uri.LocalPath}?[sig-redacted]";

        var queryIndex = url.IndexOf('?');
        if (queryIndex >= 0)
            return $"{url.Substring(0, queryIndex)}?[sig-redacted]";

        return url;
    }
}
