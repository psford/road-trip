using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RoadTripMap.Migrations
{
    /// <inheritdoc />
    public partial class AddPointsOfInterest : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PointsOfInterest",
                schema: "roadtrip",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    Category = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Latitude = table.Column<double>(type: "float", nullable: false),
                    Longitude = table.Column<double>(type: "float", nullable: false),
                    Source = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    SourceId = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PointsOfInterest", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PointsOfInterest_Category",
                schema: "roadtrip",
                table: "PointsOfInterest",
                column: "Category");

            migrationBuilder.CreateIndex(
                name: "IX_PointsOfInterest_Latitude_Longitude",
                schema: "roadtrip",
                table: "PointsOfInterest",
                columns: new[] { "Latitude", "Longitude" });

            migrationBuilder.CreateIndex(
                name: "IX_PointsOfInterest_SourceId",
                schema: "roadtrip",
                table: "PointsOfInterest",
                column: "SourceId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PointsOfInterest",
                schema: "roadtrip");
        }
    }
}
