import Foundation
import Testing
@testable import PDFMarkupCore

@MainActor
@Suite("DocumentBridgeController over an in-memory transport (no WKWebView)")
struct BridgeControllerTests {
    let tmp: TempDir
    let root: URL
    let pdf: URL
    let transport = MemoryBridgeTransport()
    let controller: DocumentBridgeController
    let ring: SidecarVersionRing

    init() throws {
        tmp = try TempDir()
        root = try tmp.dir("Root")
        pdf = try tmp.file("Root/deck.pdf")
        let dirs = AppDirectories(applicationSupport: tmp.url.appendingPathComponent("AppSupport"))
        ring = SidecarVersionRing(directory: dirs.sidecarHistory, io: CoordinatedFileIO())
        let session = DocumentSession(
            document: identity(pdf, sha: "s1"),
            primary: SiblingSidecarStore(root: root, io: CoordinatedFileIO()),
            fallback: AppContainerSidecarStore(directory: dirs.sidecars, io: CoordinatedFileIO()),
            ring: ring
        )
        controller = DocumentBridgeController(session: session, transport: transport, pdfURLForWeb: "pdfmarkup://app/__document__/t.pdf", platform: .ios)
    }

    /// Yields (bounded, no clock) until the controller has sent its flushRequest.
    func waitForFlushRequest() async {
        for _ in 0..<1000 {
            if case .flushRequest = transport.sent.last { return }
            await Task.yield()
        }
    }

    @Test func readyOpensTheDocumentWithASchemeURLNotBytes() throws {
        try transport.receiveFromWeb(json: #"{"type":"ready","protocolVersion":1}"#)
        #expect(transport.sent == [.openDocument(pdfURL: "pdfmarkup://app/__document__/t.pdf", fileName: "deck.pdf", sha256: "s1", sidecarJSON: nil, platform: .ios, storageMode: .sibling)])
    }

    @Test func saveSceneIsWrittenAndAcknowledged() throws {
        transport.receiveFromWeb(.ready(protocolVersion: 1))
        try transport.receiveFromWeb(json: #"{"type":"saveScene","requestId":"save-1","sidecarJSON":"{\"schemaVersion\":1}"}"#)
        #expect(transport.sent.last == .saveResult(requestId: "save-1", ok: true, storageMode: .sibling, error: nil))
        #expect(try String(contentsOf: SiblingSidecarStore.sidecarURL(forPDF: pdf), encoding: .utf8) == #"{"schemaVersion":1}"#)
    }

    @Test func backgroundFlushWaitsForTheWebCore() async throws {
        transport.receiveFromWeb(.ready(protocolVersion: 1))
        async let saved = controller.requestFlush(.background)
        await waitForFlushRequest()
        guard case let .flushRequest(requestId, reason) = transport.sent.last else {
            Issue.record("expected flushRequest, got \(String(describing: transport.sent.last))")
            controller.abandonPendingFlushes()
            _ = await saved
            return
        }
        #expect(reason == .background)
        transport.receiveFromWeb(.saveScene(requestId: "save-9", sidecarJSON: "flushed"))
        transport.receiveFromWeb(.flushComplete(requestId: requestId, saved: true))
        #expect(await saved == true)
        #expect(try String(contentsOf: SiblingSidecarStore.sidecarURL(forPDF: pdf), encoding: .utf8) == "flushed")
    }

    @Test func flushBeforeReadyReturnsImmediately() async {
        #expect(await controller.requestFlush(.close) == false)
    }

    @Test func foregroundReloadsWhenCleanAndOverwritesAfterBackupWhenDirty() async throws {
        transport.receiveFromWeb(.ready(protocolVersion: 1))
        transport.receiveFromWeb(.saveScene(requestId: "save-1", sidecarJSON: "mine"))
        let sidecar = SiblingSidecarStore.sidecarURL(forPDF: pdf)

        try Data("theirs".utf8).write(to: sidecar)
        #expect(await controller.handleForeground() == .reload(sidecarJSON: "theirs"))
        #expect(transport.sent.last == .reloadScene(sidecarJSON: "theirs"))

        try Data("theirs-again".utf8).write(to: sidecar)
        transport.receiveFromWeb(.dirtyChanged(dirty: true))
        async let action = controller.handleForeground()
        await waitForFlushRequest()
        if case let .flushRequest(id, reason) = transport.sent.last {
            #expect(reason == .conflict)
            transport.receiveFromWeb(.flushComplete(requestId: id, saved: true))
        } else {
            controller.abandonPendingFlushes()
        }
        #expect(await action == .overwriteAfterBackup)
        #expect(try ring.versions(for: "s1").map { String(decoding: $0, as: UTF8.self) }.last == "theirs-again")
    }

    @Test func exportPayloadIsDecodedFromBase64() throws {
        var exported: (String, Data)?
        controller.onExportReady = { exported = ($0, $1) }
        transport.receiveFromWeb(.exportReady(fileName: "deck-marked.pdf", pdfBase64: Data("%PDF-1.7".utf8).base64EncodedString()))
        #expect(exported?.0 == "deck-marked.pdf")
        #expect(exported?.1 == Data("%PDF-1.7".utf8))
    }
}
