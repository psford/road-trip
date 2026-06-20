using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using RoadTripMap;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Models;

namespace RoadTripMap.Tests.Endpoints;

/// <summary>
/// HTTP-layer tests for the read-only view endpoint's photo filtering.
/// The public view page (trips.html) must only show committed photos — the same
/// filter the native/app read path applies (PhotoReadService) — so an in-flight
/// or failed upload never surfaces as a broken image on a shared link.
/// </summary>
[Collection("EndpointRegistry")]
public class TripViewPhotoStatusTests : IAsyncLifetime
{
    private WebApplicationFactory<Program>? _factory;
    private HttpClient? _client;
    private SqliteConnection? _connection;
    private string _viewToken = null!;
    private int _committedPhotoId;
    private int _pendingPhotoId;

    public async Task InitializeAsync()
    {
        Environment.SetEnvironmentVariable("WSL_SQL_CONNECTION", "Data Source=:memory:");
        Environment.SetEnvironmentVariable("RT_DESIGN_CONNECTION", "Data Source=:memory:");
        Environment.SetEnvironmentVariable("NPS_API_KEY", "test-key");
        EndpointRegistry.OverrideFilePath = null;
        EndpointRegistry.Reset();

        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        _factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.ConfigureServices(services =>
                {
                    var descriptor = services.SingleOrDefault(
                        d => d.ServiceType == typeof(DbContextOptions<RoadTripDbContext>));
                    if (descriptor != null) services.Remove(descriptor);
                    services.AddDbContext<RoadTripDbContext>(o => o.UseSqlite(_connection));
                });
            });

        _client = _factory.CreateClient();

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RoadTripDbContext>();
        await db.Database.EnsureCreatedAsync();

        _viewToken = Guid.NewGuid().ToString();
        var trip = new TripEntity
        {
            Slug = "view-status-trip",
            Name = "View Status Trip",
            SecretToken = Guid.NewGuid().ToString(),
            ViewToken = _viewToken,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
        };
        db.Trips.Add(trip);
        await db.SaveChangesAsync();

        var committed = new PhotoEntity
        {
            TripId = trip.Id,
            BlobPath = "1/1.jpg",
            Latitude = 40.0,
            Longitude = -74.0,
            PlaceName = "Committed Place",
            TakenAt = DateTime.UtcNow.AddHours(-1),
            CreatedAt = DateTime.UtcNow,
            Status = "committed",
            StorageTier = "legacy",
            UploadId = Guid.NewGuid(),
        };
        var pending = new PhotoEntity
        {
            TripId = trip.Id,
            BlobPath = "1/2.jpg",
            Latitude = 41.0,
            Longitude = -75.0,
            PlaceName = "Pending Place",
            TakenAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow,
            Status = "pending",
            StorageTier = "legacy",
            UploadId = Guid.NewGuid(),
        };
        db.Photos.AddRange(committed, pending);
        await db.SaveChangesAsync();
        _committedPhotoId = committed.Id;
        _pendingPhotoId = pending.Id;
    }

    public async Task DisposeAsync()
    {
        _client?.Dispose();
        if (_factory != null) await _factory.DisposeAsync();
        _connection?.Dispose();
    }

    [Fact]
    public async Task GetViewPhotos_ExcludesNonCommittedPhotos()
    {
        // Act — the public, read-only view photos endpoint
        var response = await _client!.GetAsync($"/api/trips/view/{_viewToken}/photos");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var photos = await response.Content.ReadFromJsonAsync<List<PhotoResponse>>();
        photos.Should().NotBeNull();

        // Only the committed photo should be returned; the pending (in-flight/failed)
        // upload must NOT surface on the shared view page as a broken image.
        photos!.Should().HaveCount(1);
        photos.Select(p => p.Id).Should().Contain(_committedPhotoId);
        photos.Select(p => p.Id).Should().NotContain(_pendingPhotoId);
    }
}
