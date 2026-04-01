using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Azure;
using RoadTripMap.Data;
using RoadTripMap.Entities;
using RoadTripMap.Helpers;
using RoadTripMap.Models;
using RoadTripMap.Services;

var builder = WebApplication.CreateBuilder(args);

// WSL_SQL_CONNECTION: TCP connection string for WSL2 development (from .env).
// Falls back to appsettings ConnectionStrings:DefaultConnection for Windows/production.
var connectionString = Environment.GetEnvironmentVariable("WSL_SQL_CONNECTION")
    ?? builder.Configuration.GetConnectionString("DefaultConnection");
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

builder.Services.AddSingleton<UploadRateLimiter>();
builder.Services.AddSingleton<INominatimRateLimiter, NominatimRateLimiter>();
builder.Services.AddScoped<IAuthStrategy, SecretTokenAuthStrategy>();
builder.Services.AddScoped<IPhotoService, PhotoService>();
builder.Services.AddHttpClient<NominatimGeocodingService>();
builder.Services.AddScoped<IGeocodingService, NominatimGeocodingService>();

var app = builder.Build();

// Apply pending migrations on startup (skip for non-relational providers like SQLite in tests)
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<RoadTripDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        if (db.Database.IsSqlServer())
        {
            db.Database.Migrate();
            logger.LogInformation("Database migration completed successfully");
        }
        else
        {
            db.Database.EnsureCreated();
            logger.LogInformation("Database created (non-SQL Server provider)");
        }
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Database setup failed");
        throw;
    }
}

// CORS not needed for Phase 1 — frontend served same-origin.
// If native apps need cross-origin API access later, add CORS policy here.

// Global exception handler middleware (returns 500 with generic error message, no stack trace)
app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (Exception ex)
    {
        var logger = context.RequestServices.GetRequiredService<ILogger<Program>>();
        logger.LogError(ex, "Unhandled exception on {Method} {Path}",
            context.Request.Method, context.Request.Path);
        context.Response.StatusCode = 500;
        await context.Response.WriteAsJsonAsync(new { error = "An unexpected error occurred" });
    }
});

// Security headers middleware (belt-and-suspenders with robots.txt and meta tags)
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    await next();
});

app.UseDefaultFiles();
app.UseStaticFiles();


app.MapGet("/api/health", () => Results.Ok(new { status = "healthy" }));

app.MapGet("/api/geocode", async (double? lat, double? lng, IGeocodingService geocodingService) =>
{
    // Validate lat/lng parameters
    if (!lat.HasValue || !lng.HasValue)
        return Results.BadRequest(new { error = "Invalid coordinates" });

    // Validate coordinate ranges
    if (lat < -90 || lat > 90)
        return Results.BadRequest(new { error = "Invalid coordinates: latitude must be between -90 and 90" });
    if (lng < -180 || lng > 180)
        return Results.BadRequest(new { error = "Invalid coordinates: longitude must be between -180 and 180" });

    // Call geocoding service
    var placeName = await geocodingService.ReverseGeocodeAsync(lat.Value, lng.Value);

    return Results.Ok(new { placeName });
});

app.MapGet("/create", () => Results.File("create.html", "text/html"));

app.MapGet("/post/{secretToken}", () => Results.File("post.html", "text/html"));

app.MapGet("/trips/{viewToken}", () => Results.File("trips.html", "text/html"));

app.MapGet("/api/trips/view/{viewToken}", async (string viewToken, RoadTripDbContext db) =>
{
    // Validate view token format (UUID)
    if (!Guid.TryParse(viewToken, out _))
        return Results.BadRequest(new { error = "Invalid view token format" });

    // Find trip by view token where IsActive == true
    var trip = await db.Trips.FirstOrDefaultAsync(t => t.ViewToken == viewToken && t.IsActive);
    if (trip == null)
        return Results.NotFound(new { error = "Trip not found" });

    // Count photos
    var photoCount = await db.Photos.CountAsync(p => p.TripId == trip.Id);

    // Return TripResponse
    var response = new TripResponse
    {
        Name = trip.Name,
        Description = trip.Description,
        PhotoCount = photoCount,
        CreatedAt = trip.CreatedAt
    };

    return Results.Ok(response);
});

app.MapGet("/api/trips/view/{viewToken}/photos", async (string viewToken, RoadTripDbContext db) =>
{
    // Validate view token format (UUID)
    if (!Guid.TryParse(viewToken, out _))
        return Results.BadRequest(new { error = "Invalid view token format" });

    // Find trip by view token where IsActive == true
    var trip = await db.Trips.FirstOrDefaultAsync(t => t.ViewToken == viewToken && t.IsActive);
    if (trip == null)
        return Results.NotFound(new { error = "Trip not found" });

    // Query photos ordered by TakenAt ascending (chronological for route line)
    // Nulls sort last: OrderBy(p => p.TakenAt == null) returns false (0) for non-null, true (1) for null
    var photos = await db.Photos
        .Where(p => p.TripId == trip.Id)
        .OrderBy(p => p.TakenAt == null)
        .ThenBy(p => p.TakenAt)
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

    // Return empty array if no photos
    return Results.Ok(photos);
});

