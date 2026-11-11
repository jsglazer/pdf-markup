import Foundation

/// Injectable transport for the native side of the BridgeProtocol. The app implements it over
/// WKWebView (WKScriptMessageHandler in, callAsyncJavaScript out); tests use `MemoryBridgeTransport`,
/// so the Swift side runs without a live web view.
@MainActor
public protocol BridgeTransport: AnyObject {
    func send(_ message: NativeToWebMessage)
    /// Set by the session controller; called for every decoded web → native message.
    var onReceive: ((WebToNativeMessage) -> Void)? { get set }
}

/// In-memory transport for tests: records what native sent and lets the test play the web side.
@MainActor
public final class MemoryBridgeTransport: BridgeTransport {
    public private(set) var sent: [NativeToWebMessage] = []
    public var onReceive: ((WebToNativeMessage) -> Void)?

    public init() {}

    public func send(_ message: NativeToWebMessage) {
        // Round-trip through JSON so tests see exactly what the web core would receive.
        if let json = try? BridgeCodec.encode(message), let decoded = try? BridgeCodec.decodeNativeMessage(json) {
            sent.append(decoded)
        }
    }

    /// Simulates the web core posting a raw JSON message.
    public func receiveFromWeb(json: String) throws {
        let message = try BridgeCodec.decodeWebMessage(json)
        onReceive?(message)
    }

    public func receiveFromWeb(_ message: WebToNativeMessage) {
        onReceive?(message)
    }
}
