import SwiftUI

/// Modal sheet for importing a trip the device doesn't own yet via its SecretToken
/// (design AC1.3). Validates the token is a GUID, fetches the trip + photos, stores the
/// token in the Keychain, and hydrates the local cache. An unknown token surfaces an
/// error with no local writes (AC1.5).
struct PasteTokenView: View {
    let database: AppDatabase
    var keychain = KeychainStore()

    @Environment(\.dismiss) private var dismiss

    @State private var token = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var trimmedToken: String {
        token.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Secret token", text: $token, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.system(.body, design: .monospaced))
                        .lineLimit(1...3)
                } header: {
                    Text("Paste a trip's secret token")
                } footer: {
                    Text("The token from a trip's link, e.g. 123e4567-e89b-12d3-a456-426614174000.")
                }
                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.callout)
                    }
                }
            }
            .navigationTitle("Import Trip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button("Import") { Task { await importTrip() } }
                            .disabled(trimmedToken.isEmpty)
                    }
                }
            }
            .interactiveDismissDisabled(isSubmitting)
        }
    }

    private func importTrip() async {
        isSubmitting = true
        errorMessage = nil
        do {
            _ = try await RoadTripAPI.shared.importTrip(
                tokenString: trimmedToken, into: database, keychain: keychain)
            dismiss()
        } catch {
            errorMessage = Self.message(for: error)
            isSubmitting = false
        }
    }

    static func message(for error: Error) -> String {
        switch error {
        case RoadTripAPIError.notFound:
            return "No trip found for that token. Double-check it and try again."
        case RoadTripAPIError.networkUnavailable:
            return "Couldn't reach the server. Check your connection and try again."
        default:
            return "Something went wrong. Please try again."
        }
    }
}
