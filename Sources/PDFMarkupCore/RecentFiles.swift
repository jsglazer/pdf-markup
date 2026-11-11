import Foundation

public struct RecentFile: Equatable, Sendable {
    public let url: URL
    public let displayName: String
}

/// D13: the last 20 opened PDFs as bookmarks in an injected `UserDefaults` suite (never `.standard`).
public final class RecentFilesStore: @unchecked Sendable {
    // @unchecked: UserDefaults is thread-safe; all other state is immutable.
    public static let defaultLimit = 20
    public static let defaultsKey = "recentFiles"

    private struct Entry: Codable {
        var bookmark: Data
        var displayName: String
        var pathKey: String
    }

    private let defaults: UserDefaults
    private let codec: BookmarkCodec
    private let limit: Int
    private let key: String

    public init(defaults: UserDefaults, codec: BookmarkCodec, limit: Int = RecentFilesStore.defaultLimit, key: String = RecentFilesStore.defaultsKey) {
        self.defaults = defaults
        self.codec = codec
        self.limit = max(1, limit)
        self.key = key
    }

    private var entries: [Entry] {
        get {
            guard let data = defaults.data(forKey: key) else { return [] }
            return (try? JSONDecoder().decode([Entry].self, from: data)) ?? []
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) { defaults.set(data, forKey: key) }
        }
    }

    /// Records an opened PDF at the front; re-opening moves it to the front; keeps at most `limit`.
    public func add(_ url: URL, displayName: String? = nil) throws {
        let pathKey = PathContainment.components(of: url).joined(separator: "/")
        let entry = Entry(bookmark: try codec.makeBookmark(for: url), displayName: displayName ?? url.lastPathComponent, pathKey: pathKey)
        var list = entries.filter { $0.pathKey != pathKey }
        list.insert(entry, at: 0)
        entries = Array(list.prefix(limit))
    }

    /// Newest first. Entries whose bookmark no longer resolves (file deleted, access lost) are pruned.
    public func recentFiles() -> [RecentFile] {
        var kept: [Entry] = []
        var out: [RecentFile] = []
        for var entry in entries {
            guard let resolved = try? codec.resolve(entry.bookmark) else { continue }
            if resolved.isStale {
                let didStart = resolved.url.startAccessingSecurityScopedResource()
                defer { if didStart { resolved.url.stopAccessingSecurityScopedResource() } }
                if let fresh = try? codec.makeBookmark(for: resolved.url) { entry.bookmark = fresh }
            }
            kept.append(entry)
            out.append(RecentFile(url: resolved.url, displayName: entry.displayName))
        }
        if kept.count != entries.count || kept.map(\.bookmark) != entries.map(\.bookmark) { entries = kept }
        return out
    }

    public func remove(_ url: URL) {
        let pathKey = PathContainment.components(of: url).joined(separator: "/")
        entries = entries.filter { $0.pathKey != pathKey }
    }

    public func clear() {
        defaults.removeObject(forKey: key)
    }
}
