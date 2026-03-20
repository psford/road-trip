using FluentAssertions;
using Microsoft.AspNetCore.Http;
using RoadTripMap.Entities;
using RoadTripMap.Services;

namespace RoadTripMap.Tests.Services;

public class SecretTokenAuthStrategyTests
{
    private readonly SecretTokenAuthStrategy _authStrategy = new();

    [Fact]
    public async Task ValidatePostAccess_WithMatchingSecretToken_ReturnsAuthorized()
    {
        // Arrange
        var secretToken = "test-secret-token-123"; // pragma: allowlist secret
        var trip = new TripEntity
        {
            Id = 1,
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = secretToken
        };

        var httpContext = new DefaultHttpContext();
        httpContext.Request.RouteValues["secretToken"] = secretToken;

        // Act
        var result = await _authStrategy.ValidatePostAccess(httpContext, trip);

        // Assert
        result.IsAuthorized.Should().BeTrue();
        result.DeniedReason.Should().BeNull();
    }

    [Fact]
    public async Task ValidatePostAccess_WithMismatchingSecretToken_ReturnsUnauthorized()
    {
        // Arrange
        var correctToken = "correct-token"; // pragma: allowlist secret
        var wrongToken = "wrong-token";
        var trip = new TripEntity
        {
            Id = 1,
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = correctToken
        };

        var httpContext = new DefaultHttpContext();
        httpContext.Request.RouteValues["secretToken"] = wrongToken;

        // Act
        var result = await _authStrategy.ValidatePostAccess(httpContext, trip);

        // Assert
        result.IsAuthorized.Should().BeFalse();
        result.DeniedReason.Should().Be("Invalid or missing secret token");
    }

    [Fact]
    public async Task ValidatePostAccess_WithMissingSecretToken_ReturnsUnauthorized()
    {
        // Arrange
        var trip = new TripEntity
        {
            Id = 1,
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = "some-token" // pragma: allowlist secret
        };

        var httpContext = new DefaultHttpContext();
        // Don't set secretToken route value

        // Act
        var result = await _authStrategy.ValidatePostAccess(httpContext, trip);

        // Assert
        result.IsAuthorized.Should().BeFalse();
        result.DeniedReason.Should().Be("Invalid or missing secret token");
    }

    [Fact]
    public void ValidatePostAccess_ImplementsIAuthStrategy()
    {
        // Assert - The class implements the interface
        typeof(SecretTokenAuthStrategy).Should().Implement<IAuthStrategy>();
    }

    [Fact]
    public async Task ValidatePostAccess_WithValidTokenReturnsAuthResult()
    {
        // Arrange
        var secretToken = "test-token"; // pragma: allowlist secret
        var trip = new TripEntity
        {
            Id = 1,
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = secretToken
        };

        var httpContext = new DefaultHttpContext();
        httpContext.Request.RouteValues["secretToken"] = secretToken;

        // Act
        var result = await _authStrategy.ValidatePostAccess(httpContext, trip);

        // Assert
        result.Should().BeOfType<AuthResult>();
    }

    [Fact]
    public async Task ValidatePostAccess_WithEmptySecretToken_ReturnsUnauthorized()
    {
        // Arrange
        var trip = new TripEntity
        {
            Id = 1,
            Slug = "test-trip",
            Name = "Test Trip",
            SecretToken = "some-token" // pragma: allowlist secret
        };

        var httpContext = new DefaultHttpContext();
        httpContext.Request.RouteValues["secretToken"] = "";

        // Act
        var result = await _authStrategy.ValidatePostAccess(httpContext, trip);

        // Assert
        result.IsAuthorized.Should().BeFalse();
        result.DeniedReason.Should().Be("Invalid or missing secret token");
    }
}
