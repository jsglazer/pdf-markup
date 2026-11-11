// swift-tools-version: 6.0
// PDFMarkupCore: sidecar stores, bookmarks, recent files and bridge message types (D10).
// Swift 6 language mode → strict concurrency checking is on for every target.
import PackageDescription

let package = Package(
    name: "PDFMarkupCore",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "PDFMarkupCore", targets: ["PDFMarkupCore"]),
    ],
    targets: [
        .target(name: "PDFMarkupCore", path: "Sources/PDFMarkupCore"),
        .testTarget(
            name: "PDFMarkupCoreTests",
            dependencies: ["PDFMarkupCore"],
            path: "Tests/PDFMarkupCoreTests",
            resources: [.copy("Fixtures")]
        ),
    ],
    swiftLanguageModes: [.v6]
)
