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
builder.Services.AddHttpClient<NominatimGeocodingService>();
builder.Services.AddScoped<IGeocodingService, NominatimGeocodingService>();

var app = builder.Build();

// CORS not needed for Phase 1 — frontend served same-origin.
// If native apps need cross-origin API access later, add CORS policy here.

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/health", () => Results.Ok(new { status = "healthy" }));

app.MapGet("/api/geocode", async (double? lat, double? lng, IGeocodingService geocodingService) =>
{
    // Validate lat/lng parameters
    if (!lat.HasValue || !lng.HasValue)
        return Results.BadRequest(new { error = "Invalid coordinates" });

    // Call geocoding service
    var placeName = await geocodingService.ReverseGeocodeAsync(lat.Value, lng.Value);

    return Results.Ok(new { placeName });
});

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

// POST /api/trips/{secretToken}/photos — Upload photo
app.MapPost("/api/trips/{secretToken}/photos", async (string secretToken, IFormFile file, double lat, double lng, string? caption, DateTime? takenAt, RoadTripDbContext db, IAuthStrategy authStrategy, IPhotoService photoService, IGeocodingService geocodingService) =>
{
    // Look up trip by secret token
    var trip = await db.Trips.FirstOrDefaultAsync(t => t.SecretToken == secretToken);
    if (trip == null)
        return Results.NotFound(new { error = "Trip not found" });

    // Validate auth
    var authResult = await authStrategy.ValidatePostAccess(new DefaultHttpContext { Request = { RouteValues = new() { { "secretToken", secretToken } } } }, trip);
    if (!authResult.IsAuthorized)
        return Results.Unauthorized();

    // Validate file content type
    if (!file.ContentType.StartsWith("image/"))
        return Results.BadRequest(new { error = "File must be an image" });

    // Validate file size (15MB = 15,728,640 bytes)
    const long maxFileSize = 15_728_640;
    if (file.Length > maxFileSize)
        return Results.BadRequest(new { error = "File must not exceed 15MB" });

    // Create photo entity
    var photo = new RoadTripMap.Entities.PhotoEntity
    {
        TripId = trip.Id,
        Latitude = lat,
        Longitude = lng,
        Caption = caption,
        TakenAt = takenAt ?? DateTime.UtcNow,
        PlaceName = null, // Will be set by geocoding
        BlobPath = "" // Placeholder, will be set after upload
    };

    db.Photos.Add(photo);
    await db.SaveChangesAsync();

    // Process and upload photo
    using var fileStream = file.OpenReadStream();
    var uploadResult = await photoService.ProcessAndUploadAsync(fileStream, trip.Id, photo.Id, file.FileName);

    // Update photo blob path
    photo.BlobPath = uploadResult.BlobPath;

    // Reverse geocode location (AC2.3, AC2.9)
    if (lat == 0 && lng == 0)
    {
        // No GPS data — set to "Location not set"
        photo.PlaceName = "Location not set";
    }
    else
    {
        // Call geocoding service
        var placeName = await geocodingService.ReverseGeocodeAsync(lat, lng);
        photo.PlaceName = placeName ?? "Unknown location";
    }

    await db.SaveChangesAsync();

    // Return response
    var photoResponse = new PhotoResponse
    {
        Id = photo.Id,
        ThumbnailUrl = $"/api/photos/{trip.Id}/{photo.Id}/thumb",
        DisplayUrl = $"/api/photos/{trip.Id}/{photo.Id}/display",
        OriginalUrl = $"/api/photos/{trip.Id}/{photo.Id}/original",
        Lat = photo.Latitude,
        Lng = photo.Longitude,
        PlaceName = photo.PlaceName ?? "",
        Caption = photo.Caption,
        TakenAt = photo.TakenAt
    };

    return Results.Ok(photoResponse);
});

// GET /api/trips/{secretToken}/photos — Get photos for a trip
app.MapGet("/api/trips/{secretToken}/photos", async (string secretToken, RoadTripDbContext db) =>
{
    // Look up trip by secret token
    var trip = await db.Trips.FirstOrDefaultAsync(t => t.SecretToken == secretToken);
    if (trip == null)
        return Results.NotFound(new { error = "Trip not found" });

    // Query photos, ordered by most recent first
    var photos = await db.Photos
        .Where(p => p.TripId == trip.Id)
        .OrderByDescending(p => p.CreatedAt)
        .Select(p => new PhotoResponse
        {
            Id = p.Id,
            ThumbnailUrl = $"/api/photos/{trip.Id}/{p.Id}/thumb",
            DisplayUrl = $"/api/photos/{trip.Id}/{p.Id}/display",
            OriginalUrl = $"/api/photos/{trip.Id}/{p.Id}/original",
            Lat = p.Latitude,
            Lng = p.Longitude,
            PlaceName = p.PlaceName ?? "",
            Caption = p.Caption,
            TakenAt = p.TakenAt
        })
        .ToListAsync();

    return Results.Ok(photos);
});

// DELETE /api/trips/{secretToken}/photos/{id} — Delete photo
app.MapDelete("/api/trips/{secretToken}/photos/{id:int}", async (string secretToken, int id, RoadTripDbContext db, IAuthStrategy authStrategy, IPhotoService photoService) =>
{
    // Look up trip
    var trip = await db.Trips.FirstOrDefaultAsync(t => t.SecretToken == secretToken);
    if (trip == null)
        return Results.NotFound(new { error = "Trip not found" });

    // Validate auth
    var authResult = await authStrategy.ValidatePostAccess(new DefaultHttpContext { Request = { RouteValues = new() { { "secretToken", secretToken } } } }, trip);
    if (!authResult.IsAuthorized)
        return Results.Unauthorized();

    // Find photo
    var photo = await db.Photos.FirstOrDefaultAsync(p => p.Id == id && p.TripId == trip.Id);
    if (photo == null)
        return Results.NotFound(new { error = "Photo not found" });

    // Delete from blob storage
    await photoService.DeletePhotoAsync(trip.Id, photo.Id, photo.BlobPath);

    // Delete from database
    db.Photos.Remove(photo);
    await db.SaveChangesAsync();

    return Results.NoContent();
});

// GET /api/photos/{tripId}/{photoId}/{size} — Serve Photo
app.MapGet("/api/photos/{tripId:int}/{photoId:int}/{size}", async (int tripId, int photoId, string size, RoadTripDbContext db, IPhotoService photoService) =>
{
    // Validate size parameter
    var validSizes = new[] { "original", "display", "thumb" };
    if (!validSizes.Contains(size))
        return Results.BadRequest(new { error = "Invalid size. Must be one of: original, display, thumb" });

    // Look up photo in database
    var photo = await db.Photos.FirstOrDefaultAsync(p => p.TripId == tripId && p.Id == photoId);
    if (photo == null)
        return Results.NotFound(new { error = "Photo not found" });

    // Get photo stream from blob storage
    var stream = await photoService.GetPhotoAsync(tripId, photoId, size);

    // Return as JPEG image
    return Results.File(stream, "image/jpeg");
});

app.Run();
