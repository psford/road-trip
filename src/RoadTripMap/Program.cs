using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Azure;
using RoadTripMap;
using RoadTripMap.BackgroundJobs;
using RoadTripMap.Data;
using RoadTripMap.Endpoints;
using RoadTripMap.Entities;
using RoadTripMap.Helpers;
using RoadTripMap.Models;
using RoadTripMap.Services;
using RoadTripMap.Versioning;

var builder = WebApplication.CreateBuilder(args);

var connectionString = EndpointRegistry.Resolve("database");
builder.Services.AddDbContext<RoadTripDbContext>(options =>
    options.UseSqlServer(connectionString));

var useDevelopmentStorage = builder.Configuration.GetValue<bool>("Blob:UseDevelopmentStorage");
var storageConnectionString = builder.Configuration.GetConnectionString("AzureStorage");

if (useDevelopmentStorage)
{
    // Dev/Azurite: connection string with account key (Azurite doesn't support MSI)
    storageConnectionString ??= EndpointRegistry.Resolve("blobStorage");
    builder.Services.AddAzureClients(clientBuilder =>
    {
        clientBuilder.AddBlobServiceClient(storageConnectionString);
    });

    var accountName = builder.Configuration.GetValue<string>("Blob:AccountName");
    var accountKey = builder.Configuration.GetValue<string>("Blob:AccountKey");
    if (!string.IsNullOrEmpty(accountName) && !string.IsNullOrEmpty(accountKey))
    {
        builder.Services.AddSingleton(new Azure.Storage.StorageSharedKeyCredential(accountName, accountKey));
    }
}
else
{
    // Production: DefaultAzureCredential (App Service Managed Identity).
    // No account keys — MSI has Storage Blob Data Contributor on the storage account.
    // Required for UserDelegationSasIssuer.GetUserDelegationKeyAsync (OAuth only).
    var storageAccountName = builder.Configuration["Blob:AccountName"];
    if (!string.IsNullOrEmpty(storageAccountName))
    {
        var blobUri = new Uri($"https://{storageAccountName}.blob.core.windows.net");
        builder.Services.AddAzureClients(clientBuilder =>
        {
            clientBuilder.AddBlobServiceClient(blobUri);
            clientBuilder.UseCredential(new Azure.Identity.DefaultAzureCredential());
        });
    }
    else if (!string.IsNullOrEmpty(storageConnectionString))
    {
        // Fallback: connection string without dev storage flag (e.g. test environments).
        // Upload features requiring user delegation SAS will not work in this mode.
        builder.Services.AddAzureClients(clientBuilder =>
        {
            clientBuilder.AddBlobServiceClient(storageConnectionString);
        });
    }
    // If neither is set (some test configs), blob services are not registered.
    // Tests that don't exercise blob operations won't need them.
}

builder.Services.AddSingleton<UploadRateLimiter>();
builder.Services.AddSingleton<INominatimRateLimiter, NominatimRateLimiter>();
builder.Services.AddScoped<IAuthStrategy, SecretTokenAuthStrategy>();
builder.Services.AddScoped<IPhotoService, PhotoService>();
builder.Services.AddScoped<IPhotoReadService, PhotoReadService>();

// Upload service and SAS token issuance
builder.Services.AddScoped<IUploadService, UploadService>();
if (builder.Configuration.GetValue<bool>("Blob:UseDevelopmentStorage"))
    builder.Services.AddScoped<ISasTokenIssuer, AccountKeySasIssuer>();
else
    builder.Services.AddScoped<ISasTokenIssuer, UserDelegationSasIssuer>();
builder.Services.Configure<UploadOptions>(builder.Configuration.GetSection("Upload"));

// Blob container provisioner for per-trip containers
builder.Services.AddScoped<IBlobContainerProvisioner, BlobContainerProvisioner>();

// Backfill hosted service for provisioning containers on startup
if (builder.Configuration.GetValue<bool>("Backfill:RunOnStartup"))
{
    builder.Services.AddHostedService<ContainerBackfillHostedService>();
}

// Orphan sweeper background job - deletes stale pending photos
builder.Services.AddScoped<IOrphanSweeper, OrphanSweeper>();
builder.Services.AddHostedService<OrphanSweeperHostedService>();

builder.Services.AddHttpClient<NominatimGeocodingService>();
builder.Services.AddHttpClient("Overpass", c => {
    c.DefaultRequestHeaders.Add("User-Agent", "RoadTripMap/1.0");
    c.Timeout = TimeSpan.FromSeconds(20);
});
builder.Services.AddScoped<IGeocodingService, NominatimGeocodingService>();

