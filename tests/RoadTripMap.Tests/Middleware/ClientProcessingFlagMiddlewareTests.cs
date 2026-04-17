using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using RoadTripMap;
using RoadTripMap.Data;
using RoadTripMap.Entities;

namespace RoadTripMap.Tests.Middleware;

/// <summary>
/// Tests for the client-processing-enabled meta tag injection middleware.
/// Verifies that the middleware correctly injects the feature flag based on configuration.
/// </summary>
[Collection("EndpointRegistry")]
public class ClientProcessingFlagMiddlewareTests : IAsyncLifetime
{
    private WebApplicationFactory<Program>? _factory;
    private HttpClient? _client;
    private SqliteConnection? _connection;
    private string _testToken = Guid.NewGuid().ToString();

    public async Task InitializeAsync()
    {
        // Set required environment variables for EndpointRegistry
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Development");
        Environment.SetEnvironmentVariable("WSL_SQL_CONNECTION", "Data Source=:memory:");
        Environment.SetEnvironmentVariable("RT_DESIGN_CONNECTION", "Data Source=:memory:");
        Environment.SetEnvironmentVariable("NPS_API_KEY", "test-key");

        // Reset the EndpointRegistry
        EndpointRegistry.OverrideFilePath = null;
        EndpointRegistry.Reset();

        await Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        _client?.Dispose();
        _factory?.Dispose();
        _connection?.Dispose();
        await Task.CompletedTask;
    }

    private void CreateFactory(bool clientSideProcessingEnabled)
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        _factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.ConfigureAppConfiguration((context, configBuilder) =>
                {
                    // Start with defaults and override just the flag we care about
                    // Don't clear sources - let it load appsettings.json and environment variables

                    // Override the Upload:ClientSideProcessingEnabled key for this test
                    var dict = new Dictionary<string, string?>
                    {
                        { "Upload:ClientSideProcessingEnabled", clientSideProcessingEnabled.ToString().ToLower() }
                    };
                    configBuilder.AddInMemoryCollection(dict!);
                });

                builder.ConfigureServices(services =>
                {
                    var descriptor = services.SingleOrDefault(
                        d => d.ServiceType == typeof(DbContextOptions<RoadTripDbContext>));
                    if (descriptor != null) services.Remove(descriptor);

                    services.AddDbContext<RoadTripDbContext>(options =>
                        options.UseSqlite(_connection));
                });
            });

        _client = _factory.CreateClient();
    }

    [Fact]
    public async Task PostPage_ContainsClientProcessingMetaTag_WhenEnabled()
    {
        // Arrange
        CreateFactory(clientSideProcessingEnabled: true);

        // Create test trip
        using var scope = _factory!.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RoadTripDbContext>();
        await db.Database.EnsureCreatedAsync();

        var trip = new TripEntity
        {
            Slug = "test-trip-enabled",
            Name = "Test Trip",
            SecretToken = _testToken,
            ViewToken = Guid.NewGuid().ToString(),
            CreatedAt = DateTime.UtcNow,
        };
        db.Trips.Add(trip);
        await db.SaveChangesAsync();

        // Act
        var response = await _client!.GetAsync($"/post/{_testToken}");
        var html = await response.Content.ReadAsStringAsync();

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);
        html.Should().Contain("client-processing-enabled");
        html.Should().Contain("content=\"true\"");
    }

    [Fact]
    public async Task PostPage_MetaTagReflectsConfig_WhenDisabled()
    {
        // Arrange
        CreateFactory(clientSideProcessingEnabled: false);

        // Create test trip
        using var scope = _factory!.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RoadTripDbContext>();
        await db.Database.EnsureCreatedAsync();

        var trip = new TripEntity
        {
            Slug = "test-trip-disabled",
            Name = "Test Trip",
            SecretToken = _testToken,
            ViewToken = Guid.NewGuid().ToString(),
            CreatedAt = DateTime.UtcNow,
        };
        db.Trips.Add(trip);
        await db.SaveChangesAsync();

        // Act
        var response = await _client!.GetAsync($"/post/{_testToken}");
        var html = await response.Content.ReadAsStringAsync();

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);
        html.Should().Contain("client-processing-enabled");
        html.Should().Contain("content=\"false\"");
    }

    [Fact]
    public async Task PostPage_MetaTagBeforeHeadClose()
    {
        // Arrange
        CreateFactory(clientSideProcessingEnabled: true);

        using var scope = _factory!.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RoadTripDbContext>();
        await db.Database.EnsureCreatedAsync();

        var trip = new TripEntity
        {
            Slug = "test-trip-position",
            Name = "Test Trip",
            SecretToken = _testToken,
            ViewToken = Guid.NewGuid().ToString(),
            CreatedAt = DateTime.UtcNow,
        };
        db.Trips.Add(trip);
        await db.SaveChangesAsync();

        // Act
        var response = await _client!.GetAsync($"/post/{_testToken}");
        var html = await response.Content.ReadAsStringAsync();

        // Assert — meta tag should appear before </head>
        var metaIndex = html.IndexOf("client-processing-enabled");
        var headCloseIndex = html.IndexOf("</head>");

        metaIndex.Should().BeGreaterThan(-1, "meta tag should exist");
        headCloseIndex.Should().BeGreaterThan(-1, "</head> should exist");
        metaIndex.Should().BeLessThan(headCloseIndex, "meta tag should appear before </head>");
    }
}
