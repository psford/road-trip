import Foundation
import GRDB
import Network

/// The single background-`URLSession` uploader (design Phase 6, AC3.1/3.2). One session per
/// process, identified by `backgroundIdentifier`, so block uploads keep running after the app
/// is backgrounded or force-quit and resume on the next launch.
///
/// Why this looks unlike the rest of the app: background sessions are **delegate-based, not
/// async/await**, and their bodies must be **files** (`uploadTask(with:fromFile:)`). So the
/// flow is: `request-upload` → slice the original into block files → one `uploadTask` per
/// block (tagged via `taskDescription`) → `didCompleteWithError` advances the state machine →
/// when every block is in, commit + revalidate. The whole machine lives in GRDB
/// (`UploadQueueItem`), because the process can die between any two callbacks.
///
/// Concurrency: `@unchecked Sendable` is sound here — `URLSession` is thread-safe, **all**
/// upload state is in the thread-safe `AppDatabase`, and the only in-memory mutable state
/// (`backgroundCompletionHandler`, per-block `attempts`) is guarded by `lock`, never held
/// across an `await`.
final class BackgroundUploadSession: NSObject, @unchecked Sendable {
    static let backgroundIdentifier = "com.psford.roadtripmap.native.uploads"
    static let maxAttemptsPerBlock = 6

    // MARK: - Shared instance (configured once at launch with the app's database)

    // Configured + read only on the main thread (App.init / AppDelegate), so unsafe-nonisolated
    // is sound; the explicit annotation documents that and silences the global-state check.
    nonisolated(unsafe) private static var instance: BackgroundUploadSession?

    /// Creates (once) the process-wide session bound to the app's database. Idempotent.
    @discardableResult
    static func configureShared(database: AppDatabase, keychain: KeychainStore = KeychainStore()) -> BackgroundUploadSession {
        if let instance { return instance }
        let created = BackgroundUploadSession(database: database, keychain: keychain)
        created.activate()   // reconnect to the background daemon for this identifier
        instance = created
        return created
    }

    /// The configured shared session, or `nil` before launch wiring runs.
    static var shared: BackgroundUploadSession? { instance }

    // MARK: - Dependencies

    private let database: AppDatabase
    private let keychain: KeychainStore
    private let api: RoadTripAPI
    private let store: UploadStore
    private let fileWriter: UploadBlockFileWriter
    private let configuration: URLSessionConfiguration

    private let lock = NSLock()
    private var backgroundCompletionHandler: HandlerBox?
    private var attempts: [String: Int] = [:]

    // Connectivity watch (lock-guarded). `lastPathSatisfied` starts true so launching online is a
    // no-op (launch already runs `reconcile()`); launching offline then regaining service fires it.
    private let pathMonitor = NWPathMonitor()
    private let monitorQueue = DispatchQueue(label: "\(BackgroundUploadSession.backgroundIdentifier).netmonitor")
    private var monitorStarted = false
    private var lastPathSatisfied = true

    /// Carries UIKit's non-`Sendable` completion handler across the delegate-queue → main-thread
    /// hop. We only ever call it, so `@unchecked Sendable` is safe.
    private struct HandlerBox: @unchecked Sendable { let run: () -> Void }

    /// Lazily built so the delegate (`self`) is fully initialized first. For the real app this
    /// is the `.background` config; tests inject `.ephemeral` to drive the same code paths
    /// deterministically without the background daemon.
    private lazy var session: URLSession =
        URLSession(configuration: configuration, delegate: self, delegateQueue: nil)

    init(database: AppDatabase,
         keychain: KeychainStore = KeychainStore(),
         api: RoadTripAPI = .shared,
         configuration: URLSessionConfiguration = BackgroundUploadSession.makeBackgroundConfiguration(),
         fileWriter: UploadBlockFileWriter = UploadBlockFileWriter()) {
        self.database = database
        self.keychain = keychain
        self.api = api
        self.store = UploadStore(database: database)
        self.fileWriter = fileWriter
        self.configuration = configuration
        super.init()
    }

