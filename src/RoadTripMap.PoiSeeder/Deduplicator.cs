using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Entities;

namespace RoadTripMap.PoiSeeder;

public class Deduplicator
{
    private readonly RoadTripDbContext _context;

    // Source priority: higher number = higher priority (kept when duplicates found)
    private static readonly Dictionary<string, int> SourcePriority = new()
    {
        { "nps", 3 },
        { "pad_us", 2 },
        { "osm", 1 }
    };

    public Deduplicator(RoadTripDbContext context)
    {
        _context = context ?? throw new ArgumentNullException(nameof(context));
    }

    public async Task<DeduplicationResult> DeduplicateAsync()
    {
        var result = new DeduplicationResult();

        try
        {
            // Fetch all POIs from database
            var allPois = await _context.PointsOfInterest.ToListAsync();

            if (allPois.Count == 0)
            {
                return result;
            }

            // Group POIs by approximate location (rounded to 2 decimal places = ~1km precision)
            var locationGroups = allPois
                .GroupBy(poi => (
                    RoundCoordinate(poi.Latitude),
                    RoundCoordinate(poi.Longitude)))
                .ToList();

            // Process each location group
            foreach (var group in locationGroups)
            {
                var groupList = group.ToList();

                // Only process if there are potential duplicates (same location)
                if (groupList.Count > 1)
                {
                    var toDelete = FindDuplicatesInGroup(groupList);

                    foreach (var poi in toDelete)
                    {
                        _context.PointsOfInterest.Remove(poi);
                        result.DeletedCount++;
                    }
                }
            }

            // Save all deletions
            if (result.DeletedCount > 0)
            {
                await _context.SaveChangesAsync();
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException("Failed to deduplicate POIs: " + ex.Message, ex);
        }

        return result;
    }

    private List<PoiEntity> FindDuplicatesInGroup(List<PoiEntity> group)
    {
        var toDelete = new List<PoiEntity>();

        // Find clusters of similar names (case-insensitive substring match)
        var nameClusters = FindNameClusters(group);

        foreach (var cluster in nameClusters)
        {
            if (cluster.Count <= 1)
            {
                continue;
            }

            // Find highest-priority POI in cluster
            var highest = cluster.OrderByDescending(p => GetSourcePriority(p.Source)).First();

            // Delete all lower-priority ones
            foreach (var poi in cluster)
            {
                if (poi.Id != highest.Id)
                {
                    toDelete.Add(poi);
                }
            }
        }

        return toDelete;
    }

    private List<List<PoiEntity>> FindNameClusters(List<PoiEntity> pois)
    {
        var clusters = new List<List<PoiEntity>>();
        var processed = new HashSet<int>();

        foreach (var poi in pois)
        {
            if (processed.Contains(poi.Id))
            {
                continue;
            }

            var cluster = new List<PoiEntity> { poi };
            processed.Add(poi.Id);

            // Find all POIs with similar names using transitive closure
            // A similar to B, and B similar to C means A, B, C are in same cluster
            var clusterQueue = new Queue<PoiEntity>(cluster);

            while (clusterQueue.Count > 0)
            {
                var current = clusterQueue.Dequeue();
                var currentNameNormalized = NormalizeName(current.Name);

                foreach (var other in pois)
                {
                    if (processed.Contains(other.Id))
                    {
                        continue;
                    }

                    var otherNameNormalized = NormalizeName(other.Name);

                    if (AreNamesSimilar(currentNameNormalized, otherNameNormalized))
                    {
                        cluster.Add(other);
                        clusterQueue.Enqueue(other);
                        processed.Add(other.Id);
                    }
                }
            }

            if (cluster.Count > 0)
            {
                clusters.Add(cluster);
            }
        }

        return clusters;
    }

    private bool AreNamesSimilar(string name1, string name2)
    {
        // Substring match (case-insensitive)
        if (name1.Contains(name2, StringComparison.OrdinalIgnoreCase) ||
            name2.Contains(name1, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        // Levenshtein distance for typos/slight differences
        var distance = LevenshteinDistance(name1, name2);
        var maxLength = Math.Max(name1.Length, name2.Length);

        // If difference is < 30% of max length, consider similar
        return distance <= (maxLength * 0.3);
    }

    private string NormalizeName(string name)
    {
        return name
            .ToLowerInvariant()
            .Trim();
    }

    private int LevenshteinDistance(string s1, string s2)
    {
        var len1 = s1.Length;
        var len2 = s2.Length;

        var d = new int[len1 + 1, len2 + 1];

        for (var i = 0; i <= len1; i++)
        {
            d[i, 0] = i;
        }

        for (var j = 0; j <= len2; j++)
        {
            d[0, j] = j;
        }

        for (var i = 1; i <= len1; i++)
        {
            for (var j = 1; j <= len2; j++)
            {
                var cost = s1[i - 1] == s2[j - 1] ? 0 : 1;

                d[i, j] = Math.Min(
                    Math.Min(
                        d[i - 1, j] + 1,      // deletion
                        d[i, j - 1] + 1),     // insertion
                    d[i - 1, j - 1] + cost); // substitution
            }
        }

        return d[len1, len2];
    }

    private double RoundCoordinate(double coordinate)
    {
        // Round to 2 decimal places for ~1km precision
        return Math.Round(coordinate, 2);
    }

    private int GetSourcePriority(string source)
    {
        return SourcePriority.TryGetValue(source, out var priority) ? priority : 0;
    }
}

public class DeduplicationResult
{
    public int DeletedCount { get; set; }
}
