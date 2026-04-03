using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Entities;

namespace RoadTripMap.PoiSeeder;

/// <summary>
/// Shared helper for upserting POI entities across all importers.
/// Implements idempotent upsert logic: insert if new (by Source + SourceId), update if exists.
/// </summary>
public static class PoiUpsertHelper
{
    /// <summary>
    /// Upserts a POI entity into the database.
    /// If a POI with the same Source and SourceId exists, updates its name and coordinates.
    /// Otherwise, adds a new POI.
    /// </summary>
    public static async Task UpsertPoiAsync(RoadTripDbContext context, PoiEntity newPoi)
    {
        var existing = await context.PointsOfInterest
            .FirstOrDefaultAsync(p => p.Source == newPoi.Source && p.SourceId == newPoi.SourceId);

        if (existing == null)
        {
            context.PointsOfInterest.Add(newPoi);
        }
        else
        {
            existing.Name = newPoi.Name;
            existing.Latitude = newPoi.Latitude;
            existing.Longitude = newPoi.Longitude;
            context.PointsOfInterest.Update(existing);
        }
    }
}
