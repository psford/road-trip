import XCTest
@testable import RoadTrip

/// The map/strip/popup all render a single unified list: committed photos plus optimistic
/// (staged, not-yet-uploaded) photos, so a photo added in a no-service area behaves exactly like a
/// posted one (tap, swipe) — only an upload marker differs. Pure derivation.
final class DisplayPhotosTests: XCTestCase {

    private func upload(stage: UploadStage = .staged,
                        lat: Double? = 44.0, lon: Double? = -71.0,
                        uploadId: UUID = UUID()) -> UploadQueueItem {
        let now = Date()
        return UploadQueueItem(
            uploadId: uploadId, tripId: UUID(),
            localFilePath: "/tmp/\(uploadId).jpg", filename: "x.jpg", contentType: "image/jpeg",
            sizeBytes: 1000, exifLat: lat, exifLon: lon, takenAt: nil,
            stage: stage, bytesUploaded: 0, blockIds: [],
            sasUrl: nil, displaySasUrl: nil, thumbSasUrl: nil, blobPath: nil, sasIssuedAt: nil,
            errorMessage: nil, createdAt: now, updatedAt: now)
    }

    private func committed(id: Int = 1, uploadId: UUID? = nil) -> Photo {
        Photo(id: id, tripId: UUID(), thumbnailUrl: "https://s/t", displayUrl: "https://s/d",
              originalUrl: "https://s/o", lat: 1, lng: 2, placeName: "P", caption: nil,
              takenAt: nil, uploadId: uploadId)
    }

    func testCommittedOnlyPassThroughUnchanged() {
        let photos = [committed(id: 1), committed(id: 2)]
        XCTAssertEqual(DisplayPhotos.build(committed: photos, pending: []), photos)
    }

    func testStagedUploadBecomesOptimisticPhotoAppendedAfterCommitted() {
        let up = upload(stage: .staged, lat: 44.5, lon: -71.5)
        let result = DisplayPhotos.build(committed: [committed(id: 1)], pending: [up])

        XCTAssertEqual(result.count, 2)
        XCTAssertEqual(result[0].id, 1, "committed photos come first")
        let optimistic = result[1]
        XCTAssertTrue(optimistic.isOptimistic, "the staged photo is marked optimistic")
        XCTAssertEqual(optimistic.uploadId, up.uploadId)
        XCTAssertEqual(optimistic.lat, 44.5)
        XCTAssertEqual(optimistic.lng, -71.5)
        XCTAssertTrue(optimistic.displayUrl.hasPrefix("file://"),
                      "an optimistic photo's image is the local staged file")
        XCTAssertTrue(optimistic.displayUrl.contains(up.uploadId.uuidString))
    }

    func testUploadWithoutCoordsIsNotIncluded() {
        let result = DisplayPhotos.build(committed: [], pending: [upload(lat: nil, lon: nil)])
        XCTAssertTrue(result.isEmpty)
    }

    func testDoneAndFailedUploadsAreNotIncluded() {
        let result = DisplayPhotos.build(committed: [],
                                         pending: [upload(stage: .done), upload(stage: .failed)])
        XCTAssertTrue(result.isEmpty)
    }

    func testCommittedPhotoSuppressesItsOptimisticDuplicate() {
        let id = UUID()
        let result = DisplayPhotos.build(committed: [committed(id: 5, uploadId: id)],
                                         pending: [upload(stage: .committing, uploadId: id)])
        XCTAssertEqual(result.count, 1, "the committed photo replaces its optimistic twin")
        XCTAssertFalse(result[0].isOptimistic)
    }

    func testCommittedPhotoAtSameCoordinateSuppressesOptimistic() {
        // Server-hydrated photos carry uploadId: nil, so the commit hand-off must de-dup by
        // location: during commit the committed twin sits at the SAME coordinate as the optimistic.
        let committedAtSpot = Photo(id: 9, tripId: UUID(), thumbnailUrl: "https://s/t",
                                    displayUrl: "https://s/d", originalUrl: "https://s/o",
                                    lat: 44.5, lng: -71.5, placeName: "Bixby", caption: nil,
                                    takenAt: nil, uploadId: nil)
        let result = DisplayPhotos.build(committed: [committedAtSpot],
                                         pending: [upload(stage: .committing, lat: 44.5, lon: -71.5)])
        XCTAssertEqual(result.count, 1, "an optimistic photo at a committed photo's coordinate is suppressed (commit hand-off)")
        XCTAssertFalse(result[0].isOptimistic)
    }

    func testOptimisticAtDifferentCoordinateIsKept() {
        let committedAtSpot = Photo(id: 9, tripId: UUID(), thumbnailUrl: "", displayUrl: "",
                                    originalUrl: "", lat: 44.5, lng: -71.5, placeName: "P",
                                    caption: nil, takenAt: nil, uploadId: nil)
        let result = DisplayPhotos.build(committed: [committedAtSpot],
                                         pending: [upload(stage: .staged, lat: 40.0, lon: -71.0)])
        XCTAssertEqual(result.count, 2, "a pending photo at a different location is NOT suppressed")
    }

    func testCommittedPhotosAreNotOptimistic() {
        XCTAssertFalse(committed(id: 1).isOptimistic)
    }

    func testOptimisticIDsDifferForUUIDsThatShareLeadingBytes() {
        // Two uploads whose UUIDs differ only in a trailing byte must still get distinct optimistic
        // ids — otherwise SwiftUI ForEach(id:) sees duplicate ids and mis-diffs the cells.
        let a = UUID(uuid: (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16))
        let b = UUID(uuid: (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 99))
        let pa = DisplayPhotos.build(committed: [], pending: [upload(uploadId: a)]).first
        let pb = DisplayPhotos.build(committed: [], pending: [upload(uploadId: b)]).first
        XCTAssertNotNil(pa); XCTAssertNotNil(pb)
        XCTAssertNotEqual(pa?.id, pb?.id, "distinct uploads must get distinct optimistic ids")
        XCTAssertTrue((pa?.id ?? 0) < 0 && (pb?.id ?? 0) < 0, "optimistic ids are negative")
    }
}
