using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.PoiSeeder.Importers;
using Xunit;

namespace RoadTripMap.Tests.Seeder;

public class PadUsBoundaryImporterErrorTests
{
    private RoadTripDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new RoadTripDbContext(options);
    }

    private static string BuildValidFeaturesResponse()
    {
        return JsonSerializer.Serialize(new
        {
            features = new object[]
            {
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        OBJECTID = 1,
                        Unit_Nm = "Test Park",
                        State_Nm = "WA",
                        Des_Tp = "SP",
                        GIS_Acres = 1000
                    },
                    geometry = new
                    {
                        type = "Polygon",
                        coordinates = new object[][][]
                        {
                            new object[][]
                            {
                                new object[] { -122.5, 48.4 },
                                new object[] { -122.3, 48.4 },
                                new object[] { -122.3, 48.2 },
                                new object[] { -122.5, 48.2 },
                                new object[] { -122.5, 48.4 }
                            }
                        }
                    }
                }
            }
        });
    }

    // -------------------------------------------------------------------------
    // Test 1: 429 then success — import completes after one retry
    // -------------------------------------------------------------------------
    [Fact]
    public async Task ImportAsync_FeaturesReturns429ThenSuccess_ImportSucceedsAfterRetry()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var countResponse = JsonSerializer.Serialize(new { count = 1 });
        var featuresResponse = BuildValidFeaturesResponse();

        // Sequenced: call 1 = count (200), call 2 = features 429, call 3 = features 200
        var handler = new SequencedHttpMessageHandler(new[]
        {
            new SequencedResponse(HttpStatusCode.OK, countResponse),
            new SequencedResponse(HttpStatusCode.TooManyRequests, ""),
            new SequencedResponse(HttpStatusCode.OK, featuresResponse)
        });

        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://edits.nationalmap.gov/") };
        var importer = new PadUsBoundaryImporter(context, httpClient);

        // Act
        var (imported, skipped, merged) = await importer.ImportAsync();

        // Assert — import succeeded
        imported.Should().Be(1);
        skipped.Should().Be(0);

        // Call count: 1 (count) + 2 (one 429 retry + one success) = 3
        handler.CallCount.Should().Be(3, "count endpoint + one 429 + one successful features call");
    }

    // -------------------------------------------------------------------------
    // Test 2: Three consecutive 429s — exhausts retries and throws
    // -------------------------------------------------------------------------
    [Fact]
    public async Task ImportAsync_FeaturesReturnsThreeConsecutive429s_ThrowsHttpRequestException()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var countResponse = JsonSerializer.Serialize(new { count = 1 });

        // Sequenced: call 1 = count (200), calls 2-4 = features 429 × 3
        var handler = new SequencedHttpMessageHandler(new[]
        {
            new SequencedResponse(HttpStatusCode.OK, countResponse),
            new SequencedResponse(HttpStatusCode.TooManyRequests, ""),
            new SequencedResponse(HttpStatusCode.TooManyRequests, ""),
            new SequencedResponse(HttpStatusCode.TooManyRequests, "")
        });

        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://edits.nationalmap.gov/") };
        var importer = new PadUsBoundaryImporter(context, httpClient);

        // Act
        var act = () => importer.ImportAsync();

        // Assert — all retries exhausted, EnsureSuccessStatusCode throws
        await act.Should().ThrowAsync<HttpRequestException>();
    }

    // -------------------------------------------------------------------------
    // Test 3: Count endpoint returns 500
    // -------------------------------------------------------------------------
    [Fact]
    public async Task ImportAsync_CountEndpointReturns500_ThrowsHttpRequestException()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var handler = new SequencedHttpMessageHandler(new[]
        {
            new SequencedResponse(HttpStatusCode.InternalServerError, "Internal Server Error")
        });

        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://edits.nationalmap.gov/") };
        var importer = new PadUsBoundaryImporter(context, httpClient);

        // Act
        var act = () => importer.ImportAsync();

        // Assert — EnsureSuccessStatusCode throws on 500
        await act.Should().ThrowAsync<HttpRequestException>();
    }

    // -------------------------------------------------------------------------
    // Test 4: Features endpoint returns 500 (count succeeds)
    // -------------------------------------------------------------------------
    [Fact]
    public async Task ImportAsync_FeaturesEndpointReturns500_ThrowsHttpRequestException()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var countResponse = JsonSerializer.Serialize(new { count = 1 });

        var handler = new SequencedHttpMessageHandler(new[]
        {
            new SequencedResponse(HttpStatusCode.OK, countResponse),
            new SequencedResponse(HttpStatusCode.InternalServerError, "Internal Server Error")
        });

        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://edits.nationalmap.gov/") };
        var importer = new PadUsBoundaryImporter(context, httpClient);

        // Act
        var act = () => importer.ImportAsync();

        // Assert — 500 on features endpoint throws after count succeeds
        await act.Should().ThrowAsync<HttpRequestException>();
    }

    // -------------------------------------------------------------------------
    // Test 5: Malformed JSON from count endpoint
    // -------------------------------------------------------------------------
    [Fact]
    public async Task ImportAsync_CountReturnsInvalidJson_ThrowsJsonException()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var handler = new SequencedHttpMessageHandler(new[]
        {
            new SequencedResponse(HttpStatusCode.OK, "{ this is not valid json }")
        });

        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://edits.nationalmap.gov/") };
        var importer = new PadUsBoundaryImporter(context, httpClient);

        // Act
        var act = () => importer.ImportAsync();

        // Assert — JsonDocument.ParseAsync throws on malformed JSON
        await act.Should().ThrowAsync<JsonException>();
    }

    // -------------------------------------------------------------------------
    // Test 6: Empty features array — 0 imported, no crash
    // -------------------------------------------------------------------------
    [Fact]
    public async Task ImportAsync_FeaturesReturnsEmptyArray_ImportsZeroWithoutError()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var countResponse = JsonSerializer.Serialize(new { count = 0 });
        var featuresResponse = JsonSerializer.Serialize(new { features = Array.Empty<object>() });

        var handler = new SequencedHttpMessageHandler(new[]
        {
            new SequencedResponse(HttpStatusCode.OK, countResponse),
            new SequencedResponse(HttpStatusCode.OK, featuresResponse)
        });

        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://edits.nationalmap.gov/") };
        var importer = new PadUsBoundaryImporter(context, httpClient);

        // Act
        var (imported, skipped, merged) = await importer.ImportAsync();

        // Assert
        imported.Should().Be(0);
        skipped.Should().Be(0);
        merged.Should().Be(0);

        var boundaries = await context.ParkBoundaries.ToListAsync();
        boundaries.Should().BeEmpty();
    }

    // -------------------------------------------------------------------------
    // Test 7: Request timeout — OperationCanceledException is thrown
    // -------------------------------------------------------------------------
    [Fact]
    public async Task ImportAsync_RequestTimesOut_ThrowsOperationCanceledException()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // HangingHttpMessageHandler delays indefinitely; set a very short client timeout
        var handler = new HangingHttpMessageHandler();
        var httpClient = new HttpClient(handler)
        {
            BaseAddress = new Uri("https://edits.nationalmap.gov/"),
            Timeout = TimeSpan.FromMilliseconds(50)
        };

        var importer = new PadUsBoundaryImporter(context, httpClient);

        // Act
        var act = () => importer.ImportAsync();

        // Assert — HttpClient wraps the cancellation as TaskCanceledException (derives from OperationCanceledException)
        await act.Should().ThrowAsync<OperationCanceledException>();
    }
}

