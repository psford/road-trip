using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Azure;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Helpers;
using RoadTripMap.Models;
using RoadTripMap.Services;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
if (!string.IsNullOrEmpty(connectionString))
{
    builder.Services.AddDbContext<RoadTripDbContext>(options =>
        options.UseSqlServer(connectionString));
}

var storageConnectionString = builder.Configuration.GetConnectionString("AzureStorage");
if (!string.IsNullOrEmpty(storageConnectionString))
{
    builder.Services.AddAzureClients(clientBuilder =>
    {
        clientBuilder.AddBlobServiceClient(storageConnectionString);
    });
}

builder.Services.AddScoped<IAuthStrategy, SecretTokenAuthStrategy>();
builder.Services.AddScoped<IPhotoService, PhotoService>();

var app = builder.Build();

// CORS not needed for Phase 1 — frontend served same-origin.
// If native apps need cross-origin API access later, add CORS policy here.

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/health", () => Results.Ok(new { status = "healthy" }));

app.MapGet("/create", () => Results.File("wwwroot/create.html", "text/html"));

app.MapPost("/api/trips", async (CreateTripRequest request, RoadTripDbContext db) =>
{
    // Validate trip name
    if (string.IsNullOrWhiteSpace(request.Name))
        return Results.BadRequest(new { error = "Trip name is required" });

    // Generate unique slug
    var slug = await SlugHelper.GenerateUniqueSlugAsync(
        request.Name,
        async slug => await db.Trips.AnyAsync(t => t.Slug == slug)
    );

    // Generate secret token
    var secretToken = Guid.NewGuid().ToString();

    // Create and save trip
    var trip = new TripEntity
    {
        Slug = slug,
        Name = request.Name,
        Description = request.Description,
        SecretToken = secretToken
    };

    db.Trips.Add(trip);
    await db.SaveChangesAsync();

    // Return response with URLs
    var response = new CreateTripResponse
    {
        Slug = slug,
        SecretToken = secretToken,
        ViewUrl = $"/trips/{slug}",
        PostUrl = $"/post/{secretToken}"
    };

    return Results.Ok(response);
});

app.Run();
