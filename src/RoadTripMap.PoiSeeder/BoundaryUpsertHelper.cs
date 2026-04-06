using Microsoft.EntityFrameworkCore;
using RoadTripMap.Data;
using RoadTripMap.Entities;

namespace RoadTripMap.PoiSeeder;

/// <summary>
/// Shared helper for upserting ParkBoundary entities.
/// Implements idempotent upsert logic: insert if new (by Source + SourceId), update if exists.
/// </summary>
public static class BoundaryUpsertHelper
{
    /// <summary>
    /// Upserts a ParkBoundary entity into the database.
    /// If a boundary with the same Source and SourceId exists, updates all fields.
    /// Otherwise, adds a new boundary.
    /// </summary>
    public static async Task UpsertBoundaryAsync(RoadTripDbContext context, ParkBoundaryEntity newBoundary)
    {
        var existing = await context.ParkBoundaries
            .FirstOrDefaultAsync(p => p.Source == newBoundary.Source && p.SourceId == newBoundary.SourceId);

        if (existing == null)
        {
            context.ParkBoundaries.Add(newBoundary);
        }
        else
        {
            existing.Name = newBoundary.Name;
            existing.State = newBoundary.State;
            existing.Category = newBoundary.Category;
            existing.GisAcres = newBoundary.GisAcres;
            existing.CentroidLat = newBoundary.CentroidLat;
            existing.CentroidLng = newBoundary.CentroidLng;
            existing.MinLat = newBoundary.MinLat;
            existing.MaxLat = newBoundary.MaxLat;
            existing.MinLng = newBoundary.MinLng;
            existing.MaxLng = newBoundary.MaxLng;
            existing.GeoJsonFull = newBoundary.GeoJsonFull;
            existing.GeoJsonModerate = newBoundary.GeoJsonModerate;
            existing.GeoJsonSimplified = newBoundary.GeoJsonSimplified;
            context.ParkBoundaries.Update(existing);
        }
    }
}
