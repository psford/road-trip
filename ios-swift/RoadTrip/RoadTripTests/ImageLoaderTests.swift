import XCTest
import UIKit
@testable import RoadTrip

/// Phase: photo caching. The loader resolves images memory → disk → network, so reopening
/// a photo is instant and each image downloads at most once.
final class ImageLoaderTests: XCTestCase {

    private actor Counter {
        private(set) var n = 0
        func bump() { n += 1 }
    }

    func testDownloadsOnceThenServesFromMemory() async {
        let counter = Counter()
        let jpeg = makeJPEG()
        let loader = await ImageLoader(fileCache: try? tempCache(),
                                       fetch: { _ in await counter.bump(); return jpeg })
        let url = URL(string: "https://example.com/p/1/display")!
        let trip = UUID()

        let first = await loader.image(for: url, tripId: trip, photoId: 1, tier: .display)
        let second = await loader.image(for: url, tripId: trip, photoId: 1, tier: .display)

        XCTAssertNotNil(first)
        XCTAssertNotNil(second)
        let calls = await counter.n
        XCTAssertEqual(calls, 1, "second load is served from memory — no re-fetch")
    }

    func testServesFromDiskWithoutFetching() async throws {
        let counter = Counter()
        let cache = try tempCache()
        let trip = UUID()
        try cache.store(makeJPEG(), tripId: trip, photoId: 7, tier: .display)
        let loader = await ImageLoader(fileCache: cache,
                                       fetch: { _ in await counter.bump(); return Data() })

        let img = await loader.image(for: URL(string: "https://example.com/p/7/display")!,
                                     tripId: trip, photoId: 7, tier: .display)

        XCTAssertNotNil(img)
        let calls = await counter.n
        XCTAssertEqual(calls, 0, "a disk hit must not hit the network")
    }

    func testMissWritesToDiskCache() async throws {
        let cache = try tempCache()
        let jpeg = makeJPEG()
        let loader = await ImageLoader(fileCache: cache, fetch: { _ in jpeg })
        let trip = UUID()

        _ = await loader.image(for: URL(string: "https://example.com/p/3/thumb")!,
                               tripId: trip, photoId: 3, tier: .thumb)

        XCTAssertTrue(cache.contains(tripId: trip, photoId: 3, tier: .thumb),
                      "a cache miss should persist the downloaded bytes to disk")
    }

    func testLoadsLocalFileURLWithoutNetwork() async throws {
        // An optimistic (staged, not-yet-uploaded) photo points its image at the on-disk original
        // via a file:// URL. The loader must read it locally — never the network — so it renders
        // in a no-service area.
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let fileURL = dir.appendingPathComponent("staged.jpg")
        try makeJPEG().write(to: fileURL)

        let loader = await ImageLoader(fileCache: nil,
                                       fetch: { _ in throw URLError(.notConnectedToInternet) })
        let image = await loader.image(for: fileURL, tripId: UUID(), photoId: -1, tier: .display)

        XCTAssertNotNil(image, "a file:// URL must load from disk even with no network")
    }

    func testLocalFileIsSizedPerTierAndCachedSeparately() async throws {
        // A 40pt map pin (.thumb) shouldn't decode the full-res original; tiers must also cache
        // separately so a small .thumb decode doesn't get served back for the larger .display.
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let fileURL = dir.appendingPathComponent("big.jpg")
        try makeJPEG(side: 400).write(to: fileURL)

        let loader = await ImageLoader(fileCache: nil, fetch: { _ in throw URLError(.notConnectedToInternet) })
        let trip = UUID()
        let thumb = await loader.image(for: fileURL, tripId: trip, photoId: -1, tier: .thumb)
        let display = await loader.image(for: fileURL, tripId: trip, photoId: -1, tier: .display)

        let thumbW = try XCTUnwrap(thumb).size.width
        let displayW = try XCTUnwrap(display).size.width
        XCTAssertLessThanOrEqual(thumbW, 200, ".thumb decodes small, not the full original")
        XCTAssertGreaterThan(displayW, thumbW, ".display is not served the cached .thumb (separate keys)")
    }

    // MARK: - Helpers

    private func makeJPEG(side: CGFloat) -> Data {
        UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).jpegData(withCompressionQuality: 1) { ctx in
            UIColor.systemTeal.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: side, height: side))
        }
    }

    private func tempCache() throws -> PhotoFileCache {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        return try PhotoFileCache(rootURL: dir)
    }

    private func makeJPEG() -> Data {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 4, height: 4))
        return renderer.jpegData(withCompressionQuality: 1) { ctx in
            UIColor.systemTeal.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
        }
    }
}
