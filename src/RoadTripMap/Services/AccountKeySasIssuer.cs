using Azure.Storage.Blobs;
using Azure.Storage.Sas;
using Azure.Storage;

namespace RoadTripMap.Services;

/// <summary>
/// Produces write-only SAS URIs using storage account keys.
/// Intended for Azurite (development) and local testing only.
/// Production must use UserDelegationSasIssuer.
/// </summary>
public class AccountKeySasIssuer : ISasTokenIssuer
{
    private readonly BlobServiceClient _blobServiceClient;
    private readonly ILogger<AccountKeySasIssuer> _logger;

    public AccountKeySasIssuer(
        BlobServiceClient blobServiceClient,
        ILogger<AccountKeySasIssuer> logger)
    {
        _blobServiceClient = blobServiceClient;
        _logger = logger;
    }

    public Task<Uri> IssueWriteSasAsync(string containerName, string blobPath, TimeSpan ttl, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var expiresOn = now.Add(ttl);

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

        // Get the account key from the service client via reflection
        var credential = _blobServiceClient.GetType()
            .GetProperty("Credential", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
            ?.GetValue(_blobServiceClient);

        if (credential is StorageSharedKeyCredential sharedKeyCredential)
        {
            var sasUri = new BlobUriBuilder(blobClient.Uri)
            {
                Sas = blobSasBuilder.ToSasQueryParameters(sharedKeyCredential)
            }.ToUri();

            _logger.LogInformation(
                "AccountKeySasIssuer: issued SAS for container={container}, blob_path_prefix={pathPrefix}, ttl={ttl}s",
                containerName,
                blobPath.Length > 20 ? blobPath.Substring(0, 20) + "..." : blobPath,
                (int)ttl.TotalSeconds);

            return Task.FromResult(sasUri);
        }

        throw new InvalidOperationException(
            "AccountKeySasIssuer requires StorageSharedKeyCredential; use UserDelegationSasIssuer for managed identity");
    }
}
