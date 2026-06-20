import XCTest
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers
@testable import RoadTrip

/// Phase 5: HEIC detection + JPEG transcode (design `native-ios.AC2.2`). The server's
/// SkiaSharp pipeline doesn't handle HEIC reliably, so the client transcodes before upload.
final class HEICTranscoderTests: XCTestCase {

    func testJPEGIsNotDetectedAsHEIC() {
        let jpeg = makeImageData(uti: UTType.jpeg)
        XCTAssertFalse(HEICTranscoder.isHEIC(jpeg))
    }

    func testHEICIsDetected() throws {
        guard let heic = makeImageData(utiOrNil: UTType.heic) else {
            throw XCTSkip("HEIC encoding unavailable on this simulator")
        }
        XCTAssertTrue(HEICTranscoder.isHEIC(heic))
    }

    func testTranscodeProducesDecodableJPEG() throws {
        guard let heic = makeImageData(utiOrNil: UTType.heic) else {
            throw XCTSkip("HEIC encoding unavailable on this simulator")
        }
        let jpeg = try XCTUnwrap(HEICTranscoder.transcodedToJPEG(heic), "transcode should produce data")

        // JPEG SOI marker is 0xFF 0xD8.
        XCTAssertEqual(Array(jpeg.prefix(2)), [0xFF, 0xD8], "output should be JPEG")
        XCTAssertFalse(HEICTranscoder.isHEIC(jpeg), "output should no longer be HEIC")
        XCTAssertNotNil(CGImageSourceCreateWithData(jpeg as CFData, nil), "output should decode as an image")
    }

    // MARK: - Helpers

    private func makeImageData(uti: UTType) -> Data {
        makeImageData(utiOrNil: uti)!
    }

    /// Encodes a tiny solid image as the given type. Returns nil if the encoder is
    /// unavailable (e.g. HEIC on some simulators) so callers can skip.
    private func makeImageData(utiOrNil uti: UTType) -> Data? {
        let side = 8
        let ctx = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8,
                            bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.setFillColor(CGColor(red: 0.2, green: 0.5, blue: 0.8, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: side, height: side))
        let image = ctx.makeImage()!

        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, uti.identifier as CFString, 1, nil) else {
            return nil
        }
        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest), out.length > 0 else { return nil }
        return out as Data
    }
}