app.MapPost("/api/trips", async (CreateTripRequest request, RoadTripDbContext db) =>
{
    // Validate trip name
    if (string.IsNullOrWhiteSpace(request.Name))
        return Results.BadRequest(new { error = "Trip name is required" });

    // Validate trip name length
    if (request.Name.Length > 500)
        return Results.BadRequest(new { error = "Trip name must not exceed 500 characters" });

    // Generate unique slug
    var slug = await SlugHelper.GenerateUniqueSlugAsync(
        request.Name,
        async slug => await db.Trips.AnyAsync(t => t.Slug == slug)
    );

    // Generate tokens
    var secretToken = Guid.NewGuid().ToString();
    var viewToken = Guid.NewGuid().ToString();

    // Create and save trip
    var trip = new TripEntity
    {
        Slug = slug,
        Name = request.Name,
        Description = request.Description,
        SecretToken = secretToken,
        ViewToken = viewToken
    };

    db.Trips.Add(trip);
    await db.SaveChangesAsync();

    // Return response with URLs
    var response = new CreateTripResponse
    {
        Slug = slug,
        SecretToken = secretToken,
        ViewToken = viewToken,
        ViewUrl = $"/trips/{viewToken}",
        PostUrl = $"/post/{secretToken}"
    };

    return Results.Ok(response);
});

// POST /api/trips/{secretToken}/photos — Upload photo
app.MapPost("/api/trips/{secretToken}/photos", async (string secretToken, IFormFile file, [FromForm] double lat, [FromForm] double lng, [FromForm] string? caption, [FromForm] DateTime? takenAt, RoadTripDbContext db, IAuthStrategy authStrategy, IPhotoService photoService, IGeocodingService geocodingService, UploadRateLimiter rateLimiter, HttpContext context) =>
{
    // Check rate limit by IP address
    var ip = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    if (!rateLimiter.IsAllowed(ip))
        return Results.StatusCode(429);

    // Look up trip by secret token
    var trip = await db.Trips.FirstOrDefaultAsync(t => t.SecretToken == secretToken);
    if (trip == null)
        return Results.NotFound(new { error = "Trip not found" });

    // Validate auth
    var authResult = await authStrategy.ValidatePostAccess(context, trip);
    if (!authResult.IsAuthorized)
        return Results.Unauthorized();

    // Validate file content type
    if (!file.ContentType.StartsWith("image/"))
        return Results.BadRequest(new { error = "File must be an image" });

    // Validate file size (15MB = 15,728,640 bytes)
    const long maxFileSize = 15_728_640;
    if (file.Length > maxFileSize)
        return Results.BadRequest(new { error = "File must not exceed 15MB" });

    // Validate coordinates
    if (lat < -90 || lat > 90)
        return Results.BadRequest(new { error = "Invalid coordinates: latitude must be between -90 and 90" });
    if (lng < -180 || lng > 180)
        return Results.BadRequest(new { error = "Invalid coordinates: longitude must be between -180 and 180" });

    // Validate caption length if provided
    if (!string.IsNullOrEmpty(caption) && caption.Length > 1000)
        return Results.BadRequest(new { error = "Caption must not exceed 1000 characters" });

    // Create photo entity
    var photo = new RoadTripMap.Entities.PhotoEntity
    {
        TripId = trip.Id,
        Latitude = lat,
        Longitude = lng,
        Caption = caption,
        TakenAt = takenAt,
        PlaceName = null, // Will be set by geocoding
        BlobPath = "" // Placeholder, will be set after upload
    };

    db.Photos.Add(photo);
    await db.SaveChangesAsync();

    try
    {
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
    }
    catch
    {
        // If blob upload or subsequent processing fails, delete the orphaned DB record
        db.Photos.Remove(photo);
        await db.SaveChangesAsync();
        throw;
    }
}).DisableAntiforgery();

// GET /api/post/{secretToken} — Get trip info by secret token (for post page header)
app.MapGet("/api/post/{secretToken}", async (string secretToken, RoadTripDbContext db) =>
{
    var trip = await db.Trips.FirstOrDefaultAsync(t => t.SecretToken == secretToken);
    if (trip == null)
        return Results.NotFound(new { error = "Trip not found" });

    var photoCount = await db.Photos.CountAsync(p => p.TripId == trip.Id);

    return Results.Ok(new TripResponse
    {
        Name = trip.Name,
        Description = trip.Description,
        PhotoCount = photoCount,
        CreatedAt = trip.CreatedAt,
        ViewUrl = $"/trips/{trip.ViewToken}"
    });
});

