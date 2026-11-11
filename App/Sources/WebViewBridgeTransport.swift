import Foundation
import PDFMarkupCore
import WebKit

/// BridgeTransport over WKWebView: web → native via a WKScriptMessageHandler, native → web via
/// `callAsyncJavaScript` with the JSON passed as an argument (no string splicing, no PDF bytes).
@MainActor
final class WebViewBridgeTransport: NSObject, BridgeTransport, WKScriptMessageHandler {
    weak var webView: WKWebView?
    var onReceive: ((WebToNativeMessage) -> Void)?
    var onDecodeError: ((String) -> Void)?

    func send(_ message: NativeToWebMessage) {
        guard let webView, let json = try? BridgeCodec.encode(message) else { return }
        webView.callAsyncJavaScript("\(BridgeProtocol.receiveFunction)(json)", arguments: ["json": json], in: nil, in: .page) { [weak self] result in
            if case let .failure(error) = result {
                self?.onDecodeError?("bridge send failed: \(error.localizedDescription)")
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? String else {
            onDecodeError?("bridge message body is not a string")
            return
        }
        do {
            onReceive?(try BridgeCodec.decodeWebMessage(body))
        } catch {
            onDecodeError?("could not decode bridge message: \(error)")
        }
    }
}

/// Breaks the WKUserContentController → handler retain cycle.
@MainActor
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
