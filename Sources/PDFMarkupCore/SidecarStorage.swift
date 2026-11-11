import Foundation

/// The PDF a sidecar belongs to.
public struct DocumentIdentity: Equatable, Sendable {
    public let pdfURL: URL
    public let fileName: String
    /// SHA-256 of the PDF bytes, lowercase hex.
    public let sha256: String

    public init(pdfURL: URL, fileName: String, sha256: String) {
        self.pdfURL = pdfURL
        self.fileName = fileName
        self.sha256 = sha256
    }
}

/// Injectable sidecar storage (§4 builder constraint). The web core and the bridge never know which
/// implementation is active; iOS File Provider limits can be mocked or worked around by swapping it.
public protocol SidecarStorageProvider: Sendable {
    var mode: StorageMode { get }
    func sidecarURL(for document: DocumentIdentity) -> URL
    func readSidecar(for document: DocumentIdentity) throws -> Data?
    func writeSidecar(_ data: Data, for document: DocumentIdentity) throws
}

/// D1 default: `deck.pdf.excalidraw.json` next to the PDF, inside a security-scoped bookmarked root.
public struct SiblingSidecarStore: SidecarStorageProvider {
    public static let suffix = ".excalidraw.json"

    /// The granted root folder (resolved from its bookmark) whose security scope covers the sidecar.
    public let root: URL
    private let io: FileCoordinating

    public init(root: URL, io: FileCoordinating) {
        self.root = root
        self.io = io
    }

    public var mode: StorageMode { .sibling }

    public func sidecarURL(for document: DocumentIdentity) -> URL {
        Self.sidecarURL(forPDF: document.pdfURL)
    }

    public static func sidecarURL(forPDF pdfURL: URL) -> URL {
        pdfURL.deletingLastPathComponent().appendingPathComponent(pdfURL.lastPathComponent + suffix, isDirectory: false)
    }

    public func readSidecar(for document: DocumentIdentity) throws -> Data? {
        let didStart = root.startAccessingSecurityScopedResource()
        defer { if didStart { root.stopAccessingSecurityScopedResource() } }
        return try io.coordinatedRead(at: sidecarURL(for: document))
    }

    public func writeSidecar(_ data: Data, for document: DocumentIdentity) throws {
        let didStart = root.startAccessingSecurityScopedResource()
        defer { if didStart { root.stopAccessingSecurityScopedResource() } }
        try io.coordinatedWrite(data, to: sidecarURL(for: document), createParentDirectories: false)
    }
}

/// D1 fallback: `Application Support/Sidecars/<sha256-of-PDF>.excalidraw.json` in the app container.
/// Used when no root bookmark covers the PDF or a sibling write fails. Not synced by Dropbox — the UI
/// shows a persistent "Sidecar not syncing – Export/Relink" badge in this mode.
public struct AppContainerSidecarStore: SidecarStorageProvider {
    /// `<Application Support>/Sidecars` — injected (tests pass a temporary directory).
    public let directory: URL
    private let io: FileCoordinating

    public init(directory: URL, io: FileCoordinating) {
        self.directory = directory
        self.io = io
    }

    public var mode: StorageMode { .fallback }

    public func sidecarURL(for document: DocumentIdentity) -> URL {
        directory.appendingPathComponent(document.sha256 + SiblingSidecarStore.suffix, isDirectory: false)
    }

    public func readSidecar(for document: DocumentIdentity) throws -> Data? {
        // Container URLs are not security-scoped; start returns false and nothing is stopped. The
        // balanced pattern is kept so every sidecar access looks the same.
        let didStart = directory.startAccessingSecurityScopedResource()
        defer { if didStart { directory.stopAccessingSecurityScopedResource() } }
        return try io.coordinatedRead(at: sidecarURL(for: document))
    }

    public func writeSidecar(_ data: Data, for document: DocumentIdentity) throws {
        let didStart = directory.startAccessingSecurityScopedResource()
        defer { if didStart { directory.stopAccessingSecurityScopedResource() } }
        try io.coordinatedWrite(data, to: sidecarURL(for: document), createParentDirectories: true)
    }
}

/// Application-container locations, injected so nothing in core or tests hardcodes a user path.
public struct AppDirectories: Sendable {
    public let applicationSupport: URL

    public init(applicationSupport: URL) {
        self.applicationSupport = applicationSupport
    }

    /// Production: the sandbox's Application Support directory, as reported by FileManager.
    public static func system(fileManager: FileManager = .default) throws -> AppDirectories {
        let url = try fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return AppDirectories(applicationSupport: url)
    }

    public var sidecars: URL { applicationSupport.appendingPathComponent("Sidecars", isDirectory: true) }
    public var sidecarHistory: URL { applicationSupport.appendingPathComponent("SidecarHistory", isDirectory: true) }
}
