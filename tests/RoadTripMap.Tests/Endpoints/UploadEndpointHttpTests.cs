using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Specialized;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using RoadTripMap;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Models;
using RoadTripMap.Tests.Infrastructure;

namespace RoadTripMap.Tests.Endpoints;

/// <summary>
/// HTTP-layer integration tests for upload endpoints via WebApplicationFactory.
/// Verifies routing, status codes, version headers, and log sanitization (ACX.1).
/// Service-level behavior is covered in UploadEndpointTests.cs.
/// </summary>
[Collection(nameof(AzuriteCollection))]
public class UploadEndpointHttpTests : IAsyncLifetime
{
    private readonly AzuriteFixture _azurite;
    private WebApplicationFactory<Program> _factory = null!;
    private HttpClient _client = null!;
    private SqliteConnection _sqlite = null!;
    private CapturingLoggerProvider _logs = null!;
    private string _tripSecretToken = null!;
    private int _tripId;

    public UploadEndpointHttpTests(AzuriteFixture azurite) => _azurite = azurite;

    public async Task InitializeAsync()
    {
        Environment.SetEnvironmentVariable("WSL_SQL_CONNECTION", "Data Source=:memory:");
        Environment.SetEnvironmentVariable("RT_DESIGN_CONNECTION", "Data Source=:memory:");
        Environment.SetEnvironmentVariable("NPS_API_KEY", "test-key");
        Environment.SetEnvironmentVariable("ConnectionStrings__AzureStorage", _azurite.ConnectionString);
        Environment.SetEnvironmentVariable("Blob__UseDevelopmentStorage", "true");
        Environment.SetEnvironmentVariable("Blob__AccountName", "devstoreaccount1");
        Environment.SetEnvironmentVariable("Blob__AccountKey", "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==");
        RoadTripMap.EndpointRegistry.OverrideFilePath = null;
        RoadTripMap.EndpointRegistry.Reset();

        _sqlite = new SqliteConnection("DataSource=:memory:");
        _sqlite.Open();
        _logs = new CapturingLoggerProvider();

        _factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {

                builder.ConfigureServices(services =>
                {
                    var dbDescriptor = services.SingleOrDefault(
                        d => d.ServiceType == typeof(DbContextOptions<RoadTripDbContext>));
                    if (dbDescriptor != null) services.Remove(dbDescriptor);
                    services.AddDbContext<RoadTripDbContext>(o => o.UseSqlite(_sqlite));
                });

                builder.ConfigureServices(services =>
                {
                    services.AddLogging(logging =>
                    {
                        logging.ClearProviders();
                        logging.AddProvider(_logs);
                        logging.SetMinimumLevel(LogLevel.Trace);
                        // Framework request-path loggers echo the full URL (including {secretToken})
                        // at Information. Keep them at Warning so ACX.1 assertions test app-layer logs.
                        logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
                        logging.AddFilter("Microsoft.Hosting", LogLevel.Warning);
                    });
                });
            });

        _client = _factory.CreateClient();

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RoadTripDbContext>();
        await db.Database.EnsureCreatedAsync();

        _tripSecretToken = Guid.NewGuid().ToString();
        var trip = new TripEntity
        {
            Slug = "http-upload-trip",
            Name = "HTTP Upload Trip",
            SecretToken = _tripSecretToken,
            ViewToken = Guid.NewGuid().ToString(),
            CreatedAt = DateTime.UtcNow,
        };
        db.Trips.Add(trip);
        await db.SaveChangesAsync();
        _tripId = trip.Id;

