import Foundation

/// Persistent on-disk cache for photo image files, laid out as
/// `~/Library/Caches/Photos/{tripId}/{photoId}_{tier}.jpg`.
///
/// LRU eviction with a soft ceiling (default ~1 GB). iOS may also purge `Caches/`
/// under storage pressure, so callers MUST tolerate misses and re-fetch from the
/// server proxy URL.
struct PhotoFileCache {
    enum Tier: String {
        case original, display, thumb
    }

    let rootURL: URL
    let capacityBytes: Int64

    private let fm = FileManager.default

    /// - Parameters:
    ///   - rootURL: cache root; defaults to `~/Library/Caches/Photos`. Tests pass a temp dir.
    ///   - capacityBytes: soft LRU ceiling (default 1 GB).
    init(rootURL: URL? = nil, capacityBytes: Int64 = 1_000_000_000) throws {
        if let rootURL {
            self.rootURL = rootURL
        } else {
            let caches = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask,
                                                     appropriateFor: nil, create: true)
            self.rootURL = caches.appendingPathComponent("Photos", isDirectory: true)
        }
        self.capacityBytes = capacityBytes
        try fm.createDirectory(at: self.rootURL, withIntermediateDirectories: true)
    }

    func fileURL(tripId: UUID, photoId: Int, tier: Tier) -> URL {
        rootURL
            .appendingPathComponent(tripId.uuidString, isDirectory: true)
            .appendingPathComponent("\(photoId)_\(tier.rawValue).jpg")
    }

    func contains(tripId: UUID, photoId: Int, tier: Tier) -> Bool {
        fm.fileExists(atPath: fileURL(tripId: tripId, photoId: photoId, tier: tier).path)
    }

    /// Writes bytes for a tier, then evicts oldest files if over capacity.
    func store(_ data: Data, tripId: UUID, photoId: Int, tier: Tier) throws {
        let url = fileURL(tripId: tripId, photoId: photoId, tier: tier)
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
        try evictIfNeeded()
    }

    /// Reads bytes for a tier, or `nil` on a miss. Reading bumps the file's modification
    /// date so it counts as recently used for LRU.
    func data(tripId: UUID, photoId: Int, tier: Tier) -> Data? {
        let url = fileURL(tripId: tripId, photoId: photoId, tier: tier)
        guard let data = try? Data(contentsOf: url) else { return nil }
        try? fm.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
        return data
    }

    /// Removes all cached tiers for a trip (called on trip delete).
    func removeAll(tripId: UUID) throws {
        let dir = rootURL.appendingPathComponent(tripId.uuidString, isDirectory: true)
        if fm.fileExists(atPath: dir.path) {
            try fm.removeItem(at: dir)
        }
    }

    /// Total bytes currently cached.
    func currentSizeBytes() throws -> Int64 {
        try allFiles().reduce(0) { $0 + $1.size }
    }

    /// Evicts least-recently-modified files until total size is under capacity.
    func evictIfNeeded() throws {
        var files = try allFiles()
        var total = files.reduce(0) { $0 + $1.size }
        guard total > capacityBytes else { return }

        files.sort { $0.modified < $1.modified }   // oldest first
        for file in files {
            if total <= capacityBytes { break }
            try? fm.removeItem(at: file.url)
            total -= file.size
        }
    }

    // MARK: - Private

    private struct CachedFile {
        let url: URL
        let size: Int64
        let modified: Date
    }

    private func allFiles() throws -> [CachedFile] {
        guard let enumerator = fm.enumerator(
            at: rootURL,
            includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey]
        ) else { return [] }

        var result: [CachedFile] = []
        for case let url as URL in enumerator {
            let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey])
            guard values.isRegularFile == true else { continue }
            result.append(CachedFile(
                url: url,
                size: Int64(values.fileSize ?? 0),
                modified: values.contentModificationDate ?? .distantPast
            ))
        }
        return result
    }
}
