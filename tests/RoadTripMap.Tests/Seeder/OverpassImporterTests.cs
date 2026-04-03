using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.PoiSeeder.Importers;
using Xunit;

namespace RoadTripMap.Tests.Seeder;

public class OverpassImporterTests
{
    private RoadTripDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<RoadTripDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new RoadTripDbContext(options);
    }

    [Fact]
    public async Task ImportAsync_WithValidTourismData_CreatesPoisWithCorrectCategory()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var httpHandler = new OverpassMockHttpHandler(
            tourismElements: new[]
            {
                new OverpassElement { Id = 123, Name = "Statue of Liberty", Lat = 40.6892, Lon = -74.0445 },
                new OverpassElement { Id = 124, Name = "Empire State Building", Lat = 40.7484, Lon = -73.9857 }
            },
            historicElements: Array.Empty<OverpassElement>(),
            naturalElements: Array.Empty<OverpassElement>(),
            natureReserveElements: Array.Empty<OverpassElement>()
        );
        var httpClient = new HttpClient(httpHandler);
        var importer = new OverpassImporter(httpClient, context);

        // Act
        var result = await importer.ImportAsync();

        // Assert
        result.ProcessedCount.Should().Be(2);
        result.SkippedCount.Should().Be(0);

        var pois = await context.PointsOfInterest.ToListAsync();
        pois.Should().HaveCount(2);

        var statue = pois.First(p => p.SourceId == "123");
        statue.Name.Should().Be("Statue of Liberty");
        statue.Category.Should().Be("tourism");
        statue.Source.Should().Be("osm");
        statue.Latitude.Should().Be(40.6892);
        statue.Longitude.Should().Be(-74.0445);
    }

    [Fact]
    public async Task ImportAsync_WithHistoricData_CreatesPoisWithHistoricSiteCategory()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var httpHandler = new OverpassMockHttpHandler(
            tourismElements: Array.Empty<OverpassElement>(),
            historicElements: new[]
            {
                new OverpassElement { Id = 200, Name = "Fort Sumter", Lat = 32.7616, Lon = -79.8711 }
            },
            naturalElements: Array.Empty<OverpassElement>(),
            natureReserveElements: Array.Empty<OverpassElement>()
        );
        var httpClient = new HttpClient(httpHandler);
        var importer = new OverpassImporter(httpClient, context);

        // Act
        var result = await importer.ImportAsync();

        // Assert
        result.ProcessedCount.Should().Be(1);

        var pois = await context.PointsOfInterest.ToListAsync();
        var fortSumter = pois.First(p => p.SourceId == "200");
        fortSumter.Category.Should().Be("historic_site");
    }

    [Fact]
    public async Task ImportAsync_WithNaturalFeatures_CreatesPoisWithNaturalFeatureCategory()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var httpHandler = new OverpassMockHttpHandler(
            tourismElements: Array.Empty<OverpassElement>(),
            historicElements: Array.Empty<OverpassElement>(),
            naturalElements: new[]
            {
                new OverpassElement { Id = 300, Name = "Niagara Falls", Lat = 43.0896, Lon = -79.0849 }
            },
            natureReserveElements: Array.Empty<OverpassElement>()
        );
        var httpClient = new HttpClient(httpHandler);
        var importer = new OverpassImporter(httpClient, context);

        // Act
        var result = await importer.ImportAsync();

        // Assert
        result.ProcessedCount.Should().Be(1);

        var pois = await context.PointsOfInterest.ToListAsync();
        var niagara = pois.First(p => p.SourceId == "300");
        niagara.Category.Should().Be("natural_feature");
    }

    [Fact]
    public async Task ImportAsync_WithNatureReserve_CreatesPoisWithNaturalFeatureCategory()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var httpHandler = new OverpassMockHttpHandler(
            tourismElements: Array.Empty<OverpassElement>(),
            historicElements: Array.Empty<OverpassElement>(),
            naturalElements: Array.Empty<OverpassElement>(),
            natureReserveElements: new[]
            {
                new OverpassElement { Id = 400, Name = "Wildlife Refuge", Lat = 42.5, Lon = -75.0 }
            }
        );
        var httpClient = new HttpClient(httpHandler);
        var importer = new OverpassImporter(httpClient, context);

        // Act
        var result = await importer.ImportAsync();

        // Assert
        result.ProcessedCount.Should().Be(1);

        var pois = await context.PointsOfInterest.ToListAsync();
        var refuge = pois.First(p => p.SourceId == "400");
        refuge.Category.Should().Be("natural_feature");
    }

    [Fact]
    public async Task ImportAsync_WithUnnamedElement_SkipsElement()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var httpHandler = new OverpassMockHttpHandler(
            tourismElements: new[]
            {
                new OverpassElement { Id = 500, Name = null, Lat = 40.0, Lon = -74.0 }, // No name
                new OverpassElement { Id = 501, Name = "Valid POI", Lat = 40.1, Lon = -74.1 }
            },
            historicElements: Array.Empty<OverpassElement>(),
            naturalElements: Array.Empty<OverpassElement>(),
            natureReserveElements: Array.Empty<OverpassElement>()
        );
        var httpClient = new HttpClient(httpHandler);
        var importer = new OverpassImporter(httpClient, context);

        // Act
        var result = await importer.ImportAsync();

        // Assert
        result.ProcessedCount.Should().Be(1);
        result.SkippedCount.Should().Be(1);

        var pois = await context.PointsOfInterest.ToListAsync();
        pois.Should().HaveCount(1);
        pois[0].Name.Should().Be("Valid POI");
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
            Category = "tourism",
            Latitude = 0,
            Longitude = 0,
            Source = "osm",
            SourceId = "600"
        };
        context.PointsOfInterest.Add(existingPoi);
        await context.SaveChangesAsync();

        var httpHandler = new OverpassMockHttpHandler(
            tourismElements: new[]
            {
                new OverpassElement { Id = 600, Name = "Updated Name", Lat = 40.5, Lon = -74.5 }
            },
            historicElements: Array.Empty<OverpassElement>(),
            naturalElements: Array.Empty<OverpassElement>(),
            natureReserveElements: Array.Empty<OverpassElement>()
        );
        var httpClient = new HttpClient(httpHandler);
        var importer = new OverpassImporter(httpClient, context);

        // Act
        var result = await importer.ImportAsync();

        // Assert
        result.ProcessedCount.Should().Be(1);

        var pois = await context.PointsOfInterest.ToListAsync();
        pois.Should().HaveCount(1);
        pois[0].Name.Should().Be("Updated Name");
        pois[0].Latitude.Should().Be(40.5);
        pois[0].Longitude.Should().Be(-74.5);
    }

    [Fact]
    public async Task ImportAsync_WithMultipleSources_CreatesAllPois()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var httpHandler = new OverpassMockHttpHandler(
            tourismElements: new[] { new OverpassElement { Id = 1001, Name = "Museum", Lat = 40.0, Lon = -74.0 } },
            historicElements: new[] { new OverpassElement { Id = 2001, Name = "Memorial", Lat = 41.0, Lon = -75.0 } },
            naturalElements: new[] { new OverpassElement { Id = 3001, Name = "Peak", Lat = 42.0, Lon = -76.0 } },
            natureReserveElements: new[] { new OverpassElement { Id = 4001, Name = "Reserve", Lat = 43.0, Lon = -77.0 } }
        );
        var httpClient = new HttpClient(httpHandler);
        var importer = new OverpassImporter(httpClient, context);

        // Act
        var result = await importer.ImportAsync();

        // Assert
        result.ProcessedCount.Should().Be(4);

        var pois = await context.PointsOfInterest.ToListAsync();
        pois.Should().HaveCount(4);
        pois.Should().Contain(p => p.Category == "tourism");
        pois.Should().Contain(p => p.Category == "historic_site");
        pois.Should().Contain(p => p.Category == "natural_feature");
    }
}

