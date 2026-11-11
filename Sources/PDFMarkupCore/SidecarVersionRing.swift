import Foundation

/// D8: a ring of the last N (default 5) sidecar versions per document, in
/// `Application Support/SidecarHistory/<sha256>/NNNNNNNN.json`. Ordering comes from a monotonically
/// increasing sequence number in the file name — no clock dependence.
public struct SidecarVersionRing: Sendable {
    public static let defaultCapacity = 5

    public let directory: URL
    public let capacity: Int
    private let io: FileCoordinating

    public init(directory: URL, io: FileCoordinating, capacity: Int = SidecarVersionRing.defaultCapacity) {
        self.directory = directory
        self.io = io
        self.capacity = max(1, capacity)
    }

    private func folder(for sha256: String) -> URL {
        directory.appendingPathComponent(sha256, isDirectory: true)
    }

    /// Entries oldest → newest.
    public func entries(for sha256: String) throws -> [URL] {
        try io.coordinatedList(directory: folder(for: sha256))
            .filter { $0.pathExtension == "json" && Self.sequence(of: $0) != nil }
            .sorted { (Self.sequence(of: $0) ?? 0) < (Self.sequence(of: $1) ?? 0) }
    }

    /// Adds a version unless it is byte-identical to the newest entry; prunes to `capacity`.
    /// Returns true when a new entry was written.
    @discardableResult
    public func push(_ data: Data, for sha256: String) throws -> Bool {
        let didStart = directory.startAccessingSecurityScopedResource() // container URL: no-op, kept balanced
        defer { if didStart { directory.stopAccessingSecurityScopedResource() } }
        let existing = try entries(for: sha256)
        if let newest = existing.last, try io.coordinatedRead(at: newest) == data {
            return false
        }
        let next = (existing.last.flatMap(Self.sequence(of:)) ?? 0) + 1
        let url = folder(for: sha256).appendingPathComponent(String(format: "%08d.json", next), isDirectory: false)
        try io.coordinatedWrite(data, to: url, createParentDirectories: true)
        let all = existing + [url]
        for stale in all.dropLast(capacity) {
            try io.coordinatedDelete(at: stale)
        }
        return true
    }

    public func versions(for sha256: String) throws -> [Data] {
        try entries(for: sha256).compactMap { try io.coordinatedRead(at: $0) }
    }

    private static func sequence(of url: URL) -> Int? {
        Int(url.deletingPathExtension().lastPathComponent)
    }
}