var app = builder.Build();

// Initialize server version from configuration and assembly metadata
ServerVersion.Initialize(app.Configuration);

EndpointRegistry.ValidateAll();

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

// Correlation ID middleware — generates x-correlation-id header on each request
app.Use(async (context, next) =>
{
    var correlationId = context.Request.Headers["x-correlation-id"].FirstOrDefault() ?? Guid.NewGuid().ToString();
    context.Items["CorrelationId"] = correlationId;

    context.Response.OnStarting(() =>
    {
        context.Response.Headers["x-correlation-id"] = correlationId;
        return Task.CompletedTask;
    });

    await next();
});

// Version headers middleware — must be before exception handler so headers survive error path
app.Use(async (context, next) =>
{
    context.Response.OnStarting(() =>
    {
        context.Response.Headers["x-server-version"] = ServerVersion.Current;
        context.Response.Headers["x-client-min-version"] = ServerVersion.ClientMin;
        return Task.CompletedTask;
    });
    await next();
});

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
var contentTypeProvider = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
contentTypeProvider.Mappings[".geojson"] = "application/geo+json";
app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = contentTypeProvider });

// Middleware to inject feature flags into post.html before returning it.
// Only intercepts exact /post/{token} page requests (not /api/post/* routes).
app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value ?? "";
    var isPostPage = path.StartsWith("/post/", StringComparison.OrdinalIgnoreCase)
        && !path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase);

    if (isPostPage)
    {
        var originalBodyStream = context.Response.Body;
        var memoryStream = new MemoryStream();
        context.Response.Body = memoryStream;

        await next();

        memoryStream.Position = 0;
        var reader = new StreamReader(memoryStream);
        var content = await reader.ReadToEndAsync();

        // Inject feature flags into the meta tag
        var resilientUploadsUI = app.Configuration.GetValue<bool>("FeatureFlags:ResilientUploadsUI");
        content = content.Replace(
            """<meta id="featureFlags" data-resilient-uploads-ui="">""",
            $"""<meta id="featureFlags" data-resilient-uploads-ui="{resilientUploadsUI.ToString().ToLower()}">""");

        var bytes = System.Text.Encoding.UTF8.GetBytes(content);
        context.Response.ContentLength = bytes.Length;
        await originalBodyStream.WriteAsync(bytes, 0, bytes.Length);
        context.Response.Body = originalBodyStream;
    }
    else
    {
        await next();
    }
});

app.MapGet("/api/health", () => Results.Ok(new { status = "healthy" }));

app.MapGet("/api/version", () =>
    Results.Ok(new { server_version = ServerVersion.Current, client_min_version = ServerVersion.ClientMin }));

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

app.MapPost("/api/trips", async (CreateTripRequest request, RoadTripDbContext db, IBlobContainerProvisioner provisioner, ILogger<Program> logger, HttpContext context) =>
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

    // Provision per-trip blob container (after trip is saved; do NOT roll back trip row on provisioner failure)
    try
    {
        await provisioner.EnsureContainerAsync(secretToken, context.RequestAborted);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Failed to provision blob container for trip {trip_token_prefix}",
            RoadTripMap.Security.LogSanitizer.SanitizeToken(secretToken));
        // Return 500 but do not roll back the trip row
        return Results.StatusCode(500);
    }

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

