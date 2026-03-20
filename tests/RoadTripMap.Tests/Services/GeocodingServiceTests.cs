using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Services;
using Xunit;

namespace RoadTripMap.Tests.Services;

public class GeocodingServiceTests
{
    private RoadTripDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new RoadTripDbContext(options);
    }

    private MockHttpMessageHandler CreateMockHttpHandler(string displayName)
    {
        return new MockHttpMessageHandler(displayName);
    }

    private INominatimRateLimiter CreateMockRateLimiter()
    {
        return new NominatimRateLimiter();
    }

    [Fact]
    public async Task ReverseGeocodeAsync_WithValidCoordinates_ReturnsPlaceName()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var httpHandler = CreateMockHttpHandler("Grand Canyon Village, Coconino County, Arizona, United States");
        var httpClient = new HttpClient(httpHandler);
        var rateLimiter = CreateMockRateLimiter();
        var service = new NominatimGeocodingService(httpClient, context, rateLimiter);

        // Act
        var result = await service.ReverseGeocodeAsync(36.1069, -112.1129);

        // Assert
        result.Should().NotBeNull();
        result.Should().Contain("Grand Canyon");
    }

    [Fact]
    public async Task ReverseGeocodeAsync_CachesResult_PreventsSecondHttpCall()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var httpHandler = CreateMockHttpHandler("Test City, State, Country");
        var httpClient = new HttpClient(httpHandler);
        var rateLimiter = CreateMockRateLimiter();
        var service = new NominatimGeocodingService(httpClient, context, rateLimiter);

        var lat = 36.1069;
        var lng = -112.1129;

        // Act - First call
        var result1 = await service.ReverseGeocodeAsync(lat, lng);

        // Assert cache was populated
        var cachedEntry = await context.GeoCache.FirstOrDefaultAsync(
            g => g.LatRounded == Math.Round(lat, 2) && g.LngRounded == Math.Round(lng, 2));
        cachedEntry.Should().NotBeNull();

        // Act - Second call with same coordinates
        var result2 = await service.ReverseGeocodeAsync(lat, lng);

        // Assert
        result1.Should().Be(result2);
        // The second call should use the cache, not make a new HTTP request
        httpHandler.CallCount.Should().Be(1);
    }

    [Fact]
    public async Task ReverseGeocodeAsync_CacheHit_ReturnsPlaceNameWithoutHttpRequest()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var cacheEntry = new GeoCacheEntity
        {
            LatRounded = 36.11,
            LngRounded = -112.11,
            PlaceName = "Cached Test Location",
            CachedAt = DateTime.UtcNow
        };
        context.GeoCache.Add(cacheEntry);
        await context.SaveChangesAsync();

        var httpHandler = new MockHttpMessageHandler("Should Not Be Called");
        var httpClient = new HttpClient(httpHandler);
        var rateLimiter = CreateMockRateLimiter();
        var service = new NominatimGeocodingService(httpClient, context, rateLimiter);

        // Act
        var result = await service.ReverseGeocodeAsync(36.1069, -112.1129);

        // Assert
        result.Should().Be("Cached Test Location");
        httpHandler.CallCount.Should().Be(0); // No HTTP call made
    }

    [Fact]
    public async Task ReverseGeocodeAsync_CacheMiss_CreatesGeoCacheEntry()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var httpHandler = CreateMockHttpHandler("New Test City, State, Country");
        var httpClient = new HttpClient(httpHandler);
        var rateLimiter = CreateMockRateLimiter();
        var service = new NominatimGeocodingService(httpClient, context, rateLimiter);

        var lat = 40.7128;
        var lng = -74.0060;

        // Act
        var result = await service.ReverseGeocodeAsync(lat, lng);

        // Assert
        var cachedEntry = await context.GeoCache.FirstOrDefaultAsync(
            g => g.LatRounded == Math.Round(lat, 2) && g.LngRounded == Math.Round(lng, 2));
        cachedEntry.Should().NotBeNull();
        cachedEntry!.PlaceName.Should().Be(result);
    }

    [Fact]
    public async Task ReverseGeocodeAsync_HttpFailure_ReturnsNull()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var httpHandler = new FailingHttpMessageHandler();
        var httpClient = new HttpClient(httpHandler);
        var rateLimiter = CreateMockRateLimiter();
        var service = new NominatimGeocodingService(httpClient, context, rateLimiter);

        // Act
        var result = await service.ReverseGeocodeAsync(36.1069, -112.1129);

        // Assert
        result.Should().BeNull();
    }

    [Fact]
    public void NominatimGeocodingService_ImplementsIGeocodingService()
    {
        // Arrange & Act
        var interfaceType = typeof(IGeocodingService);
        var implementationType = typeof(NominatimGeocodingService);

        // Assert
        implementationType.Should().Implement(interfaceType);
    }

    [Fact]
    public async Task ReverseGeocodeAsync_SimplifiesPlaceName()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var complexName = "123 Main Street, 12345, New York City, New York, United States of America";
        var httpHandler = CreateMockHttpHandler(complexName);
        var httpClient = new HttpClient(httpHandler);
        var rateLimiter = CreateMockRateLimiter();
        var service = new NominatimGeocodingService(httpClient, context, rateLimiter);

        // Act
        var result = await service.ReverseGeocodeAsync(40.7128, -74.0060);

        // Assert
        result.Should().NotBeNull();
        // Should contain main components but not postcodes
        result.Should().NotContain("12345");
    }

    [Fact]
    public async Task ReverseGeocodeAsync_RoundsCoordinatesForCache()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var httpHandler = CreateMockHttpHandler("Test Location");
        var httpClient = new HttpClient(httpHandler);
        var rateLimiter = CreateMockRateLimiter();
        var service = new NominatimGeocodingService(httpClient, context, rateLimiter);

        // Act - Call with coordinates that round to same values
        var lat1 = 36.106;
        var lng1 = -112.1129;
        var lat2 = 36.109; // Rounds to same 2 decimal places
        var lng2 = -112.1125; // Rounds to same 2 decimal places

        var result1 = await service.ReverseGeocodeAsync(lat1, lng1);
        var result2 = await service.ReverseGeocodeAsync(lat2, lng2);

        // Assert - Should use cache on second call
        result1.Should().Be(result2);
        httpHandler.CallCount.Should().Be(1); // Only one HTTP call
    }
}

/// <summary>
/// Mock HttpMessageHandler that returns a success response with Nominatim JSON structure
/// </summary>
public class MockHttpMessageHandler : HttpMessageHandler
{
    private readonly string _displayName;
    public int CallCount { get; private set; }

    public MockHttpMessageHandler(string displayName)
    {
        _displayName = displayName;
    }

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        CallCount++;

        var responseJson = new
        {
            display_name = _displayName
        };

        var content = new StringContent(
            JsonSerializer.Serialize(responseJson),
            System.Text.Encoding.UTF8,
            "application/json");

        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = content
        });
    }
}

/// <summary>
/// Mock HttpMessageHandler that always returns a failure response
/// </summary>
public class FailingHttpMessageHandler : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError));
    }
}
