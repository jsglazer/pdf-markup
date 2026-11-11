import Foundation
import Observation
import PDFMarkupCore
import WebKit

/// One open document: loads the PDF, wires the core `DocumentBridgeController` to the WKWebView, and
/// runs the D8 flush points (background, foreground, close) and the D9 export hand-off.
@MainActor
@Observable
final class DocumentModel {
    enum Phase: Equatable {
        case loading
        case ready
        case failed(String)
    }

    let pdfURL: URL
    private(set) var phase: Phase = .loading
    private(set) var storageMode: StorageMode = .sibling
    var exportedFile: URL?
    var sidecarToShare: URL?
    var alertMessage: String?

    @ObservationIgnored private let environment: AppEnvironment
    @ObservationIgnored private let plan: SidecarAccessPlan
    @ObservationIgnored private let schemeHandler: AppSchemeHandler
    @ObservationIgnored private let transport = WebViewBridgeTransport()
    @ObservationIgnored private let navigationDelegate = LocalOnlyNavigationDelegate()
    @ObservationIgnored private(set) var controller: DocumentBridgeController?
    @ObservationIgnored private(set) var webView: WKWebView?

    init(pdfURL: URL, plan: SidecarAccessPlan, environment: AppEnvironment) {
        self.pdfURL = pdfURL
        self.plan = plan
        self.environment = environment
        let webRoot = Bundle.main.url(forResource: "web", withExtension: nil) ?? Bundle.main.bundleURL.appendingPathComponent("web")
        schemeHandler = AppSchemeHandler(webRoot: webRoot)
    }

    var displayName: String { pdfURL.lastPathComponent }

    func load() async {
        guard controller == nil else { return }
        do {
            // Coordinated read: for an online-only Dropbox file this blocks while the File Provider
            // downloads it; the UI shows the loading state meanwhile.
            let data = try await PDFLoader.load(pdfURL, io: environment.io)
            let document = DocumentIdentity(pdfURL: pdfURL, fileName: pdfURL.lastPathComponent, sha256: PDFFingerprint.sha256Hex(of: data))
            let primary: SidecarStorageProvider? = if case let .sibling(root) = plan {
                SiblingSidecarStore(root: root, io: environment.io)
            } else {
                nil
            }
            let session = DocumentSession(document: document, primary: primary, fallback: environment.fallbackStore, ring: environment.ring)
            storageMode = session.storageMode

            let webView = MarkupWebViewFactory.make(schemeHandler: schemeHandler, transport: transport, navigationDelegate: navigationDelegate)
            let controller = DocumentBridgeController(
                session: session,
                transport: transport,
                pdfURLForWeb: schemeHandler.register(pdf: data),
                platform: Self.platform
            )
            controller.onStorageModeChange = { [weak self] mode in self?.storageMode = mode }
            controller.onExportReady = { [weak self] name, bytes in self?.exportReady(fileName: name, bytes: bytes) }
            controller.onExportFailed = { [weak self] message in self?.alertMessage = "Export failed: \(message)" }
            controller.onLog = { level, message in
                if level != .info { print("[web \(level.rawValue)] \(message)") }
            }
            transport.onDecodeError = { message in print("[bridge] \(message)") }
            self.controller = controller
            self.webView = webView
            await MarkupWebViewFactory.load(webView)
            phase = .ready
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    static var platform: BridgePlatform {
        #if os(iOS)
        .ios
        #else
        .macos
        #endif
    }

    // MARK: D8 flush points

    func didEnterBackground() async {
        _ = await controller?.requestFlush(.background)
    }

    func didBecomeActive() async {
        await controller?.handleForeground()
    }

    func close() async {
        await controller?.close()
        controller?.abandonPendingFlushes()
        schemeHandler.unregisterAll()
    }

    // MARK: D9 export / D1 sidecar export

    func requestExport() {
        controller?.requestExport()
    }

    private func exportReady(fileName: String, bytes: Data) {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Exports", isDirectory: true)
        let url = folder.appendingPathComponent(fileName)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try bytes.write(to: url, options: .atomic)
            exportedFile = url
        } catch {
            alertMessage = "Could not prepare the export: \(error.localizedDescription)"
        }
    }

    /// Fallback mode "Export" action: share a copy of the app-container sidecar JSON.
    func shareSidecar() {
        guard let source = controller?.session.activeSidecarURL else { return }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("SidecarExport", isDirectory: true)
        let target = folder.appendingPathComponent(pdfURL.lastPathComponent + SiblingSidecarStore.suffix)
        let didStart = source.startAccessingSecurityScopedResource()
        defer { if didStart { source.stopAccessingSecurityScopedResource() } }
        do {
            guard let data = try environment.io.coordinatedRead(at: source) else {
                alertMessage = "There is no markup to export yet."
                return
            }
            try environment.io.coordinatedWrite(data, to: target, createParentDirectories: true)
            sidecarToShare = target
        } catch {
            alertMessage = "Could not export the sidecar: \(error.localizedDescription)"
        }
    }
}
