using Xunit;

namespace RoadTripMap.Tests;

/// <summary>
/// Shared collection for test classes that manipulate EndpointRegistry state.
/// Prevents xUnit from running these tests in parallel, avoiding race conditions
/// from shared static state in EndpointRegistry and environment variables.
/// </summary>
[CollectionDefinition("EndpointRegistry")]
public class EndpointRegistryCollection : ICollectionFixture<EndpointRegistryFixture>
{
}

/// <summary>
/// Fixture that provides safe isolation for EndpointRegistry state during tests.
/// </summary>
public class EndpointRegistryFixture : IAsyncLifetime
{
    public Task InitializeAsync()
    {
        return Task.CompletedTask;
    }

    public Task DisposeAsync()
    {
        // Clean up environment variables and EndpointRegistry state after each test class
        Environment.SetEnvironmentVariable("WSL_SQL_CONNECTION", null);
        Environment.SetEnvironmentVariable("NPS_API_KEY", null);
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", null);
        Environment.SetEnvironmentVariable("DOTNET_ENVIRONMENT", null);
        Environment.SetEnvironmentVariable("TEST_ENV_VAR", null);
        Environment.SetEnvironmentVariable("TEST_API_KEY", null);
        RoadTripMap.EndpointRegistry.OverrideFilePath = null;
        RoadTripMap.EndpointRegistry.Reset();
        return Task.CompletedTask;
    }
}
