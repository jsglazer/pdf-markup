import Foundation
@testable import PDFMarkupCore

/// A fresh temporary directory per test; removed on deinit. No hardcoded user paths.
final class TempDir {
    let url: URL

    init() throws {
        url = FileManager.default.temporaryDirectory
            .appendingPathComponent("PDFMarkupCoreTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    func file(_ relativePath: String, contents: Data = Data("%PDF-1.7".utf8)) throws -> URL {
        let file = url.appendingPathComponent(relativePath)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try contents.write(to: file)
        return file
    }

    func dir(_ relativePath: String) throws -> URL {
        let d = url.appendingPathComponent(relativePath, isDirectory: true)
        try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    deinit {
        // Restore write permission on anything a test locked, then delete.
        if let e = FileManager.default.enumerator(at: url, includingPropertiesForKeys: nil) {
            for case let u as URL in e { try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: u.path) }
        }
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        try? FileManager.default.removeItem(at: url)
    }
}

/// An isolated UserDefaults suite per test (never `.standard`); its domain is removed on deinit.
final class TestDefaults {
    let suiteName = "PDFMarkupCoreTests.\(UUID().uuidString)"
    let defaults: UserDefaults

    init() {
        guard let d = UserDefaults(suiteName: suiteName) else { preconditionFailure("could not create defaults suite") }
        defaults = d
    }

    func reopen() -> UserDefaults {
        guard let d = UserDefaults(suiteName: suiteName) else { preconditionFailure("could not reopen defaults suite") }
        return d
    }

    deinit {
        defaults.removePersistentDomain(forName: suiteName)
    }
}

/// Records every coordinated call and forwards to the real NSFileCoordinator implementation.
final class SpyFileIO: FileCoordinating, @unchecked Sendable {
    private let lock = NSLock()
    private let real = CoordinatedFileIO()
    private var _calls: [String] = []

    var calls: [String] { lock.withLock { _calls } }

    private func record(_ s: String) { lock.withLock { _calls.append(s) } }

    func coordinatedRead(at url: URL) throws -> Data? {
        record("read:\(url.lastPathComponent)")
        return try real.coordinatedRead(at: url)
    }

    func coordinatedWrite(_ data: Data, to url: URL, createParentDirectories: Bool) throws {
        record("write:\(url.lastPathComponent)")
        try real.coordinatedWrite(data, to: url, createParentDirectories: createParentDirectories)
    }

    func coordinatedDelete(at url: URL) throws {
        record("delete:\(url.lastPathComponent)")
        try real.coordinatedDelete(at: url)
    }

    func coordinatedList(directory: URL) throws -> [URL] {
        record("list:\(directory.lastPathComponent)")
        return try real.coordinatedList(directory: directory)
    }
}

/// Deterministic bookmark codec: bookmark data is the path; resolution can be made stale or fail.
final class FakeBookmarkCodec: BookmarkCodec, @unchecked Sendable {
    private let lock = NSLock()
    private var _stale: Set<String> = []
    private var _broken: Set<String> = []
    private var _made = 0

    var madeCount: Int { lock.withLock { _made } }
    func markStale(_ url: URL) { lock.withLock { _ = _stale.insert(url.path) } }
    func markBroken(_ url: URL) { lock.withLock { _ = _broken.insert(url.path) } }

    func makeBookmark(for url: URL) throws -> Data {
        lock.withLock { _made += 1 }
        return Data(url.path.utf8)
    }

    func resolve(_ bookmark: Data) throws -> ResolvedBookmark {
        let path = String(decoding: bookmark, as: UTF8.self)
        return try lock.withLock {
            if _broken.contains(path) { throw CocoaError(.fileNoSuchFile) }
            let stale = _stale.remove(path) != nil
            return ResolvedBookmark(url: URL(fileURLWithPath: path), isStale: stale)
        }
    }
}

struct FailingStore: SidecarStorageProvider {
    let mode: StorageMode = .sibling
    func sidecarURL(for document: DocumentIdentity) -> URL { document.pdfURL }
    func readSidecar(for document: DocumentIdentity) throws -> Data? { throw CocoaError(.fileReadNoPermission) }
    func writeSidecar(_ data: Data, for document: DocumentIdentity) throws { throw CocoaError(.fileWriteNoPermission) }
}

func identity(_ pdf: URL, sha: String = "0123abcd") -> DocumentIdentity {
    DocumentIdentity(pdfURL: pdf, fileName: pdf.lastPathComponent, sha256: sha)
}
