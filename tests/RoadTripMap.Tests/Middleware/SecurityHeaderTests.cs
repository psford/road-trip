using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;

namespace RoadTripMap.Tests.Middleware;

public class SecurityHeaderTests : IAsyncLifetime
{
    private WebApplicationFactory<Program>? _factory;
    private HttpClient? _client;

    public async Task InitializeAsync()
    {
        _factory = new WebApplicationFactory<Program>();
        _client = _factory.CreateClient();
        await Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        _client?.Dispose();
        _factory?.Dispose();
        await Task.CompletedTask;
    }

    [Fact]
    public async Task GetHealth_ReturnsXRobotsTagHeader()
    {
        // Act
        var response = await _client!.GetAsync("/api/health");

        // Assert
        response.Headers.Should().Contain(h => h.Key == "X-Robots-Tag");
        var robotsTagValues = response.Headers.GetValues("X-Robots-Tag").ToList();
        robotsTagValues.Should().HaveCount(1);
        robotsTagValues[0].Should().Be("noindex, nofollow");
    }

    [Fact]
    public async Task GetHealth_ReturnsAllSecurityHeaders()
    {
        // Act
        var response = await _client!.GetAsync("/api/health");

        // Assert
        response.Headers.Should().Contain(h => h.Key == "X-Content-Type-Options");
        response.Headers.Should().Contain(h => h.Key == "X-Frame-Options");
        response.Headers.Should().Contain(h => h.Key == "Referrer-Policy");
        response.Headers.Should().Contain(h => h.Key == "X-Robots-Tag");

        response.Headers.GetValues("X-Content-Type-Options").First().Should().Be("nosniff");
        response.Headers.GetValues("X-Frame-Options").First().Should().Be("DENY");
        response.Headers.GetValues("Referrer-Policy").First().Should().Be("strict-origin-when-cross-origin");
    }

    [Fact]
    public async Task UnknownTripSlug_Returns404WithoutEnumeration()
    {
        // Act
        var response = await _client!.GetAsync("/api/trips/view/random-nonexistent-token-12345");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.NotFound);

        var content = await response.Content.ReadAsStringAsync();
        // Should not reveal what slugs exist or provide hints
        content.Should().NotContainAny("existing", "valid", "enumerat");
    }
}
