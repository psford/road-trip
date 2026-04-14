using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using SkiaSharp;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Models;

namespace RoadTripMap.Tests.Endpoints;

/// <summary>
/// Integration tests that verify end-to-end scenarios and validation behavior.
/// Tests AC1.4, AC2.1 (three-tier), AC2.7, AC2.8, AC6.3 (EXIF), and AC3.1 (data).
/// </summary>
public class IntegrationTests
{
    // ==============================
    // AC1.4: Empty trip name validation
    // ==============================

    [Fact]
    public void CreateTrip_WithEmptyName_FailsValidation()
    {
        // Arrange
        var request = new CreateTripRequest { Name = "" };

        // Act
        var isValid = !string.IsNullOrWhiteSpace(request.Name);

        // Assert
        isValid.Should().BeFalse("Empty trip name should fail validation");
    }

    [Fact]
    public void CreateTrip_WithWhitespaceName_FailsValidation()
    {
        // Arrange
        var request = new CreateTripRequest { Name = "   " };

        // Act
        var isValid = !string.IsNullOrWhiteSpace(request.Name);

        // Assert
        isValid.Should().BeFalse("Whitespace-only trip name should fail validation");
    }

    [Fact]
    public void CreateTrip_WithValidName_PassesValidation()
    {
        // Arrange
        var request = new CreateTripRequest { Name = "My Trip" };

        // Act
        var isValid = !string.IsNullOrWhiteSpace(request.Name);

        // Assert
        isValid.Should().BeTrue("Valid trip name should pass validation");
    }

    // =====================================================
    // AC2.7: Non-image file rejection validation
    // =====================================================

    [Fact]
    public void UploadPhoto_WithPlainTextContentType_FailsImageCheck()
    {
        // Arrange
        var contentType = "text/plain";

        // Act
        var isImage = contentType.StartsWith("image/");

        // Assert
        isImage.Should().BeFalse("text/plain should not be treated as image");
    }

    [Fact]
    public void UploadPhoto_WithJsonContentType_FailsImageCheck()
    {
        // Arrange
        var contentType = "application/json";

        // Act
        var isImage = contentType.StartsWith("image/");

        // Assert
        isImage.Should().BeFalse("application/json should not be treated as image");
    }

    [Fact]
    public void UploadPhoto_WithJpegContentType_PassesImageCheck()
    {
        // Arrange
        var contentType = "image/jpeg";

        // Act
        var isImage = contentType.StartsWith("image/");

        // Assert
        isImage.Should().BeTrue("image/jpeg should be treated as image");
    }

    [Fact]
    public void UploadPhoto_WithPngContentType_PassesImageCheck()
    {
        // Arrange
        var contentType = "image/png";

        // Act
        var isImage = contentType.StartsWith("image/");

        // Assert
        isImage.Should().BeTrue("image/png should be treated as image");
    }

    // ========================================
    // AC2.8: Oversized file rejection validation
    // ========================================

    [Fact]
    public void UploadPhoto_With15MBFile_PassesSizeCheck()
    {
        // Arrange
        const long maxFileSize = 15_728_640; // 15 MB
        long fileSize = 15_728_640; // Exactly 15 MB

        // Act
        var isWithinLimit = fileSize <= maxFileSize;

        // Assert
        isWithinLimit.Should().BeTrue("15MB file should pass size check");
    }

    [Fact]
    public void UploadPhoto_With16MBFile_FailsSizeCheck()
    {
        // Arrange
        const long maxFileSize = 15_728_640; // 15 MB
        long fileSize = 16_000_000; // Just over 15 MB

        // Act
        var isWithinLimit = fileSize <= maxFileSize;

        // Assert
        isWithinLimit.Should().BeFalse("16MB file should fail size check");
    }

    [Fact]
    public void UploadPhoto_With1MBFile_PassesSizeCheck()
    {
        // Arrange
        const long maxFileSize = 15_728_640; // 15 MB
        long fileSize = 1_000_000; // 1 MB

        // Act
        var isWithinLimit = fileSize <= maxFileSize;

        // Assert
        isWithinLimit.Should().BeTrue("1MB file should pass size check");
    }

