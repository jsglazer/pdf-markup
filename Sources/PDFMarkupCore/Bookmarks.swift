import Foundation

public struct ResolvedBookmark: Equatable, Sendable {
    public let url: URL
    public let isStale: Bool

    public init(url: URL, isStale: Bool) {
        self.url = url
        self.isStale = isStale
    }
}

/// Creates and resolves bookmarks. Injected so tests can simulate stale or unresolvable bookmarks.
public protocol BookmarkCodec: Sendable {
    func makeBookmark(for url: URL) throws -> Data
    func resolve(_ bookmark: Data) throws -> ResolvedBookmark
}

/// Production codec: security-scoped bookmarks on macOS (sandbox), standard bookmarks on iOS, where the
/// security scope travels with the bookmark of a document-picker URL.
public struct SystemBookmarkCodec: BookmarkCodec {
    private let securityScoped: Bool

    /// `securityScoped` defaults to true on macOS; pass false for unsandboxed contexts.
    public init(securityScoped: Bool = SystemBookmarkCodec.platformDefaultSecurityScoped) {
        self.securityScoped = securityScoped
    }

    public static var platformDefaultSecurityScoped: Bool {
        #if os(macOS)
        true
        #else
        false
        #endif
    }

    public func makeBookmark(for url: URL) throws -> Data {
        #if os(macOS)
        let options: URL.BookmarkCreationOptions = securityScoped ? [.withSecurityScope] : []
        #else
        let options: URL.BookmarkCreationOptions = []
        #endif
        return try url.bookmarkData(options: options, includingResourceValuesForKeys: nil, relativeTo: nil)
    }

    public func resolve(_ bookmark: Data) throws -> ResolvedBookmark {
        var stale = false
        #if os(macOS)
        let options: URL.BookmarkResolutionOptions = securityScoped ? [.withSecurityScope, .withoutUI] : [.withoutUI]
        #else
        let options: URL.BookmarkResolutionOptions = [.withoutUI]
        #endif
        let url = try URL(resolvingBookmarkData: bookmark, options: options, relativeTo: nil, bookmarkDataIsStale: &stale)
        return ResolvedBookmark(url: url, isStale: stale)
    }
}

/// Path containment on resolved, standardized path components (so `/a/bc` is not inside `/a/b`, and
/// `/var/…` vs `/private/var/…` symlinks compare equal).
public enum PathContainment {
    public static func components(of url: URL) -> [String] {
        url.resolvingSymlinksInPath().standardizedFileURL.pathComponents
    }

    public static func isURL(_ url: URL, inside folder: URL) -> Bool {
        let child = components(of: url)
        let parent = components(of: folder)
        return child.count > parent.count && Array(child.prefix(parent.count)) == parent
    }
}

/// Granted root folders (D1/D2), persisted as bookmarks in an injected `UserDefaults` suite.
public final class RootFolderStore: @unchecked Sendable {
    // @unchecked: UserDefaults is thread-safe; all other state is immutable.
    public static let defaultsKey = "rootFolderBookmarks"

    private let defaults: UserDefaults
    private let codec: BookmarkCodec
    private let key: String

    public init(defaults: UserDefaults, codec: BookmarkCodec, key: String = RootFolderStore.defaultsKey) {
        self.defaults = defaults
        self.codec = codec
        self.key = key
    }

    private var bookmarks: [Data] {
        get { (defaults.array(forKey: key) as? [Data]) ?? [] }
        set { defaults.set(newValue, forKey: key) }
    }

    /// Adds (or refreshes) a granted root. A root equal to an existing one replaces it.
    public func addRoot(_ url: URL) throws {
        let data = try codec.makeBookmark(for: url)
        let target = PathContainment.components(of: url)
        var kept: [Data] = []
        for bookmark in bookmarks {
            if let resolved = try? codec.resolve(bookmark), PathContainment.components(of: resolved.url) == target { continue }
            kept.append(bookmark)
        }
        bookmarks = kept + [data]
    }

    /// Resolves all roots; unresolvable bookmarks are dropped and stale ones are refreshed when possible.
    public func roots() -> [URL] {
        var urls: [URL] = []
        var kept: [Data] = []
        var changed = false
        for bookmark in bookmarks {
            guard let resolved = try? codec.resolve(bookmark) else {
                changed = true
                continue
            }
            if resolved.isStale {
                let didStart = resolved.url.startAccessingSecurityScopedResource()
                defer { if didStart { resolved.url.stopAccessingSecurityScopedResource() } }
                if let fresh = try? codec.makeBookmark(for: resolved.url) {
                    kept.append(fresh)
                    changed = true
                } else {
                    kept.append(bookmark)
                }
            } else {
                kept.append(bookmark)
            }
            urls.append(resolved.url)
        }
        if changed { bookmarks = kept }
        return urls
    }

    /// The deepest granted root containing `pdfURL`, or nil when the PDF is out of every root (D2).
    public func root(covering pdfURL: URL) -> URL? {
        roots()
            .filter { PathContainment.isURL(pdfURL, inside: $0) }
            .max { PathContainment.components(of: $0).count < PathContainment.components(of: $1).count }
    }

    public func isOutOfRoot(_ pdfURL: URL) -> Bool {
        root(covering: pdfURL) == nil
    }

    public func removeAll() {
        defaults.removeObject(forKey: key)
    }
}
