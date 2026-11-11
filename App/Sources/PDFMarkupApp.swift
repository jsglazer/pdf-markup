import PDFMarkupCore
import SwiftUI

@main
struct PDFMarkupApp: App {
    @State private var library: LibraryModel?
    @State private var startupError: String?

    var body: some Scene {
        WindowGroup {
            Group {
                if let library {
                    RootView(library: library)
                } else if let startupError {
                    Text("PDF Markup could not start: \(startupError)").padding()
                } else {
                    ProgressView()
                }
            }
            .task {
                guard library == nil else { return }
                do {
                    library = LibraryModel(environment: try AppEnvironment.live())
                } catch {
                    startupError = error.localizedDescription
                }
            }
        }
    }
}

struct RootView: View {
    @Bindable var library: LibraryModel

    var body: some View {
        NavigationStack {
            HomeView(library: library)
                .navigationDestination(item: $library.openDocument) { request in
                    DocumentScreen(library: library, request: request)
                }
        }
    }
}
