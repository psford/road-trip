using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RoadTripMap.Migrations
{
    /// <inheritdoc />
    public partial class AddUploadStatusColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "LastActivityAt",
                schema: "roadtrip",
                table: "Photos",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                schema: "roadtrip",
                table: "Photos",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "committed");

            migrationBuilder.AddColumn<string>(
                name: "StorageTier",
                schema: "roadtrip",
                table: "Photos",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "legacy");

            migrationBuilder.AddColumn<int>(
                name: "UploadAttemptCount",
                schema: "roadtrip",
                table: "Photos",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "UploadId",
                schema: "roadtrip",
                table: "Photos",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Photos_UploadId",
                schema: "roadtrip",
                table: "Photos",
                column: "UploadId",
                unique: true,
                filter: "[UploadId] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Photos_UploadId",
                schema: "roadtrip",
                table: "Photos");

            migrationBuilder.DropColumn(
                name: "LastActivityAt",
                schema: "roadtrip",
                table: "Photos");

            migrationBuilder.DropColumn(
                name: "Status",
                schema: "roadtrip",
                table: "Photos");

            migrationBuilder.DropColumn(
                name: "StorageTier",
                schema: "roadtrip",
                table: "Photos");

            migrationBuilder.DropColumn(
                name: "UploadAttemptCount",
                schema: "roadtrip",
                table: "Photos");

            migrationBuilder.DropColumn(
                name: "UploadId",
                schema: "roadtrip",
                table: "Photos");
        }
    }
}