// GET /api/post/{secretToken}/photos — Get photos for a trip (distinct from slug-based endpoint)
app.MapGet("/api/post/{secretToken}/photos", async (string secretToken, RoadTripDbContext db) =>
{
    // Look up trip by secret token
    var trip = await db.Trips.FirstOrDefaultAsync(t => t.SecretToken == secretToken);
    if (trip == null)
        return Results.NotFound(new { error = "Trip not found" });

    // Query photos, ordered by takenAt ascending (chronological)
    // Nulls sort last: OrderBy(p => p.TakenAt == null) returns false (0) for non-null, true (1) for null
    var photos = await db.Photos
        .Where(p => p.TripId == trip.Id)
        .OrderBy(p => p.TakenAt == null)
        .ThenBy(p => p.TakenAt)
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
app.MapDelete("/api/trips/{secretToken}/photos/{id:int}", async (string secretToken, int id, RoadTripDbContext db, IAuthStrategy authStrategy, IPhotoService photoService, HttpContext context) =>
{
    // Look up trip
    var trip = await db.Trips.FirstOrDefaultAsync(t => t.SecretToken == secretToken);
    if (trip == null)
        return Results.NotFound(new { error = "Trip not found" });

    // Validate auth
    var authResult = await authStrategy.ValidatePostAccess(context, trip);
    if (!authResult.IsAuthorized)
        return Results.Unauthorized();

    // Find photo
    var photo = await db.Photos.FirstOrDefaultAsync(p => p.Id == id && p.TripId == trip.Id);
    if (photo == null)
        return Results.NotFound(new { error = "Photo not found" });

    // Delete from blob storage
    await photoService.DeletePhotoAsync(photo.BlobPath);

    // Delete from database
    db.Photos.Remove(photo);
    await db.SaveChangesAsync();

    return Results.NoContent();
});

// PATCH /api/trips/{secretToken}/photos/{id}/location — Update photo location
app.MapPatch("/api/trips/{secretToken}/photos/{id:int}/location", async (string secretToken, int id, UpdateLocationRequest request, RoadTripDbContext db, IAuthStrategy authStrategy, IGeocodingService geocodingService, HttpContext context) =>
{
    var trip = await db.Trips.FirstOrDefaultAsync(t => t.SecretToken == secretToken);
    if (trip == null)
        return Results.NotFound(new { error = "Trip not found" });

    var authResult = await authStrategy.ValidatePostAccess(context, trip);
    if (!authResult.IsAuthorized)
        return Results.Unauthorized();

    if (request.Lat < -90 || request.Lat > 90)
        return Results.BadRequest(new { error = "Invalid coordinates: latitude must be between -90 and 90" });
    if (request.Lng < -180 || request.Lng > 180)
        return Results.BadRequest(new { error = "Invalid coordinates: longitude must be between -180 and 180" });

    var photo = await db.Photos.FirstOrDefaultAsync(p => p.Id == id && p.TripId == trip.Id);
    if (photo == null)
        return Results.NotFound(new { error = "Photo not found" });

    photo.Latitude = request.Lat;
    photo.Longitude = request.Lng;

    var placeName = await geocodingService.ReverseGeocodeAsync(request.Lat, request.Lng);
    photo.PlaceName = placeName ?? "Unknown location";

    await db.SaveChangesAsync();

    return Results.Ok(new PhotoResponse
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
    });
});

// GET /api/photos/{tripId}/{photoId}/{size} — Serve Photo
app.MapGet("/api/photos/{tripId:int}/{photoId:int}/{size}", async (int tripId, int photoId, string size, RoadTripDbContext db, IPhotoService photoService, HttpContext context) =>
{
    // Validate size parameter
    var validSizes = new[] { "original", "display", "thumb" };
    if (!validSizes.Contains(size))
        return Results.BadRequest(new { error = "Invalid size. Must be one of: original, display, thumb" });

    // Look up photo in database
    var photo = await db.Photos.FirstOrDefaultAsync(p => p.TripId == tripId && p.Id == photoId);
    if (photo == null)
        return Results.NotFound(new { error = "Photo not found" });

    // Get photo stream from blob storage using stored path
    var stream = await photoService.GetPhotoAsync(photo.BlobPath, size);

    // Photos are immutable — cache aggressively (1 year)
    context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
    return Results.File(stream, "image/jpeg");
});

app.Run();

// Make Program public for WebApplicationFactory in tests
public partial class Program { }
