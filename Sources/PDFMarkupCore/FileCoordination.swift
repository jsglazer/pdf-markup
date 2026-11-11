import Foundation

/// Coordinated, atomic file access. Every sidecar, ring and PDF read/write goes through this protocol,
/// and the production implementation routes every call through `NSFileCoordinator` so Dropbox's File
/// Provider (and any other presenter) sees a coordinated access and never reads a half-written file.
public protocol FileCoordinating: Sendable {
    /// Returns nil when the file does not exist.
    func coordinatedRead(at url: URL) throws -> Data?
    /// Atomic write (temp file + rename) under a `.forReplacing` write coordination.
    func coordinatedWrite(_ data: Data, to url: URL, createParentDirectories: Bool) throws
    func coordinatedDelete(at url: URL) throws
    /// Directory listing under a read coordination; empty when the directory does not exist.
    func coordinatedList(directory: URL) throws -> [URL]
}

public struct CoordinatedFileIO: FileCoordinating {
    public init() {}

    public func coordinatedRead(at url: URL) throws -> Data? {
        var coordinationError: NSError?
        var result: Result<Data?, Error> = .success(nil)
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &coordinationError) { actualURL in
            do {
                result = .success(try Data(contentsOf: actualURL))
            } catch let error as CocoaError where error.code == .fileReadNoSuchFile || error.code == .fileNoSuchFile {
                result = .success(nil)
            } catch {
                result = .failure(error)
            }
        }
        if let coordinationError {
            if coordinationError.domain == NSCocoaErrorDomain,
               coordinationError.code == CocoaError.fileReadNoSuchFile.rawValue || coordinationError.code == CocoaError.fileNoSuchFile.rawValue {
                return nil
            }
            throw coordinationError
        }
        return try result.get()
    }

    public func coordinatedWrite(_ data: Data, to url: URL, createParentDirectories: Bool) throws {
        var coordinationError: NSError?
        var result: Result<Void, Error> = .success(())
        NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { actualURL in
            do {
                if createParentDirectories {
                    try FileManager.default.createDirectory(at: actualURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                }
                try data.write(to: actualURL, options: [.atomic])
            } catch {
                result = .failure(error)
            }
        }
        if let coordinationError { throw coordinationError }
        try result.get()
    }

    public func coordinatedDelete(at url: URL) throws {
        var coordinationError: NSError?
        var result: Result<Void, Error> = .success(())
        NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: .forDeleting, error: &coordinationError) { actualURL in
            do {
                try FileManager.default.removeItem(at: actualURL)
            } catch let error as CocoaError where error.code == .fileNoSuchFile {
                result = .success(())
            } catch {
                result = .failure(error)
            }
        }
        if let coordinationError { throw coordinationError }
        try result.get()
    }

    public func coordinatedList(directory: URL) throws -> [URL] {
        var coordinationError: NSError?
        var result: Result<[URL], Error> = .success([])
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: directory, options: [], error: &coordinationError) { actualURL in
            do {
                result = .success(try FileManager.default.contentsOfDirectory(at: actualURL, includingPropertiesForKeys: nil))
            } catch let error as CocoaError where error.code == .fileReadNoSuchFile || error.code == .fileNoSuchFile {
                result = .success([])
            } catch {
                result = .failure(error)
            }
        }
        if let coordinationError {
            if coordinationError.code == CocoaError.fileReadNoSuchFile.rawValue || coordinationError.code == CocoaError.fileNoSuchFile.rawValue { return [] }
            throw coordinationError
        }
        return try result.get()
    }
}
