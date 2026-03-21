using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace RoadTripMap.Data;

public class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<RoadTripDbContext>
{
    public RoadTripDbContext CreateDbContext(string[] args)
    {
        // RT_DESIGN_CONNECTION: Used in WSL2 with TCP connection to Windows SQL Express.
        // Uses the admin login (wsl_claude_admin) because migrations need DDL permissions.
        // Fallback: Windows SQL Express via named pipes for existing Windows workflow.
        var connectionString = Environment.GetEnvironmentVariable("RT_DESIGN_CONNECTION")
            ?? "Server=.\\SQLEXPRESS;Database=StockAnalyzer;Trusted_Connection=True;TrustServerCertificate=True";

        var optionsBuilder = new DbContextOptionsBuilder<RoadTripDbContext>();
        optionsBuilder.UseSqlServer(connectionString);

        return new RoadTripDbContext(optionsBuilder.Options);
    }
}
