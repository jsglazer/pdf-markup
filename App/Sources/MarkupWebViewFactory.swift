import Foundation
import PDFMarkupCore
import WebKit
#if os(iOS)
import UIKit
#endif

/// Builds the single WKWebView that hosts the web core, with:
/// - the pdfmarkup:// scheme handler (bundle + PDF bytes),
/// - a content rule list that blocks every http(s) load (offline guarantee on top of the CSP),
/// - a navigation policy that only allows pdfmarkup:// navigations,
/// - native zoom disabled (D3) and Scribble disabled on the drawing surface (D4).
@MainActor
enum MarkupWebViewFactory {
    static let blockNetworkRules = #"[{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}}]"#

    static func make(schemeHandler: AppSchemeHandler, transport: WebViewBridgeTransport, navigationDelegate: WKNavigationDelegate) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: AppSchemeHandler.scheme)
        config.userContentController.add(WeakScriptMessageHandler(transport), name: BridgeProtocol.handlerName)
        config.websiteDataStore = .nonPersistent()
        #if os(iOS)
        config.allowsInlineMediaPlayback = false
        config.dataDetectorTypes = []
        #endif

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = navigationDelegate
        transport.webView = webView
        #if DEBUG
        webView.isInspectable = true
        #endif

        #if os(iOS)
        // D3: the TypeScript ZoomController owns zoom; WebKit's own pinch-zoom is off.
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // D4: no iPadOS Scribble (handwriting-to-text) on the drawing surface.
        webView.addInteraction(UIScribbleInteraction(delegate: ScribbleBlocker.shared))
        #else
        webView.allowsMagnification = false
        #endif
        return webView
    }

    /// Compiles the network-blocking rule list, installs it, then loads the app page.
    static func load(_ webView: WKWebView) async {
        if let store = WKContentRuleListStore.default(),
           let rules = try? await store.compileContentRuleList(forIdentifier: "pdfmarkup-block-network", encodedContentRuleList: blockNetworkRules) {
            webView.configuration.userContentController.add(rules)
        }
        webView.load(URLRequest(url: AppSchemeHandler.indexURL))
    }
}

/// Only pdfmarkup:// (and about:blank) may load in the web view.
@MainActor
final class LocalOnlyNavigationDelegate: NSObject, WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        let scheme = navigationAction.request.url?.scheme
        return scheme == AppSchemeHandler.scheme || navigationAction.request.url?.absoluteString == "about:blank" ? .allow : .cancel
    }
}

#if os(iOS)
@MainActor
final class ScribbleBlocker: NSObject, UIScribbleInteractionDelegate {
    static let shared = ScribbleBlocker()

    func scribbleInteraction(_ interaction: UIScribbleInteraction, shouldBeginAt location: CGPoint) -> Bool {
        false
    }
}
#endif
