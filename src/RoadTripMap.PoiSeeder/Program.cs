using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;

namespace RoadTripMap.PoiSeeder;

public static class Program
{
    public static async Task Main(string[] args)
    {
        try
        {
            // Read connection string from environment variable, fall back to development default
            var connectionString = Environment.GetEnvironmentVariable("WSL_SQL_CONNECTION")
                ?? "Server=localhost,1433;Database=RoadTrip;User Id=sa;Password=YourPassword123!;TrustServerCertificate=true;";

            // Build DbContext
            var optionsBuilder = new DbContextOptionsBuilder<RoadTripDbContext>();
            optionsBuilder.UseSqlServer(connectionString);

            await using var context = new RoadTripDbContext(optionsBuilder.Options);

            Console.WriteLine("POI Seeder initialized. Ready to run importers.");
            Console.WriteLine("Note: Importers not yet implemented. This is the entry point infrastructure.");

            // TODO: Add importer invocations here
            // - NPS importer
            // - PAD-US importer
            // - Overpass importer
            // - Cross-source deduplication
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            Environment.Exit(1);
        }
    }
}
