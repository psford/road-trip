import Foundation
import Security

/// Stores per-trip tokens in the iOS Keychain. Tokens never go in GRDB — this is the
/// single place raw SecretToken / ViewToken values live on the device.
///
/// Layout: one `kSecClassGenericPassword` item per (trip, kind), under a shared
/// `service`, with account `"<kind>-<tripId>"` and the token's UUID string as the value.
struct KeychainStore {
    enum TokenKind: String {
        case secret = "trip-secret"   // upload + view access; defines trip "ownership"
        case view = "trip-view"       // view-only; used to build share links
    }

    enum KeychainError: Error, Equatable {
        case unexpectedStatus(OSStatus)
        case malformedData
    }

    let service: String

    init(service: String = "com.psford.roadtripmap.native") {
        self.service = service
    }

    private func account(_ kind: TokenKind, tripId: UUID) -> String {
        "\(kind.rawValue)-\(tripId.uuidString)"
    }

    private func baseQuery(_ kind: TokenKind, tripId: UUID) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account(kind, tripId: tripId),
        ]
    }

    /// Upsert: stores (or replaces) the token for this trip + kind.
    func setToken(_ token: UUID, kind: TokenKind, tripId: UUID) throws {
        var query = baseQuery(kind, tripId: tripId)
        // Remove any existing item first so this is a clean overwrite.
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = Data(token.uuidString.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
    }

    /// Returns the stored token, or `nil` if none exists for this trip + kind.
    func token(kind: TokenKind, tripId: UUID) throws -> UUID? {
        var query = baseQuery(kind, tripId: tripId)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
        guard let data = item as? Data,
              let string = String(data: data, encoding: .utf8),
              let uuid = UUID(uuidString: string)
        else { throw KeychainError.malformedData }
        return uuid
    }

    /// Removes one token. A missing item is treated as success (idempotent).
    func removeToken(kind: TokenKind, tripId: UUID) throws {
        let status = SecItemDelete(baseQuery(kind, tripId: tripId) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }

    /// Removes both tokens for a trip (called on trip delete).
    func removeAll(tripId: UUID) throws {
        try removeToken(kind: .secret, tripId: tripId)
        try removeToken(kind: .view, tripId: tripId)
    }
}
