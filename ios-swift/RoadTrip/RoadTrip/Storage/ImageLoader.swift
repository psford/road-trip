import UIKit
import ImageIO

/// Resolves photo images through three layers so reopening a photo is instant and each
/// image downloads at most once:
///   1. in-memory `NSCache` (decoded `UIImage`) — instant, survives view re-creation
///   2. `PhotoFileCache` (disk) — survives app launches and memory-cache purges
///   3. network — only on a true miss; the result is written back to both caches
///
/// `@MainActor` because it's driven by SwiftUI views; `NSCache` is itself thread-safe.
@MainActor
final class ImageLoader {
    static let shared = ImageLoader()

    private let memory = NSCache<NSString, UIImage>()
    private let fileCache: PhotoFileCache?
    private let fetch: @Sendable (URL) async throws -> Data

    init(fileCache: PhotoFileCache? = try? PhotoFileCache(),
         fetch: @escaping @Sendable (URL) async throws -> Data = { try await URLSession.shared.data(from: $0).0 }) {
        self.fileCache = fileCache
        self.fetch = fetch
    }

    /// Synchronous memory-cache peek so a view can render a cached image on first frame
    /// (no placeholder flash on reopen).
    func memoryImage(for url: URL?) -> UIImage? {
        guard let url else { return nil }
        return memory.object(forKey: url.absoluteString as NSString)
    }

    /// Returns the image, hitting memory → disk → network in order. `nil` only if the
    /// network fails or the bytes don't decode.
    func image(for url: URL, tripId: UUID, photoId: Int, tier: PhotoFileCache.Tier) async -> UIImage? {
        // Optimistic (staged, not-yet-uploaded) photos point their image at the on-disk original via
        // a file:// URL (all three tiers share one URL). Load + downsample it locally — never the
        // network — sized to the requesting tier so a 40pt pin doesn't decode the full original, and
        // keyed per-size so the small .thumb decode isn't served back for the larger .display.
        if url.isFileURL {
            let maxPixel = Self.maxPixel(for: tier)
            let key = "\(url.absoluteString)#\(maxPixel)" as NSString
            if let cached = memory.object(forKey: key) { return cached }
            guard let image = await Task.detached(priority: .utility, operation: {
                Self.downsampledImage(at: url, maxPixel: maxPixel)
            }).value else { return nil }
            memory.setObject(image, forKey: key)
            return image
        }

        let key = url.absoluteString as NSString
        if let cached = memory.object(forKey: key) { return cached }

        if let data = fileCache?.data(tripId: tripId, photoId: photoId, tier: tier),
           let image = UIImage(data: data) {
            memory.setObject(image, forKey: key)
            return image
        }

        guard let data = try? await fetch(url), let image = UIImage(data: data) else { return nil }
        try? fileCache?.store(data, tripId: tripId, photoId: photoId, tier: tier)
        memory.setObject(image, forKey: key)
        return image
    }

    /// Target pixel size for a locally-decoded file, by tier — a map pin / strip thumbnail needs far
    /// fewer pixels than the full-screen popup.
    nonisolated private static func maxPixel(for tier: PhotoFileCache.Tier) -> Int {
        switch tier {
        case .thumb: return 200
        case .display, .original: return 1500
        }
    }

    /// Decodes only as many pixels as needed from a local image file via ImageIO.
    nonisolated private static func downsampledImage(at url: URL, maxPixel: Int) -> UIImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
