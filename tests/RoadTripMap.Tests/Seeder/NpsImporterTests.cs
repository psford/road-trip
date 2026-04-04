using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.PoiSeeder.Importers;
using Xunit;

namespace RoadTripMap.Tests.Seeder;

public class NpsImporterTests
{
    private RoadTripDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new RoadTripDbContext(options);
    }

    [Fact]
    public async Task ImportAsync_WithValidNpsData_CreatesPoisWithCorrectProperties()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var httpHandler = new NpsImporterMockHttpHandler(new[]
        {
            new NpsParkData { FullName = "Grand Canyon National Park", ParkCode = "grca", LatLong = "lat:36.1069, long:-112.1129" },
            new NpsParkData { FullName = "Yellowstone National Park", ParkCode = "yell", LatLong = "lat:44.4280, long:-110.5885" },
            new NpsParkData { FullName = "Yosemite National Park", ParkCode = "yose", LatLong = "lat:37.8651, long:-119.5383" }
        });
        var httpClient = new HttpClient(httpHandler);
        var importer = new NpsImporter(httpClient, context);

        // Act
        var result = await importer.ImportAsync("test-api-key");

        // Assert
        result.ProcessedCount.Should().Be(3);
        result.SkippedCount.Should().Be(0);

        var pois = await context.PointsOfInterest.ToListAsync();
        pois.Should().HaveCount(3);

        var grandCanyon = pois.First(p => p.SourceId == "grca");
        grandCanyon.Name.Should().Be("Grand Canyon National Park");
        grandCanyon.Category.Should().Be("national_park");
        grandCanyon.Source.Should().Be("nps");
        grandCanyon.Latitude.Should().Be(36.1069);
        grandCanyon.Longitude.Should().Be(-112.1129);
    }

    [Fact]
    public async Task ImportAsync_WithMissingCoordinates_SkipsEntry()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var httpHandler = new NpsImporterMockHttpHandler(new[]
        {
            new NpsParkData { FullName = "Valid Park", ParkCode = "vald", LatLong = "lat:36.1069, long:-112.1129" },
            new NpsParkData { FullName = "Invalid Park", ParkCode = "invl", LatLong = "" } // Invalid
        });
        var httpClient = new HttpClient(httpHandler);
        var importer = new NpsImporter(httpClient, context);

        // Act
        var result = await importer.ImportAsync("test-api-key");

        // Assert
        result.ProcessedCount.Should().Be(1);
        result.SkippedCount.Should().Be(1);
        var pois = await context.PointsOfInterest.ToListAsync();
        pois.Should().HaveCount(1);
    }

    [Fact]
    public async Task ImportAsync_WithDuplicateSourceId_UpdatesExisting()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        // Pre-populate with existing POI
        var existingPoi = new RoadTripMap.Entities.PoiEntity
        {
            Name = "Old Name",
            Category = "national_park",
            Latitude = 0,
            Longitude = 0,
            Source = "nps",
            SourceId = "grca"
        };
        context.PointsOfInterest.Add(existingPoi);
        await context.SaveChangesAsync();

        var httpHandler = new NpsImporterMockHttpHandler(new[]
        {
            new NpsParkData { FullName = "Updated Name", ParkCode = "grca", LatLong = "lat:36.1069, long:-112.1129" }
        });
        var httpClient = new HttpClient(httpHandler);
        var importer = new NpsImporter(httpClient, context);

        // Act
        var result = await importer.ImportAsync("test-api-key");

        // Assert
        result.ProcessedCount.Should().Be(1);
        var pois = await context.PointsOfInterest.ToListAsync();
        pois.Should().HaveCount(1);
        pois[0].Name.Should().Be("Updated Name");
        pois[0].Latitude.Should().Be(36.1069);
    }

    [Fact]
    public async Task ImportAsync_WithoutApiKey_ReturnsErrorResult()
    {
        // Arrange
        using var context = CreateInMemoryContext();

        var httpHandler = new NpsImporterMockHttpHandler(Array.Empty<NpsParkData>());
        var httpClient = new HttpClient(httpHandler);
        var importer = new NpsImporter(httpClient, context);

        // Act
        var result = await importer.ImportAsync(string.Empty);

        // Assert
        result.SkippedCount.Should().Be(-1); // Indicates API key missing
    }
}

public class NpsImporterMockHttpHandler : HttpMessageHandler
{
    private readonly NpsParkData[] _parkData;

    public NpsImporterMockHttpHandler(NpsParkData[] parkData)
    {
        _parkData = parkData;
    }

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        // Build response in NPS API format
        var response = new
        {
            total = _parkData.Length,
            data = _parkData.Select(p => new
            {
                fullName = p.FullName,
                parkCode = p.ParkCode,
                latLong = p.LatLong,
                designation = "National Park"
            }).ToArray()
        };

        var content = new StringContent(
            JsonSerializer.Serialize(response),
            System.Text.Encoding.UTF8,
            "application/json");

        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = content
        });
    }
}

public class NpsParkData
{
    public string FullName { get; set; } = string.Empty;
    public string ParkCode { get; set; } = string.Empty;
    public string LatLong { get; set; } = string.Empty;
}
