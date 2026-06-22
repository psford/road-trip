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

        // v2 (Phase 6 Slice B.2): fields a relaunched background-`URLSession` upload needs
        // to resume from disk alone, after a force-quit cancels its in-flight block tasks.
        // - blockSizeBytes: the block size the plan was sliced with, so re-slicing on resume
        //   reproduces identical block boundaries + ids (don't trust a re-fetched value).
        // - serverPhotoId: the photo id returned by request-upload (used to commit).
        // - completedBlockIndices: which block indices Azure has already accepted (a 201),
        //   so resume re-enqueues only the missing ones. JSON int array.
        migrator.registerMigration("v2") { db in
            try db.alter(table: UploadQueueItem.databaseTableName) { t in
                t.add(column: "blockSizeBytes", .integer)
                t.add(column: "serverPhotoId", .text)
                t.add(column: "completedBlockIndices", .text).notNull().defaults(to: "[]")
            }
        }

        // v3 (Phase 2): soft-archive support. Adds a nullable archivedAt column to track
        // when a trip was locally archived by the user. nil = active; non-nil = archived.
        // The server is unaware of the archive flag — all trip data remains intact for restore.
        migrator.registerMigration("v3") { db in
            try db.alter(table: Trip.databaseTableName) { t in
                t.add(column: "archivedAt", .datetime)
            }
        }

        return migrator
    }
}
