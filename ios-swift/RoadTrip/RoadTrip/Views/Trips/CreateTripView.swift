import SwiftUI

/// Modal sheet for creating a new trip (design AC1.1). On submit it calls the server,
/// stores the returned tokens in the Keychain, inserts the local Trip row, and dismisses.
/// The list updates on its own via GRDB ValueObservation — no manual refresh needed.
struct CreateTripView: View {
    let database: AppDatabase
    var keychain = KeychainStore()

    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var description = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    /// Trimmed name; the Create button is disabled until it's non-empty.
    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Trip name", text: $name)
                        .textInputAutocapitalization(.words)
                    TextField("Description (optional)", text: $description, axis: .vertical)
                        .lineLimit(1...4)
                }
                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.callout)
                    }
                }
            }
            .navigationTitle("New Trip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button("Create") { Task { await create() } }
                            .disabled(trimmedName.isEmpty)
                    }
                }
            }
            .interactiveDismissDisabled(isSubmitting)
        }
    }

    private func create() async {
        isSubmitting = true
        errorMessage = nil
        let trimmedDescription = description.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            _ = try await RoadTripAPI.shared.createTrip(
                name: trimmedName,
                description: trimmedDescription.isEmpty ? nil : trimmedDescription,
                into: database, keychain: keychain)
            dismiss()
        } catch {
            errorMessage = Self.message(for: error)
            isSubmitting = false
        }
    }

    static func message(for error: Error) -> String {
        switch error {
        case RoadTripAPIError.networkUnavailable:
            return "Couldn't reach the server. Check your connection and try again."
        case RoadTripAPIError.serverError(let detail):
            return "The server rejected the request (\(detail))."
        default:
            return "Something went wrong. Please try again."
        }
    }
}
