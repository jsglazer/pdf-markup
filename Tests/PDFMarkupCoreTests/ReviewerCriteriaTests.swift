import Foundation
import Testing

/// Static checks that make the reviewer criteria machine-checkable: they scan the Swift sources of
/// the core package and the app shell.
@Suite("Reviewer criteria (source scan)")
struct ReviewerCriteriaTests {
    static let repoRoot: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    static func swiftSources() -> [(URL, String)] {
        let dirs = ["Sources", "Tests", "App/Sources"].map { repoRoot.appendingPathComponent($0) }
        var out: [(URL, String)] = []
        for dir in dirs {
            guard let e = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: nil) else { continue }
            for case let url as URL in e where url.pathExtension == "swift" {
                if let text = try? String(contentsOf: url, encoding: .utf8) { out.append((url, text)) }
            }
        }
        return out
    }

    @Test func noStandardUserDefaultsOrHardcodedUserPaths() {
        let sources = Self.swiftSources()
        #expect(sources.count > 10)
        let standard = "UserDefaults" + ".standard"
        let banned = [standard, "\"/Users/", "\"~/", "/Dropbox/", "CloudStorage/Dropbox"]
        for (url, text) in sources where url.lastPathComponent != "ReviewerCriteriaTests.swift" {
            for needle in banned {
                #expect(!text.contains(needle), "\(url.lastPathComponent) contains \(needle)")
            }
        }
    }

    @Test func everySecurityScopeStartIsBalancedByADeferredStop() {
        for (url, text) in Self.swiftSources() where url.lastPathComponent != "ReviewerCriteriaTests.swift" {
            let lines = text.components(separatedBy: "\n")
            for (i, line) in lines.enumerated() where line.contains("startAccessingSecurityScopedResource()") {
                let next = lines.dropFirst(i + 1).prefix(1).joined()
                #expect(next.contains("defer") && next.contains("stopAccessingSecurityScopedResource()"),
                        "\(url.lastPathComponent):\(i + 1) start without an immediately deferred stop")
            }
        }
    }

    @Test func pdfBytesNeverGoThroughEvaluateJavaScript() {
        for (url, text) in Self.swiftSources() where url.lastPathComponent != "ReviewerCriteriaTests.swift" {
            #expect(!text.contains("evaluateJavaScript"), "\(url.lastPathComponent) uses evaluateJavaScript")
            if text.contains("callAsyncJavaScript") {
                #expect(!text.contains("base64EncodedString"), "\(url.lastPathComponent) base64-encodes data near JS calls")
            }
        }
    }

    @Test func sidecarStoresUseTheFileCoordinator() throws {
        let storage = try String(contentsOf: Self.repoRoot.appendingPathComponent("Sources/PDFMarkupCore/SidecarStorage.swift"), encoding: .utf8)
        #expect(!storage.contains("Data(contentsOf"))
        #expect(!storage.contains(".write(to"))
        let io = try String(contentsOf: Self.repoRoot.appendingPathComponent("Sources/PDFMarkupCore/FileCoordination.swift"), encoding: .utf8)
        #expect(io.components(separatedBy: "NSFileCoordinator(filePresenter: nil).coordinate(").count - 1 == 4)
    }
}
