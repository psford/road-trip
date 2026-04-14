using Azure.Storage.Blobs;
using Azure.Storage.Sas;
using Azure.Storage;
using RoadTripMap.Security;

namespace RoadTripMap.Services;

/// <summary>
/// Produces write-only SAS URIs using storage account keys.
/// Intended for Azurite (development) and local testing only.
/// Production must use UserDelegationSasIssuer.
/// </summary>
public class AccountKeySasIssuer : ISasTokenIssuer
{
    private readonly BlobServiceClient _blobServiceClient;
    private readonly StorageSharedKeyCredential _credential;
    private readonly ILogger<AccountKeySasIssuer> _logger;

    public AccountKeySasIssuer(
        BlobServiceClient blobServiceClient,
        StorageSharedKeyCredential credential,
        ILogger<AccountKeySasIssuer> logger)
    {
        _blobServiceClient = blobServiceClient;
        _credential = credential ?? throw new ArgumentNullException(nameof(credential));
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

        var sasUri = new BlobUriBuilder(blobClient.Uri)
        {
            Sas = blobSasBuilder.ToSasQueryParameters(_credential)
        }.ToUri();

        _logger.LogInformation(
            "AccountKeySasIssuer: issued SAS for container={container}, blob_path_prefix={pathPrefix}, ttl={ttl}s",
            LogSanitizer.SanitizeContainerName(containerName),
            LogSanitizer.SanitizeBlobPath(blobPath),
            (int)ttl.TotalSeconds);

        return Task.FromResult(sasUri);
    }
}
