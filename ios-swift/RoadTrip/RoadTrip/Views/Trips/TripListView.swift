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
                        .swipeActions(edge: .trailing) {
                            Button {
                                archive(trip)
                            } label: {
                                Label("Archive", systemImage: "archivebox")
                            }
                            .tint(.orange)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("My Trips")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink {
                        ArchivedTripsView(database: database, keychain: keychain)
                    } label: {
                        Label("Archived", systemImage: "archivebox")
                    }
                    .accessibilityLabel("Archived")
                }
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
    /// Filters out archived trips (where `archivedAt` is not nil).
    private func observeTrips() async {
        let observation = ValueObservation.tracking { db in
            try Trip.filter(Column("archivedAt") == nil)
                    .order(Column("createdAt").desc)
                    .fetchAll(db)
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
    /// Archived trips are skipped (they remain archived locally and won't be network-revalidated).
    private func revalidateOwnedTrips() async {
        let known = (try? await database.dbQueue.read { try Trip.filter(Column("archivedAt") == nil).fetchAll($0) }) ?? []
        for trip in known {
            guard let token = try? keychain.token(kind: .secret, tripId: trip.id) else { continue }
            await RoadTripAPI.shared.revalidate(tripId: trip.id, secretToken: token.uuidString, into: database, keychain: keychain)
        }
    }

    /// Archives a trip locally by setting `archivedAt = Date()`.
    /// Captured `trip.id` is immutable and safe for async closure (@Sendable).
    /// ValueObservation automatically removes the trip from the list via the filter.
    /// Note: The end-to-end swipe→Archived→Restore UI flow test lands in Phase 3
    /// (testArchiveAndRestoreFlow), so no redundant UI test is added here.
    private func archive(_ trip: Trip) {
        let id = trip.id
        Task {
            try? await database.dbQueue.write { db in
                guard var t = try Trip.fetchOne(db, key: id) else { return }
                t.archivedAt = Date()
                try t.update(db)
            }
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
