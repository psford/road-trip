using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using RoadTripMap;

namespace RoadTripMap.Data;

public class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<RoadTripDbContext>
{
    public RoadTripDbContext CreateDbContext(string[] args)
    {
        Environment.SetEnvironmentVariable("DOTNET_ENVIRONMENT", "Development");
        var connectionString = EndpointRegistry.Resolve("database-admin");

        var optionsBuilder = new DbContextOptionsBuilder<RoadTripDbContext>();
        optionsBuilder.UseSqlServer(connectionString);

        return new RoadTripDbContext(optionsBuilder.Options);
    }
}
