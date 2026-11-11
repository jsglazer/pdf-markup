import PDFMarkupCore
import SwiftUI
import WebKit

struct DocumentScreen: View {
    let library: LibraryModel
    let request: LibraryModel.OpenRequest
    @State private var model: DocumentModel?
    @State private var relinking = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if let model {
                content(model)
            } else {
                ProgressView()
            }
        }
        .navigationTitle(request.pdfURL.lastPathComponent)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            let m = DocumentModel(pdfURL: request.pdfURL, plan: request.plan, environment: library.environment)
            model = m
            await m.load()
        }
        .onDisappear {
            // D8: flush on document close.
            if let model { Task { await model.close() } }
        }
        .onChange(of: scenePhase) { _, phase in
            guard let model else { return }
            switch phase {
            case .background:
                BackgroundFlush.run { await model.didEnterBackground() }
            case .active:
                Task { await model.didBecomeActive() }
            default:
                break
            }
        }
        .fileImporter(isPresented: $relinking, allowedContentTypes: [.folder]) { result in
            if case let .success(folder) = result {
                library.grantRoot(folder, reopening: request.pdfURL)
            }
        }
    }

    @ViewBuilder
    private func content(_ model: DocumentModel) -> some View {
        switch model.phase {
        case .loading:
            VStack(spacing: 12) {
                ProgressView()
                Text("Opening \(model.displayName)…")
                Text("Files stored online-only are downloaded first.").font(.footnote).foregroundStyle(.secondary)
            }
        case let .failed(message):
            ContentUnavailableView("Could not open this PDF", systemImage: "exclamationmark.triangle", description: Text(message))
        case .ready:
            VStack(spacing: 0) {
                if model.storageMode == .fallback {
                    FallbackBadge(onExport: { model.shareSidecar() }, onRelink: { relinking = true })
                }
                if let webView = model.webView {
                    WebViewContainer(webView: webView)
                        .ignoresSafeArea(.container, edges: .bottom)
                }
            }
            .exportPresenter(file: Binding(get: { model.exportedFile }, set: { model.exportedFile = $0 }))
            .exportPresenter(file: Binding(get: { model.sidecarToShare }, set: { model.sidecarToShare = $0 }))
            .alert("Problem", isPresented: Binding(get: { model.alertMessage != nil }, set: { if !$0 { model.alertMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(model.alertMessage ?? "")
            }
        }
    }
}

/// D1: persistent badge while the sidecar lives in the app container instead of next to the PDF.
struct FallbackBadge: View {
    let onExport: () -> Void
    let onRelink: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Label("Sidecar not syncing", systemImage: "exclamationmark.icloud")
                .font(.callout.weight(.semibold))
            Spacer()
            Button("Export", action: onExport)
            Button("Relink", action: onRelink)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.yellow.opacity(0.25))
        .accessibilityElement(children: .combine)
    }
}
