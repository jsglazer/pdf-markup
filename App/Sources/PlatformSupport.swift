import SwiftUI
import WebKit
#if os(iOS)
import UIKit
#else
import AppKit
#endif

#if os(iOS)
struct WebViewContainer: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// Keeps the app alive long enough to finish the D8 background flush.
@MainActor
enum BackgroundFlush {
    /// Holds the task identifier so the expiration handler and the completion end the same task once.
    @MainActor
    private final class Token {
        var id = UIBackgroundTaskIdentifier.invalid

        func end() {
            guard id != .invalid else { return }
            UIApplication.shared.endBackgroundTask(id)
            id = .invalid
        }
    }

    static func run(_ work: @escaping @MainActor () async -> Void) {
        let token = Token()
        token.id = UIApplication.shared.beginBackgroundTask(withName: "Flush markup") {
            MainActor.assumeIsolated { token.end() }
        }
        Task { @MainActor in
            await work()
            token.end()
        }
    }
}

/// Share sheet for the flattened export (D9) and the fallback sidecar export (D1).
private struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

extension View {
    func exportPresenter(file: Binding<URL?>) -> some View {
        sheet(item: Binding(get: { file.wrappedValue.map(IdentifiedURL.init) }, set: { file.wrappedValue = $0?.url })) { item in
            ShareSheet(url: item.url)
        }
    }
}
#else
struct WebViewContainer: NSViewRepresentable {
    let webView: WKWebView
    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

@MainActor
enum BackgroundFlush {
    static func run(_ work: @escaping @MainActor () async -> Void) {
        Task { @MainActor in await work() }
    }
}

/// NSSavePanel for the flattened export (D9) and the fallback sidecar export (D1).
private struct SavePanelPresenter: ViewModifier {
    @Binding var file: URL?

    func body(content: Content) -> some View {
        content.onChange(of: file) { _, url in
            guard let url else { return }
            let panel = NSSavePanel()
            panel.nameFieldStringValue = url.lastPathComponent
            panel.canCreateDirectories = true
            if panel.runModal() == .OK, let destination = panel.url {
                do {
                    if FileManager.default.fileExists(atPath: destination.path) {
                        _ = try FileManager.default.replaceItemAt(destination, withItemAt: url)
                    } else {
                        try FileManager.default.copyItem(at: url, to: destination)
                    }
                } catch {
                    NSAlert(error: error).runModal()
                }
            }
            file = nil
        }
    }
}

extension View {
    func exportPresenter(file: Binding<URL?>) -> some View {
        modifier(SavePanelPresenter(file: file))
    }
}
#endif

struct IdentifiedURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}
