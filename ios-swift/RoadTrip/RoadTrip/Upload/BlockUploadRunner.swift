import Foundation

/// Uploads a file's blocks with retry/backoff and reactive SAS refresh — the resilient
/// transport from `uploadTransport.js`, expressed as pure orchestration over injected
/// effects so it can be tested without a network.
///
/// Per block: `put` until it succeeds. A `.sasExpired` (403) refreshes the SAS and retries
/// immediately (not counted against the attempt budget). A `.retryable` waits via `backoff`
/// and retries up to `maxAttemptsPerBlock`. A `.permanent` error aborts the whole upload.
enum BlockUploadRunner {
    static func run(
        ranges: [ChunkRange],
        initialSasUrl: String,
        maxAttemptsPerBlock: Int = 6,
        chunk: (ChunkRange) throws -> Data,
        put: (_ sasUrl: String, _ blockId: String, _ data: Data) async throws -> Void,
        refreshSAS: () async throws -> String,
        backoff: (_ attempt: Int) async -> Void,
        onProgress: (_ completedIndex: Int) async -> Void
    ) async throws -> [String] {
        var sasUrl = initialSasUrl
        var blockIds: [String] = []

        for range in ranges {
            let data = try chunk(range)
            var attempt = 0
            while true {
                do {
                    try await put(sasUrl, range.blockId, data)
                    break   // block done
                } catch UploadTransportError.sasExpired {
                    sasUrl = try await refreshSAS()
                    continue   // retry immediately against the fresh URL
                } catch let UploadTransportError.retryable(status) {
                    guard attempt < maxAttemptsPerBlock - 1 else {
                        throw UploadTransportError.retryable(status: status)
                    }
                    await backoff(attempt)
                    attempt += 1
                    continue
                }
                // .permanent (and any other error) propagates out and aborts the upload.
            }
            blockIds.append(range.blockId)
            await onProgress(range.index)
        }

        return blockIds
    }
}
