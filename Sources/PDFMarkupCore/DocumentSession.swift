import Foundation

/// D8 foreground rule: what to do when the app returns to the foreground.
public enum ReconcileAction: Equatable, Sendable {
    /// Disk matches what this session last read or wrote.
    case upToDate
    /// The sidecar changed on disk and nothing is dirty: reload it into the web core.
    case reload(sidecarJSON: String)
    /// The sidecar changed on disk while pages are dirty: the external version was backed up to the
    /// ring; flush the web core so it overwrites (last-write-wins, v1).
    case overwriteAfterBackup
}

public enum ForegroundReconciler {
    /// Pure decision. `onDisk == nil` (sidecar deleted elsewhere) keeps the in-memory scene.
    public static func decide(lastKnown: Data?, onDisk: Data?, hasDirtyPages: Bool) -> ReconcileAction {
        guard let onDisk, onDisk != lastKnown else { return .upToDate }
        if hasDirtyPages { return .overwriteAfterBackup }
        return .reload(sidecarJSON: String(decoding: onDisk, as: UTF8.self))
    }
}

public struct OpenedSidecar: Equatable, Sendable {
    public let sidecarJSON: String?
    public let storageMode: StorageMode
}

public struct SaveOutcome: Equatable, Sendable {
    public let ok: Bool
    public let storageMode: StorageMode
    public let error: String?
}

/// One open document's sidecar lifecycle: open, coordinated saves with automatic D1 fallback,
/// the D8 version ring and foreground reconciliation. No WKWebView, no UI — fully testable.
public final class DocumentSession {
    public let document: DocumentIdentity
    private let primary: SidecarStorageProvider?
    private let fallback: SidecarStorageProvider
    private let ring: SidecarVersionRing
    public private(set) var storageMode: StorageMode
    /// Bytes this session last read from or wrote to the active store.
    private var lastKnown: Data?

    /// - Parameters:
    ///   - primary: the sibling store when a root covers the PDF; nil → fallback mode from the start.
    ///   - fallback: the app-container store.
    public init(document: DocumentIdentity, primary: SidecarStorageProvider?, fallback: SidecarStorageProvider, ring: SidecarVersionRing) {
        self.document = document
        self.primary = primary
        self.fallback = fallback
        self.ring = ring
        storageMode = primary == nil ? .fallback : .sibling
    }

    private var active: SidecarStorageProvider {
        if storageMode == .sibling, let primary { return primary }
        return fallback
    }

    /// Reads the sidecar. In sibling mode a missing sibling falls back to an earlier fallback copy
    /// (e.g. written while the folder was not granted). The loaded bytes go into the ring before any
    /// save can overwrite them, so even a malformed sidecar is preserved.
    public func open() -> OpenedSidecar {
        var data: Data?
        if storageMode == .sibling, let primary {
            do {
                data = try primary.readSidecar(for: document)
                lastKnown = data
            } catch {
                storageMode = .fallback // sibling unreadable → behave as fallback (D1)
            }
        }
        if data == nil {
            data = try? fallback.readSidecar(for: document)
            if storageMode == .fallback { lastKnown = data }
        }
        if let data { _ = try? ring.push(data, for: document.sha256) }
        return OpenedSidecar(sidecarJSON: data.map { String(decoding: $0, as: UTF8.self) }, storageMode: storageMode)
    }

    /// Coordinated atomic write. If the sibling write fails, switches to the fallback store for the
    /// rest of the session (D1) and writes there.
    public func save(_ sidecarJSON: String) -> SaveOutcome {
        let data = Data(sidecarJSON.utf8)
        if storageMode == .sibling, let primary {
            do {
                try primary.writeSidecar(data, for: document)
                lastKnown = data
                return SaveOutcome(ok: true, storageMode: .sibling, error: nil)
            } catch {
                storageMode = .fallback
            }
        }
        do {
            try fallback.writeSidecar(data, for: document)
            lastKnown = data
            return SaveOutcome(ok: true, storageMode: .fallback, error: nil)
        } catch {
            return SaveOutcome(ok: false, storageMode: storageMode, error: error.localizedDescription)
        }
    }

    /// D8 foreground check. Backs up an external version to the ring before it is overwritten.
    public func reconcileOnForeground(hasDirtyPages: Bool) -> ReconcileAction {
        let onDisk = try? active.readSidecar(for: document)
        let action = ForegroundReconciler.decide(lastKnown: lastKnown, onDisk: onDisk, hasDirtyPages: hasDirtyPages)
        switch action {
        case .upToDate:
            break
        case .reload:
            lastKnown = onDisk
        case .overwriteAfterBackup:
            if let onDisk { _ = try? ring.push(onDisk, for: document.sha256) }
        }
        return action
    }

    /// Snapshot of the final state into the ring when the document closes.
    public func close() {
        if let lastKnown { _ = try? ring.push(lastKnown, for: document.sha256) }
    }

    /// The file a "Export sidecar" share action should hand to the share sheet (fallback mode).
    public var activeSidecarURL: URL {
        active.sidecarURL(for: document)
    }
}