// DELETE /api/trips/{secretToken} — Delete trip
app.MapDelete("/api/trips/{secretToken}", async (string secretToken, RoadTripDbContext db, IBlobContainerProvisioner provisioner, IPhotoService photoService, IAuthStrategy authStrategy, ILogger<Program> logger, HttpContext context) =>
{
    // Look up trip by secret token
    var trip = await db.Trips.FirstOrDefaultAsync(t => t.SecretToken == secretToken);
    if (trip == null)
        return Results.NotFound(new { error = "Trip not found" });

    // Validate auth
    var authResult = await authStrategy.ValidatePostAccess(context, trip);
    if (!authResult.IsAuthorized)
        return Results.Unauthorized();

    // Delete legacy blobs (existing code path)
    var legacyPhotos = await db.Photos.Where(p => p.TripId == trip.Id && p.StorageTier == "legacy").ToListAsync();
    foreach (var photo in legacyPhotos)
    {
        if (!string.IsNullOrEmpty(photo.BlobPath))
        {
            try
            {
                await photoService.DeletePhotoAsync(photo.BlobPath);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to delete legacy blob for photo {photo_id}", photo.Id);
            }
        }
    }

    // Delete per-trip container
    try
    {
        await provisioner.DeleteContainerAsync(secretToken, context.RequestAborted);
    }
    catch (Exception ex)
    {
        logger.LogWarning(ex, "Failed to delete blob container for trip {trip_token_prefix}",
            RoadTripMap.Security.LogSanitizer.SanitizeToken(secretToken));
    }

    // Delete trip and all associated photos
    db.Trips.Remove(trip);
    var allPhotos = await db.Photos.Where(p => p.TripId == trip.Id).ToListAsync();
    foreach (var photo in allPhotos)
    {
        db.Photos.Remove(photo);
    }

    await db.SaveChangesAsync();

    return Results.NoContent();
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
        BlobPath = "", // Placeholder, will be set after upload
        Status = "committed",
        StorageTier = "legacy"
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
app.MapGet("/api/post/{secretToken}/photos", async (string secretToken, IPhotoReadService photoReadService, HttpContext context) =>
{
    try
    {
        var photos = await photoReadService.GetPhotosForTripAsync(secretToken, context.RequestAborted);
        return Results.Ok(photos);
    }
    catch (KeyNotFoundException)
    {
        return Results.NotFound(new { error = "Trip not found" });
    }
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

    // Look up photo in database, including Trip details for per-trip storage tier resolution
    var photo = await db.Photos
        .Include(p => p.Trip)
        .FirstOrDefaultAsync(p => p.TripId == tripId && p.Id == photoId);
    if (photo == null)
        return Results.NotFound(new { error = "Photo not found" });

    // Get photo stream from blob storage, using storage tier to determine container
    var containerName = photo.StorageTier == "per-trip" ? $"trip-{photo.Trip!.SecretToken.ToLowerInvariant()}" : null;
    var stream = await photoService.GetPhotoAsync(photo.BlobPath, size, photo.StorageTier, containerName);

    // Photos are immutable — cache aggressively (1 year)
    context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
    return Results.File(stream, "image/jpeg");
});

// GET /api/poi — Get points of interest filtered by viewport and zoom level
app.MapGet("/api/poi", async (double? minLat, double? maxLat, double? minLng, double? maxLng, int? zoom, RoadTripDbContext db, IHttpClientFactory httpClientFactory) =>
{
    // Validate all 5 parameters are present
    if (!minLat.HasValue || !maxLat.HasValue || !minLng.HasValue || !maxLng.HasValue || !zoom.HasValue)
        return Results.BadRequest(new { error = "Missing required parameters: minLat, maxLat, minLng, maxLng, zoom" });

    // Validate latitude range
    if (minLat < -90 || minLat > 90 || maxLat < -90 || maxLat > 90)
        return Results.BadRequest(new { error = "Invalid coordinates: latitude must be between -90 and 90" });

    // Validate longitude range
    if (minLng < -180 || minLng > 180 || maxLng < -180 || maxLng > 180)
        return Results.BadRequest(new { error = "Invalid coordinates: longitude must be between -180 and 180" });

    // Validate zoom >= 0
    if (zoom < 0)
        return Results.BadRequest(new { error = "Invalid zoom level: zoom must be >= 0" });

    // National parks are rendered by the boundary polygon layer, not as POI dots
    var allowedCategories = zoom < 7
        ? Array.Empty<string>()
        : new[] { "state_park", "natural_feature", "historic_site", "tourism" };

    // Fetch candidates from DB
    var candidates = await db.PointsOfInterest
        .Where(p => p.Latitude >= minLat && p.Latitude <= maxLat && p.Longitude >= minLng && p.Longitude <= maxLng)
        .Where(p => allowedCategories.Contains(p.Category))
        .Select(p => new PoiResponse
        {
            Id = p.Id,
            Name = p.Name,
            Category = p.Category,
            Lat = p.Latitude,
            Lng = p.Longitude
        })
        .ToListAsync();

    // If DB has zero OSM data for this viewport, backfill from Overpass in real-time.
    // Only backfill if we have literally nothing — avoids re-querying on every pan.
    var hasOsmData = candidates.Any() || await db.PointsOfInterest
        .AnyAsync(p => p.Source == "osm" &&
            p.Latitude >= minLat && p.Latitude <= maxLat &&
            p.Longitude >= minLng && p.Longitude <= maxLng);
    if (!hasOsmData && zoom >= 8)
    {
        try
        {
            var overpassPois = await FetchOverpassForViewport(
                httpClientFactory, db,
                minLat.Value, maxLat.Value, minLng.Value, maxLng.Value);
            if (overpassPois > 0)
            {
                // Re-query DB after backfill
                candidates = await db.PointsOfInterest
                    .Where(p => p.Latitude >= minLat && p.Latitude <= maxLat && p.Longitude >= minLng && p.Longitude <= maxLng)
                    .Where(p => allowedCategories.Contains(p.Category))
                    .Select(p => new PoiResponse
                    {
                        Id = p.Id,
                        Name = p.Name,
                        Category = p.Category,
                        Lat = p.Latitude,
                        Lng = p.Longitude
                    })
                    .ToListAsync();
            }
        }
        catch
        {
            // Overpass unavailable — return whatever we have from DB
        }
    }

    // Spatial grid sampling: divide viewport into cells, pick best POI per cell.
    var targetCount = zoom >= 14 ? 30 : 40;
    var gridCols = 7;
    var gridRows = 6;

    var latRange = maxLat.Value - minLat.Value;
    var lngRange = maxLng.Value - minLng.Value;

    if (latRange <= 0 || lngRange <= 0 || candidates.Count == 0)
        return Results.Ok(candidates.Take(targetCount));

    var cellLat = latRange / gridRows;
    var cellLng = lngRange / gridCols;

    int CategoryPriority(string cat) => cat switch
    {
        "national_park" => 0,
        "state_park" => 1,
        "historic_site" => 2,
        "natural_feature" => 3,
        "tourism" => 4,
        _ => 5
    };

    var sampled = new List<PoiResponse>();
    var usedCells = new HashSet<string>();
    var sorted = candidates.OrderBy(p => CategoryPriority(p.Category)).ToList();

    foreach (var poi in sorted)
    {
        var row = Math.Min((int)((poi.Lat - minLat.Value) / cellLat), gridRows - 1);
        var col = Math.Min((int)((poi.Lng - minLng.Value) / cellLng), gridCols - 1);
        var cellKey = $"{row}_{col}";

        if (usedCells.Contains(cellKey))
            continue;

        usedCells.Add(cellKey);
        sampled.Add(poi);

        if (sampled.Count >= targetCount)
            break;
    }

    return Results.Ok(sampled);
});

// GET /api/park-boundaries — Get park boundaries filtered by viewport and zoom level
app.MapGet("/api/park-boundaries", async (double? minLat, double? maxLat, double? minLng, double? maxLng, int? zoom, string? detail, RoadTripDbContext db) =>
{
    // Validate all 5 parameters are present
    if (!minLat.HasValue || !maxLat.HasValue || !minLng.HasValue || !maxLng.HasValue || !zoom.HasValue)
        return Results.BadRequest(new { error = "Missing required parameters: minLat, maxLat, minLng, maxLng, zoom" });

    // Validate latitude range
    if (minLat < -90 || minLat > 90 || maxLat < -90 || maxLat > 90)
        return Results.BadRequest(new { error = "Invalid coordinates: latitude must be between -90 and 90" });

    // Validate longitude range
    if (minLng < -180 || minLng > 180 || maxLng < -180 || maxLng > 180)
        return Results.BadRequest(new { error = "Invalid coordinates: longitude must be between -180 and 180" });

    // Validate zoom >= 0
    if (zoom < 0)
        return Results.BadRequest(new { error = "Invalid zoom level: zoom must be >= 0" });

    // Validate detail parameter if provided
    detail ??= "moderate";
    if (!new[] { "full", "moderate", "simplified" }.Contains(detail))
        return Results.BadRequest(new { error = "Invalid detail level: must be one of 'full', 'moderate', 'simplified'" });

    // Zoom gating: return empty features if zoom < 8
    if (zoom < 8)
        return Results.Ok(new RoadTripMap.Models.ParkBoundaryResponse
        {
            Type = "FeatureCollection",
            Features = Array.Empty<RoadTripMap.Models.ParkBoundaryFeature>()
        });

    // Query parks that overlap the viewport bbox
    var parks = await db.ParkBoundaries
        .Where(p => p.MaxLat >= minLat.Value && p.MinLat <= maxLat.Value && p.MaxLng >= minLng.Value && p.MinLng <= maxLng.Value)
        .OrderByDescending(p => p.GisAcres)
        .Take(50)
        .ToListAsync();

    // Select the correct GeoJSON column based on detail parameter
    var geoJsonSelector = detail switch
    {
        "full" => (System.Func<RoadTripMap.Entities.ParkBoundaryEntity, string>)(p => p.GeoJsonFull),
        "simplified" => (p => p.GeoJsonSimplified),
        _ => (p => p.GeoJsonModerate) // default to moderate
    };

    // Build GeoJSON FeatureCollection
    var features = parks.Select(p => new RoadTripMap.Models.ParkBoundaryFeature
    {
        Type = "Feature",
        Properties = new RoadTripMap.Models.ParkBoundaryProperties
        {
            Id = p.Id,
            Name = p.Name,
            State = p.State,
            Category = p.Category,
            CentroidLat = p.CentroidLat,
            CentroidLng = p.CentroidLng,
            GisAcres = p.GisAcres
        },
        Geometry = System.Text.Json.Nodes.JsonNode.Parse(geoJsonSelector(p))!
    }).ToArray();

    var response = new RoadTripMap.Models.ParkBoundaryResponse
    {
        Type = "FeatureCollection",
        Features = features
    };

    return Results.Ok(response);
});

// Live Overpass backfill — queries Overpass for a viewport and caches results in DB
async Task<int> FetchOverpassForViewport(
    IHttpClientFactory clientFactory, RoadTripDbContext dbCtx,
    double south, double north, double west, double east)
{
    var bbox = $"({south},{west},{north},{east})";
    var queries = new Dictionary<string, string>
    {
        ["tourism"] = $"[out:json][timeout:15];node[\"tourism\"~\"attraction|viewpoint\"]{bbox};out body;",
        ["natural"] = $"[out:json][timeout:15];(node[\"natural\"=\"peak\"]{bbox};node[\"natural\"=\"waterfall\"]{bbox};node[\"natural\"=\"volcano\"]{bbox};node[\"natural\"=\"cave_entrance\"]{bbox};);out body;",
        ["state_park"] = $"[out:json][timeout:15];(node[\"leisure\"=\"nature_reserve\"]{bbox};way[\"leisure\"=\"nature_reserve\"]{bbox};relation[\"leisure\"=\"nature_reserve\"]{bbox};node[\"boundary\"=\"protected_area\"][\"protect_class\"~\"^[1-5]$\"]{bbox};way[\"boundary\"=\"protected_area\"][\"protect_class\"~\"^[1-5]$\"]{bbox};relation[\"boundary\"=\"protected_area\"][\"protect_class\"~\"^[1-5]$\"]{bbox};);out center;",
    };

    var client = clientFactory.CreateClient("Overpass");
    int totalInserted = 0;

    foreach (var (qtype, query) in queries)
    {
        try
        {
            var content = new FormUrlEncodedContent(new[] { new KeyValuePair<string, string>("data", query) });
            var response = await client.PostAsync("https://overpass-api.de/api/interpreter", content);
            if (!response.IsSuccessStatusCode) continue;

            var json = await response.Content.ReadAsStringAsync();
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("elements", out var elements)) continue;

            foreach (var el in elements.EnumerateArray())
            {
                if (!el.TryGetProperty("tags", out var tags)) continue;
                if (!tags.TryGetProperty("name", out var nameEl)) continue;
                var name = nameEl.GetString();
                if (string.IsNullOrEmpty(name)) continue;

                var elType = el.TryGetProperty("type", out var typeEl) ? typeEl.GetString() : "node";

                // Nodes have lat/lon directly; ways/relations use center
                double lat, lon;
                if (elType == "node")
                {
                    lat = el.GetProperty("lat").GetDouble();
                    lon = el.GetProperty("lon").GetDouble();
                }
                else if (el.TryGetProperty("center", out var center))
                {
                    lat = center.GetProperty("lat").GetDouble();
                    lon = center.GetProperty("lon").GetDouble();
                }
                else continue;

                var sourceId = $"{elType}/{el.GetProperty("id").GetInt64()}";

                var category = qtype switch
                {
                    "natural" => "natural_feature",
                    "state_park" => "state_park",
                    _ => "tourism"
                };

                // Upsert
                var existing = await dbCtx.PointsOfInterest
                    .FirstOrDefaultAsync(p => p.Source == "osm" && p.SourceId == sourceId);
                if (existing == null)
                {
                    dbCtx.PointsOfInterest.Add(new RoadTripMap.Entities.PoiEntity
                    {
                        Name = name, Category = category,
                        Latitude = lat, Longitude = lon,
                        Source = "osm", SourceId = sourceId
                    });
                    totalInserted++;
                }
            }

            await dbCtx.SaveChangesAsync();
            await Task.Delay(2000); // rate limit between queries
        }
        catch
        {
            // Overpass query failed — skip this query type
        }
    }

    return totalInserted;
}

// Map resilient upload endpoints (request-upload, commit, abort)
app.MapUploadEndpoints();

app.Run();

// Make Program public for WebApplicationFactory in tests
public partial class Program { }
