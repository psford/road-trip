import SwiftUI
import GRDB

/// Root screen: the list of trips this device knows about, newest first.
struct TripListView: View {
    let database: AppDatabase
    @State private var trips: [Trip] = []

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
        }
        .task { await load() }
    }

    private func load() async {
        trips = (try? await database.dbQueue.read { db in
            try Trip.order(Column("createdAt").desc).fetchAll(db)
        }) ?? []
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
