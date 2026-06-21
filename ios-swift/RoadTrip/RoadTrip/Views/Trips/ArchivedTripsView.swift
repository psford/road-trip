import SwiftUI
import GRDB

/// View for managing archived trips: restore or permanently delete.
/// Mirrors TripListView's structure (injected database + keychain, ValueObservation + @State trips).
struct ArchivedTripsView: View {
    let database: AppDatabase
    var keychain = KeychainStore()

    @State private var trips: [Trip] = []
    @State private var pendingDelete: Trip?
    @State private var deleteError: String?
    @State private var restoreError: String?

    var body: some View {
        archivedContent
            .navigationTitle("Archived")
            .confirmationDialog("Delete permanently?", isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ), titleVisibility: .visible) {
                if let trip = pendingDelete {
                    Button("Delete permanently", role: .destructive) {
                        Task {
                            await deletePermanently(trip)
                        }
                    }
                    Button("Cancel", role: .cancel) {}
                }
            } message: {
                if let trip = pendingDelete {
                    Text("This permanently deletes \"\(trip.name)\" and its photos.")
                }
            }
            .alert("Couldn't delete trip", isPresented: Binding(
                get: { deleteError != nil },
                set: { if !$0 { deleteError = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(deleteError ?? "")
            }
            .alert("Couldn't restore trip", isPresented: Binding(
                get: { restoreError != nil },
                set: { if !$0 { restoreError = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(restoreError ?? "")
            }
            .task { await observeArchived() }
    }

    @ViewBuilder
    private var archivedContent: some View {
        if trips.isEmpty {
            ContentUnavailableView("No archived trips", systemImage: "archivebox")
        } else {
            tripsList
        }
    }

    private var tripsList: some View {
        List(trips) { trip in
            ArchivedTripRow(trip: trip, onRestore: { restore(trip) }, onDelete: { pendingDelete = trip })
        }
        .listStyle(.plain)
    }

    /// Streams archived trips from GRDB; re-fires whenever any trip row changes.
    /// Filters for archived trips (where `archivedAt` is not nil), ordered newest first.
    private func observeArchived() async {
        let observation = ValueObservation.tracking { db in
            try Trip.filter(Column("archivedAt") != nil)
                    .order(Column("createdAt").desc)
                    .fetchAll(db)
        }
        do {
            for try await rows in observation.values(in: database.dbQueue) {
                trips = rows
            }
        } catch {
            print("observeArchived: \(error)")
        }
    }

    /// Restores a trip by setting `archivedAt = nil`.
    /// Captured `trip.id` is immutable and safe for async closure (@Sendable).
    /// ValueObservation automatically removes it from the archived list via the filter.
    /// Surfaces errors via .alert for symmetry with deletePermanently.
    private func restore(_ trip: Trip) {
        let id = trip.id
        Task {
            do {
                try await database.dbQueue.write { db in
                    guard var t = try Trip.fetchOne(db, key: id) else { return }
                    t.archivedAt = nil
                    try t.update(db)
                }
            } catch {
                restoreError = "Couldn't restore trip. Please try again."
            }
        }
    }

    /// Permanently deletes a trip by delegating to RoadTripAPI.deleteTrip.
    /// This performs server DELETE (if a secret token exists) + local cleanup + Keychain cleanup.
    /// On error, surfaces the error via .alert.
    private func deletePermanently(_ trip: Trip) async {
        do {
            try await RoadTripAPI.shared.deleteTrip(trip, from: database, keychain: keychain)
        } catch RoadTripAPIError.networkUnavailable {
            deleteError = "Couldn't reach the server. Check your connection and try again."
        } catch {
            deleteError = "The server couldn't delete this trip. Please try again."
        }
    }
}

private struct ArchivedTripRow: View {
    let trip: Trip
    let onRestore: () -> Void
    let onDelete: () -> Void

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
        .swipeActions(edge: .trailing) {
            Button {
                onRestore()
            } label: {
                Label("Restore", systemImage: "arrow.uturn.backward")
            }
            .tint(.blue)
            .accessibilityIdentifier("restore-trip")

            Button {
                onDelete()
            } label: {
                Label("Delete permanently", systemImage: "trash")
            }
            .tint(.red)
            .accessibilityIdentifier("delete-permanently-action")
        }
    }
}
