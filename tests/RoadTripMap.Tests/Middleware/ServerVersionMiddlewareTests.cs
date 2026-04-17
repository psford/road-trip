using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using RoadTripMap;
using RoadTripMap.Data;
using RoadTripMap.Versioning;

namespace RoadTripMap.Tests.Middleware;

[Collection("EndpointRegistry")]
public class ServerVersionMiddlewareTests : IAsyncLifetime
{
    private WebApplicationFactory<Program>? _factory;
    private HttpClient? _client;
    private SqliteConnection? _connection;

    public async Task InitializeAsync()
    {
        // Set required environment variables for ValidateAll()
        Environment.SetEnvironmentVariable("WSL_SQL_CONNECTION", "Data Source=:memory:");
        Environment.SetEnvironmentVariable("RT_DESIGN_CONNECTION", "Data Source=:memory:");
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
    public async Task GetVersion_ReturnsVersionHeaders()
    {
        // Act
        var response = await _client!.GetAsync("/api/version");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);
        response.Headers.Should().Contain(h => h.Key == "x-server-version");
        response.Headers.Should().Contain(h => h.Key == "x-client-min-version");

        var serverVersionValues = response.Headers.GetValues("x-server-version").ToList();
        var clientMinValues = response.Headers.GetValues("x-client-min-version").ToList();

        serverVersionValues.Should().HaveCount(1);
        clientMinValues.Should().HaveCount(1);

        // Both should be semantic versions (at minimum contain numbers and dots)
        serverVersionValues[0].Should().MatchRegex(@"^\d+\.\d+\.\d+");
        clientMinValues[0].Should().MatchRegex(@"^\d+\.\d+\.\d+");
    }

    [Fact]
    public async Task GetVersion_ReturnsJsonBody()
    {
        // Act
        var response = await _client!.GetAsync("/api/version");

        // Assert
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);
        var content = await response.Content.ReadAsStringAsync();

        // Should contain both keys
        content.Should().Contain("server_version");
        content.Should().Contain("client_min_version");
    }

    [Fact]
    public async Task NotFoundPath_IncludesVersionHeaders()
    {
        // Act — request a path that doesn't exist and returns 404
        // Using view endpoint which validates GUID and returns 404 for non-existent trip
        var response = await _client!.GetAsync("/api/trips/view/00000000-0000-0000-0000-000000000000");

        // Assert — 404 response should still include version headers
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.NotFound);
        response.Headers.Should().Contain(h => h.Key == "x-server-version");
        response.Headers.Should().Contain(h => h.Key == "x-client-min-version");
    }

    [Fact]
    public async Task RapidRequests_ConsistentVersionHeaders()
    {
        // Act — fire 10 rapid requests to /api/version
        var tasks = Enumerable.Range(0, 10)
            .Select(async _ => await _client!.GetAsync("/api/version"))
            .ToList();

        var responses = await Task.WhenAll(tasks);

        // Assert — all responses should have identical version header values
        var serverVersions = responses
            .Select(r => r.Headers.GetValues("x-server-version").First())
            .Distinct()
            .ToList();

        var clientMins = responses
            .Select(r => r.Headers.GetValues("x-client-min-version").First())
            .Distinct()
            .ToList();

        // Should have exactly one distinct value across all requests
        serverVersions.Should().HaveCount(1, "server version should not change between requests");
        clientMins.Should().HaveCount(1, "client min version should not change between requests");
    }

    [Fact]
    public async Task UnconfiguredMinVersion_DefaultsToOnePointZeroPointZero()
    {
        // Arrange — create a factory with MinVersion unset in config
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var unconfiguredFactory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.ConfigureAppConfiguration((context, configBuilder) =>
                {
                    // Clear all default sources and provide minimal config without ClientProtocol:MinVersion
                    configBuilder.Sources.Clear();

                    // Add a custom in-memory source with basic config
                    var configData = new[] {
                        new KeyValuePair<string, string?>("ConnectionStrings:DefaultConnection", ""),
                        new KeyValuePair<string, string?>("Blob:UseDevelopmentStorage", "false"),
                        new KeyValuePair<string, string?>("Upload:SasTokenTtl", "02:00:00"),
                        new KeyValuePair<string, string?>("Upload:MaxBlockSizeBytes", "4194304"),
                        new KeyValuePair<string, string?>("OrphanSweeper:IntervalHours", "1"),
                        new KeyValuePair<string, string?>("OrphanSweeper:StaleThresholdHours", "48")
                        // ClientProtocol:MinVersion intentionally omitted
                    };

                    // Use IConfigurationBuilder.AddInMemoryCollection if available,
                    // otherwise build from Dictionary directly
                    var dict = new Dictionary<string, string?>();
                    foreach (var kvp in configData)
                    {
                        dict[kvp.Key] = kvp.Value;
                    }

                    // Create a custom configuration provider
                    configBuilder.AddJsonFile("appsettings.json", optional: true, reloadOnChange: false);
                    // Override specific values to unset MinVersion
                    var overrides = new Dictionary<string, string?>(dict);
                    configBuilder.Sources.Insert(0, new TestConfigurationSource(overrides));
                });

                builder.ConfigureServices(services =>
                {
                    var descriptor = services.SingleOrDefault(
                        d => d.ServiceType == typeof(DbContextOptions<RoadTripDbContext>));
                    if (descriptor != null) services.Remove(descriptor);

                    services.AddDbContext<RoadTripDbContext>(options =>
                        options.UseSqlite(connection));
                });
            });

        var unconfiguredClient = unconfiguredFactory.CreateClient();

        try
        {
            // Act
            var response = await unconfiguredClient.GetAsync("/api/version");

            // Assert
            response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);
            var clientMinValues = response.Headers.GetValues("x-client-min-version").ToList();
            clientMinValues[0].Should().Be("1.0.0");
        }
        finally
        {
            unconfiguredClient.Dispose();
            unconfiguredFactory.Dispose();
            connection.Dispose();
        }
    }
}

/// <summary>
/// Test configuration source that provides hardcoded values without ClientProtocol:MinVersion.
/// </summary>
internal class TestConfigurationSource : IConfigurationSource
{
    private readonly Dictionary<string, string?> _data;

    public TestConfigurationSource(Dictionary<string, string?> data)
    {
        _data = data;
    }

    public IConfigurationProvider Build(IConfigurationBuilder builder)
    {
        return new TestConfigurationProvider(_data);
    }
}

/// <summary>
/// Test configuration provider that supplies hardcoded values.
/// </summary>
internal class TestConfigurationProvider : ConfigurationProvider
{
    private readonly Dictionary<string, string?> _data;

    public TestConfigurationProvider(Dictionary<string, string?> data)
    {
        _data = data;
    }

    public override void Load()
    {
        Data = new Dictionary<string, string?>(_data, StringComparer.OrdinalIgnoreCase);
    }
}
