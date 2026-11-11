import PDFMarkupCore
import SwiftUI
import UniformTypeIdentifiers

struct HomeView: View {
    @Bindable var library: LibraryModel
    @State private var pickingPDF = false
    @State private var pickingFolder = false
    @State private var folderPickReopens: URL?

    var body: some View {
        List {
            Section {
                Button {
                    pickingPDF = true
                } label: {
                    Label("Open PDF…", systemImage: "doc.richtext")
                }
                Button {
                    folderPickReopens = nil
                    pickingFolder = true
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
        .fileImporter(isPresented: $pickingPDF, allowedContentTypes: [.pdf]) { result in
            if case let .success(url) = result { library.open(url) }
        }
        .fileImporter(isPresented: $pickingFolder, allowedContentTypes: [.folder]) { result in
            switch result {
            case let .success(folder):
                library.grantRoot(folder, reopening: folderPickReopens)
            case .failure:
                // D2: the folder could not be granted (e.g. a File Provider that blocks folder picks).
                if let pdf = folderPickReopens {
                    library.grantPrompt = LibraryModel.GrantPrompt(pdfURL: pdf, folder: pdf.deletingLastPathComponent())
                    library.declineGrant()
                }
            }
            folderPickReopens = nil
        }
        .alert(
            "Allow saving markup next to this PDF?",
            isPresented: Binding(get: { library.grantPrompt != nil }, set: { if !$0 { library.grantPrompt = nil } }),
            presenting: library.grantPrompt
        ) { prompt in
            Button("Choose Folder…") {
                folderPickReopens = prompt.pdfURL
                library.grantPrompt = nil
                pickingFolder = true
            }
            Button("Not Now", role: .cancel) { library.declineGrant() }
        } message: { prompt in
            Text("“\(prompt.pdfURL.lastPathComponent)” is outside the folders you have granted. Grant “\(prompt.folder.lastPathComponent)” (or a folder above it) so the sidecar syncs with the PDF. If you choose Not Now, markup is kept on this device only.")
        }
        .alert("Error", isPresented: Binding(get: { library.errorMessage != nil }, set: { if !$0 { library.errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(library.errorMessage ?? "")
        }
        .onAppear { library.refresh() }
    }
}