// =============================================================================
// Test helpers
// =============================================================================

/// <summary>
/// Returns pre-configured responses in sequence for each SendAsync call.
/// Throws InvalidOperationException if more calls are made than responses configured.
/// </summary>
internal class SequencedHttpMessageHandler : HttpMessageHandler
{
    private readonly IReadOnlyList<SequencedResponse> _responses;
    private int _callCount = 0;

    public int CallCount => _callCount;

    public SequencedHttpMessageHandler(IEnumerable<SequencedResponse> responses)
    {
        _responses = responses.ToList();
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var index = Interlocked.Increment(ref _callCount) - 1;

        if (index >= _responses.Count)
            throw new InvalidOperationException(
                $"SequencedHttpMessageHandler received call #{index + 1} but only {_responses.Count} response(s) were configured.");

        var response = _responses[index];
        var message = new HttpResponseMessage(response.StatusCode)
        {
            Content = new StringContent(response.Body, System.Text.Encoding.UTF8, "application/json")
        };

        return Task.FromResult(message);
    }
}

/// <summary>
/// A single pre-configured HTTP response for use with SequencedHttpMessageHandler.
/// </summary>
internal record SequencedResponse(HttpStatusCode StatusCode, string Body);

/// <summary>
/// Delays indefinitely to simulate a request timeout.
/// Respects cancellation so that HttpClient's Timeout can cancel the delay.
/// </summary>
internal class HangingHttpMessageHandler : HttpMessageHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        await Task.Delay(Timeout.Infinite, cancellationToken);
        // Unreachable — Task.Delay with cancellationToken throws OperationCanceledException
        return new HttpResponseMessage(HttpStatusCode.OK);
    }
}
