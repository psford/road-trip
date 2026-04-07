using FluentAssertions;
using RoadTripMap;

namespace RoadTripMap.Tests;

public class EndpointRegistryTests : IDisposable
{
    private readonly string _testFixturePath;

    public EndpointRegistryTests()
    {
        _testFixturePath = Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "test-endpoints.json");

        EndpointRegistry.OverrideFilePath = _testFixturePath;
        EndpointRegistry.Reset();
    }

    public void Dispose()
    {
        EndpointRegistry.OverrideFilePath = null;
        EndpointRegistry.Reset();
    }

    [Fact]
    public void Resolve_LiteralSource_ReturnsValueDirectly()
    {
        // Arrange & Act
        var result = EndpointRegistry.Resolve("literalEndpoint");

        // Assert
        result.Should().Be("https://literal.example.com");
    }

    [Fact]
    public void Resolve_EnvSource_ReturnsEnvironmentVariableValue()
    {
        // Arrange
        Environment.SetEnvironmentVariable("TEST_ENV_VAR", "https://env.example.com");

        // Act
        var result = EndpointRegistry.Resolve("envEndpoint");

        // Assert
        result.Should().Be("https://env.example.com");
        Environment.SetEnvironmentVariable("TEST_ENV_VAR", null);
    }

    [Fact]
    public void Resolve_EnvSource_MissingVariable_ThrowsDescriptiveError()
    {
        // Arrange
        Environment.SetEnvironmentVariable("TEST_ENV_VAR", null);

        // Act & Assert
        var action = () => EndpointRegistry.Resolve("envEndpoint");

        action.Should()
            .Throw<InvalidOperationException>()
            .WithMessage("*Environment variable 'TEST_ENV_VAR' not set for endpoint 'envEndpoint'*");
    }

    [Fact]
    public void Resolve_UnknownEndpoint_ThrowsWithAvailableEndpoints()
    {
        // Act & Assert
        var action = () => EndpointRegistry.Resolve("nonexistent");

        action.Should()
            .Throw<InvalidOperationException>()
            .WithMessage("*Unknown endpoint 'nonexistent'*Available:*");
    }

    [Fact]
    public void Resolve_CompoundEndpoint_WithSubKey_ResolvesSubEntry()
    {
        // Arrange
        Environment.SetEnvironmentVariable("TEST_API_KEY", "secret-key-123");

        // Act
        var baseUrl = EndpointRegistry.Resolve("compound.baseUrl");
        var apiKey = EndpointRegistry.Resolve("compound.apiKey");

        // Assert
        baseUrl.Should().Be("https://api.example.com");
        apiKey.Should().Be("secret-key-123");
        Environment.SetEnvironmentVariable("TEST_API_KEY", null);
    }

    [Fact]
    public void Resolve_CompoundEndpoint_WithoutSubKey_ThrowsAndListsSubKeys()
    {
        // Act & Assert
        var action = () => EndpointRegistry.Resolve("compound");

        action.Should()
            .Throw<InvalidOperationException>()
            .WithMessage("*'compound' is a compound endpoint*Use a sub-key:*compound.baseUrl*compound.apiKey*");
    }

    [Fact]
    public void Resolve_CompoundEndpoint_InvalidSubKey_ThrowsDescriptiveError()
    {
        // Act & Assert
        var action = () => EndpointRegistry.Resolve("compound.invalidKey");

        action.Should()
            .Throw<InvalidOperationException>()
            .WithMessage("*Unknown endpoint 'compound.invalidKey'*");
    }

    [Fact]
    public void Resolve_KeyVaultSource_ThrowsNotImplemented()
    {
        // Arrange
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");
        EndpointRegistry.Reset();

        // Act & Assert
        var action = () => EndpointRegistry.Resolve("keyvaultEndpoint");

        action.Should()
            .Throw<NotImplementedException>()
            .WithMessage("*Key Vault resolution not yet implemented*");

        // Cleanup
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", null);
        EndpointRegistry.Reset();
    }

    [Fact]
    public void Resolve_DevelopmentEnvironment_UsesDevBlock()
    {
        // Arrange
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Development");
        EndpointRegistry.Reset();

        // Act
        var result = EndpointRegistry.Resolve("literalEndpoint");

        // Assert
        result.Should().Be("https://literal.example.com");
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", null);
        EndpointRegistry.Reset();
    }

    [Fact]
    public void Resolve_ProductionEnvironment_UsesProduction()
    {
        // Arrange
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");
        EndpointRegistry.Reset();

        // Act
        var action = () => EndpointRegistry.Resolve("literalProd");

        // Assert — should find prod entry
        action.Should().NotThrow();
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", null);
        EndpointRegistry.Reset();
    }

    [Fact]
    public void Resolve_InvalidEnvironment_ThrowsWithAvailableEnvironments()
    {
        // Arrange
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "InvalidEnv");
        EndpointRegistry.Reset();

        // Act & Assert
        var action = () => EndpointRegistry.Resolve("literalEndpoint");

        action.Should()
            .Throw<InvalidOperationException>()
            .WithMessage("*Unknown environment 'invalidenv'*Available:*dev*prod*");

        // Cleanup
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", null);
        EndpointRegistry.Reset();
    }

    [Fact]
    public void ValidateAll_AllEndpointsResolvable_DoesNotThrow()
    {
        // Arrange
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Development");
        Environment.SetEnvironmentVariable("TEST_ENV_VAR", "https://env.example.com");
        Environment.SetEnvironmentVariable("TEST_API_KEY", "secret-key-123");
        EndpointRegistry.Reset();

        // Act & Assert
        var action = () => EndpointRegistry.ValidateAll();
        action.Should().NotThrow();

        // Cleanup
        Environment.SetEnvironmentVariable("TEST_ENV_VAR", null);
        Environment.SetEnvironmentVariable("TEST_API_KEY", null);
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", null);
        EndpointRegistry.Reset();
    }

    [Fact]
    public void ValidateAll_MissingEnvVar_ThrowsAggregateException()
    {
        // Arrange
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Development");
        Environment.SetEnvironmentVariable("TEST_ENV_VAR", null);
        Environment.SetEnvironmentVariable("TEST_API_KEY", null);
        EndpointRegistry.Reset();

        // Act & Assert
        var action = () => EndpointRegistry.ValidateAll();

        action.Should()
            .Throw<AggregateException>()
            .WithMessage("*Endpoint validation failed with*error*");

        // Cleanup
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", null);
        EndpointRegistry.Reset();
    }

    [Fact]
    public void EnvironmentVariable_DotnetEnvironment_UsedAsBackup()
    {
        // Arrange
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", null);
        Environment.SetEnvironmentVariable("DOTNET_ENVIRONMENT", "Development");
        EndpointRegistry.Reset();

        // Act
        var result = EndpointRegistry.Resolve("literalEndpoint");

        // Assert
        result.Should().Be("https://literal.example.com");

        // Cleanup
        Environment.SetEnvironmentVariable("DOTNET_ENVIRONMENT", null);
        EndpointRegistry.Reset();
    }

    [Fact]
    public void EnvironmentVariable_DefaultToDevelopment()
    {
        // Arrange
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", null);
        Environment.SetEnvironmentVariable("DOTNET_ENVIRONMENT", null);
        EndpointRegistry.Reset();

        // Act
        var result = EndpointRegistry.Resolve("literalEndpoint");

        // Assert
        result.Should().Be("https://literal.example.com");
        EndpointRegistry.Reset();
    }

    [Fact]
    public async Task Resolve_ThreadSafe_MultipleConcurrentCalls()
    {
        // Arrange
        var tasks = new List<Task<string>>();
        Environment.SetEnvironmentVariable("TEST_ENV_VAR", "https://env.example.com");

        // Act
        for (int i = 0; i < 10; i++)
        {
            tasks.Add(Task.Run(() =>
            {
                return EndpointRegistry.Resolve("literalEndpoint");
            }));
        }

        var results = await Task.WhenAll(tasks);

        // Assert
        results.Should().AllSatisfy(r => r.Should().Be("https://literal.example.com"));
        Environment.SetEnvironmentVariable("TEST_ENV_VAR", null);
    }
}
