import Foundation

/// Native half of the bridge for one open document. Owns the `DocumentSession`, answers `saveScene`
/// with a coordinated write, tracks the web core's dirty state, and implements the D8 flush points
/// (background, close, foreground conflict). Transport-agnostic: tests drive it with
/// `MemoryBridgeTransport`.
@MainActor
public final class DocumentBridgeController {
    public let session: DocumentSession
    private let transport: BridgeTransport
    private let pdfURLForWeb: String
    private let platform: BridgePlatform
    private var nextFlush = 1
    private var pendingFlushes: [String: CheckedContinuation<Bool, Never>] = [:]
    public private(set) var webIsReady = false
    public private(set) var webHasDirtyPages = false

    /// Called on main for exports, logs and storage-mode changes; set by the app shell.
    public var onExportReady: ((String, Data) -> Void)?
    public var onExportFailed: ((String) -> Void)?
    public var onLog: ((BridgeLogLevel, String) -> Void)?
    public var onStorageModeChange: ((StorageMode) -> Void)?

    public init(session: DocumentSession, transport: BridgeTransport, pdfURLForWeb: String, platform: BridgePlatform) {
        self.session = session
        self.transport = transport
        self.pdfURLForWeb = pdfURLForWeb
        self.platform = platform
        transport.onReceive = { [weak self] message in self?.handle(message) }
    }

    private func handle(_ message: WebToNativeMessage) {
        switch message {
        case .ready:
            webIsReady = true
            let opened = session.open()
            onStorageModeChange?(opened.storageMode)
            transport.send(.openDocument(
                pdfURL: pdfURLForWeb,
                fileName: session.document.fileName,
                sha256: session.document.sha256,
                sidecarJSON: opened.sidecarJSON,
                platform: platform,
                storageMode: opened.storageMode
            ))
        case let .saveScene(requestId, sidecarJSON):
            let before = session.storageMode
            let outcome = session.save(sidecarJSON)
            if outcome.storageMode != before { onStorageModeChange?(outcome.storageMode) }
            transport.send(.saveResult(requestId: requestId, ok: outcome.ok, storageMode: outcome.storageMode, error: outcome.error))
        case let .dirtyChanged(dirty):
            webHasDirtyPages = dirty
        case let .flushComplete(requestId, saved):
            pendingFlushes.removeValue(forKey: requestId)?.resume(returning: saved)
        case let .exportReady(fileName, pdfBase64):
            if let data = Data(base64Encoded: pdfBase64) {
                onExportReady?(fileName, data)
            } else {
                onExportFailed?("export payload was not valid base64")
            }
        case let .exportFailed(message):
            onExportFailed?(message)
        case let .log(level, message):
            onLog?(level, message)
        }
    }

    /// Asks the web core to save any dirty pages now and waits for its `flushComplete`.
    /// The shell wraps this in a background task on iOS (D8: flush on backgrounding).
    public func requestFlush(_ reason: FlushReason) async -> Bool {
        guard webIsReady else { return false }
        let requestId = "flush-\(nextFlush)"
        nextFlush += 1
        return await withCheckedContinuation { continuation in
            pendingFlushes[requestId] = continuation
            transport.send(.flushRequest(requestId: requestId, reason: reason))
        }
    }

    /// Resolves every outstanding flush (e.g. the web view went away) so no caller waits forever.
    public func abandonPendingFlushes() {
        let pending = pendingFlushes
        pendingFlushes.removeAll()
        for continuation in pending.values { continuation.resume(returning: false) }
    }

    /// D8 foreground rule.
    @discardableResult
    public func handleForeground() async -> ReconcileAction {
        guard webIsReady else { return .upToDate }
        let action = session.reconcileOnForeground(hasDirtyPages: webHasDirtyPages)
        switch action {
        case .upToDate:
            break
        case let .reload(sidecarJSON):
            transport.send(.reloadScene(sidecarJSON: sidecarJSON))
        case .overwriteAfterBackup:
            _ = await requestFlush(.conflict)
        }
        return action
    }

    /// Flushes and snapshots the final state; call before the document view is torn down.
    public func close() async {
        _ = await requestFlush(.close)
        session.close()
    }

    public func requestExport() {
        transport.send(.requestExport)
    }
}
