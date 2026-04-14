using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Models;
using RoadTripMap.Services;
using RoadTripMap.Tests.Infrastructure;

namespace RoadTripMap.Tests.Endpoints;

[Collection(nameof(AzuriteCollection))]
public class UploadEndpointTests : IAsyncLifetime
{
    private readonly AzuriteFixture _azuriteFixture;
    private RoadTripDbContext? _context;
    private BlobServiceClient? _blobServiceClient;
    private IUploadService? _uploadService;
    private ISasTokenIssuer? _sasTokenIssuer;
    private TripEntity? _trip;
    private string? _tripToken;

    public UploadEndpointTests(AzuriteFixture azuriteFixture)
    {
        _azuriteFixture = azuriteFixture;
    }

    public async Task InitializeAsync()
    {
        // Set up in-memory database
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        _context = new RoadTripDbContext(options);

        // Set up Azurite client
        _blobServiceClient = new BlobServiceClient(new Uri("http://127.0.0.1:10000/devstoreaccount1"), null);

        // Create trip
        _tripToken = Guid.NewGuid().ToString();
        _trip = new TripEntity
        {
            Slug = "integration-test-trip",
            Name = "Integration Test Trip",
            SecretToken = _tripToken,
            ViewToken = Guid.NewGuid().ToString()
        };
        await _context.Trips.AddAsync(_trip);
        await _context.SaveChangesAsync();

        // Create container
        var containerClient = _blobServiceClient.GetBlobContainerClient($"trip-{_tripToken.ToLowerInvariant()}");
        await containerClient.CreateIfNotExistsAsync(PublicAccessType.None);

        // Set up services
        _sasTokenIssuer = new AccountKeySasIssuer(_blobServiceClient, new Microsoft.Extensions.Logging.Abstractions.NullLogger<AccountKeySasIssuer>());
        var uploadOptions = Options.Create(new UploadOptions { MaxBlockSizeBytes = 4 * 1024 * 1024 });
        _uploadService = new UploadService(_context, _blobServiceClient, _sasTokenIssuer, new Microsoft.Extensions.Logging.Abstractions.NullLogger<UploadService>(), uploadOptions);
    }

    public async Task DisposeAsync()
    {
        // Clean up blob container
        try
        {
            if (_blobServiceClient != null && _tripToken != null)
            {
                var containerClient = _blobServiceClient.GetBlobContainerClient($"trip-{_tripToken.ToLowerInvariant()}");
                await containerClient.DeleteIfExistsAsync();
            }
        }
        catch { /* Ignore cleanup errors */ }

        _context?.Dispose();
    }

    [Fact]
    public async Task FullUploadFlow_WithBlockUploads_Succeeds()
    {
        // Arrange - AC1.1: full request-upload → 4 PUT block → commit round trip
        if (_uploadService == null || _tripToken == null || _blobServiceClient == null)
            throw new InvalidOperationException("Test not initialized");

        var uploadId = Guid.NewGuid();
        var requestUpload = new RequestUploadRequest
        {
            UploadId = uploadId,
            Filename = "test.jpg",
            ContentType = "image/jpeg",
            SizeBytes = 1024 * 100,
            Exif = null
        };

        // Act - Request upload
        var uploadResponse = await _uploadService.RequestUploadAsync(_tripToken, requestUpload, CancellationToken.None);
        uploadResponse.Should().NotBeNull();

        // Upload 4 blocks (each ~100 bytes for this test)
        var sasUri = new Uri(uploadResponse.SasUrl);
        var blockBlobClient = new Azure.Storage.Blobs.Specialized.BlockBlobClient(sasUri);
        var blockIds = new List<string>();

        for (int i = 0; i < 4; i++)
        {
            var blockData = new byte[100];
            Array.Fill<byte>(blockData, (byte)('A' + i));
            var blockId = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes($"block-{i}"));
            blockIds.Add(blockId);

            await blockBlobClient.StageBlockAsync(blockId, new System.IO.MemoryStream(blockData));
        }

        // Commit
        var commitRequest = new CommitRequest { BlockIds = blockIds };
        var photoResponse = await _uploadService.CommitAsync(_tripToken, uploadId, commitRequest, CancellationToken.None);

