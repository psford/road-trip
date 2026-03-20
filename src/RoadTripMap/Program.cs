using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
if (!string.IsNullOrEmpty(connectionString))
{
    builder.Services.AddDbContext<RoadTripDbContext>(options =>
        options.UseSqlServer(connectionString));
}

var app = builder.Build();

// CORS not needed for Phase 1 — frontend served same-origin.
// If native apps need cross-origin API access later, add CORS policy here.

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/health", () => Results.Ok(new { status = "healthy" }));

app.Run();
