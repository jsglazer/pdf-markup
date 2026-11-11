import Foundation
import Testing
@testable import PDFMarkupCore

@Suite("Bookmarks, out-of-root detection and recent files")
struct BookmarkTests {
    @Test func systemCodecResolvesARealBookmarkForATemporaryFolder() throws {
        let tmp = try TempDir()
        let folder = try tmp.dir("Root")
        let codec = SystemBookmarkCodec(securityScoped: false)
        let resolved = try codec.resolve(codec.makeBookmark(for: folder))
        #expect(PathContainment.components(of: resolved.url) == PathContainment.components(of: folder))
        #expect(resolved.isStale == false)
    }

    @Test func rootStoreFindsTheCoveringRootAndDetectsOutOfRootPDFs() throws {
        let tmp = try TempDir()
        let defaults = TestDefaults()
        let root = try tmp.dir("Root")
        let nested = try tmp.dir("Root/Course/Slides")
        _ = try tmp.dir("Root2")
        let roots = RootFolderStore(defaults: defaults.defaults, codec: SystemBookmarkCodec(securityScoped: false))
        try roots.addRoot(root)
        try roots.addRoot(nested)

        let deep = try tmp.file("Root/Course/Slides/deck.pdf")
        let shallow = try tmp.file("Root/notes.pdf")
        let outside = try tmp.file("Root2/deck.pdf") // shares the "Root" prefix but is not inside it
        let loose = try tmp.file("deck.pdf")

        #expect(roots.root(covering: deep).map(PathContainment.components(of:)) == PathContainment.components(of: nested))
        #expect(roots.root(covering: shallow).map(PathContainment.components(of:)) == PathContainment.components(of: root))
        #expect(roots.isOutOfRoot(outside))
        #expect(roots.isOutOfRoot(loose))
        #expect(roots.isOutOfRoot(root)) // the folder itself is not a file inside it

        // Persisted in the injected suite: a new store instance over the same suite sees the roots.
        let reopened = RootFolderStore(defaults: defaults.reopen(), codec: SystemBookmarkCodec(securityScoped: false))
        #expect(reopened.roots().count == 2)
    }

    @Test func rootStoreReplacesDuplicatesRefreshesStaleAndDropsBrokenBookmarks() throws {
        let tmp = try TempDir()
        let defaults = TestDefaults()
        let codec = FakeBookmarkCodec()
        let a = try tmp.dir("A")
        let b = try tmp.dir("B")
        let roots = RootFolderStore(defaults: defaults.defaults, codec: codec)
        try roots.addRoot(a)
        try roots.addRoot(a)
        try roots.addRoot(b)
        #expect(roots.roots().count == 2)

        codec.markStale(a)
        let made = codec.madeCount
        #expect(roots.roots().count == 2)
        #expect(codec.madeCount == made + 1) // stale bookmark was re-created

        codec.markBroken(b)
        #expect(roots.roots().map(\.lastPathComponent) == ["A"])
    }

    @Test func accessPlannerFollowsD1AndD2() throws {
        let tmp = try TempDir()
        let defaults = TestDefaults()
        let root = try tmp.dir("Root")
        let roots = RootFolderStore(defaults: defaults.defaults, codec: SystemBookmarkCodec(securityScoped: false))
        try roots.addRoot(root)
        let inside = try tmp.file("Root/deck.pdf")
        let outside = try tmp.file("Other/deck.pdf")

        guard case .sibling = SidecarAccessPlanner.plan(pdfURL: inside, roots: roots, userDeclinedGrant: false) else {
            Issue.record("expected sibling")
            return
        }
        #expect(SidecarAccessPlanner.plan(pdfURL: outside, roots: roots, userDeclinedGrant: false) == .needsGrant(suggestedFolder: outside.deletingLastPathComponent()))
        #expect(SidecarAccessPlanner.plan(pdfURL: outside, roots: roots, userDeclinedGrant: true) == .fallback)
    }

    @Test func recentFilesKeepsTwentyNewestFirstWithoutDuplicates() throws {
        let tmp = try TempDir()
        let defaults = TestDefaults()
        let recents = RecentFilesStore(defaults: defaults.defaults, codec: FakeBookmarkCodec())
        var files: [URL] = []
        for i in 1...25 { files.append(try tmp.file("f\(i).pdf")) }
        for f in files { try recents.add(f) }

        var list = recents.recentFiles()
        #expect(list.count == 20)
        #expect(list.first?.displayName == "f25.pdf")
        #expect(list.last?.displayName == "f6.pdf")

        try recents.add(files[9]) // f10 → front, no duplicate
        list = recents.recentFiles()
        #expect(list.count == 20)
        #expect(list.first?.displayName == "f10.pdf")
        #expect(list.filter { $0.displayName == "f10.pdf" }.count == 1)
    }

    @Test func recentFilesPrunesUnresolvableEntriesAndPersistsInTheSuite() throws {
        let tmp = try TempDir()
        let defaults = TestDefaults()
        let codec = FakeBookmarkCodec()
        let recents = RecentFilesStore(defaults: defaults.defaults, codec: codec, limit: 20)
        let a = try tmp.file("a.pdf")
        let b = try tmp.file("b.pdf")
        try recents.add(a)
        try recents.add(b)
        codec.markBroken(a)
        #expect(recents.recentFiles().map(\.displayName) == ["b.pdf"])

        let reopened = RecentFilesStore(defaults: defaults.reopen(), codec: codec)
        #expect(reopened.recentFiles().map(\.displayName) == ["b.pdf"]) // pruning was persisted
        reopened.remove(b)
        #expect(reopened.recentFiles().isEmpty)
    }
}
