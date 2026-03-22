using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RoadTripMap.Migrations
{
    /// <inheritdoc />
    public partial class AddViewToken : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Add column as nullable first so existing rows aren't blocked
            migrationBuilder.AddColumn<string>(
                name: "ViewToken",
                schema: "roadtrip",
                table: "Trips",
                type: "nvarchar(36)",
                maxLength: 36,
                nullable: true);

            // Backfill existing rows with unique GUIDs
            migrationBuilder.Sql(
                "UPDATE roadtrip.Trips SET ViewToken = LOWER(NEWID()) WHERE ViewToken IS NULL");

            // Now make it non-nullable
            migrationBuilder.AlterColumn<string>(
                name: "ViewToken",
                schema: "roadtrip",
                table: "Trips",
                type: "nvarchar(36)",
                maxLength: 36,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(36)",
                oldMaxLength: 36,
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Trips_ViewToken",
                schema: "roadtrip",
                table: "Trips",
                column: "ViewToken",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Trips_ViewToken",
                schema: "roadtrip",
                table: "Trips");

            migrationBuilder.DropColumn(
                name: "ViewToken",
                schema: "roadtrip",
                table: "Trips");
        }
    }
}
