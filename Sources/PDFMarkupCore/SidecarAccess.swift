import Foundation

/// D1/D2 decision for where a PDF's sidecar lives.
public enum SidecarAccessPlan: Equatable, Sendable {
    /// A granted root covers the PDF: write `deck.pdf.excalidraw.json` next to it.
    case sibling(root: URL)
    /// The PDF is outside every granted root: prompt the user to grant its folder.
    /// If they decline (or the grant fails), use `.fallback` — never refuse to annotate.
    case needsGrant(suggestedFolder: URL)
    /// Use the app-container store.
    case fallback
}

public enum SidecarAccessPlanner {
    /// - Parameter userDeclinedGrant: true once the user has declined (or failed) the D2 folder prompt.
    public static func plan(pdfURL: URL, roots: RootFolderStore, userDeclinedGrant: Bool) -> SidecarAccessPlan {
        if let root = roots.root(covering: pdfURL) { return .sibling(root: root) }
        if userDeclinedGrant { return .fallback }
        return .needsGrant(suggestedFolder: pdfURL.deletingLastPathComponent())
    }
}
