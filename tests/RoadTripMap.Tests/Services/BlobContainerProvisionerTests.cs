using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;
using RoadTripMap.Services;

namespace RoadTripMap.Tests.Services;

public class BlobContainerProvisionerTests
{
    [Fact]
    public async Task EnsureContainerAsync_ValidToken_CreatesContainer()
    {
        // Arrange
        var mockBlobServiceClient = new Mock<BlobServiceClient>();
        var mockContainerClient = new Mock<BlobContainerClient>();
        var mockLogger = new Mock<ILogger<BlobContainerProvisioner>>();

        mockBlobServiceClient
            .Setup(x => x.GetBlobContainerClient(It.IsAny<string>()))
            .Returns(mockContainerClient.Object);

        var provisioner = new BlobContainerProvisioner(
            mockBlobServiceClient.Object,
            mockLogger.Object);

        var secretToken = Guid.NewGuid().ToString();
        var ct = CancellationToken.None;

        // Act
        var containerName = await provisioner.EnsureContainerAsync(secretToken, ct);

        // Assert
        containerName.Should().StartWith("trip-");
        containerName.Should().Be("trip-" + secretToken.ToLowerInvariant());
        mockBlobServiceClient.Verify(
            x => x.GetBlobContainerClient("trip-" + secretToken.ToLowerInvariant()),
            Times.Once);
    }

    [Fact]
    public async Task EnsureContainerAsync_CalledTwice_IsIdempotent()
    {
        // Arrange (AC2.2 - idempotence)
        var mockBlobServiceClient = new Mock<BlobServiceClient>();
        var mockContainerClient = new Mock<BlobContainerClient>();
        var mockLogger = new Mock<ILogger<BlobContainerProvisioner>>();

        mockBlobServiceClient
            .Setup(x => x.GetBlobContainerClient(It.IsAny<string>()))
            .Returns(mockContainerClient.Object);

        var provisioner = new BlobContainerProvisioner(
            mockBlobServiceClient.Object,
            mockLogger.Object);

        var secretToken = Guid.NewGuid().ToString();
        var ct = CancellationToken.None;

        // Act
        var result1 = await provisioner.EnsureContainerAsync(secretToken, ct);
        var result2 = await provisioner.EnsureContainerAsync(secretToken, ct);

        // Assert
        result1.Should().Be(result2);
    }

    [Fact]
    public async Task DeleteContainerAsync_ValidToken_DeletesContainer()
    {
        // Arrange (AC2.4)
        var mockBlobServiceClient = new Mock<BlobServiceClient>();
        var mockContainerClient = new Mock<BlobContainerClient>();
        var mockLogger = new Mock<ILogger<BlobContainerProvisioner>>();

        mockBlobServiceClient
            .Setup(x => x.GetBlobContainerClient(It.IsAny<string>()))
            .Returns(mockContainerClient.Object);

        var provisioner = new BlobContainerProvisioner(
            mockBlobServiceClient.Object,
            mockLogger.Object);

        var secretToken = Guid.NewGuid().ToString();
        var ct = CancellationToken.None;

        // Act
        await provisioner.DeleteContainerAsync(secretToken, ct);

        // Assert
        mockBlobServiceClient.Verify(
            x => x.GetBlobContainerClient("trip-" + secretToken.ToLowerInvariant()),
            Times.Once);
    }

    [Fact]
    public async Task EnsureContainerAsync_InvalidToken_ThrowsException()
    {
        // Arrange (AC2.5)
        var mockLogger = new Mock<ILogger<BlobContainerProvisioner>>();

        // Create a real BlobServiceClient with invalid endpoint - we won't reach it due to validation
        // Actually, use a null mock that will fail if accessed
        BlobServiceClient blobClient = null;

        var provisioner = new BlobContainerProvisioner(
            blobClient,
            mockLogger.Object);

        // Token that produces consecutive dashes when formatted
        // "trip---" will fail the consecutive dash check
        var invalidToken = "---";
        var ct = CancellationToken.None;

        // Act & Assert
        await Assert.ThrowsAsync<InvalidContainerNameException>(
            () => provisioner.EnsureContainerAsync(invalidToken, ct));
    }

    [Fact]
    public async Task EnsureContainerAsync_TokenWithUppercase_ConvertedToLowercase()
    {
        // Arrange
        var mockBlobServiceClient = new Mock<BlobServiceClient>();
        var mockContainerClient = new Mock<BlobContainerClient>();
        var mockLogger = new Mock<ILogger<BlobContainerProvisioner>>();

        mockBlobServiceClient
            .Setup(x => x.GetBlobContainerClient(It.IsAny<string>()))
            .Returns(mockContainerClient.Object);

        var provisioner = new BlobContainerProvisioner(
            mockBlobServiceClient.Object,
            mockLogger.Object);

        var secretToken = "ABCD1234-1234-1234-1234-123456789ABC";
        var ct = CancellationToken.None;

        // Act
        var containerName = await provisioner.EnsureContainerAsync(secretToken, ct);

        // Assert
        containerName.Should().Be("trip-abcd1234-1234-1234-1234-123456789abc");
        containerName.Should().Be(containerName.ToLowerInvariant());
    }

    [Fact]
    public async Task EnsureContainerAsync_GuidToken_ProducesValidName()
    {
        // Arrange (AC2.1 - fresh trip creates container)
        var mockBlobServiceClient = new Mock<BlobServiceClient>();
        var mockContainerClient = new Mock<BlobContainerClient>();
        var mockLogger = new Mock<ILogger<BlobContainerProvisioner>>();

        mockBlobServiceClient
            .Setup(x => x.GetBlobContainerClient(It.IsAny<string>()))
            .Returns(mockContainerClient.Object);

        var provisioner = new BlobContainerProvisioner(
            mockBlobServiceClient.Object,
            mockLogger.Object);

        var secretToken = "550e8400-e29b-41d4-a716-446655440000";
        var ct = CancellationToken.None;

        // Act
        var containerName = await provisioner.EnsureContainerAsync(secretToken, ct);

        // Assert
        containerName.Should().Be("trip-550e8400-e29b-41d4-a716-446655440000");
        containerName.Should().HaveLength(41); // "trip-" (5) + 36-char UUID
        containerName.Should().MatchRegex(@"^trip-[a-z0-9-]+$");
    }
}
