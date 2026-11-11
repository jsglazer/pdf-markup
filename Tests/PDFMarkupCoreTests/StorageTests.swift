import Foundation
import Testing
@testable import PDFMarkupCore

@Suite("Sidecar stores: coordinated atomic read/write cycles")
struct StorageTests {
    @Test func siblingStoreNamesWritesAndReadsNextToThePDF() throws {
        let tmp = try TempDir()
        let root = try tmp.dir("Dropboxish/Slides")
        let pdf = try tmp.file("Dropboxish/Slides/Week 3/deck.pdf")
        let io = SpyFileIO()
        let store = SiblingSidecarStore(root: root, io: io)
        let doc = identity(pdf)

        #expect(store.sidecarURL(for: doc).lastPathComponent == "deck.pdf.excalidraw.json")
        #expect(store.sidecarURL(for: doc).deletingLastPathComponent().standardizedFileURL == pdf.deletingLastPathComponent().standardizedFileURL)
        #expect(try store.readSidecar(for: doc) == nil)

        try store.writeSidecar(Data("v1".utf8), for: doc)
        try store.writeSidecar(Data("v2-longer".utf8), for: doc)
        #expect(try store.readSidecar(for: doc) == Data("v2-longer".utf8))
        #expect(io.calls == ["read:deck.pdf.excalidraw.json", "write:deck.pdf.excalidraw.json", "write:deck.pdf.excalidraw.json", "read:deck.pdf.excalidraw.json"])

        // Atomic writes leave no temporary files behind.
        let siblings = try FileManager.default.contentsOfDirectory(atPath: pdf.deletingLastPathComponent().path).sorted()
        #expect(siblings == ["deck.pdf", "deck.pdf.excalidraw.json"])
    }

    @Test func appContainerStoreKeysBySHA256AndCreatesItsDirectory() throws {
        let tmp = try TempDir()
        let dirs = AppDirectories(applicationSupport: tmp.url.appendingPathComponent("AppSupport"))
        let io = SpyFileIO()
        let store = AppContainerSidecarStore(directory: dirs.sidecars, io: io)
        let doc = identity(try tmp.file("elsewhere/deck.pdf"), sha: "deadbeef")

        #expect(store.sidecarURL(for: doc).lastPathComponent == "deadbeef.excalidraw.json")
        try store.writeSidecar(Data("{}".utf8), for: doc)
        #expect(try store.readSidecar(for: doc) == Data("{}".utf8))
        #expect(FileManager.default.fileExists(atPath: dirs.sidecars.appendingPathComponent("deadbeef.excalidraw.json").path))
        #expect(io.calls.allSatisfy { $0.hasPrefix("read:") || $0.hasPrefix("write:") })
    }

    @Test func coordinatedIOReturnsNilForMissingFilesAndListsMissingDirectoriesAsEmpty() throws {
        let tmp = try TempDir()
        let io = CoordinatedFileIO()
        #expect(try io.coordinatedRead(at: tmp.url.appendingPathComponent("missing.json")) == nil)
        #expect(try io.coordinatedList(directory: tmp.url.appendingPathComponent("nope")) == [])
        try io.coordinatedDelete(at: tmp.url.appendingPathComponent("missing.json"))
    }

    @Test func versionRingKeepsTheLastFiveDistinctVersionsInOrder() throws {
        let tmp = try TempDir()
        let ring = SidecarVersionRing(directory: tmp.url.appendingPathComponent("History"), io: CoordinatedFileIO())
        for i in 1...8 { #expect(try ring.push(Data("v\(i)".utf8), for: "sha")) }
        #expect(try ring.push(Data("v8".utf8), for: "sha") == false) // identical to newest → skipped
        #expect(try ring.versions(for: "sha").map { String(decoding: $0, as: UTF8.self) } == ["v4", "v5", "v6", "v7", "v8"])
        #expect(try ring.versions(for: "other").isEmpty)
    }

    @Test func fingerprintIsLowercaseHexSHA256() {
        #expect(PDFFingerprint.sha256Hex(of: Data("abc".utf8)) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }
}
