import type { MemoryTransportPair } from "../bridge/transport";

/**
 * Development-only stand-in for the Swift shell when the page runs in a normal browser: a file input
 * opens a local PDF (blob: URL) and saves are kept in memory and logged. Not used inside the app.
 */
export function startBrowserHarness(native: MemoryTransportPair["native"]): void {
  let lastSaved: string | null = null;
  native.onSend((m) => {
    if (m.type === "saveScene") {
      lastSaved = m.sidecarJSON;
      console.info("[harness] saveScene", m.sidecarJSON.length, "bytes");
      queueMicrotask(() =>
        native.deliver({ type: "saveResult", requestId: m.requestId, ok: true, storageMode: "sibling", error: null }),
      );
    } else if (m.type === "exportReady") {
      const bytes = Uint8Array.from(atob(m.pdfBase64), (c) => c.charCodeAt(0));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      a.download = m.fileName;
      a.click();
    } else if (m.type === "log") {
      console.info(`[web ${m.level}]`, m.message);
    }
  });
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf";
  input.className = "harness-input";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    native.deliver({
      type: "openDocument",
      pdfURL: URL.createObjectURL(file),
      fileName: file.name,
      sha256: "browser-harness",
      sidecarJSON: lastSaved,
      platform: "browser",
      storageMode: "sibling",
    });
  };
  document.body.prepend(input);
}