        // Assert - AC1.1: photo exists with expected length
        photoResponse.Should().NotBeNull();
        photoResponse.Id.Should().BeGreaterThan(0);

        // Verify blob exists and has correct size
        if (_context == null || _tripToken == null)
            throw new InvalidOperationException("Test not initialized");

        var containerClient = _blobServiceClient.GetBlobContainerClient($"trip-{_tripToken.ToLowerInvariant()}");
        var blobClient = containerClient.GetBlobClient(uploadResponse.BlobPath);
        var blobProperties = await blobClient.GetPropertiesAsync();
        blobProperties.Value.ContentLength.Should().Be(400); // 4 blocks × 100 bytes

        // Verify DB row has status='committed'
        var photo = await _context.Photos.FirstOrDefaultAsync(p => p.UploadId == uploadId);
        photo.Should().NotBeNull();
        photo!.Status.Should().Be("committed");
    }

    [Fact]
    public async Task ConcurrentUploads_With20Photos_AllSucceed()
    {
        // Arrange - AC1.2: batch of 20 photos concurrent request-upload + commit
        if (_uploadService == null || _tripToken == null || _blobServiceClient == null || _context == null)
            throw new InvalidOperationException("Test not initialized");

        var uploadIds = Enumerable.Range(0, 20).Select(_ => Guid.NewGuid()).ToList();

        // Act - Request all uploads concurrently
        var requestTasks = uploadIds.Select(id =>
            _uploadService.RequestUploadAsync(_tripToken, new RequestUploadRequest
            {
                UploadId = id,
                Filename = "test.jpg",
                ContentType = "image/jpeg",
                SizeBytes = 1024,
                Exif = null
            }, CancellationToken.None));

        var uploadResponses = await Task.WhenAll(requestTasks);

        // Upload blocks and commit concurrently (5 concurrent)
        var commitTasks = uploadResponses.Select(async response =>
        {
            var sasUri = new Uri(response.SasUrl);
            var blockBlobClient = new Azure.Storage.Blobs.Specialized.BlockBlobClient(sasUri);

            // Upload one block
            var blockData = new byte[100];
            Array.Fill<byte>(blockData, (byte)'A');
            var blockId = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("block-0"));
            await blockBlobClient.StageBlockAsync(blockId, new System.IO.MemoryStream(blockData));

            // Commit
            var commitRequest = new CommitRequest { BlockIds = new List<string> { blockId } };
            return await _uploadService.CommitAsync(_tripToken, response.PhotoId, commitRequest, CancellationToken.None);
        });

        var commitResults = new List<PhotoResponse>();
        await foreach (var result in TaskExt.ConcurrentForEachAsync(commitTasks, maxConcurrency: 5))
        {
            commitResults.Add(result);
        }

        // Assert - AC1.2: all 20 succeeded, no deadlocks or duplicates
        commitResults.Should().HaveCount(20);
        if (_context == null)
            throw new InvalidOperationException("Test not initialized");
        var photoCount = await _context.Photos.CountAsync();
        photoCount.Should().Be(20);
    }

    [Fact]
    public async Task ExpiredSasToken_FailsToUploadBlock()
    {
        // Arrange - AC1.5: issue SAS with 1-second TTL, wait 2 seconds, PUT block expect 403
        if (_context == null || _blobServiceClient == null || _sasTokenIssuer == null || _tripToken == null)
            throw new InvalidOperationException("Test not initialized");

        var uploadId = Guid.NewGuid();
        var uploadRequest = new RequestUploadRequest
        {
            UploadId = uploadId,
            Filename = "test.jpg",
            ContentType = "image/jpeg",
            SizeBytes = 100,
            Exif = null
        };

        // Override upload options for this test: 1-second TTL
        var shortTtlOptions = Options.Create(new UploadOptions { SasTokenTtl = TimeSpan.FromSeconds(1) });
        var shortTtlService = new UploadService(_context, _blobServiceClient, _sasTokenIssuer, new Microsoft.Extensions.Logging.Abstractions.NullLogger<UploadService>(), shortTtlOptions);

        // Act - Request upload with short TTL
        var uploadResponse = await shortTtlService.RequestUploadAsync(_tripToken, uploadRequest, CancellationToken.None);

        // Wait for token to expire
        await Task.Delay(2000);

        // Try to upload a block with expired SAS token
        var sasUri = new Uri(uploadResponse.SasUrl);
        var blockBlobClient = new Azure.Storage.Blobs.Specialized.BlockBlobClient(sasUri);
        var blockData = new byte[100];
        var blockId = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("block-0"));

        // Assert - AC1.5: expect 403 from Azurite
        var exception = await Assert.ThrowsAsync<Azure.RequestFailedException>(
            () => blockBlobClient.StageBlockAsync(blockId, new System.IO.MemoryStream(blockData)));

        exception.Status.Should().Be(403); // Forbidden due to expired token
    }

    [Fact]
    public async Task LargeUpload_15MB_WithMultipleBlocks_Succeeds()
    {
        // Arrange - AC1.7: 15 MB synthetic buffer uploaded as 4× ~4 MB blocks
        if (_uploadService == null || _tripToken == null || _blobServiceClient == null || _context == null)
            throw new InvalidOperationException("Test not initialized");

        var uploadId = Guid.NewGuid();
        var uploadRequest = new RequestUploadRequest
        {
            UploadId = uploadId,
            Filename = "large.jpg",
            ContentType = "image/jpeg",
            SizeBytes = 15 * 1024 * 1024,
            Exif = null
        };

        var uploadResponse = await _uploadService.RequestUploadAsync(_tripToken, uploadRequest, CancellationToken.None);

        // Act - Upload 4 blocks, each ~3.75 MB
        var blockSize = 4 * 1024 * 1024; // 4 MB
        var totalSize = 15 * 1024 * 1024;
        var blockCount = (totalSize + blockSize - 1) / blockSize; // Ceiling division
        var blockIds = new List<string>();

        var sasUri = new Uri(uploadResponse.SasUrl);
        var blockBlobClient = new Azure.Storage.Blobs.Specialized.BlockBlobClient(sasUri);

        for (int i = 0; i < blockCount; i++)
        {
            var currentBlockSize = Math.Min(blockSize, totalSize - (i * blockSize));
            var blockData = new byte[currentBlockSize];
            Array.Fill<byte>(blockData, (byte)('A' + (i % 26)));

            var blockId = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes($"block-{i}"));
            blockIds.Add(blockId);

            await blockBlobClient.StageBlockAsync(blockId, new System.IO.MemoryStream(blockData));
        }

        // Commit
        var commitRequest = new CommitRequest { BlockIds = blockIds };
        var photoResponse = await _uploadService.CommitAsync(_tripToken, uploadId, commitRequest, CancellationToken.None);

        // Assert - AC1.7: blob length == 15 MB
        photoResponse.Should().NotBeNull();

        if (_blobServiceClient == null || _tripToken == null)
            throw new InvalidOperationException("Test not initialized");

        var containerClient = _blobServiceClient.GetBlobContainerClient($"trip-{_tripToken.ToLowerInvariant()}");
        var blobClient = containerClient.GetBlobClient(uploadResponse.BlobPath);
        var blobProperties = await blobClient.GetPropertiesAsync();
        blobProperties.Value.ContentLength.Should().Be(15 * 1024 * 1024);
    }
}

/// <summary>
/// Helper for concurrent iteration with limited concurrency.
/// </summary>
internal static class TaskExt
{
    public static async IAsyncEnumerable<T> ConcurrentForEachAsync<T>(
        IEnumerable<Task<T>> tasks,
        int maxConcurrency)
    {
        var remaining = new List<Task<T>>(tasks);
        var active = new List<Task<T>>();

        while (remaining.Count > 0 || active.Count > 0)
        {
            while (active.Count < maxConcurrency && remaining.Count > 0)
            {
                active.Add(remaining[0]);
                remaining.RemoveAt(0);
            }

            if (active.Count > 0)
            {
                var completed = await Task.WhenAny(active);
                active.Remove(completed);
                yield return await completed;
            }
        }
    }
}
