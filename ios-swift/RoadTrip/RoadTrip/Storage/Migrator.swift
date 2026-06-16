import GRDB

/// Schema migrations. Each registered migration runs once, in registration order;
/// GRDB records which have applied. **Never edit a shipped migration** — once a build
/// has run `v1` on a device, changes go in a new `v2` migration.
enum AppMigrator {
    static func makeMigrator() -> DatabaseMigrator {
        var migrator = DatabaseMigrator()

        migrator.registerMigration("v1") { db in
            // Foreign keys are enabled by GRDB's default configuration, so the
            // `references(... onDelete: .cascade)` clauses below actually cascade.

            try db.create(table: Trip.databaseTableName) { t in
                t.primaryKey("id", .blob).notNull()             // UUID → 16-byte blob
                t.column("name", .text).notNull()
                t.column("description", .text)
                t.column("slug", .text)
                t.column("photoCount", .integer).notNull().defaults(to: 0)
                t.column("createdAt", .datetime).notNull()
                t.column("cachedAt", .datetime).notNull()
            }
            // Slug is nullable (imported trips have none) and non-unique here.
            try db.create(index: "idx_trip_slug", on: Trip.databaseTableName, columns: ["slug"])

            try db.create(table: Photo.databaseTableName) { t in
                t.primaryKey("id", .integer).notNull()          // server-assigned id
                t.column("tripId", .blob).notNull()
                    .references(Trip.databaseTableName, onDelete: .cascade)
                t.column("thumbnailUrl", .text).notNull()
                t.column("displayUrl", .text).notNull()
                t.column("originalUrl", .text).notNull()
                t.column("lat", .double).notNull()
                t.column("lng", .double).notNull()
                t.column("placeName", .text).notNull()
                t.column("caption", .text)
                t.column("takenAt", .datetime)
                t.column("uploadId", .blob)
            }
            try db.create(index: "idx_photo_tripId", on: Photo.databaseTableName, columns: ["tripId"])

            try db.create(table: UploadQueueItem.databaseTableName) { t in
                t.primaryKey("uploadId", .blob).notNull()       // unique by primary key
                t.column("tripId", .blob).notNull()
                    .references(Trip.databaseTableName, onDelete: .cascade)
                t.column("localFilePath", .text).notNull()
                t.column("filename", .text).notNull()
                t.column("contentType", .text).notNull()
                t.column("sizeBytes", .integer).notNull()
                t.column("exifLat", .double)
                t.column("exifLon", .double)
                t.column("takenAt", .datetime)
                t.column("stage", .text).notNull()
                t.column("bytesUploaded", .integer).notNull().defaults(to: 0)
                t.column("blockIds", .text).notNull().defaults(to: "[]")  // JSON array
                t.column("sasUrl", .text)
                t.column("displaySasUrl", .text)
                t.column("thumbSasUrl", .text)
                t.column("blobPath", .text)
                t.column("sasIssuedAt", .datetime)
                t.column("errorMessage", .text)
                t.column("createdAt", .datetime).notNull()
                t.column("updatedAt", .datetime).notNull()
            }
        }

        return migrator
    }
}
