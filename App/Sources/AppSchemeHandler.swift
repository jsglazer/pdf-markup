import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the bundled web core and the open PDF over `pdfmarkup://app/…` (§4: PDF bytes go to the web
/// view through this WKURLSchemeHandler, never as base64 over JavaScript). Everything shares one origin,
/// so the CSP `'self'` covers the app, its fonts, PDF.js data files and the document.
@MainActor
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "pdfmarkup"
    static let host = "app"
    static let documentPrefix = "/__document__/"
    static var indexURL: URL {
        // Built from constants; force-unwrap avoided.
        URL(string: "\(scheme)://\(host)/index.html") ?? URL(fileURLWithPath: "/")
    }

    private let webRoot: URL
    private var documents: [String: Data] = [:]

    init(webRoot: URL) {
        self.webRoot = webRoot.standardizedFileURL
    }

    /// Registers PDF bytes and returns the URL the web core should load them from.
    func register(pdf: Data) -> String {
        let token = UUID().uuidString.lowercased()
        documents[token] = pdf
        return "\(Self.scheme)://\(Self.host)\(Self.documentPrefix)\(token).pdf"
    }

    func unregisterAll() {
        documents.removeAll()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, url.host == Self.host else {
            urlSchemeTask.didFailWithError(URLError(.unsupportedURL))
            return
        }
        let path = url.path
        if path.hasPrefix(Self.documentPrefix) {
            let token = String(path.dropFirst(Self.documentPrefix.count)).replacingOccurrences(of: ".pdf", with: "")
            guard let data = documents[token] else {
                respond(urlSchemeTask, url: url, status: 404, mime: "text/plain", data: Data())
                return
            }
            respond(urlSchemeTask, url: url, status: 200, mime: "application/pdf", data: data)
            return
        }
        let relative = path == "/" || path.isEmpty ? "index.html" : String(path.drop(while: { $0 == "/" }))
        let fileURL = webRoot.appendingPathComponent(relative).standardizedFileURL
        // Refuse anything that escapes the bundled web folder.
        guard fileURL.path.hasPrefix(webRoot.path + "/"), let data = try? Data(contentsOf: fileURL) else {
            respond(urlSchemeTask, url: url, status: 404, mime: "text/plain", data: Data())
            return
        }
        respond(urlSchemeTask, url: url, status: 200, mime: Self.mimeType(for: fileURL), data: data)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {}

    private func respond(_ task: any WKURLSchemeTask, url: URL, status: Int, mime: String, data: Data) {
        let headers = [
            "Content-Type": mime,
            "Content-Length": String(data.count),
            "Cache-Control": "no-store",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.badServerResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    static func mimeType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "html": "text/html; charset=utf-8"
        case "js", "mjs": "text/javascript; charset=utf-8"
        case "css": "text/css; charset=utf-8"
        case "json": "application/json"
        case "wasm": "application/wasm"
        case "woff2": "font/woff2"
        case "ttf": "font/ttf"
        case "pfb": "application/octet-stream"
        case "bcmap": "application/octet-stream"
        case "icc": "application/vnd.iccprofile"
        default: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}