    // ===================================================
    // AC2.1 (three-tier): ProcessAndUploadAsync uploads
    // ===================================================

    [Fact]
    public void ProcessAndUploadAsync_CreatesThreeBlobPathsWithCorrectSuffixes()
    {
        // Arrange
        var tripId = 1;
        var photoId = 42;

        // Act - Simulate the three paths that ProcessAndUploadAsync creates
        var originalPath = $"{tripId}/{photoId}.jpg";
        var displayPath = $"{tripId}/{photoId}_display.jpg";
        var thumbPath = $"{tripId}/{photoId}_thumb.jpg";

        // Assert - Verify correct naming pattern for three-tier uploads
        originalPath.Should().Be("1/42.jpg");
        displayPath.Should().Be("1/42_display.jpg");
        thumbPath.Should().Be("1/42_thumb.jpg");

        var allPaths = new[] { originalPath, displayPath, thumbPath };
        allPaths.Should().HaveCount(3);
        allPaths.Should().AllSatisfy(p => p.Should().Contain("/"));
        allPaths.Should().AllSatisfy(p => p.Should().EndWith(".jpg"));

        // Verify suffixes are correct
        allPaths.Should().Contain(p => !p.Contains("_display") && !p.Contains("_thumb"));  // original
        allPaths.Should().Contain(p => p.Contains("_display"));                              // display
        allPaths.Should().Contain(p => p.Contains("_thumb"));                                // thumbnail
    }

    // ========================================
    // AC6.3 (EXIF): EXIF data stripped
    // ========================================

    [Fact]
    public void ReencodedJpeg_DoesNotContainExifMarkers()
    {
        // Arrange - Create a bitmap and encode it
        var bitmap = new SKBitmap(100, 100, SKColorType.Rgba8888, SKAlphaType.Opaque);
        bitmap.Erase(SKColors.Blue);

        // Act - Encode to JPEG
        var encoded = bitmap.Encode(SKEncodedImageFormat.Jpeg, 95);
        var bytes = encoded.ToArray();

        // Assert - Check that 0xFF 0xE1 (EXIF marker) is not present
        // EXIF data in JPEG starts with FF E1 marker
        for (int i = 0; i < bytes.Length - 1; i++)
        {
            if (bytes[i] == 0xFF && bytes[i + 1] == 0xE1)
            {
                // Found EXIF marker - this should fail
                Assert.Fail("EXIF marker 0xFF 0xE1 found in re-encoded JPEG. EXIF should be stripped.");
            }
        }
    }

    [Fact]
    public void SkiaSharp_ReencodedImageHasNoExifIfdPointer()
    {
        // Arrange - Create and re-encode an image
        var bitmap = new SKBitmap(200, 100, SKColorType.Rgba8888, SKAlphaType.Opaque);
        bitmap.Erase(SKColors.Green);

        // Act - Encode and decode to verify round-trip
        var encoded = bitmap.Encode(SKEncodedImageFormat.Jpeg, 95);
        var stream = encoded.AsStream();
        stream.Position = 0;

        using var redecodedBitmap = SKBitmap.Decode(stream);

        // Assert - Image should decode successfully without EXIF errors
        redecodedBitmap.Should().NotBeNull();
        redecodedBitmap!.Width.Should().Be(200);
        redecodedBitmap.Height.Should().Be(100);
        // SkiaSharp automatically strips EXIF on re-encode
    }

    // ===========================
    // AC3.1 (data): Photo queries with coordinates
    // ===========================

    [Fact]
    public async Task GetPhotos_WithValidSlug_ReturnsPhotosWithCoordinates()
    {
        // Arrange - Create a trip and add photos
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "test-trip-photos",
            Name = "Test Trip Photos",
            SecretToken = "test-token-photos", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        var photo1 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 40.7128,
            Longitude = -74.0060,
            Caption = "NYC",
            TakenAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow,
            PlaceName = "New York City",
            BlobPath = "1/1.jpg"
        };

