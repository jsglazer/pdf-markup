import Foundation
import Observation
import PDFMarkupCore

/// Home-screen state: recent files, granted roots, and the D2 "grant this folder?" flow.
@MainActor
@Observable
final class LibraryModel {
    struct GrantPrompt: Identifiable, Equatable {
        let id = UUID()
        let pdfURL: URL
        let folder: URL
    }

    struct OpenRequest: Identifiable, Hashable {
        let id = UUID()
        let pdfURL: URL
        let plan: SidecarAccessPlan

        static func == (a: OpenRequest, b: OpenRequest) -> Bool { a.id == b.id }
        func hash(into hasher: inout Hasher) { hasher.combine(id) }
    }

    let environment: AppEnvironment
    private(set) var recentFiles: [RecentFile] = []
    private(set) var roots: [URL] = []
    var grantPrompt: GrantPrompt?
    var openDocument: OpenRequest?
    var errorMessage: String?
    /// PDFs whose folder grant the user declined this launch (D2 → fallback store).
    private var declined: Set<String> = []

    init(environment: AppEnvironment) {
        self.environment = environment
        refresh()
    }

    func refresh() {
        recentFiles = environment.recents.recentFiles()
        roots = environment.roots.roots()
    }

    /// Entry point for a PDF chosen in the file importer or the recents list.
    func open(_ pdfURL: URL) {
        rememberRecent(pdfURL)
        let plan = SidecarAccessPlanner.plan(pdfURL: pdfURL, roots: environment.roots, userDeclinedGrant: declined.contains(pdfURL.path))
        switch plan {
        case let .needsGrant(folder):
            grantPrompt = GrantPrompt(pdfURL: pdfURL, folder: folder)
        case .sibling, .fallback:
            openDocument = OpenRequest(pdfURL: pdfURL, plan: plan)
        }
    }

    /// D2: user declined to grant the PDF's folder — annotate anyway with the fallback store.
    func declineGrant() {
        guard let prompt = grantPrompt else { return }
        grantPrompt = nil
        declined.insert(prompt.pdfURL.path)
        openDocument = OpenRequest(pdfURL: prompt.pdfURL, plan: .fallback)
    }

    /// A folder picked in the folder importer (from the D2 prompt, the Relink badge, or Settings).
    func grantRoot(_ folder: URL, reopening pdfURL: URL?) {
        do {
            let didStart = folder.startAccessingSecurityScopedResource()
            defer { if didStart { folder.stopAccessingSecurityScopedResource() } }
            try environment.roots.addRoot(folder)
        } catch {
            errorMessage = "Could not keep access to \(folder.lastPathComponent): \(error.localizedDescription)"
        }
        refresh()
        if let pdfURL {
            if environment.roots.root(covering: pdfURL) == nil {
                // The granted folder does not contain the PDF (or the grant failed): D2 → fallback.
                declined.insert(pdfURL.path)
            }
            open(pdfURL)
        }
    }

    private func rememberRecent(_ pdfURL: URL) {
        let didStart = pdfURL.startAccessingSecurityScopedResource()
        defer { if didStart { pdfURL.stopAccessingSecurityScopedResource() } }
        try? environment.recents.add(pdfURL)
        recentFiles = environment.recents.recentFiles()
    }

    func removeRecent(_ file: RecentFile) {
        environment.recents.remove(file.url)
        refresh()
    }
}
