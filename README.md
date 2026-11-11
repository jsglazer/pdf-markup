# PDF Markup

A personal PDF reader for macOS and iPadOS that lets you mark up slide decks and other PDFs with the full [Excalidraw](https://github.com/excalidraw/excalidraw) toolset: freehand pen (Apple Pencil on iPad), arrows, shapes, text and callouts. Markup stays editable. It is saved as a plain JSON sidecar next to the PDF (`deck.pdf` → `deck.pdf.excalidraw.json`), so it syncs through Dropbox along with the PDF, and the PDF itself is never modified.

## Features

- Opens PDFs through the system file picker (Files on iPad, the open panel on Mac), including Dropbox files that are online-only. A loading state shows while the File Provider downloads the file.
- One-time folder grant: pick a root folder (for example your Dropbox slides folder) and the app keeps a security-scoped bookmark so it can save sidecars next to any PDF under it.
- PDF.js viewer: continuous vertical scroll, fit-to-width, pinch/trackpad zoom, page jump, next/previous and a page list. Only the visible pages plus two on each side are rendered, and no canvas is larger than 4096 px on its longest side.
- Per-page Excalidraw markup aligned to the page at every zoom level. A Markup toggle switches between reading and drawing. Only one live Excalidraw editor exists at a time (on the active page); other pages show cached SVG previews.
- iPad: Apple Pencil draws (Excalidraw pen mode) while fingers scroll and zoom the document; Scribble is disabled on the drawing surface.
- Auto-save: edits are debounced for 750 ms and then written with a coordinated, atomic write. Pending edits are also saved immediately when you switch pages, leave markup mode, background the app or close the document. The last 5 sidecar versions per document are kept in Application Support.
- If a PDF is outside every granted folder, the app asks you to grant its folder. If you decline, or the folder can't be granted, markup goes to an app-local store with a persistent "Sidecar not syncing – Export/Relink" badge. The app never refuses to annotate.
- Flattened export: `<name>-marked.pdf`, with each annotated page's markup rasterized at 3× (about 216 dpi) and drawn over the page with pdf-lib, delivered through the share sheet (iPad) or a save panel (Mac). The original PDF is untouched.
- Recent files: the last 20 opened PDFs.
- Fully offline. PDF.js, Excalidraw and all fonts are bundled. The page has a strict Content-Security-Policy, the web view blocks every http(s) load with a content rule list, and only `pdfmarkup://` navigations are allowed. (The sandboxed Mac app does carry `network.client`, which WKWebView needs to render at all.)

## Sidecar format (v1)

```json
{
  "schemaVersion": 1,
  "pdf": { "fileName": "deck.pdf", "pageCount": 42, "sha256": "…" },
  "pages": { "3": { "elements": [ … Excalidraw elements … ] } }
}
```

Page keys are 1-based and empty pages are omitted. Coordinates are PDF points at scale 1.0, with the origin at the top-left of the page as displayed. Deleted elements are stripped on save, and `version`/`versionNonce` are kept on every element. A sidecar with a newer `schemaVersion` opens read-only.

## Repository layout

| Path | What it is |
|---|---|
| `Package.swift`, `Sources/PDFMarkupCore` | Swift package: sidecar stores (sibling and app container), `NSFileCoordinator` I/O, bookmarks, recent files, version ring, bridge message types, document session and bridge controller |
| `Tests/PDFMarkupCoreTests` | Swift Testing suite (`swift test`), including the bridge fixtures shared with the web tests |
| `App/` | SwiftUI app with native iOS/iPadOS and macOS targets; `project.yml` is the XcodeGen spec |
| `web/` | Vite + React + TypeScript web core (PDF.js, Excalidraw, pdf-lib) with Vitest tests |
| `scripts/embed-web.sh` | Xcode pre-build step that builds `web/` and copies `web/dist` into the app bundle |

## Building

Requirements: Xcode 16 or later (built with Xcode 27.2 and Swift 6.4), Node 20 or later, and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```sh
# Web core
cd web && npm ci && npm test && npm run build

# Swift core
swift test

# App (generates App/PDFMarkup.xcodeproj)
cd App && xcodegen generate
open PDFMarkup.xcodeproj   # schemes: PDFMarkup-iOS, PDFMarkup-macOS
```

Deployment targets are iOS/iPadOS 18.0 and macOS 15.0, and the bundle ID is `com.jsglazer.pdf-markup`. Set your development team in Xcode before running on a device. To work on the web core in a browser, run `npm run dev` in `web/`: a file input in the corner of the page opens a local PDF through an in-memory stand-in for the native shell.

## License

MIT. See [LICENSE](LICENSE).
