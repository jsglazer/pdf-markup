import PDFMarkupCore
import SwiftUI
import UniformTypeIdentifiers

struct HomeView: View {
    @Bindable var library: LibraryModel
    var body: some View {
        List {
            Section {
                Button {
                    library.requestImport(.pdf)
                } label: {
                    Label("Open PDF…", systemImage: "doc.richtext")
                }
                Button {
                    library.requestImport(.folder)
                } label: {
                    Label("Grant Folder Access…", systemImage: "folder.badge.plus")
                }
            } footer: {
                Text("Grant your Dropbox slides folder once so markup can be saved next to each PDF and sync with it.")
            }

            if !library.roots.isEmpty {
                Section("Granted folders") {
                    ForEach(library.roots, id: \.self) { root in
                        Label(root.lastPathComponent, systemImage: "folder")
                    }
                }
            }

            Section("Recent") {
                if library.recentFiles.isEmpty {
                    Text("No recent files").foregroundStyle(.secondary)
                }
                ForEach(library.recentFiles, id: \.url) { file in
                    Button {
                        library.open(file.url)
                    } label: {
                        Label(file.displayName, systemImage: "doc")
                    }
                    .contextMenu {
                        Button("Remove from Recents", role: .destructive) { library.removeRecent(file) }
                    }
                }
            }
        }
        .navigationTitle("PDF Markup")
        .onAppear { library.refresh() }
    }
}

/// File picker and prompts live at the navigation root so they work while a document is on screen
/// (attached to HomeView they could not present over a pushed document). One importer only: SwiftUI
/// honours just the last `.fileImporter` on a view.
struct LibraryPresentations: ViewModifier {
    @Bindable var library: LibraryModel

    func body(content: Content) -> some View {
        content
            .fileImporter(isPresented: $library.importing, allowedContentTypes: library.importKind == .pdf ? [.pdf] : [.folder]) { result in
                library.finishImport(result)
            }
            .alert(
                "Allow saving markup next to this PDF?",
                isPresented: Binding(get: { library.grantPrompt != nil }, set: { if !$0 { library.grantPrompt = nil } }),
                presenting: library.grantPrompt
            ) { prompt in
                Button("Choose Folder…") { library.requestImport(.folder, reopening: prompt.pdfURL) }
                Button("Not Now", role: .cancel) { library.declineGrant() }
            } message: { prompt in
                Text("“\(prompt.pdfURL.lastPathComponent)” is outside the folders you have granted. Grant “\(prompt.folder.lastPathComponent)” (or a folder above it) so the sidecar syncs with the PDF. If you choose Not Now, markup is kept on this device only.")
            }
            .alert("Error", isPresented: Binding(get: { library.errorMessage != nil }, set: { if !$0 { library.errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(library.errorMessage ?? "")
            }
    }
}
