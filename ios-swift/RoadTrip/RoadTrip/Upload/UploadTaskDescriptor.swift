import Foundation

/// Correlation key stashed on each background `URLSessionTask.taskDescription`.
///
/// Background sessions survive force-quit: on relaunch the system hands our (fresh,
/// memory-less) delegate the outstanding/finished tasks. `taskDescription` is the one
/// string the system preserves per task, so it's how a `didCompleteWithError` callback
/// recovers *which upload and which block* it belongs to without any in-memory state.
///
/// Format: `<uploadId-uuid>|<blockIndex>` — pipe-separated because a UUID never contains
/// one. Pure value type; round-trips via `encode`/`decode` so it can be unit-tested.
struct UploadTaskDescriptor: Equatable {
    let uploadId: UUID
    let blockIndex: Int

    /// The string to assign to `task.taskDescription`.
    func encode() -> String {
        "\(uploadId.uuidString)|\(blockIndex)"
    }

    /// Recovers a descriptor from a task's `taskDescription`, or `nil` if it isn't ours
    /// (e.g. a stray system task, or a malformed string we should ignore rather than crash).
    static func decode(_ raw: String?) -> UploadTaskDescriptor? {
        guard let raw else { return nil }
        let parts = raw.split(separator: "|", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2,
              let uploadId = UUID(uuidString: String(parts[0])),
              let blockIndex = Int(parts[1]), blockIndex >= 0
        else { return nil }
        return UploadTaskDescriptor(uploadId: uploadId, blockIndex: blockIndex)
    }
}
