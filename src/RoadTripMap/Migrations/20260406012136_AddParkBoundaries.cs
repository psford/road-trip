using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RoadTripMap.Migrations
{
    /// <inheritdoc />
    public partial class AddParkBoundaries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ParkBoundaries",
                schema: "roadtrip",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    State = table.Column<string>(type: "nvarchar(2)", maxLength: 2, nullable: false),
                    Category = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    GisAcres = table.Column<int>(type: "int", nullable: false),
                    CentroidLat = table.Column<double>(type: "float", nullable: false),
                    CentroidLng = table.Column<double>(type: "float", nullable: false),
                    MinLat = table.Column<double>(type: "float", nullable: false),
                    MaxLat = table.Column<double>(type: "float", nullable: false),
                    MinLng = table.Column<double>(type: "float", nullable: false),
                    MaxLng = table.Column<double>(type: "float", nullable: false),
                    GeoJsonFull = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    GeoJsonModerate = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    GeoJsonSimplified = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Source = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    SourceId = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ParkBoundaries", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ParkBoundaries_GisAcres",
                schema: "roadtrip",
                table: "ParkBoundaries",
                column: "GisAcres");

            migrationBuilder.CreateIndex(
                name: "IX_ParkBoundaries_MinLat_MaxLat_MinLng_MaxLng",
                schema: "roadtrip",
                table: "ParkBoundaries",
                columns: new[] { "MinLat", "MaxLat", "MinLng", "MaxLng" });

            migrationBuilder.CreateIndex(
                name: "IX_ParkBoundaries_SourceId",
                schema: "roadtrip",
                table: "ParkBoundaries",
                column: "SourceId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ParkBoundaries",
                schema: "roadtrip");
        }
    }
}
