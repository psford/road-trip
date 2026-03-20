using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace RoadTripMap.Data;

public class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<RoadTripDbContext>
{
    public RoadTripDbContext CreateDbContext(string[] args)
    {
        var optionsBuilder = new DbContextOptionsBuilder<RoadTripDbContext>();
        optionsBuilder.UseSqlServer(
            "Server=.\\SQLEXPRESS;Database=StockAnalyzer;Trusted_Connection=True;TrustServerCertificate=True");
        return new RoadTripDbContext(optionsBuilder.Options);
    }
}
