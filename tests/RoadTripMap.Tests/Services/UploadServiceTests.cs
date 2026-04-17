using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Blobs.Specialized;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Models;
using RoadTripMap.Services;

namespace RoadTripMap.Tests.Services;

public class UploadServiceTests
{
    private RoadTripDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new RoadTripDbContext(options);
    }

    [Fact]
    public async Task RequestUploadAsync_WithNewUpload_CreatesPhotoRow()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var tripToken = Guid.NewGuid().ToString();
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = tripToken,
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        var mockBlobServiceClient = new Mock<BlobServiceClient>();
        var mockSasIssuer = new Mock<ISasTokenIssuer>();
        var mockGeocodingService = new Mock<IGeocodingService>();
        var mockLogger = new Mock<ILogger<UploadService>>();
        var options = Options.Create(new UploadOptions { MaxBlockSizeBytes = 4 * 1024 * 1024 });

        var sasUri = new Uri("https://example.blob.core.windows.net/container/blob?sv=2021-01-01&sig=xyz");
        mockSasIssuer
            .Setup(s => s.IssueWriteSasAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<TimeSpan>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(sasUri);

        var service = new UploadService(context, mockBlobServiceClient.Object, mockSasIssuer.Object, mockGeocodingService.Object, Mock.Of<IPhotoService>(), mockLogger.Object, options);

        var request = new RequestUploadRequest
        {
            UploadId = Guid.NewGuid(),
            Filename = "test.jpg",
            ContentType = "image/jpeg",
            SizeBytes = 1024 * 1024,
            Exif = null
        };

        // Act
        var response = await service.RequestUploadAsync(tripToken, request, CancellationToken.None);

        // Assert
        response.Should().NotBeNull();
        response.PhotoId.Should().NotBe(Guid.Empty);
        response.SasUrl.Should().Contain("sv=");
        response.BlobPath.Should().EndWith("_original.jpg");

        var photo = await context.Photos.FirstOrDefaultAsync(p => p.UploadId == request.UploadId);
        photo.Should().NotBeNull();
        photo!.Status.Should().Be("pending");
        photo.StorageTier.Should().Be("per-trip");
    }

    [Fact]
    public async Task RequestUploadAsync_WithExistingUploadId_ReturnsSamePhotoIdIdempotently()
    {
        // Arrange - AC1.3: idempotency
        using var context = CreateInMemoryContext();
        var tripToken = Guid.NewGuid().ToString();
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = tripToken,
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        var uploadId = Guid.NewGuid();
        var existingPhoto = new PhotoEntity
        {
            TripId = trip.Id,
            BlobPath = "photo1_original.jpg",
            Status = "pending",
            StorageTier = "per-trip",
            UploadId = uploadId,
            LastActivityAt = DateTime.UtcNow
        };
        await context.Photos.AddAsync(existingPhoto);
        await context.SaveChangesAsync();
        var initialPhotoId = existingPhoto.Id;

        var mockBlobServiceClient = new Mock<BlobServiceClient>();
        var mockSasIssuer = new Mock<ISasTokenIssuer>();
        var mockGeocodingService = new Mock<IGeocodingService>();
        var mockLogger = new Mock<ILogger<UploadService>>();
        var options = Options.Create(new UploadOptions { MaxBlockSizeBytes = 4 * 1024 * 1024 });

        var sasUri = new Uri("https://example.blob.core.windows.net/container/blob?sv=2021-01-01&sig=abc");
        mockSasIssuer
            .Setup(s => s.IssueWriteSasAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<TimeSpan>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(sasUri);

        var service = new UploadService(context, mockBlobServiceClient.Object, mockSasIssuer.Object, mockGeocodingService.Object, Mock.Of<IPhotoService>(), mockLogger.Object, options);

        var request = new RequestUploadRequest
        {
            UploadId = uploadId,
            Filename = "test.jpg",
            ContentType = "image/jpeg",
            SizeBytes = 1024 * 1024,
            Exif = null
        };

        // Act
        var response1 = await service.RequestUploadAsync(tripToken, request, CancellationToken.None);

        // Assert - AC1.3: DB row count does not increase
        var photoCount = await context.Photos.CountAsync();
        photoCount.Should().Be(1);

        // AC1.3: Returns the same upload ID
        response1.PhotoId.Should().Be(uploadId);

        // AC1.3: SAS issuer called 3 times to regenerate tokens (original, display, thumb)
        mockSasIssuer.Verify(
            s => s.IssueWriteSasAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<TimeSpan>(), It.IsAny<CancellationToken>()),
            Times.Exactly(3));
    }

    [Fact]
    public async Task CommitAsync_WithWrongTripId_Throws404NotFound()
    {
        // Arrange - AC1.6: trip/photo mismatch
        using var context = CreateInMemoryContext();
        var correctTripToken = Guid.NewGuid().ToString();
        var wrongTripToken = Guid.NewGuid().ToString();

        var correctTrip = new TripEntity
        {
            Slug = "correct-trip",
            Name = "Correct Trip",
            SecretToken = correctTripToken,
            ViewToken = Guid.NewGuid().ToString()
        };
        var wrongTrip = new TripEntity
        {
            Slug = "wrong-trip",
            Name = "Wrong Trip",
            SecretToken = wrongTripToken,
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(correctTrip);
        await context.Trips.AddAsync(wrongTrip);
        await context.SaveChangesAsync();

        var photoId = Guid.NewGuid();
        var photo = new PhotoEntity
        {
            TripId = correctTrip.Id,
            BlobPath = "test_original.jpg",
            Status = "pending",
            StorageTier = "per-trip",
            UploadId = photoId,
            LastActivityAt = DateTime.UtcNow
        };
        await context.Photos.AddAsync(photo);
        await context.SaveChangesAsync();

        var mockBlobServiceClient = new Mock<BlobServiceClient>();
        var mockSasIssuer = new Mock<ISasTokenIssuer>();
        var mockGeocodingService = new Mock<IGeocodingService>();
        var mockLogger = new Mock<ILogger<UploadService>>();
        var options = Options.Create(new UploadOptions { MaxBlockSizeBytes = 4 * 1024 * 1024 });

        var service = new UploadService(context, mockBlobServiceClient.Object, mockSasIssuer.Object, mockGeocodingService.Object, Mock.Of<IPhotoService>(), mockLogger.Object, options);

        var request = new CommitRequest { BlockIds = new List<string> { "block1" } };

        // Act & Assert - AC1.6: 404 when photo belongs to different trip
        var exception = await Assert.ThrowsAsync<KeyNotFoundException>(
            () => service.CommitAsync(wrongTripToken, photoId, request, CancellationToken.None));

        exception.Message.Should().Contain("Photo not found");
    }

    [Fact]
    public async Task AbortAsync_WithExistingPhoto_DeletesRow()
    {
        // Arrange - AC1.7
        using var context = CreateInMemoryContext();
        var tripToken = Guid.NewGuid().ToString();
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = tripToken,
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        var photoId = Guid.NewGuid();
        var photo = new PhotoEntity
        {
            TripId = trip.Id,
            BlobPath = "test_original.jpg",
            Status = "pending",
            StorageTier = "per-trip",
            UploadId = photoId,
            LastActivityAt = DateTime.UtcNow
        };
        await context.Photos.AddAsync(photo);
        await context.SaveChangesAsync();

        var mockBlobServiceClient = new Mock<BlobServiceClient>();
        var mockSasIssuer = new Mock<ISasTokenIssuer>();
        var mockGeocodingService = new Mock<IGeocodingService>();
        var mockLogger = new Mock<ILogger<UploadService>>();
        var options = Options.Create(new UploadOptions { MaxBlockSizeBytes = 4 * 1024 * 1024 });

        var service = new UploadService(context, mockBlobServiceClient.Object, mockSasIssuer.Object, mockGeocodingService.Object, Mock.Of<IPhotoService>(), mockLogger.Object, options);

        // Act
        await service.AbortAsync(tripToken, photoId, CancellationToken.None);

        // Assert - AC1.7: row deleted
        var deletedPhoto = await context.Photos.FirstOrDefaultAsync(p => p.UploadId == photoId);
        deletedPhoto.Should().BeNull();
    }

    [Fact]
    public async Task AbortAsync_WithMissingPhoto_IsIdempotent()
    {
        // Arrange - AC1.7: idempotent on missing photo
        using var context = CreateInMemoryContext();
        var tripToken = Guid.NewGuid().ToString();
        var trip = new TripEntity
        {
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = tripToken,
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        var mockBlobServiceClient = new Mock<BlobServiceClient>();
        var mockSasIssuer = new Mock<ISasTokenIssuer>();
        var mockGeocodingService = new Mock<IGeocodingService>();
        var mockLogger = new Mock<ILogger<UploadService>>();
        var options = Options.Create(new UploadOptions { MaxBlockSizeBytes = 4 * 1024 * 1024 });

        var service = new UploadService(context, mockBlobServiceClient.Object, mockSasIssuer.Object, mockGeocodingService.Object, Mock.Of<IPhotoService>(), mockLogger.Object, options);

        var photoId = Guid.NewGuid();

        // Act & Assert - should not throw
        await service.AbortAsync(tripToken, photoId, CancellationToken.None);
    }
}
