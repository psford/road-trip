using Azure.Storage.Blobs;
using Azure.Storage.Sas;

namespace RoadTripMap.Services;

/// <summary>
/// Produces write-only SAS URIs using user delegation keys (AD-based).
/// Suitable for production environments with Azure managed identity.
/// </summary>
public class UserDelegationSasIssuer : ISasTokenIssuer
{
    private readonly BlobServiceClient _blobServiceClient;
    private readonly ILogger<UserDelegationSasIssuer> _logger;

    public UserDelegationSasIssuer(
        BlobServiceClient blobServiceClient,
        ILogger<UserDelegationSasIssuer> logger)
    {
        _blobServiceClient = blobServiceClient;
        _logger = logger;
    }

    public async Task<Uri> IssueWriteSasAsync(string containerName, string blobPath, TimeSpan ttl, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var expiresOn = now.Add(ttl);

        // Get user delegation key for SAS generation
        var userDelegationKey = await _blobServiceClient.GetUserDelegationKeyAsync(now, expiresOn, ct);

        var blobClient = _blobServiceClient
            .GetBlobContainerClient(containerName)
            .GetBlobClient(blobPath);

        // Build SAS with write-only permissions
        var blobSasBuilder = new BlobSasBuilder
        {
            BlobContainerName = containerName,
            BlobName = blobPath,
            Resource = "b",
            StartsOn = now,
            ExpiresOn = expiresOn
        };
        blobSasBuilder.SetPermissions(BlobSasPermissions.Write);

        // Generate SAS query parameters
        var sasUri = new BlobUriBuilder(blobClient.Uri)
        {
            Sas = blobSasBuilder.ToSasQueryParameters(userDelegationKey.Value, _blobServiceClient.AccountName)
        }.ToUri();

        _logger.LogInformation(
            "UserDelegationSasIssuer: issued SAS for container={container}, blob_path_prefix={pathPrefix}, ttl={ttl}s",
            containerName,
            blobPath.Length > 20 ? blobPath.Substring(0, 20) + "..." : blobPath,
            (int)ttl.TotalSeconds);

        return sasUri;
    }
}