public class OverpassMockHttpHandler : HttpMessageHandler
{
    private readonly OverpassElement[] _tourismElements;
    private readonly OverpassElement[] _historicElements;
    private readonly OverpassElement[] _naturalElements;
    private readonly OverpassElement[] _natureReserveElements;
    private int _queryCount = 0;

    public OverpassMockHttpHandler(
        OverpassElement[] tourismElements,
        OverpassElement[] historicElements,
        OverpassElement[] naturalElements,
        OverpassElement[] natureReserveElements)
    {
        _tourismElements = tourismElements;
        _historicElements = historicElements;
        _naturalElements = naturalElements;
        _natureReserveElements = natureReserveElements;
    }

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var elements = _queryCount switch
        {
            0 => _tourismElements,
            1 => _historicElements,
            2 => _naturalElements,
            3 => _natureReserveElements,
            _ => Array.Empty<OverpassElement>()
        };

        _queryCount++;

        var elementDtos = elements.Select(e =>
        {
            var tags = e.Name != null ? new Dictionary<string, string> { { "name", e.Name } } : new Dictionary<string, string>();
            return new
            {
                type = "node",
                id = e.Id,
                lat = e.Lat,
                lon = e.Lon,
                tags = tags
            };
        }).ToArray();

        var response = new { elements = elementDtos };

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

public class OverpassElement
{
    public long Id { get; set; }
    public string? Name { get; set; }
    public double Lat { get; set; }
    public double Lon { get; set; }
}
