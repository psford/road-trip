using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using RoadTripMap;
using RoadTripMap.Data;

namespace RoadTripMap.Tests.Middleware;

public class SecurityHeaderTests : IAsyncLifetime
{
    private WebApplicationFactory<Program>? _factory;
    private HttpClient? _client;
    private SqliteConnection? _connection;

    public async Task InitializeAsync()
    {
        // Set required environment variables for ValidateAll()
        Environment.SetEnvironmentVariable("WSL_SQL_CONNECTION", "Data Source=:memory:");
        Environment.SetEnvironmentVariable("NPS_API_KEY", "test-key");

        // Ensure EndpointRegistry uses the real endpoints.json, not test fixture
        EndpointRegistry.OverrideFilePath = null;
        EndpointRegistry.Reset();

        // SQLite in-memory connection (kept open for test lifetime)
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        _factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.ConfigureServices(services =>
                {
                    // Replace SQL Server with SQLite for CI
                    var descriptor = services.SingleOrDefault(
                        d => d.ServiceType == typeof(DbContextOptions<RoadTripDbContext>));
                    if (descriptor != null) services.Remove(descriptor);

                    services.AddDbContext<RoadTripDbContext>(options =>
                        options.UseSqlite(_connection));
                });
            });

        _client = _factory.CreateClient();
        await Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        _client?.Dispose();
        _factory?.Dispose();
        _connection?.Dispose();
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
    public async Task UnknownViewToken_RejectsInvalidFormat()
    {
        // Act — non-GUID token should be rejected without revealing valid tokens
        var response = await _client!.GetAsync("/api/trips/view/random-nonexistent-token-12345");

        // Assert — endpoint validates GUID format first (400), not trip existence (404)
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.BadRequest);

        var content = await response.Content.ReadAsStringAsync();
        // Should not reveal what tokens exist or hint at enumeration
        content.Should().NotContainAny("existing", "enumerat");
    }

    [Fact]
    public async Task UnknownViewToken_ValidGuid_Returns404()
    {
        // Act — valid GUID format but non-existent trip
        var response = await _client!.GetAsync("/api/trips/view/00000000-0000-0000-0000-000000000000");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.NotFound);
    }
}
