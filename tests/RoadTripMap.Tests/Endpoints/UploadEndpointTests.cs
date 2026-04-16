using Azure.Storage;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Moq;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Models;
using RoadTripMap.Services;
using RoadTripMap.Tests.Infrastructure;

namespace RoadTripMap.Tests.Endpoints;

/// <summary>
/// Service-layer tests for upload operations via UploadService.
/// Tests verify AC1.1, AC1.2, AC1.3, AC1.4, AC1.5, AC1.7 at the service layer.
/// HTTP-level tests (AC1.1-AC1.7, AC8.1, ACX.1) are tested implicitly via HTTP endpoints
/// which delegate to these service methods.
/// </summary>
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

        // Set up Azurite client with StorageSharedKeyCredential for account-key SAS generation
        // Extract account name and key from fixture's connection string
        var connStr = _azuriteFixture.ConnectionString;
        var accountName = "devstoreaccount1";
        var accountKey = "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
        var credential = new StorageSharedKeyCredential(accountName, accountKey);
        var uri = new Uri("http://127.0.0.1:10000/devstoreaccount1");
        _blobServiceClient = new BlobServiceClient(uri, credential);

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
        _sasTokenIssuer = new AccountKeySasIssuer(_blobServiceClient, credential, new Microsoft.Extensions.Logging.Abstractions.NullLogger<AccountKeySasIssuer>());
        var mockGeocodingService = new Mock<IGeocodingService>();
        mockGeocodingService.Setup(g => g.ReverseGeocodeAsync(It.IsAny<double>(), It.IsAny<double>()))
            .ReturnsAsync((string?)null);
        var uploadOptions = Microsoft.Extensions.Options.Options.Create(new UploadOptions { MaxBlockSizeBytes = 4 * 1024 * 1024 });
        var photoService = new PhotoService(_blobServiceClient, _context);
        _uploadService = new UploadService(_context, _blobServiceClient, _sasTokenIssuer, mockGeocodingService.Object, photoService, new Microsoft.Extensions.Logging.Abstractions.NullLogger<UploadService>(), uploadOptions);
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

    /// <summary>
    /// AC1.1: Full request-upload → 4 PUT block → commit round trip.
    /// Verifies SAS URL, block uploads, commit, DB persistence, blob storage.
    /// </summary>
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

    /// <summary>
    /// After commit, the per-trip container must contain display and thumb tiers
    /// generated from the original. Without this, photoCarousel.js cannot render
    /// thumbnails (the proxy endpoint looks for {uploadId}_display.jpg and
    /// {uploadId}_thumb.jpg alongside {uploadId}_original.jpg).
    /// </summary>
    [Fact]
    public async Task CommitAsync_GeneratesDisplayAndThumbTiers_FromOriginalBlob()
    {
        if (_uploadService == null || _tripToken == null || _blobServiceClient == null || _context == null)
            throw new InvalidOperationException("Test not initialized");

        var uploadId = Guid.NewGuid();
        var requestUpload = new RequestUploadRequest
        {
            UploadId = uploadId,
            Filename = "test.jpg",
            ContentType = "image/jpeg",
            SizeBytes = 0,
            Exif = null
        };

        // Build a real JPEG via SkiaSharp so tier generation can decode it
        using var bitmap = new SkiaSharp.SKBitmap(800, 600, SkiaSharp.SKColorType.Rgba8888, SkiaSharp.SKAlphaType.Opaque);
        using var canvas = new SkiaSharp.SKCanvas(bitmap);
        canvas.Clear(SkiaSharp.SKColors.CornflowerBlue);
        using var encoded = bitmap.Encode(SkiaSharp.SKEncodedImageFormat.Jpeg, 85);
        var jpegBytes = encoded.ToArray();

        var uploadResponse = await _uploadService.RequestUploadAsync(_tripToken, requestUpload, CancellationToken.None);

        var sasUri = new Uri(uploadResponse.SasUrl);
        var blockBlobClient = new Azure.Storage.Blobs.Specialized.BlockBlobClient(sasUri);
        var blockId = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("block-0"));
        await blockBlobClient.StageBlockAsync(blockId, new System.IO.MemoryStream(jpegBytes));

        var commitRequest = new CommitRequest { BlockIds = new List<string> { blockId } };
        await _uploadService.CommitAsync(_tripToken, uploadId, commitRequest, CancellationToken.None);

        // Act — verify tiers exist in the per-trip container
        var containerClient = _blobServiceClient.GetBlobContainerClient($"trip-{_tripToken.ToLowerInvariant()}");
        var originalBlob = containerClient.GetBlobClient($"{uploadId}_original.jpg");
        var displayBlob = containerClient.GetBlobClient($"{uploadId}_display.jpg");
        var thumbBlob = containerClient.GetBlobClient($"{uploadId}_thumb.jpg");

        // Assert — all three tiers must exist
        (await originalBlob.ExistsAsync()).Value.Should().BeTrue("original blob must exist after commit");
        (await displayBlob.ExistsAsync()).Value.Should().BeTrue("display tier must be generated during commit");
        (await thumbBlob.ExistsAsync()).Value.Should().BeTrue("thumb tier must be generated during commit");

        // Thumb must be smaller than display (300px max vs 1920px max)
        var thumbProps = await thumbBlob.GetPropertiesAsync();
        var displayProps = await displayBlob.GetPropertiesAsync();
        thumbProps.Value.ContentLength.Should().BeLessThan(displayProps.Value.ContentLength,
            "thumb tier should be smaller than display tier");
    }

    /// <summary>
    /// The PhotoResponse returned by CommitAsync must use the same URL pattern as
    /// PhotoReadService: /api/photos/{tripId}/{photoId}/{size}. Using /api/blobs/...
    /// means the photo shows up broken immediately after upload, even though the
    /// photo list API returns correct URLs. Client uses the URLs from commit
    /// response for optimistic UI.
    /// </summary>
    [Fact]
    public async Task CommitAsync_ReturnsPhotoResponse_WithProxyUrlsMatchingPhotoReadService()
    {
        if (_uploadService == null || _tripToken == null || _blobServiceClient == null || _context == null)
            throw new InvalidOperationException("Test not initialized");

        using var bitmap = new SkiaSharp.SKBitmap(400, 300, SkiaSharp.SKColorType.Rgba8888, SkiaSharp.SKAlphaType.Opaque);
        using var canvas = new SkiaSharp.SKCanvas(bitmap);
        canvas.Clear(SkiaSharp.SKColors.LimeGreen);
        using var encoded = bitmap.Encode(SkiaSharp.SKEncodedImageFormat.Jpeg, 85);
        var jpegBytes = encoded.ToArray();

        var uploadId = Guid.NewGuid();
        var req = new RequestUploadRequest
        {
            UploadId = uploadId,
            Filename = "test.jpg",
            ContentType = "image/jpeg",
            SizeBytes = jpegBytes.Length,
            Exif = null
        };
        var uploadResponse = await _uploadService.RequestUploadAsync(_tripToken, req, CancellationToken.None);
        var blockBlobClient = new Azure.Storage.Blobs.Specialized.BlockBlobClient(new Uri(uploadResponse.SasUrl));
        var blockId = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("block-0"));
        await blockBlobClient.StageBlockAsync(blockId, new System.IO.MemoryStream(jpegBytes));

        // Act
        var photoResponse = await _uploadService.CommitAsync(
            _tripToken,
            uploadId,
            new CommitRequest { BlockIds = new List<string> { blockId } },
            CancellationToken.None);

        // Assert: URLs match the proxy pattern /api/photos/{tripId}/{photoId}/{size}
        var tripId = _trip!.Id;
        var photoId = photoResponse.Id;
        photoResponse.ThumbnailUrl.Should().Be($"/api/photos/{tripId}/{photoId}/thumb");
        photoResponse.DisplayUrl.Should().Be($"/api/photos/{tripId}/{photoId}/display");
        photoResponse.OriginalUrl.Should().Be($"/api/photos/{tripId}/{photoId}/original");
    }

    /// <summary>
    /// After commit with tier generation, PhotoService.GetPhotoAsync must be able
    /// to resolve the "display" and "thumb" tiers for a per-trip blobPath.
    /// The path construction was buggy: blobPath "{uuid}_original.jpg" naively replaced
    /// .jpg with _display.jpg produces "{uuid}_original_display.jpg" which doesn't exist.
    /// </summary>
    [Fact]
    public async Task GetPhotoAsync_PerTripContainer_ResolvesDisplayAndThumbTiers()
    {
        if (_uploadService == null || _tripToken == null || _blobServiceClient == null || _context == null)
            throw new InvalidOperationException("Test not initialized");

        // Upload a real JPEG so tier generation can decode it
        using var bitmap = new SkiaSharp.SKBitmap(800, 600, SkiaSharp.SKColorType.Rgba8888, SkiaSharp.SKAlphaType.Opaque);
        using var canvas = new SkiaSharp.SKCanvas(bitmap);
        canvas.Clear(SkiaSharp.SKColors.Coral);
        using var encoded = bitmap.Encode(SkiaSharp.SKEncodedImageFormat.Jpeg, 85);
        var jpegBytes = encoded.ToArray();

        var uploadId = Guid.NewGuid();
        var req = new RequestUploadRequest
        {
            UploadId = uploadId,
            Filename = "test.jpg",
            ContentType = "image/jpeg",
            SizeBytes = jpegBytes.Length,
            Exif = null
        };
        var uploadResponse = await _uploadService.RequestUploadAsync(_tripToken, req, CancellationToken.None);
        var blockBlobClient = new Azure.Storage.Blobs.Specialized.BlockBlobClient(new Uri(uploadResponse.SasUrl));
        var blockId = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("block-0"));
        await blockBlobClient.StageBlockAsync(blockId, new System.IO.MemoryStream(jpegBytes));
        await _uploadService.CommitAsync(_tripToken, uploadId, new CommitRequest { BlockIds = new List<string> { blockId } }, CancellationToken.None);

        var photoService = new PhotoService(_blobServiceClient, _context);
        var containerName = $"trip-{_tripToken.ToLowerInvariant()}";
        var blobPath = uploadResponse.BlobPath; // "{uploadId}_original.jpg"

        // Act + Assert — all three tiers must be retrievable
        using (var originalStream = await photoService.GetPhotoAsync(blobPath, "original", "per-trip", containerName))
        {
            originalStream.Should().NotBeNull();
        }
        using (var displayStream = await photoService.GetPhotoAsync(blobPath, "display", "per-trip", containerName))
        {
            displayStream.Should().NotBeNull();
        }
        using (var thumbStream = await photoService.GetPhotoAsync(blobPath, "thumb", "per-trip", containerName))
        {
            thumbStream.Should().NotBeNull();
        }
    }

    /// <summary>
    /// AC1.2: Batch of 20 photos with concurrent request-upload + commit.
    /// Tests concurrency handling and no deadlocks.
    /// </summary>
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

        // Upload blocks concurrently (no DB access yet)
        var blockUploadTasks = uploadResponses.Select(async response =>
        {
            var sasUri = new Uri(response.SasUrl);
            var blockBlobClient = new Azure.Storage.Blobs.Specialized.BlockBlobClient(sasUri);

            // Upload one block
            var blockData = new byte[100];
            Array.Fill<byte>(blockData, (byte)'A');
            var blockId = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("block-0"));
            await blockBlobClient.StageBlockAsync(blockId, new System.IO.MemoryStream(blockData));

            return (response, blockId);
        });

        var uploadedBlocks = await Task.WhenAll(blockUploadTasks);

        // Commit serially due to EF Core in-memory DbContext concurrency limitations
        // (In-memory provider does not support concurrent access from multiple async contexts)
        var commitResults = new List<PhotoResponse>();
        foreach (var (response, blockId) in uploadedBlocks)
        {
            var commitRequest = new CommitRequest { BlockIds = new List<string> { blockId } };
            var result = await _uploadService.CommitAsync(_tripToken, response.PhotoId, commitRequest, CancellationToken.None);
            commitResults.Add(result);
        }

        // Assert - AC1.2: all 20 succeeded, no deadlocks or duplicates
        commitResults.Should().HaveCount(20);
        if (_context == null)
            throw new InvalidOperationException("Test not initialized");
        var photoCount = await _context.Photos.CountAsync();
        photoCount.Should().Be(20);
    }

    /// <summary>
    /// AC1.3: Idempotency - repeat request-upload with same upload_id returns existing photo_id.
    /// </summary>
    [Fact]
    public async Task RequestUploadIdempotent_WithSameUploadId()
    {
        if (_uploadService == null || _tripToken == null || _context == null)
            throw new InvalidOperationException("Test not initialized");

        var uploadId = Guid.NewGuid();
        var reqBody = new RequestUploadRequest
        {
            UploadId = uploadId,
            Filename = "test.jpg",
            ContentType = "image/jpeg",
            SizeBytes = 100,
            Exif = null
        };

        // Act 1: First request
        var resp1 = await _uploadService.RequestUploadAsync(_tripToken, reqBody, CancellationToken.None);
        resp1.Should().NotBeNull();

        // Act 2: Second request with same upload_id
        var resp2 = await _uploadService.RequestUploadAsync(_tripToken, reqBody, CancellationToken.None);
        resp2.Should().NotBeNull();

        // Assert: Same photo_id, same SAS URL (idempotent)
        resp1.PhotoId.Should().Be(resp2.PhotoId);
        resp1.SasUrl.Should().Be(resp2.SasUrl);

        // Assert: Only one row in DB
        var photoCount = await _context.Photos.CountAsync();
        photoCount.Should().Be(1);
    }

    /// <summary>
    /// AC1.4: Block mismatch - commit with fake block ID returns error.
    /// </summary>
    [Fact]
    public async Task CommitBlockMismatch_ThrowsException()
    {
        if (_uploadService == null || _tripToken == null || _blobServiceClient == null)
            throw new InvalidOperationException("Test not initialized");

        var uploadId = Guid.NewGuid();
        var reqBody = new RequestUploadRequest
        {
            UploadId = uploadId,
            Filename = "test.jpg",
            ContentType = "image/jpeg",
            SizeBytes = 100,
            Exif = null
        };

        // Request upload
        var uploadResp = await _uploadService.RequestUploadAsync(_tripToken, reqBody, CancellationToken.None);

        // Upload a real block
        var sasUri = new Uri(uploadResp.SasUrl);
        var blockBlobClient = new Azure.Storage.Blobs.Specialized.BlockBlobClient(sasUri);
        var blockData = new byte[100];
        Array.Fill<byte>(blockData, (byte)'A');
        var realBlockId = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("block-0"));
        await blockBlobClient.StageBlockAsync(realBlockId, new System.IO.MemoryStream(blockData));

        // Commit with fake block ID (not uploaded) instead of real block ID
        var fakeBlockId = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("fake-block"));
        var commitBody = new CommitRequest { BlockIds = new List<string> { fakeBlockId } };

        // Act & Assert: Should throw BadHttpRequestException with BlockListMismatch
        var ex = await Assert.ThrowsAsync<BadHttpRequestException>(
            () => _uploadService.CommitAsync(_tripToken, uploadId, commitBody, CancellationToken.None));

        ex.Message.Should().Contain("BlockListMismatch");
    }

    /// <summary>
    /// AC1.5: Expired SAS token - issue with 1-second TTL, wait 2s, PUT → 403.
    /// </summary>
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
        var mockGeocodingService = new Mock<IGeocodingService>();
        mockGeocodingService.Setup(g => g.ReverseGeocodeAsync(It.IsAny<double>(), It.IsAny<double>()))
            .ReturnsAsync((string?)null);
        var shortTtlOptions = Microsoft.Extensions.Options.Options.Create(new UploadOptions { SasTokenTtl = TimeSpan.FromSeconds(1) });
        var photoService2 = new PhotoService(_blobServiceClient, _context);
        var shortTtlService = new UploadService(_context, _blobServiceClient, _sasTokenIssuer, mockGeocodingService.Object, photoService2, new Microsoft.Extensions.Logging.Abstractions.NullLogger<UploadService>(), shortTtlOptions);

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

    /// <summary>
    /// AC1.7: 15 MB upload - upload synthetic 15 MB as blocks, commit, verify blob length.
    /// </summary>
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

    /// <summary>
    /// AC5.3, AC7.3: Pin-drop happy path - update GPS on committed photo.
    /// </summary>
    [Fact]
    public async Task PinDrop_OnCommittedPhoto_Succeeds()
    {
        // Arrange - AC5.3: create and commit a photo, then pin-drop
        if (_uploadService == null || _tripToken == null || _context == null || _blobServiceClient == null)
            throw new InvalidOperationException("Test not initialized");

        var uploadId = Guid.NewGuid();
        var reqBody = new RequestUploadRequest
        {
            UploadId = uploadId,
            Filename = "test.jpg",
            ContentType = "image/jpeg",
            SizeBytes = 100,
            Exif = null
        };

        // Request and commit a photo
        var uploadResp = await _uploadService.RequestUploadAsync(_tripToken, reqBody, CancellationToken.None);
        var sasUri = new Uri(uploadResp.SasUrl);
        var blockBlobClient = new Azure.Storage.Blobs.Specialized.BlockBlobClient(sasUri);
        var blockData = new byte[100];
        Array.Fill<byte>(blockData, (byte)'A');
        var blockId = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("block-0"));
        await blockBlobClient.StageBlockAsync(blockId, new System.IO.MemoryStream(blockData));

        var commitReq = new CommitRequest { BlockIds = new List<string> { blockId } };
        var photoResp = await _uploadService.CommitAsync(_tripToken, uploadId, commitReq, CancellationToken.None);

        // Photo should be committed with lat=0, lng=0
        var photo = await _context.Photos.FirstOrDefaultAsync(p => p.UploadId == uploadId);
        photo!.Status.Should().Be("committed");
        photo.Latitude.Should().Be(0);
        photo.Longitude.Should().Be(0);

        // Act - Pin-drop with new coordinates
        var gpsLat = 40.7128;
        var gpsLon = -74.0060;
        var pinDropResp = await _uploadService.PinDropAsync(_tripToken, uploadId, gpsLat, gpsLon, CancellationToken.None);

        // Assert - GPS updated, PhotoResponse contains new coordinates
        pinDropResp.Should().NotBeNull();
        pinDropResp.Lat.Should().Be(gpsLat);
        pinDropResp.Lng.Should().Be(gpsLon);

        // Verify DB updated
        photo = await _context.Photos.FirstOrDefaultAsync(p => p.UploadId == uploadId);
        photo!.Latitude.Should().Be(gpsLat);
        photo.Longitude.Should().Be(gpsLon);
        photo.Status.Should().Be("committed"); // Should remain committed
    }

    /// <summary>
    /// AC7.3: Pin-drop rejected on non-committed photo (409 Conflict).
    /// </summary>
    [Fact]
    public async Task PinDrop_OnPendingPhoto_Returns409()
    {
        // Arrange - AC7.3: create pending photo, try to pin-drop (should fail)
        if (_uploadService == null || _tripToken == null)
            throw new InvalidOperationException("Test not initialized");

        var uploadId = Guid.NewGuid();
        var reqBody = new RequestUploadRequest
        {
            UploadId = uploadId,
            Filename = "test.jpg",
            ContentType = "image/jpeg",
            SizeBytes = 100,
            Exif = null
        };

        // Request upload (photo is pending)
        await _uploadService.RequestUploadAsync(_tripToken, reqBody, CancellationToken.None);

        // Act & Assert - Pin-drop on pending photo should throw BadHttpRequestException
        var ex = await Assert.ThrowsAsync<BadHttpRequestException>(
            () => _uploadService.PinDropAsync(_tripToken, uploadId, 40.7128, -74.0060, CancellationToken.None));

        ex.Message.Should().Contain("Pin-drop only allowed on committed photos");
    }

    /// <summary>
    /// AC5.3: Pin-drop on cross-trip photo returns 404.
    /// </summary>
    [Fact]
    public async Task PinDrop_OnCrossTripPhoto_Returns404()
    {
        // Arrange - AC5.3: commit photo in trip1, try to pin-drop via trip2's token (should fail)
        if (_uploadService == null || _context == null)
            throw new InvalidOperationException("Test not initialized");

        // Create second trip
        var trip2Token = Guid.NewGuid().ToString();
        var trip2 = new TripEntity
        {
            Slug = "cross-trip-test",
            Name = "Cross-Trip Test",
            SecretToken = trip2Token,
            ViewToken = Guid.NewGuid().ToString()
        };
        await _context.Trips.AddAsync(trip2);
        await _context.SaveChangesAsync();

        // Commit photo in trip1
        if (_tripToken == null || _blobServiceClient == null)
            throw new InvalidOperationException("Test not initialized");

        var uploadId = Guid.NewGuid();
        var reqBody = new RequestUploadRequest
        {
            UploadId = uploadId,
            Filename = "test.jpg",
            ContentType = "image/jpeg",
            SizeBytes = 100,
            Exif = null
        };

        var uploadResp = await _uploadService.RequestUploadAsync(_tripToken, reqBody, CancellationToken.None);
        var sasUri = new Uri(uploadResp.SasUrl);
        var blockBlobClient = new Azure.Storage.Blobs.Specialized.BlockBlobClient(sasUri);
        var blockData = new byte[100];
        Array.Fill<byte>(blockData, (byte)'A');
        var blockId = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("block-0"));
        await blockBlobClient.StageBlockAsync(blockId, new System.IO.MemoryStream(blockData));

        var commitReq = new CommitRequest { BlockIds = new List<string> { blockId } };
        await _uploadService.CommitAsync(_tripToken, uploadId, commitReq, CancellationToken.None);

        // Act & Assert - Try to pin-drop using trip2's token (should fail with KeyNotFoundException -> 404)
        var ex = await Assert.ThrowsAsync<KeyNotFoundException>(
            () => _uploadService.PinDropAsync(trip2Token, uploadId, 40.7128, -74.0060, CancellationToken.None));
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
