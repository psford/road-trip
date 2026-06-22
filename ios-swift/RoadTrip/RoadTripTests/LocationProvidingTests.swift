import XCTest
import CoreLocation
import UIKit
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers
@testable import RoadTrip

// MARK: - Fakes

/// A fake that immediately returns nil (simulates denied / restricted location access).
@MainActor
private final class DeniedLocationProvider: LocationProviding {
    func currentCoordinate(timeout: TimeInterval) async -> CLLocationCoordinate2D? {
        return nil
    }
}

/// A fake that never resolves — the timeout in locationWithTimeout races it and fires first.
@MainActor
private final class TimingOutLocationProvider: LocationProviding {
    func currentCoordinate(timeout: TimeInterval) async -> CLLocationCoordinate2D? {
        // Sleep longer than the caller's timeout so the timeout wins.
        try? await Task.sleep(nanoseconds: UInt64((timeout + 60) * 1_000_000_000))
        return nil
    }
}

/// A fake that immediately returns a fixed coordinate (simulates a fast GPS fix).
@MainActor
private final class FixedLocationProvider: LocationProviding {
    let coordinate: CLLocationCoordinate2D
    init(lat: Double, lon: Double) {
        coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
    func currentCoordinate(timeout: TimeInterval) async -> CLLocationCoordinate2D? {
        return coordinate
    }
}

// MARK: - Tests

final class LocationProvidingTests: XCTestCase {

    // MARK: locationWithTimeout behaviour

    func testDeniedProviderReturnsNil() async {
        let result = await locationWithTimeout(DeniedLocationProvider(), seconds: 2)
        XCTAssertNil(result, "denied location → nil")
    }

    func testFixedProviderPassesThrough() async {
        let result = await locationWithTimeout(FixedLocationProvider(lat: 48.8584, lon: 2.2945), seconds: 2)
        XCTAssertNotNil(result)
        XCTAssertEqual(result?.latitude ?? .nan, 48.8584, accuracy: 0.0001)
        XCTAssertEqual(result?.longitude ?? .nan, 2.2945, accuracy: 0.0001)
    }

    func testTimingOutProviderIsBoundedByTimeout() async {
        // Use a very short timeout so this test doesn't take long.
        let start = Date()
        let result = await locationWithTimeout(TimingOutLocationProvider(), seconds: 0.3)
        let elapsed = Date().timeIntervalSince(start)
        XCTAssertNil(result, "timing-out provider → nil")
        // Should finish well within 1 second: at most ~0.3s + a bit of overhead.
        XCTAssertLessThan(elapsed, 1.5,
                          "locationWithTimeout must not block longer than timeout + overhead")
    }

    // MARK: Camera-staging with denied location → nil exifLat / exifLon

    func testCameraStagingWithDeniedLocationProducesNilCoordinates() async throws {
        let (db, coordinator, dir) = try makeCoordinator()
        defer { try? FileManager.default.removeItem(at: dir) }
        let tripId = try await seedTrip(db)

        // Simulate a camera-captured JPEG (no EXIF GPS, as camera shots from a denied-location
        // session arrive without location).
        let imageData = makePlainJPEG()
        let filename = "camera-test.jpg"

        // Use a denied location provider — same as what TripDetailView does when location is off.
        let coordinate = await locationWithTimeout(DeniedLocationProvider(), seconds: 0.1)
        XCTAssertNil(coordinate, "denied provider → no coordinate for override")

        let item = try await coordinator.stagePhoto(
            imageData: imageData,
            filename: filename,
            tripId: tripId,
            overrideCoordinate: coordinate   // nil → falls through to EXIF (also absent)
        )

        XCTAssertNil(item.exifLat, "no location permission + no EXIF GPS → nil exifLat")
        XCTAssertNil(item.exifLon, "no location permission + no EXIF GPS → nil exifLon")
        XCTAssertEqual(item.stage, .staged)
    }

    // MARK: - Helpers

    private func makeCoordinator() throws -> (AppDatabase, PhotoCaptureCoordinator, URL) {
        let db = try AppDatabase.makeInMemory()
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        return (db, PhotoCaptureCoordinator(database: db, stagingDirectory: dir), dir)
    }

    private func seedTrip(_ db: AppDatabase) async throws -> UUID {
        let id = UUID()
        try await db.dbQueue.write { d in
            try Trip(id: id, name: "Trip", description: nil, slug: nil,
                     photoCount: 0,
                     createdAt: Date(timeIntervalSince1970: 1_700_000_000),
                     cachedAt: Date(timeIntervalSince1970: 1_700_000_000)).insert(d)
        }
        return id
    }

    /// A minimal plain JPEG with no EXIF GPS (matches camera output from a device with
    /// location permission denied).
    private func makePlainJPEG() -> Data {
        let side = 8
        let ctx = CGContext(data: nil, width: side, height: side,
                            bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.setFillColor(CGColor(red: 0.5, green: 0.5, blue: 0.5, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: side, height: side))
        let image = ctx.makeImage()!
        let out = NSMutableData()
        let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(dest, image, nil)
        CGImageDestinationFinalize(dest)
        return out as Data
    }
}
