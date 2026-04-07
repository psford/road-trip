using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using RoadTripMap;

namespace RoadTripMap.Data;

public class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<RoadTripDbContext>
{
    public RoadTripDbContext CreateDbContext(string[] args)
    {
        // EF Core CLI tools (dotnet ef migrations add, dotnet ef database update) do not set
        // ASPNETCORE_ENVIRONMENT, so we explicitly set DOTNET_ENVIRONMENT to "Development"
        // to ensure EndpointRegistry resolves the dev endpoints. This is a known limitation
        // of the EF Core design-time API and affects the global process environment.
        Environment.SetEnvironmentVariable("DOTNET_ENVIRONMENT", "Development");
        var connectionString = EndpointRegistry.Resolve("database-admin");

        var optionsBuilder = new DbContextOptionsBuilder<RoadTripDbContext>();
        optionsBuilder.UseSqlServer(connectionString);

        return new RoadTripDbContext(optionsBuilder.Options);
    }
}
