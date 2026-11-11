import Foundation
import Testing
@testable import PDFMarkupCore

@Suite("DocumentSession: fallback, ring and foreground reconciliation")
struct SessionTests {
    struct Env {
        let tmp: TempDir
        let dirs: AppDirectories
        let ring: SidecarVersionRing
        let fallback: AppContainerSidecarStore
        let root: URL
        let pdf: URL
    }

    func makeEnv() throws -> Env {
        let tmp = try TempDir()
        let dirs = AppDirectories(applicationSupport: tmp.url.appendingPathComponent("AppSupport"))
        let io = CoordinatedFileIO()
        let root = try tmp.dir("Root")
        let pdf = try tmp.file("Root/deck.pdf")
        return Env(tmp: tmp, dirs: dirs, ring: SidecarVersionRing(directory: dirs.sidecarHistory, io: io),
                   fallback: AppContainerSidecarStore(directory: dirs.sidecars, io: io), root: root, pdf: pdf)
    }

    @Test func savesNextToThePDFInSiblingMode() throws {
        let env = try makeEnv()
        let session = DocumentSession(document: identity(env.pdf), primary: SiblingSidecarStore(root: env.root, io: CoordinatedFileIO()), fallback: env.fallback, ring: env.ring)
        #expect(session.open() == OpenedSidecar(sidecarJSON: nil, storageMode: .sibling))
        #expect(session.save("{\"schemaVersion\":1}") == SaveOutcome(ok: true, storageMode: .sibling, error: nil))
        let onDisk = try Data(contentsOf: SiblingSidecarStore.sidecarURL(forPDF: env.pdf))
        #expect(String(decoding: onDisk, as: UTF8.self) == "{\"schemaVersion\":1}")
    }

    @Test func switchesToTheFallbackStoreWhenTheSiblingWriteFails() throws {
        let env = try makeEnv()
        // Make the PDF's folder read-only so the sibling write genuinely fails.
        try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: env.root.path)
        let session = DocumentSession(document: identity(env.pdf, sha: "feed"), primary: SiblingSidecarStore(root: env.root, io: CoordinatedFileIO()), fallback: env.fallback, ring: env.ring)
        _ = session.open()
        let outcome = session.save("{}")
        #expect(outcome == SaveOutcome(ok: true, storageMode: .fallback, error: nil))
        #expect(session.storageMode == .fallback)
        #expect(FileManager.default.fileExists(atPath: env.dirs.sidecars.appendingPathComponent("feed.excalidraw.json").path))
        #expect(session.activeSidecarURL.lastPathComponent == "feed.excalidraw.json")
    }

    @Test func fallsBackWhenTheSiblingStoreThrowsOnRead() throws {
        let env = try makeEnv()
        let session = DocumentSession(document: identity(env.pdf), primary: FailingStore(), fallback: env.fallback, ring: env.ring)
        #expect(session.open().storageMode == .fallback)
    }

    @Test func startsInFallbackModeWithoutAPrimaryStoreAndReadsAnEarlierFallbackCopy() throws {
        let env = try makeEnv()
        let doc = identity(env.pdf, sha: "cafe")
        try env.fallback.writeSidecar(Data("old".utf8), for: doc)
        let session = DocumentSession(document: doc, primary: nil, fallback: env.fallback, ring: env.ring)
        #expect(session.open() == OpenedSidecar(sidecarJSON: "old", storageMode: .fallback))
    }

    @Test func preservesTheLoadedSidecarInTheRingEvenWhenItIsMalformed() throws {
        let env = try makeEnv()
        try Data("{not json".utf8).write(to: SiblingSidecarStore.sidecarURL(forPDF: env.pdf))
        let session = DocumentSession(document: identity(env.pdf, sha: "bad"), primary: SiblingSidecarStore(root: env.root, io: CoordinatedFileIO()), fallback: env.fallback, ring: env.ring)
        #expect(session.open().sidecarJSON == "{not json")
        _ = session.save("{\"schemaVersion\":1}")
        #expect(try env.ring.versions(for: "bad").map { String(decoding: $0, as: UTF8.self) } == ["{not json"])
    }

    @Test func foregroundReconcileFollowsD8() throws {
        let env = try makeEnv()
        let doc = identity(env.pdf, sha: "ring")
        let session = DocumentSession(document: doc, primary: SiblingSidecarStore(root: env.root, io: CoordinatedFileIO()), fallback: env.fallback, ring: env.ring)
        _ = session.open()
        _ = session.save("mine")
        #expect(session.reconcileOnForeground(hasDirtyPages: false) == .upToDate)

        let sidecar = SiblingSidecarStore.sidecarURL(forPDF: env.pdf)
        try Data("theirs-1".utf8).write(to: sidecar)
        #expect(session.reconcileOnForeground(hasDirtyPages: false) == .reload(sidecarJSON: "theirs-1"))
        #expect(session.reconcileOnForeground(hasDirtyPages: false) == .upToDate) // now known

        try Data("theirs-2".utf8).write(to: sidecar)
        #expect(session.reconcileOnForeground(hasDirtyPages: true) == .overwriteAfterBackup)
        #expect(try env.ring.versions(for: "ring").map { String(decoding: $0, as: UTF8.self) }.last == "theirs-2")
    }

    @Test func reconcilerDecisionTable() {
        let a = Data("a".utf8)
        let b = Data("b".utf8)
        #expect(ForegroundReconciler.decide(lastKnown: a, onDisk: a, hasDirtyPages: true) == .upToDate)
        #expect(ForegroundReconciler.decide(lastKnown: a, onDisk: nil, hasDirtyPages: false) == .upToDate)
        #expect(ForegroundReconciler.decide(lastKnown: a, onDisk: b, hasDirtyPages: false) == .reload(sidecarJSON: "b"))
        #expect(ForegroundReconciler.decide(lastKnown: nil, onDisk: b, hasDirtyPages: true) == .overwriteAfterBackup)
    }
}
