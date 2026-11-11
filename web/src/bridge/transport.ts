import { decodeNativeMessage, type NativeToWebMessage, type WebToNativeMessage } from "./protocol";

/**
 * Injectable transport. Production uses WebKitTransport; tests and the standalone browser build use the
 * in-memory pair, so the web core runs headless with no WKWebView.
 */
export interface BridgeTransport {
  send(message: WebToNativeMessage): void;
  /** Registers a handler for decoded native messages. Returns an unsubscribe function. */
  onMessage(handler: (message: NativeToWebMessage) => void): () => void;
}

interface WebKitMessageHandler {
  postMessage(body: unknown): void;
}

interface WebKitWindow {
  webkit?: { messageHandlers?: Record<string, WebKitMessageHandler | undefined> };
  /** Native calls this via callAsyncJavaScript with a JSON string argument. */
  __pdfMarkupReceive?: (json: string) => void;
}

export const WEBKIT_HANDLER_NAME = "pdfMarkupBridge";

/** Transport for the WKWebView shell: postMessage out, window.__pdfMarkupReceive in. */
export class WebKitTransport implements BridgeTransport {
  private readonly handlers = new Set<(m: NativeToWebMessage) => void>();
  private readonly handler: WebKitMessageHandler;

  constructor(
    private readonly win: WebKitWindow,
    private readonly onDecodeError: (error: unknown) => void = () => undefined,
  ) {
    const h = win.webkit?.messageHandlers?.[WEBKIT_HANDLER_NAME];
    if (!h) throw new Error("WebKit message handler is not installed");
    this.handler = h;
    win.__pdfMarkupReceive = (json: string) => {
      let message: NativeToWebMessage;
      try {
        message = decodeNativeMessage(json);
      } catch (error) {
        this.onDecodeError(error);
        return;
      }
      for (const fn of this.handlers) fn(message);
    };
  }

  static isAvailable(win: WebKitWindow): boolean {
    return Boolean(win.webkit?.messageHandlers?.[WEBKIT_HANDLER_NAME]);
  }

  send(message: WebToNativeMessage): void {
    this.handler.postMessage(JSON.stringify(message));
  }

  onMessage(handler: (message: NativeToWebMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

/** In-memory transport: `web` is handed to the web core, `native` is driven by the test (or the dev page). */
export interface MemoryTransportPair {
  web: BridgeTransport;
  native: {
    sent: WebToNativeMessage[];
    deliver(message: NativeToWebMessage): void;
    onSend(handler: (message: WebToNativeMessage) => void): () => void;
  };
}

export function createMemoryTransportPair(): MemoryTransportPair {
  const webHandlers = new Set<(m: NativeToWebMessage) => void>();
  const nativeHandlers = new Set<(m: WebToNativeMessage) => void>();
  const sent: WebToNativeMessage[] = [];
  return {
    web: {
      send(message) {
        // Round-trip through JSON so tests see exactly what Swift would receive.
        const copy = JSON.parse(JSON.stringify(message)) as WebToNativeMessage;
        sent.push(copy);
        for (const fn of nativeHandlers) fn(copy);
      },
      onMessage(handler) {
        webHandlers.add(handler);
        return () => webHandlers.delete(handler);
      },
    },
    native: {
      sent,
      deliver(message) {
        const decoded = decodeNativeMessage(JSON.stringify(message));
        for (const fn of webHandlers) fn(decoded);
      },
      onSend(handler) {
        nativeHandlers.add(handler);
        return () => nativeHandlers.delete(handler);
      },
    },
  };
}
