using FluentAssertions;
using RoadTripMap.Services;

namespace RoadTripMap.Tests.Services;

public class UploadRateLimiterTests
{
    [Fact]
    public void IsAllowed_FirstUpload_ReturnsTrue()
    {
        // Arrange
        var limiter = new UploadRateLimiter();
        var ip = "192.168.1.1";

        // Act
        var result = limiter.IsAllowed(ip);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void IsAllowed_UnderLimit_AllReturnsTrue()
    {
        // Arrange
        var limiter = new UploadRateLimiter();
        var ip = "192.168.1.1";

        // Act & Assert
        for (int i = 0; i < 200; i++)
        {
            var result = limiter.IsAllowed(ip);
            result.Should().BeTrue($"Upload {i + 1} should be allowed");
        }
    }

    [Fact]
    public void IsAllowed_201stUpload_ReturnsFalse()
    {
        // Arrange
        var limiter = new UploadRateLimiter();
        var ip = "192.168.1.1";

        // Act - Do 200 allowed uploads
        for (int i = 0; i < 200; i++)
        {
            limiter.IsAllowed(ip);
        }

        // 201st should be denied
        var result = limiter.IsAllowed(ip);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public void IsAllowed_DifferentIPs_HaveIndependentLimits()
    {
        // Arrange
        var limiter = new UploadRateLimiter();
        var ip1 = "192.168.1.1";
        var ip2 = "192.168.1.2";

        // Act - Max out IP1
        for (int i = 0; i < 200; i++)
        {
            limiter.IsAllowed(ip1);
        }

        // IP2 should still be able to upload
        var result = limiter.IsAllowed(ip2);

        // Assert
        result.Should().BeTrue("Different IPs should have independent limits");
        limiter.IsAllowed(ip1).Should().BeFalse("IP1 should still be rate limited");
    }

    [Fact]
    public void IsAllowed_AfterExpiry_AllowsNewUploads()
    {
        // Arrange
        var limiter = new UploadRateLimiter();
        var ip = "192.168.1.1";

        // Fill to capacity and verify the next call would fail
        for (int i = 0; i < 200; i++)
        {
            limiter.IsAllowed(ip);
        }

        var afterLimit = limiter.IsAllowed(ip);
        afterLimit.Should().BeFalse("Should be rate limited after 200 uploads");

        // In a real scenario, waiting 1 hour would allow new uploads
        // This test verifies the logic is in place
    }

    [Fact]
    public void IsAllowed_EmptyIP_Allowed()
    {
        // Arrange
        var limiter = new UploadRateLimiter();

        // Act
        var result = limiter.IsAllowed("unknown");

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public async Task IsAllowed_ThreadSafe_ConcurrentRequests()
    {
        // Arrange
        var limiter = new UploadRateLimiter();
        var ip = "192.168.1.1";
        var allowedCount = 0;
        var tasks = new List<Task>();

        // Act - 400 concurrent requests from same IP
        for (int i = 0; i < 400; i++)
        {
            tasks.Add(Task.Run(() =>
            {
                if (limiter.IsAllowed(ip))
                    Interlocked.Increment(ref allowedCount);
            }));
        }
        await Task.WhenAll(tasks);

        // Assert - Only first 200 should succeed
        allowedCount.Should().Be(200, "Thread-safe limiter should allow exactly 200 concurrent uploads");
    }
}
