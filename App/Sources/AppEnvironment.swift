import Foundation
import PDFMarkupCore

/// Production wiring of the injectable core services. Nothing here hardcodes a user or Dropbox path:
/// the defaults suite is named, and directories come from FileManager.
struct AppEnvironment: Sendable {
    static let defaultsSuiteName = "com.jsglazer.pdf-markup.state"

    let io: FileCoordinating
    let directories: AppDirectories
    let roots: RootFolderStore
    let recents: RecentFilesStore
    let ring: SidecarVersionRing
    let fallbackStore: AppContainerSidecarStore

    static func live() throws -> AppEnvironment {
        guard let defaults = UserDefaults(suiteName: defaultsSuiteName) else {
            throw CocoaError(.featureUnsupported)
        }
        let io = CoordinatedFileIO()
        let directories = try AppDirectories.system()
        let codec = SystemBookmarkCodec()
        return AppEnvironment(
            io: io,
            directories: directories,
            roots: RootFolderStore(defaults: defaults, codec: codec),
            recents: RecentFilesStore(defaults: defaults, codec: codec),
            ring: SidecarVersionRing(directory: directories.sidecarHistory, io: io),
            fallbackStore: AppContainerSidecarStore(directory: directories.sidecars, io: io)
        )
    }
}

/// Reads the PDF with a coordinated read (this is what makes the Dropbox File Provider download an
/// online-only file) under the PDF's security scope. Runs off the main actor.
enum PDFLoader {
    static func load(_ url: URL, io: FileCoordinating) async throws -> Data {
        try await Task.detached(priority: .userInitiated) {
            let didStart = url.startAccessingSecurityScopedResource()
            defer { if didStart { url.stopAccessingSecurityScopedResource() } }
            guard let data = try io.coordinatedRead(at: url) else { throw CocoaError(.fileReadNoSuchFile) }
            return data
        }.value
    }
}
