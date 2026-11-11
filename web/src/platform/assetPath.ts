/**
 * Excalidraw font/asset base URL (D-§4: assets bundled locally via window.EXCALIDRAW_ASSET_PATH).
 * Always the app's own origin — e.g. pdfmarkup://app/ inside the WKWebView. Never an http(s) CDN.
 */
export function localAssetBase(baseURI: string): string {
  const url = new URL("./", baseURI);
  if (url.protocol === "http:" || url.protocol === "https:") {
    // Only reachable in the `vite` dev server on localhost; the shipped app always uses pdfmarkup://.
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error(`refusing non-local asset base: ${url.href}`);
    }
  }
  return url.href;
}

export function configureExcalidrawAssetPath(win: Window & { EXCALIDRAW_ASSET_PATH?: string | string[] }, baseURI: string): string {
  const base = localAssetBase(baseURI);
  win.EXCALIDRAW_ASSET_PATH = base;
  return base;
}
