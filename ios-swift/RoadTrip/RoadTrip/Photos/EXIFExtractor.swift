import Foundation
import ImageIO
import CoreLocation

/// GPS coordinate + capture date pulled from an image's embedded metadata.
struct PhotoMetadata: Equatable {
    var lat: Double?
    var lng: Double?
    /// EXIF `DateTimeOriginal` (camera capture time), if present.
    var takenAt: Date?

    /// Convenience: a coordinate when both lat and lng are present.
    var coordinate: CLLocationCoordinate2D? {
        guard let lat, let lng else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }
}

/// Reads GPS coordinates and capture date from raw image bytes.
///
/// `PhotosPicker` strips EXIF for privacy, so the capture pipeline feeds this the raw
/// bytes from `PHImageManager.requestImageDataAndOrientation` instead (see
/// `PhotoCaptureCoordinator`). GPS is stored as magnitude + hemisphere ref, so southern
/// latitudes and western longitudes must be negated.
enum EXIFExtractor {
    static func extract(from data: Data) -> PhotoMetadata {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        else { return PhotoMetadata() }

        var meta = PhotoMetadata()

        if let gps = props[kCGImagePropertyGPSDictionary] as? [CFString: Any] {
            if let value = gps[kCGImagePropertyGPSLatitude] as? Double {
                let ref = gps[kCGImagePropertyGPSLatitudeRef] as? String
                meta.lat = (ref == "S") ? -value : value
            }
            if let value = gps[kCGImagePropertyGPSLongitude] as? Double {
                let ref = gps[kCGImagePropertyGPSLongitudeRef] as? String
                meta.lng = (ref == "W") ? -value : value
            }
        }

        if let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any],
           let raw = exif[kCGImagePropertyExifDateTimeOriginal] as? String {
            meta.takenAt = exifDateFormatter.date(from: raw)
        }

        return meta
    }

    /// EXIF dates are formatted `yyyy:MM:dd HH:mm:ss` with no timezone; parse as UTC for
    /// a stable, locale-independent instant.
    private static let exifDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy:MM:dd HH:mm:ss"
        return f
    }()
}
