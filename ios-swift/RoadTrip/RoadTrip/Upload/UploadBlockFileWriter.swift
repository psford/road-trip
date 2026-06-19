import Foundation

/// Carves the staged original into per-block files on disk.
///
/// Background `uploadTask(with:fromFile:)` is *file-based by mandate* — a background session
/// can't upload in-memory `Data`, because the body has to outlive the app process. So before
/// kicking block tasks we slice the original into `block-<index>.bin` files the system owns
/// for the task's lifetime, and delete them once the upload commits (or is aborted).
struct UploadBlockFileWriter {
    /// One sliced block, ready to become an `uploadTask`.
    struct PreparedBlock: Equatable {
        let index: Int
        let blockId: String
        let fileURL: URL
        let length: Int
    }

    /// Parent of the per-upload block folders. Injectable so tests stay off Application Support.
    let baseDirectory: URL

    init(baseDirectory: URL = UploadBlockFileWriter.defaultBaseDirectory) {
        self.baseDirectory = baseDirectory
    }

    /// `…/PendingUploads/blocks/` — a sibling of the staged `.jpg` originals.
    static var defaultBaseDirectory: URL {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                 appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("PendingUploads/blocks", isDirectory: true)
    }

    func directory(for uploadId: UUID) -> URL {
        baseDirectory.appendingPathComponent(uploadId.uuidString, isDirectory: true)
    }

    /// Writes the requested block indices of `item`'s staged original to disk. Block boundaries
    /// come from the *persisted* `blockSizeBytes`, so a resumed slice reproduces the exact same
    /// ranges + ids the first run used. Throws if the source is unreadable or an index is out
    /// of range.
    func prepare(item: UploadQueueItem, indices: [Int]) throws -> [PreparedBlock] {
        guard let blockSize = item.blockSizeBytes, blockSize > 0 else {
            throw CocoaError(.fileReadUnknown)
        }
        let ranges = BlockUpload.chunkRanges(fileSize: Int(item.sizeBytes), chunkSize: blockSize)
        let dir = directory(for: item.uploadId)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: item.localFilePath))
        defer { try? handle.close() }

        return try indices.sorted().map { index in
            guard index >= 0, index < ranges.count else { throw CocoaError(.fileReadUnknown) }
            let range = ranges[index]
            try handle.seek(toOffset: UInt64(range.offset))
            let data = try handle.read(upToCount: range.length) ?? Data()
            let fileURL = dir.appendingPathComponent("block-\(index).bin")
            try data.write(to: fileURL, options: .atomic)
            return PreparedBlock(index: index, blockId: range.blockId, fileURL: fileURL, length: data.count)
        }
    }

    /// Removes a single block file once its task succeeds (keeps disk lean during a big upload).
    func removeBlockFile(uploadId: UUID, index: Int) {
        try? FileManager.default.removeItem(at: directory(for: uploadId).appendingPathComponent("block-\(index).bin"))
    }

    /// Deletes the whole per-upload block folder on commit/abort.
    func cleanup(uploadId: UUID) {
        try? FileManager.default.removeItem(at: directory(for: uploadId))
    }
}
