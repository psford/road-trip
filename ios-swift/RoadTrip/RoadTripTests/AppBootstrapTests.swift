import XCTest
import GRDB
@testable import RoadTrip

/// Launch-time DB seeding policy. SampleData trips have no Keychain token / server identity,
/// so presenting them in real runs made "Add Photo" fail ("No upload token for this trip").
/// They're now scaffolding for UI tests only; real launches start empty.
final class AppBootstrapTests: XCTestCase {

    func testNormalLaunchStartsEmpty() throws {
        let db = try AppDatabase.makeInMemory()
        try AppBootstrap.prepare(db, isUITest: false)
        let trips = try db.dbQueue.read { try Trip.fetchCount($0) }
        XCTAssertEqual(trips, 0, "a real launch must not seed un-uploadable sample trips")
    }

    func testUITestLaunchSeedsSampleData() throws {
        let db = try AppDatabase.makeInMemory()
        try AppBootstrap.prepare(db, isUITest: true)
        let trips = try db.dbQueue.read { try Trip.fetchCount($0) }
        XCTAssertGreaterThan(trips, 0, "UI tests get a deterministic SampleData fixture")
    }
}
