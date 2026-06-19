import SwiftUI
import GRDB

/// Root screen: the list of trips this device knows about, newest first.
struct TripListView: View {
    let database: AppDatabase
    var keychain = KeychainStore()

    @State private var trips: [Trip] = []
    @State private var showingCreate = false
    @State private var showingImport = false

    var body: some View {
        NavigationStack {
            Group {
                if trips.isEmpty {
                    ContentUnavailableView("No trips yet", systemImage: "map",
                                           description: Text("Trips you create or import will show up here."))
                } else {
                    List(trips) { trip in
                        NavigationLink {
                            TripDetailView(database: database, trip: trip)
                        } label: {
                            TripRow(trip: trip)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("My Trips")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showingImport = true } label: {
                        Label("Import via Token", systemImage: "square.and.arrow.down")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingCreate = true } label: {
                        Label("New Trip", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingCreate) {
                CreateTripView(database: database, keychain: keychain)
            }
            .sheet(isPresented: $showingImport) {
                PasteTokenView(database: database, keychain: keychain)
            }
        }
        // ValueObservation keeps `trips` in sync with GRDB, so create/import/revalidate
        // writes refresh the list automatically (no manual reload).
        .task { await observeTrips() }
        // Stale-while-revalidate: refresh owned trips from the server in the background.
        .task { await revalidateOwnedTrips() }
    }

    /// Streams the trip list from GRDB; re-fires whenever any trip row changes.
    private func observeTrips() async {
        let observation = ValueObservation.tracking { db in
            try Trip.order(Column("createdAt").desc).fetchAll(db)
        }
        do {
            for try await rows in observation.values(in: database.dbQueue) {
                trips = rows
            }
        } catch {
            print("observeTrips: \(error)")
        }
    }

    /// For each trip with a SecretToken in the Keychain, refresh metadata + photos.
    /// Sample/offline trips (no token) are left as-is.
    private func revalidateOwnedTrips() async {
        let known = (try? await database.dbQueue.read { try Trip.fetchAll($0) }) ?? []
        for trip in known {
            guard let token = try? keychain.token(kind: .secret, tripId: trip.id) else { continue }
            await RoadTripAPI.shared.revalidate(tripId: trip.id, secretToken: token.uuidString, into: database, keychain: keychain)
        }
    }
}

private struct TripRow: View {
    let trip: Trip

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(trip.name)
                .font(.headline)
            if let description = trip.description, !description.isEmpty {
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Text("\(trip.photoCount) photos · \(trip.createdAt.formatted(date: .abbreviated, time: .omitted))")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}