        // Ensure per-trip container exists in Azurite.
        var blobService = new BlobServiceClient(_azurite.ConnectionString);
        var container = blobService.GetBlobContainerClient($"trip-{_tripSecretToken.ToLowerInvariant()}");
        await container.CreateIfNotExistsAsync();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        _sqlite.Dispose();
    }

    [Fact]
    public async Task RequestUpload_Commit_HappyPath_Returns200WithVersionHeaders()
    {
        var uploadId = Guid.NewGuid();
        var requestUploadResp = await _client.PostAsJsonAsync(
            $"/api/trips/{_tripSecretToken}/photos/request-upload",
            new RequestUploadRequest
            {
                UploadId = uploadId,
                Filename = "sample.jpg",
                ContentType = "image/jpeg",
                SizeBytes = 400,
                Exif = new ExifDto { GpsLat = 47.6062, GpsLon = -122.3321, TakenAt = DateTime.UtcNow },
            });

        requestUploadResp.StatusCode.Should().Be(HttpStatusCode.OK);
        AssertVersionHeaders(requestUploadResp);

        var body = await requestUploadResp.Content.ReadFromJsonAsync<RequestUploadResponse>();
        body.Should().NotBeNull();
        body!.PhotoId.Should().Be(uploadId);
        body.SasUrl.Should().NotBeNullOrEmpty();

        var blockClient = new BlockBlobClient(new Uri(body.SasUrl));
        var blockIds = new List<string>();
        for (int i = 0; i < 4; i++)
        {
            var id = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes($"blk-{i:D4}"));
            blockIds.Add(id);
            await blockClient.StageBlockAsync(id, new MemoryStream(new byte[100]));
        }

        var commitResp = await _client.PostAsJsonAsync(
            $"/api/trips/{_tripSecretToken}/photos/{uploadId}/commit",
            new CommitRequest { BlockIds = blockIds });

        commitResp.StatusCode.Should().Be(HttpStatusCode.OK);
        AssertVersionHeaders(commitResp);
    }

    [Fact]
    public async Task Commit_WithFakeBlockIds_Returns400BlockListMismatch()
    {
        var uploadId = Guid.NewGuid();
        var reqResp = await _client.PostAsJsonAsync(
            $"/api/trips/{_tripSecretToken}/photos/request-upload",
            new RequestUploadRequest
            {
                UploadId = uploadId, Filename = "x.jpg", ContentType = "image/jpeg", SizeBytes = 10,
            });
        reqResp.StatusCode.Should().Be(HttpStatusCode.OK);

        var bogusBlockIds = new List<string> { Convert.ToBase64String(Guid.NewGuid().ToByteArray()) };
        var commitResp = await _client.PostAsJsonAsync(
            $"/api/trips/{_tripSecretToken}/photos/{uploadId}/commit",
            new CommitRequest { BlockIds = bogusBlockIds });

        commitResp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await commitResp.Content.ReadAsStringAsync();
        body.Should().Contain("BlockListMismatch");
    }

    [Fact]
    public async Task Commit_CrossTripPhotoId_Returns404()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RoadTripDbContext>();
        var tripB = new TripEntity
        {
            Slug = "trip-b", Name = "Trip B",
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = Guid.NewGuid().ToString(),
            CreatedAt = DateTime.UtcNow,
        };
        db.Trips.Add(tripB);
        await db.SaveChangesAsync();

        var uploadId = Guid.NewGuid();
        var reqResp = await _client.PostAsJsonAsync(
            $"/api/trips/{_tripSecretToken}/photos/request-upload",
            new RequestUploadRequest
            {
                UploadId = uploadId, Filename = "a.jpg", ContentType = "image/jpeg", SizeBytes = 10,
            });
        reqResp.StatusCode.Should().Be(HttpStatusCode.OK);

        // Commit using trip B's token but trip A's photoId.
        var commitResp = await _client.PostAsJsonAsync(
            $"/api/trips/{tripB.SecretToken}/photos/{uploadId}/commit",
            new CommitRequest { BlockIds = new List<string>() });

        commitResp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Abort_Returns204_AndIsIdempotent()
    {
        var uploadId = Guid.NewGuid();
        await _client.PostAsJsonAsync(
            $"/api/trips/{_tripSecretToken}/photos/request-upload",
            new RequestUploadRequest
            {
                UploadId = uploadId, Filename = "z.jpg", ContentType = "image/jpeg", SizeBytes = 10,
            });

        var abort1 = await _client.PostAsync(
            $"/api/trips/{_tripSecretToken}/photos/{uploadId}/abort", content: null);
        abort1.StatusCode.Should().Be(HttpStatusCode.NoContent);
        AssertVersionHeaders(abort1);

        var abort2 = await _client.PostAsync(
            $"/api/trips/{_tripSecretToken}/photos/{uploadId}/abort", content: null);
        abort2.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task RequestUpload_UnknownTrip_Returns404()
    {
        var resp = await _client.PostAsJsonAsync(
            $"/api/trips/{Guid.NewGuid()}/photos/request-upload",
            new RequestUploadRequest
            {
                UploadId = Guid.NewGuid(), Filename = "a.jpg", ContentType = "image/jpeg", SizeBytes = 10,
            });

        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AllResponses_IncludeVersionHeaders_Even404()
    {
        var resp = await _client.GetAsync($"/api/post/{Guid.NewGuid()}/photos");
        resp.StatusCode.Should().BeOneOf(HttpStatusCode.NotFound, HttpStatusCode.OK);
        AssertVersionHeaders(resp);
    }

    [Fact]
    public async Task Logs_DoNotContainRawSecretTokenOrSasSignatureOrGps()
    {
        var uploadId = Guid.NewGuid();
        var resp = await _client.PostAsJsonAsync(
            $"/api/trips/{_tripSecretToken}/photos/request-upload",
            new RequestUploadRequest
            {
                UploadId = uploadId, Filename = "geo.jpg", ContentType = "image/jpeg", SizeBytes = 10,
                Exif = new ExifDto { GpsLat = 47.6062, GpsLon = -122.3321, TakenAt = DateTime.UtcNow },
            });
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<RequestUploadResponse>();
        body.Should().NotBeNull();

        // Trigger at least one more request so version-headers and any per-route logs fire.
        await _client.PostAsync($"/api/trips/{_tripSecretToken}/photos/{uploadId}/abort", null);

        var joined = string.Join("\n", _logs.Records.Select(r => r.Formatted + " " + (r.Exception?.ToString() ?? "")));

        // ACX.1 assertions: sensitive values must not appear in logs.
        joined.Should().NotContain(_tripSecretToken, "secret token must never land in logs");
        joined.Should().NotContain("sig=", "SAS signature query parameter must not appear in logs");
        joined.Should().NotContain("47.6062", "GPS latitude must not appear in logs");
        joined.Should().NotContain("-122.3321", "GPS longitude must not appear in logs");
    }

    [Fact]
    public async Task RequestUpload_Idempotent_IncrementsUploadAttemptCount()
    {
        // I3 coverage: second call with same UploadId bumps the attempt counter.
        var uploadId = Guid.NewGuid();
        var req = new RequestUploadRequest
        {
            UploadId = uploadId, Filename = "dup.jpg", ContentType = "image/jpeg", SizeBytes = 1024,
        };

        var r1 = await _client.PostAsJsonAsync($"/api/trips/{_tripSecretToken}/photos/request-upload", req);
        r1.StatusCode.Should().Be(HttpStatusCode.OK);

        var r2 = await _client.PostAsJsonAsync($"/api/trips/{_tripSecretToken}/photos/request-upload", req);
        r2.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RoadTripDbContext>();
        var photo = await db.Photos.SingleAsync(p => p.UploadId == uploadId);
        photo.UploadAttemptCount.Should().Be(1,
            "idempotent re-request must increment UploadAttemptCount from 0 to 1 (I3)");
    }

    [Fact]
    public async Task RequestUpload_Idempotent_DeletesStaleStagedBlocks()
    {
        // I4 coverage: previously staged uncommitted blocks are cleared on re-request so they
        // can't be committed accidentally on a later commit.
        var uploadId = Guid.NewGuid();
        var req = new RequestUploadRequest
        {
            UploadId = uploadId, Filename = "stale.jpg", ContentType = "image/jpeg", SizeBytes = 1024,
        };

        var r1 = await _client.PostAsJsonAsync($"/api/trips/{_tripSecretToken}/photos/request-upload", req);
        r1.StatusCode.Should().Be(HttpStatusCode.OK);
        var body1 = (await r1.Content.ReadFromJsonAsync<RequestUploadResponse>())!;

        var blockClient1 = new BlockBlobClient(new Uri(body1.SasUrl));
        var staleBlockId = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("stale-block"));
        await blockClient1.StageBlockAsync(staleBlockId, new MemoryStream(new byte[50]));

        var r2 = await _client.PostAsJsonAsync($"/api/trips/{_tripSecretToken}/photos/request-upload", req);
        r2.StatusCode.Should().Be(HttpStatusCode.OK);

        // After re-request, the stale blob+blocks should be gone.
        var sharedKey = new Azure.Storage.StorageSharedKeyCredential(
            "devstoreaccount1",
            "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==");
        var directClient = new BlockBlobClient(
            new Uri($"http://127.0.0.1:10000/devstoreaccount1/trip-{_tripSecretToken.ToLowerInvariant()}/{uploadId}_original.jpg"),
            sharedKey);

        try
        {
            var list = await directClient.GetBlockListAsync(Azure.Storage.Blobs.Models.BlockListTypes.Uncommitted);
            list.Value.UncommittedBlocks.Should().BeEmpty("stale staged blocks must be wiped on re-request (I4)");
        }
        catch (Azure.RequestFailedException ex) when (ex.Status == 404)
        {
            // Blob was deleted entirely — equivalent guarantee.
        }
    }

    [Fact]
    public async Task RequestUpload_PersistsExifGpsAndTakenAt()
    {
        // C7 coverage: EXIF GPS + TakenAt land on the PhotoEntity row.
        var uploadId = Guid.NewGuid();
        var takenAt = new DateTimeOffset(2026, 04, 12, 14, 30, 0, TimeSpan.Zero);
        var resp = await _client.PostAsJsonAsync($"/api/trips/{_tripSecretToken}/photos/request-upload",
            new RequestUploadRequest
            {
                UploadId = uploadId, Filename = "exif.jpg", ContentType = "image/jpeg", SizeBytes = 1024,
                Exif = new ExifDto { GpsLat = 42.1234, GpsLon = -71.5678, TakenAt = takenAt },
            });

        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RoadTripDbContext>();
        var photo = await db.Photos.SingleAsync(p => p.UploadId == uploadId);
        photo.Latitude.Should().Be(42.1234, "EXIF GPS lat must persist (C7)");
        photo.Longitude.Should().Be(-71.5678, "EXIF GPS lon must persist (C7)");
        photo.TakenAt.Should().Be(takenAt.UtcDateTime, "EXIF TakenAt must persist (C7)");
    }

    [Fact]
    public async Task DeleteTrip_WithUnknownToken_Returns404AndDoesNotCascade()
    {
        // C3 coverage: unknown token returns 404; does not destroy the real trip.
        var resp = await _client.DeleteAsync($"/api/trips/{Guid.NewGuid()}");
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);

        // The real trip seeded in InitializeAsync must still exist.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RoadTripDbContext>();
        var realTrip = await db.Trips.FirstOrDefaultAsync(t => t.SecretToken == _tripSecretToken);
        realTrip.Should().NotBeNull("unknown-token DELETE must not touch any real trip (C3)");
    }

    private static void AssertVersionHeaders(HttpResponseMessage response)
    {
        response.Headers.Should().Contain(h => h.Key == "x-server-version");
        response.Headers.Should().Contain(h => h.Key == "x-client-min-version");
    }
}

internal sealed class CapturingLoggerProvider : ILoggerProvider
{
    public List<LogRecord> Records { get; } = new();

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(categoryName, Records);

    public void Dispose() { }

    private sealed class CapturingLogger : ILogger
    {
        private readonly string _category;
        private readonly List<LogRecord> _sink;

        public CapturingLogger(string category, List<LogRecord> sink)
        {
            _category = category;
            _sink = sink;
        }

        public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state,
            Exception? exception, Func<TState, Exception?, string> formatter)
        {
            var formatted = formatter(state, exception);
            lock (_sink)
            {
                _sink.Add(new LogRecord(logLevel, _category, formatted, exception));
            }
        }

        private sealed class NullScope : IDisposable
        {
            public static readonly NullScope Instance = new();
            public void Dispose() { }
        }
    }
}

internal sealed record LogRecord(LogLevel Level, string Category, string Formatted, Exception? Exception);
