import Foundation

/// Runs an optimistic mutation (design AC4): apply the change to the local cache first so
/// the UI updates immediately, then perform the server effect, reverting the local change
/// if the server fails. The original error is rethrown so the caller can surface a toast.
///
/// If `apply` itself throws, the server is never called and there's nothing to revert.
enum OptimisticMutation {
    static func run(
        apply: () async throws -> Void,
        server: () async throws -> Void,
        revert: () async throws -> Void
    ) async throws {
        try await apply()
        do {
            try await server()
        } catch {
            try? await revert()
            throw error
        }
    }
}
