// Loaded by boot.ts only after window.EXCALIDRAW_ASSET_PATH is set (ES imports are hoisted, so the
// asset path cannot be set in this module before Excalidraw initializes).
import "@excalidraw/excalidraw/index.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { createMemoryTransportPair, WebKitTransport, type BridgeTransport } from "./bridge/transport";
import { App } from "./components/App";
import { DocumentController } from "./controller/documentController";
import { rasterizeWithExcalidraw, renderStaticPreview } from "./excalidraw/adapter";
import { openPdfWithPdfjs } from "./pdf/pdfjsSource";
import { browserScheduler } from "./sidecar/sceneStore";
import { startBrowserHarness } from "./platform/browserHarness";

const win = window as unknown as Parameters<typeof WebKitTransport.isAvailable>[0];
let transport: BridgeTransport;
if (WebKitTransport.isAvailable(win)) {
  transport = new WebKitTransport(win, (error) => console.error("bridge decode error", error));
} else {
  // Standalone browser (vite dev): an in-memory "native" side lets the web core run without the app.
  const pair = createMemoryTransportPair();
  transport = pair.web;
  startBrowserHarness(pair.native);
}

const controller = new DocumentController({
  transport,
  openPdf: openPdfWithPdfjs,
  rasterize: rasterizeWithExcalidraw,
  scheduler: browserScheduler,
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing");
createRoot(rootEl).render(<App controller={controller} scheduler={browserScheduler} renderPreview={renderStaticPreview} />);
controller.start();