    static func makeBackgroundConfiguration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.background(withIdentifier: backgroundIdentifier)
        config.isDiscretionary = false            // upload promptly, don't wait for ideal conditions
        config.sessionSendsLaunchEvents = true    // relaunch the app to deliver completion events
        config.allowsCellularAccess = true
        return config
    }

    // MARK: - Public API (fire-and-forget; progress/results surface via ValueObservation)

    /// Begins (or restarts) a staged upload from scratch.
    func start(_ uploadId: UUID) { Task { await beginUpload(uploadId) } }

    /// User-driven retry of a `.failed` upload: wipe progress + block files, then start fresh.
    /// Put Block is idempotent and uncommitted blocks linger server-side, so re-uploading all
    /// blocks is always safe.
    func retry(_ uploadId: UUID) {
        Task {
            await cancelLiveTasks(for: uploadId)
            fileWriter.cleanup(uploadId: uploadId)
            try? await store.resetForRetry(uploadId)
            resetAttempts(uploadId)
            await beginUpload(uploadId)
        }
    }

    /// User-driven dismissal of a stuck/failed upload: cancel tasks, drop the row, delete files.
    func abort(_ uploadId: UUID) {
        Task {
            await cancelLiveTasks(for: uploadId)
            if let item = try? await store.fetch(uploadId) { removeStagedOriginal(item) }
            fileWriter.cleanup(uploadId: uploadId)
            try? await store.delete(uploadId)
            resetAttempts(uploadId)
        }
    }

    /// Materializes the `URLSession` so it re-registers as the delegate for the background
    /// identifier — must run on every launch (including a background relaunch) so the system
    /// can deliver outstanding events to us. Cheap and idempotent. Also starts watching for
    /// connectivity so uploads that waited out a no-service area retry the moment service returns.
    func activate() {
        _ = session
        startNetworkMonitoring()
    }

    /// When the network transitions from unavailable → available, retry everything that was
    /// waiting (a `.staged`/in-flight item with no live tasks re-plans to `.start`/`.resume`).
    /// Started lazily from `activate()` so unit tests that construct the session directly aren't
    /// perturbed by real network state.
    private func startNetworkMonitoring() {
        lock.lock()
        if monitorStarted { lock.unlock(); return }
        monitorStarted = true
        lock.unlock()

        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            let satisfied = path.status == .satisfied
            self.lock.lock()
            let becameReachable = satisfied && !self.lastPathSatisfied
            self.lastPathSatisfied = satisfied
            self.lock.unlock()
            if becameReachable { self.reconcile() }
        }
        pathMonitor.start(queue: monitorQueue)
    }

    /// Reconcile persisted uploads with the system's live tasks on launch — the force-quit
    /// resume path (AC3.2). Safe to call every cold start.
    func reconcile() { Task { await runReconcile() } }

    /// Stores the completion handler iOS hands us when it relaunches the app purely to finish
    /// background events (called from the `AppDelegate`). We invoke it once events drain.
    func saveBackgroundCompletionHandler(_ handler: @escaping () -> Void) {
        lock.lock(); backgroundCompletionHandler = HandlerBox(run: handler); lock.unlock()
    }

    // MARK: - Reconcile

    private func runReconcile() async {
        let items = (try? await store.all()) ?? []
        guard !items.isEmpty else { return }
        let live = await liveTaskDescriptors()
        let actions = UploadReconciler.plan(
            items: items, liveTaskKeys: live,
            fileExists: { FileManager.default.fileExists(atPath: $0.localFilePath) })
        for action in actions {
            switch action {
            case .start(let id): await beginUpload(id)
            case .resume(let id, let indices): await resumeBlocks(id, indices: indices)
            case .commit(let id): if let item = try? await store.fetch(id) { await commit(item) }
            case .wait: break
            case .fail(let id, let reason): try? await store.setFailed(id, message: reason)
            }
        }
    }

    private func liveTaskDescriptors() async -> [UploadTaskDescriptor] {
        await withCheckedContinuation { continuation in
            session.getAllTasks { tasks in
                continuation.resume(returning: tasks.compactMap { UploadTaskDescriptor.decode($0.taskDescription) })
            }
        }
    }

    // MARK: - Start / resume

    /// Registers the upload (idempotent `request-upload`), persists the plan, and enqueues
    /// every block. Used for a fresh start and for a reconciler `.start`.
    private func beginUpload(_ uploadId: UUID) async {
        guard let item = try? await store.fetch(uploadId) else { return }
        guard let token = token(for: item.tripId) else {
            try? await store.setFailed(uploadId, message: "No upload token for this trip"); return
        }
        do {
            let response = try await api.requestUpload(requestBody(item), secretToken: token)
            try await store.persistPlan(uploadId, sasUrl: response.sasUrl,
                                        photoId: response.photoId, blockSize: response.maxBlockSizeBytes)
            guard let planned = try? await store.fetch(uploadId) else { return }
            let total = blockCount(planned)
            guard total > 0 else { try? await store.setFailed(uploadId, message: "The photo file is empty."); return }
            try enqueueBlocks(item: planned, indices: Array(0..<total), sasUrl: response.sasUrl)
        } catch {
            await handleFailure(uploadId, error)
        }
    }

    /// Re-enqueues only the missing blocks after a relaunch, against a freshly refreshed SAS
    /// (the old one may have expired during suspension). Progress is preserved.
    private func resumeBlocks(_ uploadId: UUID, indices: [Int]) async {
        guard let item = try? await store.fetch(uploadId) else { return }
        guard let token = token(for: item.tripId) else {
            try? await store.setFailed(uploadId, message: "No upload token for this trip"); return
        }
        do {
            let response = try await api.requestUpload(requestBody(item), secretToken: token)
            try await store.refreshSAS(uploadId, sasUrl: response.sasUrl)
            guard let refreshed = try? await store.fetch(uploadId) else { return }
            try enqueueBlocks(item: refreshed, indices: indices, sasUrl: response.sasUrl)
        } catch {
            await handleFailure(uploadId, error)
        }
    }

    /// Slices the requested blocks to disk and kicks one file-based background task each.
    private func enqueueBlocks(item: UploadQueueItem, indices: [Int], sasUrl: String) throws {
        let blocks = try fileWriter.prepare(item: item, indices: indices)
        for block in blocks {
            guard let url = BlockUpload.blockPutURL(sasUrl: sasUrl, blockId: block.blockId) else { continue }
            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            request.setValue("BlockBlob", forHTTPHeaderField: "x-ms-blob-type")
            // Body is the file (mandatory for background) — never set httpBody here.
            let task = session.uploadTask(with: request, fromFile: block.fileURL)
            task.taskDescription = UploadTaskDescriptor(uploadId: item.uploadId, blockIndex: block.index).encode()
            task.resume()
        }
    }

    // MARK: - Per-block completion (delegate → here)

    private func handleBlockCompletion(_ descriptor: UploadTaskDescriptor, status: Int?, hadError: Bool) async {
        guard let item = try? await store.fetch(descriptor.uploadId) else { return }   // aborted/committed
        if let status, let transportError = UploadTransportError.classify(status: status) {
            await handleBlockFailure(item, descriptor, transportError)
        } else if status != nil {
            await onBlockSucceeded(item, descriptor)                 // 2xx
        } else {
            // No HTTP response (network drop, or a force-quit cancel). Retry within this run;
            // if the process died, launch reconcile re-enqueues it instead.
            await handleBlockFailure(item, descriptor, .retryable(status: -1))
        }
    }

    private func onBlockSucceeded(_ item: UploadQueueItem, _ descriptor: UploadTaskDescriptor) async {
        resetAttempts(descriptor.uploadId, blockIndex: descriptor.blockIndex)
        let length = blockLength(item, index: descriptor.blockIndex)
        try? await store.markBlockComplete(descriptor.uploadId, index: descriptor.blockIndex, bytes: length)
        fileWriter.removeBlockFile(uploadId: descriptor.uploadId, index: descriptor.blockIndex)

        guard let updated = try? await store.fetch(descriptor.uploadId) else { return }
        let total = blockCount(updated)
        guard total > 0, updated.completedBlockIndices.count >= total else { return }   // more blocks pending
        // Claim the commit so two final blocks finishing together commit only once.
        if (try? await store.claimCommit(descriptor.uploadId)) == true {
            await commit(updated)
        }
    }

    private func handleBlockFailure(_ item: UploadQueueItem, _ descriptor: UploadTaskDescriptor, _ error: UploadTransportError) async {
        switch error {
        case .sasExpired:
            // Refresh SAS + retry. A freshly issued SAS that still 403s is a server/clock fault,
            // so bound the retries (counter resets on success) instead of hammering forever.
            guard bumpAttempt(descriptor.uploadId, blockIndex: descriptor.blockIndex) < Self.maxAttemptsPerBlock else {
                try? await store.setFailed(descriptor.uploadId, message: "Upload authorization kept failing. Tap to retry.")
                fileWriter.cleanup(uploadId: descriptor.uploadId)
                return
            }
            await resumeBlocks(descriptor.uploadId, indices: [descriptor.blockIndex])
        case .retryable:
            await backoffAndRetry(item, descriptor)
        case .permanent(let status):
            try? await store.setFailed(descriptor.uploadId, message: "Upload rejected (HTTP \(status)).")
            fileWriter.cleanup(uploadId: descriptor.uploadId)
        }
    }

    private func backoffAndRetry(_ item: UploadQueueItem, _ descriptor: UploadTaskDescriptor) async {
        let attempt = bumpAttempt(descriptor.uploadId, blockIndex: descriptor.blockIndex)
        guard attempt < Self.maxAttemptsPerBlock else {
            try? await store.setFailed(descriptor.uploadId, message: "Upload kept failing. Tap to retry.")
            fileWriter.cleanup(uploadId: descriptor.uploadId)
            return
        }
        let ms = Backoff.delayMs(attempt: attempt - 1, jitter: Double.random(in: 0..<1))
        try? await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000)
        guard let fresh = try? await store.fetch(descriptor.uploadId), let sasUrl = fresh.sasUrl else { return }
        try? enqueueBlocks(item: fresh, indices: [descriptor.blockIndex], sasUrl: sasUrl)
    }

    // MARK: - Commit

    private func commit(_ item: UploadQueueItem) async {
        guard let token = token(for: item.tripId), let photoId = item.serverPhotoId else {
            try? await store.setFailed(item.uploadId, message: "No upload token for this trip"); return
        }
        do {
            let total = blockCount(item)
            let blockIds = (0..<total).map { BlockUpload.blockId(index: $0) }   // ordered list for Azure
            try await api.commitUpload(secretToken: token, photoId: photoId, blockIds: blockIds)
            // Re-hydrate so the committed photo becomes a local Photo row + map pin.
            await api.revalidate(tripId: item.tripId, secretToken: token, into: database, keychain: keychain)
            try await store.delete(item.uploadId)
            fileWriter.cleanup(uploadId: item.uploadId)
            removeStagedOriginal(item)
            resetAttempts(item.uploadId)
        } catch {
            await handleFailure(item.uploadId, error)
        }
    }

    // MARK: - Helpers

    private func token(for tripId: UUID) -> String? {
        (try? keychain.token(kind: .secret, tripId: tripId))?.uuidString.lowercased()
    }

    private func requestBody(_ item: UploadQueueItem) -> RequestUploadRequest {
        RequestUploadRequest(
            uploadId: item.uploadId.uuidString.lowercased(),
            filename: item.filename, contentType: item.contentType, sizeBytes: item.sizeBytes,
            exif: ExifDTO(gpsLat: item.exifLat, gpsLon: item.exifLon, takenAt: item.takenAt))
    }

    private func blockRanges(_ item: UploadQueueItem) -> [ChunkRange] {
        guard let blockSize = item.blockSizeBytes, blockSize > 0 else { return [] }
        return BlockUpload.chunkRanges(fileSize: Int(item.sizeBytes), chunkSize: blockSize)
    }

    private func blockCount(_ item: UploadQueueItem) -> Int { blockRanges(item).count }

    private func blockLength(_ item: UploadQueueItem, index: Int) -> Int {
        let ranges = blockRanges(item)
        return ranges.indices.contains(index) ? ranges[index].length : 0
    }

    private func removeStagedOriginal(_ item: UploadQueueItem) {
        try? FileManager.default.removeItem(atPath: item.localFilePath)
    }

    private func cancelLiveTasks(for uploadId: UUID) async {
        await withCheckedContinuation { continuation in
            session.getAllTasks { tasks in
                for task in tasks where UploadTaskDescriptor.decode(task.taskDescription)?.uploadId == uploadId {
                    task.cancel()
                }
                continuation.resume()
            }
        }
    }

    // Attempt counter (lock-guarded; never held across an await).
    private func attemptKey(_ uploadId: UUID, _ blockIndex: Int) -> String { "\(uploadId.uuidString)|\(blockIndex)" }

    private func bumpAttempt(_ uploadId: UUID, blockIndex: Int) -> Int {
        let key = attemptKey(uploadId, blockIndex)
        lock.lock(); defer { lock.unlock() }
        attempts[key, default: 0] += 1
        return attempts[key]!
    }

    private func resetAttempts(_ uploadId: UUID, blockIndex: Int) {
        lock.lock(); attempts[attemptKey(uploadId, blockIndex)] = nil; lock.unlock()
    }

    private func resetAttempts(_ uploadId: UUID) {
        lock.lock(); attempts = attempts.filter { !$0.key.hasPrefix(uploadId.uuidString) }; lock.unlock()
    }

    /// Apply the offline policy to a thrown error. A transport-level failure (no service / timeout)
    /// leaves the upload in its current stage so a later `reconcile()` — triggered when connectivity
    /// returns — retries it; anything else marks it `.failed` so the banner can surface Retry.
    private func handleFailure(_ uploadId: UUID, _ error: Error) async {
        switch UploadFailurePolicy.decide(error, message: friendlyError(error)) {
        case .waitForNetwork: break
        case .fail(let message): try? await store.setFailed(uploadId, message: message)
        }
    }

    private func friendlyError(_ error: Error) -> String {
        switch error {
        case UploadTransportError.permanent(let status): return "Upload rejected (HTTP \(status))."
        case UploadTransportError.retryable: return "Upload kept failing. Tap to retry."
        case RoadTripAPIError.networkUnavailable: return "Couldn’t reach the server. Check your connection."
        case RoadTripAPIError.serverError(let detail): return "Server error: \(detail)"
        default: return "Upload failed. Tap to retry."
        }
    }
}

// MARK: - URLSession delegate (system calls these on the session's delegate queue)

extension BackgroundUploadSession: URLSessionDelegate, URLSessionTaskDelegate {
    /// One block task finished (or failed/cancelled). Hand off to the async state machine.
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let descriptor = UploadTaskDescriptor.decode(task.taskDescription) else { return }
        let status = (task.response as? HTTPURLResponse)?.statusCode
        Task { await handleBlockCompletion(descriptor, status: status, hadError: error != nil) }
    }

    /// All queued background events for this session have been delivered — fire the saved
    /// completion handler on the main thread so UIKit can snapshot the UI and suspend us.
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        lock.lock(); let box = backgroundCompletionHandler; backgroundCompletionHandler = nil; lock.unlock()
        if let box { DispatchQueue.main.async { box.run() } }
    }
}
