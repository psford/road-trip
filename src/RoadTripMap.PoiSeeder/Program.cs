using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.PoiSeeder;
using RoadTripMap.PoiSeeder.Importers;

namespace RoadTripMap.PoiSeeder;

public static class Program
{
    public static async Task Main(string[] args)
    {
        try
        {
            // Parse command-line arguments
            var padUsFile = GetArgument(args, "--pad-us-file");
            var npsOnly = args.Contains("--nps-only");
            var overpassOnly = args.Contains("--overpass-only");
            var padUsOnly = args.Contains("--pad-us-only");
            var boundariesOnly = args.Contains("--boundaries-only");

            // Read connection string from environment variable, fall back to development default
            var connectionString = Environment.GetEnvironmentVariable("WSL_SQL_CONNECTION")
                ?? "Server=localhost,1433;Database=RoadTrip;User Id=sa;Password=YourPassword123!;TrustServerCertificate=true;";

            // Build DbContext
            var optionsBuilder = new DbContextOptionsBuilder<RoadTripDbContext>();
            optionsBuilder.UseSqlServer(connectionString);

            await using var context = new RoadTripDbContext(optionsBuilder.Options);

            // Create HttpClient with user agent and polite rate limiting
            using var httpClient = new HttpClient();
            httpClient.DefaultRequestHeaders.Add("User-Agent", "RoadTripMap/1.0");
            httpClient.Timeout = TimeSpan.FromSeconds(180);

            Console.WriteLine("POI Seeder starting...\n");

            var results = new Dictionary<string, (int processed, int skipped)>();

            // Run NPS importer if not restricted
            if (!overpassOnly && !padUsOnly && !boundariesOnly)
            {
                Console.WriteLine("Running NPS importer...");
                var npsApiKey = Environment.GetEnvironmentVariable("NPS_API_KEY") ?? string.Empty;
                var npsImporter = new NpsImporter(httpClient, context);
                try
                {
                    var npsResult = await npsImporter.ImportAsync(npsApiKey);
                    results["NPS"] = (npsResult.ProcessedCount, npsResult.SkippedCount);
                    Console.WriteLine($"  NPS: {npsResult.ProcessedCount} processed, {npsResult.SkippedCount} skipped\n");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"  NPS import failed: {ex.Message}\n");
                }
            }

            // Run Overpass importer if not restricted
            if (!npsOnly && !padUsOnly && !boundariesOnly)
            {
                Console.WriteLine("Running Overpass importer...");
                var overpassImporter = new OverpassImporter(httpClient, context);
                try
                {
                    var overpassResult = await overpassImporter.ImportAsync();
                    results["Overpass"] = (overpassResult.ProcessedCount, overpassResult.SkippedCount);
                    Console.WriteLine($"  Overpass: {overpassResult.ProcessedCount} processed, {overpassResult.SkippedCount} skipped\n");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"  Overpass import failed: {ex.Message}\n");
                }
            }

            // Run PAD-US importer if not restricted and file is provided
            if (!npsOnly && !overpassOnly && !boundariesOnly)
            {
                if (!string.IsNullOrEmpty(padUsFile))
                {
                    Console.WriteLine("Running PAD-US importer...");
                    var padUsImporter = new PadUsImporter(context);
                    try
                    {
                        var padUsResult = await padUsImporter.ImportAsync(padUsFile);
                        results["PAD-US"] = (padUsResult.ProcessedCount, padUsResult.SkippedCount);
                        Console.WriteLine($"  PAD-US: {padUsResult.ProcessedCount} processed, {padUsResult.SkippedCount} skipped\n");
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"  PAD-US import failed: {ex.Message}\n");
                    }
                }
                else
                {
                    Console.WriteLine("Skipping PAD-US importer (no file provided, use --pad-us-file <path>)\n");
                }
            }

            // Run PAD-US boundary importer if not restricted to other importers
            if (!npsOnly && !overpassOnly && !padUsOnly)
            {
                Console.WriteLine("Running PAD-US boundary importer...");
                var boundaryImporter = new PadUsBoundaryImporter(context, httpClient);
                try
                {
                    var boundaryResult = await boundaryImporter.ImportAsync();
                    Console.WriteLine($"  Boundaries: {boundaryResult.imported} imported, {boundaryResult.skipped} skipped, {boundaryResult.merged} parks merged\n");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"  Boundary import failed: {ex.Message}\n");
                }
            }

            // Run cross-source deduplication
            Console.WriteLine("Running cross-source deduplication...");
            var deduplicator = new Deduplicator(context);
            try
            {
                var dedupResult = await deduplicator.DeduplicateAsync();
                Console.WriteLine($"  Deduplication: {dedupResult.DeletedCount} duplicates removed\n");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"  Deduplication failed: {ex.Message}\n");
            }

            // Print summary
            Console.WriteLine("=== Import Summary ===");
            foreach (var (source, (processed, skipped)) in results)
            {
                Console.WriteLine($"{source,-12}: {processed,5} inserted/updated, {skipped,5} skipped");
            }

            Console.WriteLine("\nPOI Seeder completed successfully.");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            Environment.Exit(1);
        }
    }

    private static string? GetArgument(string[] args, string key)
    {
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == key)
            {
                return args[i + 1];
            }
        }
        return null;
    }
}
