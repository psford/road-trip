using System.Text.RegularExpressions;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace RoadTripMap.Services;

public class BlobContainerProvisioner : IBlobContainerProvisioner
{
    private readonly BlobServiceClient _blobServiceClient;
    private readonly ILogger<BlobContainerProvisioner> _logger;

    public BlobContainerProvisioner(BlobServiceClient blobServiceClient, ILogger<BlobContainerProvisioner> logger)
    {
        _blobServiceClient = blobServiceClient;
        _logger = logger;
    }

    public async Task<string> EnsureContainerAsync(string secretToken, CancellationToken ct)
    {
        var containerName = FormatContainerName(secretToken);
        ValidateContainerName(containerName);

        var containerClient = _blobServiceClient.GetBlobContainerClient(containerName);
        await containerClient.CreateIfNotExistsAsync(PublicAccessType.None, cancellationToken: ct);

        return containerName;
    }

    public async Task DeleteContainerAsync(string secretToken, CancellationToken ct)
    {
        var containerName = FormatContainerName(secretToken);
        ValidateContainerName(containerName);

        var containerClient = _blobServiceClient.GetBlobContainerClient(containerName);
        await containerClient.DeleteIfExistsAsync(cancellationToken: ct);
    }

    private static string FormatContainerName(string secretToken)
    {
        return "trip-" + secretToken.ToLowerInvariant();
    }

    private static void ValidateContainerName(string containerName)
    {
        // Check length: 4-63 characters
        // "trip-" is 5 chars, so token part must be 0+ chars to keep total <= 63
        if (containerName.Length < 4 || containerName.Length > 63)
        {
            throw new InvalidContainerNameException(
                $"Container name length must be between 4 and 63 characters, but got {containerName.Length}");
        }

        // Check regex: ^trip-[a-z0-9-]+$
        // This allows the token portion to be empty or contain lowercase, digits, hyphens
        // But we need at least "trip-" so minimum is 5 chars for a non-empty token
        if (!Regex.IsMatch(containerName, @"^trip-[a-z0-9-]*$"))
        {
            throw new InvalidContainerNameException(
                $"Container name must match pattern 'trip-[a-z0-9-]*': {containerName}");
        }

        // No consecutive dashes
        if (containerName.Contains("--"))
        {
            throw new InvalidContainerNameException(
                $"Container name cannot contain consecutive dashes: {containerName}");
        }

        // No trailing dash
        if (containerName.EndsWith("-"))
        {
            throw new InvalidContainerNameException(
                $"Container name cannot end with a dash: {containerName}");
        }
    }
}
