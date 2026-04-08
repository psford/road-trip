using FluentAssertions;
using RoadTripMap;
using Xunit;

namespace RoadTripMap.Tests;

/// <summary>
/// Tests that validate the real endpoints.json file against the actual development environment contract.
/// Unlike EndpointRegistryTests which uses a test fixture, this test class points at the real endpoints.json
/// and verifies that ValidateAll() passes when all required environment variables are set with stub values.
/// This ensures the real endpoints.json is valid and complete.
/// </summary>
[Collection("EndpointRegistry")]
public class EndpointRegistryRealContractTests : IDisposable
{
    public EndpointRegistryRealContractTests()
    {
        // Point to the real endpoints.json (OverrideFilePath = null uses the default location)
        EndpointRegistry.OverrideFilePath = null;
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Development");

        // Set all development environment "source": "env" keys with stub values
        Environment.SetEnvironmentVariable("WSL_SQL_CONNECTION", "Server=localhost;Database=stub;User Id=stub;Password=stub;");
        Environment.SetEnvironmentVariable("RT_DESIGN_CONNECTION", "Server=localhost;Database=stub;User Id=stub;Password=stub;");
        Environment.SetEnvironmentVariable("NPS_API_KEY", "stub-nps-key-for-contract-test");

        EndpointRegistry.Reset();
    }

    public void Dispose()
    {
        // Clean up all environment variables set in constructor
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", null);
        Environment.SetEnvironmentVariable("WSL_SQL_CONNECTION", null);
        Environment.SetEnvironmentVariable("RT_DESIGN_CONNECTION", null);
        Environment.SetEnvironmentVariable("NPS_API_KEY", null);

        // Reset EndpointRegistry to pristine state
        EndpointRegistry.OverrideFilePath = null;
        EndpointRegistry.Reset();
    }

    /// <summary>
    /// Validates that the real endpoints.json file can be loaded and all endpoints can be resolved
    /// in Development environment with all required environment variables set to stub values.
    /// </summary>
    [Fact]
    public void ValidateAll_RealEndpointsWithDevEnvironment_DoesNotThrow()
    {
        // Act & Assert
        var action = () => EndpointRegistry.ValidateAll();
        action.Should().NotThrow();
    }

    /// <summary>
    /// Documents the expected endpoint and environment variable contract for the real endpoints.json.
    /// This test serves as executable documentation of what endpoints are required in Development.
    /// </summary>
    [Fact]
    public void ResolveAll_DevelopmentEnvironmentEndpoints_CanResolveExpectedKeys()
    {
        // This test documents the expected contract. If endpoints.json changes, this test
        // may need updating. All of these should resolve without throwing.

        // Database endpoints
        var database = EndpointRegistry.Resolve("database");
        database.Should().Contain("Server=localhost");

        var databaseAdmin = EndpointRegistry.Resolve("database-admin");
        databaseAdmin.Should().Contain("Server=localhost");

        // Literal endpoints (no env vars needed)
        var blobStorage = EndpointRegistry.Resolve("blobStorage");
        blobStorage.Should().Be("UseDevelopmentStorage=true");

        var nominatim = EndpointRegistry.Resolve("nominatim");
        nominatim.Should().Contain("nominatim.openstreetmap.org");

        var overpass = EndpointRegistry.Resolve("overpass");
        overpass.Should().Contain("overpass-api.de");

        var padUs = EndpointRegistry.Resolve("padUs");
        padUs.Should().Contain("nationalmap.gov");

        // NPS API compound endpoint
        var npsBaseUrl = EndpointRegistry.Resolve("npsApi.baseUrl");
        npsBaseUrl.Should().Be("https://developer.nps.gov/api/v1");

        var npsApiKey = EndpointRegistry.Resolve("npsApi.apiKey");
        npsApiKey.Should().Be("stub-nps-key-for-contract-test");
    }
}