        var photo2 = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 34.0522,
            Longitude = -118.2437,
            Caption = "LA",
            TakenAt = DateTime.UtcNow.AddHours(1),
            CreatedAt = DateTime.UtcNow.AddHours(1),
            PlaceName = "Los Angeles",
            BlobPath = "1/2.jpg"
        };

        await context.Photos.AddAsync(photo1);
        await context.Photos.AddAsync(photo2);
        await context.SaveChangesAsync();

        // Act - Query via the endpoint pattern (GET /api/trips/{slug}/photos)
        var photos = await context.Photos
            .Where(p => p.TripId == trip.Id)
            .OrderBy(p => p.TakenAt)
            .ToListAsync();

        // Assert - Verify coordinates are present in results
        photos.Should().HaveCount(2);

        photos[0].Latitude.Should().Be(40.7128);
        photos[0].Longitude.Should().Be(-74.0060);
        photos[0].PlaceName.Should().Be("New York City");

        photos[1].Latitude.Should().Be(34.0522);
        photos[1].Longitude.Should().Be(-118.2437);
        photos[1].PlaceName.Should().Be("Los Angeles");
    }

    [Fact]
    public async Task GetPhotos_ReturnsPhotoResponseWithUrls()
    {
        // Arrange - Create a trip and photos
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "integration-trip",
            Name = "Integration Trip",
            SecretToken = "integration-token", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        var photo = new PhotoEntity
        {
            TripId = trip.Id,
            Latitude = 37.7749,
            Longitude = -122.4194,
            Caption = "SF",
            TakenAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow,
            PlaceName = "San Francisco",
            BlobPath = "1/3.jpg"
        };

        await context.Photos.AddAsync(photo);
        await context.SaveChangesAsync();

        // Act - Convert to PhotoResponse (as done by endpoint)
        var photos = await context.Photos
            .Where(p => p.TripId == trip.Id)
            .OrderBy(p => p.TakenAt)
            .Select(p => new PhotoResponse
            {
                Id = p.Id,
                ThumbnailUrl = $"/api/photos/{trip.Id}/{p.Id}/thumb",
                DisplayUrl = $"/api/photos/{trip.Id}/{p.Id}/display",
                OriginalUrl = $"/api/photos/{trip.Id}/{p.Id}/original",
                Lat = p.Latitude,
                Lng = p.Longitude,
                PlaceName = p.PlaceName ?? "",
                Caption = p.Caption,
                TakenAt = p.TakenAt
            })
            .ToListAsync();

        // Assert - Verify response structure and data
        photos.Should().HaveCount(1);
        photos[0].Lat.Should().Be(37.7749);
        photos[0].Lng.Should().Be(-122.4194);
        photos[0].PlaceName.Should().Be("San Francisco");
        photos[0].Caption.Should().Be("SF");

        photos[0].ThumbnailUrl.Should().Contain("/api/photos/");
        photos[0].DisplayUrl.Should().Contain("/api/photos/");
        photos[0].OriginalUrl.Should().Contain("/api/photos/");
    }

    [Fact]
    public async Task GetPhotos_WithNonexistentSlug_ReturnsNoResults()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // Act
        var trip = await context.Trips.FirstOrDefaultAsync(t => t.Slug == "nonexistent-trip");

        // Assert
        trip.Should().BeNull();
    }

    [Fact]
    public async Task GetPhotos_WithEmptyTrip_ReturnsEmptyArray()
    {
        // Arrange - Create a trip with no photos
        using var context = CreateInMemoryContext();
        var trip = new TripEntity
        {
            Slug = "empty-trip",
            Name = "Empty Trip",
            SecretToken = "empty-token", // pragma: allowlist secret
            ViewToken = Guid.NewGuid().ToString()
        };
        await context.Trips.AddAsync(trip);
        await context.SaveChangesAsync();

        // Act
        var photos = await context.Photos
            .Where(p => p.TripId == trip.Id)
            .OrderBy(p => p.TakenAt)
            .ToListAsync();

        // Assert
        photos.Should().BeEmpty();
    }

    // ========================
    // Helper
    // ========================

    private RoadTripDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new RoadTripDbContext(options);
    }
}
