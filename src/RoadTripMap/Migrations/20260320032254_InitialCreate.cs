using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RoadTripMap.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "roadtrip");

            migrationBuilder.CreateTable(
                name: "GeoCache",
                schema: "roadtrip",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    LatRounded = table.Column<double>(type: "float", nullable: false),
                    LngRounded = table.Column<double>(type: "float", nullable: false),
                    PlaceName = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    CachedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GeoCache", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Trips",
                schema: "roadtrip",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Slug = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    SecretToken = table.Column<string>(type: "nvarchar(36)", maxLength: 36, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Trips", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Photos",
                schema: "roadtrip",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    TripId = table.Column<int>(type: "int", nullable: false),
                    BlobPath = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    Latitude = table.Column<double>(type: "float", nullable: false),
                    Longitude = table.Column<double>(type: "float", nullable: false),
                    PlaceName = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    Caption = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    TakenAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Photos", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Photos_Trips_TripId",
                        column: x => x.TripId,
                        principalSchema: "roadtrip",
                        principalTable: "Trips",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GeoCache_LatRounded_LngRounded",
                schema: "roadtrip",
                table: "GeoCache",
                columns: new[] { "LatRounded", "LngRounded" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Photos_TripId",
                schema: "roadtrip",
                table: "Photos",
                column: "TripId");

            migrationBuilder.CreateIndex(
                name: "IX_Trips_SecretToken",
                schema: "roadtrip",
                table: "Trips",
                column: "SecretToken",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Trips_Slug",
                schema: "roadtrip",
                table: "Trips",
                column: "Slug",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GeoCache",
                schema: "roadtrip");

            migrationBuilder.DropTable(
                name: "Photos",
                schema: "roadtrip");

            migrationBuilder.DropTable(
                name: "Trips",
                schema: "roadtrip");
        }
    }
}
