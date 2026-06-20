import Foundation
import ImageIO
import UniformTypeIdentifiers
import UIKit

/// Detects HEIC/HEIF source images and transcodes them to JPEG before upload.
///
/// The .NET server's SkiaSharp processing doesn't handle HEIC reliably, so the client
/// converts HEIC (Apple's default camera format) to JPEG client-side. JPEG and other
/// formats pass through untouched.
enum HEICTranscoder {
    /// True if the bytes are HEIC/HEIF, determined from the image source's UTI.
    static func isHEIC(_ data: Data) -> Bool {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let uti = CGImageSourceGetType(source) as String?
        else { return false }
        guard let type = UTType(uti) else { return false }
        return type.conforms(to: .heic) || type.conforms(to: .heif)
    }

    /// Transcodes image bytes to JPEG (quality 1.0). Returns nil if the bytes don't
    /// decode as an image.
    static func transcodedToJPEG(_ data: Data) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        return image.jpegData(compressionQuality: 1.0)
    }
}
