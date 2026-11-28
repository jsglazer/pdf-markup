import DevStyleKit
import PDFMarkupCore
import SwiftUI

@main
struct PDFMarkupApp: App {
    @State private var library: LibraryModel?
    @State private var startupError: String?
    /// A PDF handed over by Finder / Files ("Open With") before the library finished loading.
    @State private var pendingOpen: URL?

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
                    let model = LibraryModel(environment: try AppEnvironment.live())
                    library = model
                    if let url = pendingOpen {
                        pendingOpen = nil
                        model.open(url)
                    }
                } catch {
                    startupError = error.localizedDescription
                }
            }
            // Open With / double-click / Files "Open in": the system hands the PDF URL here.
            .onOpenURL { url in
                guard url.isFileURL else { return }
                if let library { library.open(url) } else { pendingOpen = url }
            }
            // Reuse the existing window instead of opening a new one for each file (macOS).
            .handlesExternalEvents(preferring: ["*"], allowing: ["*"])
            // DevStyle: the profile for the window's appearance; the window takes that profile's
            // own appearance (one profile picked for both modes).
            .devStyle(PDFStyle.store, requested: nil)
        }
        .handlesExternalEvents(matching: ["*"])
        #if os(macOS)
        .defaultSize(width: 1100, height: 900)
        .commands {
            // View ▸ Style Profile: every profile, light and dark in one list (custom ones too),
            // the one showing checked; picking one shows it in both light and dark mode. While
            // "Follow shared style" is on this changes the style for every app that follows it.
            CommandGroup(after: .toolbar) {
                Divider()
                DSStyleProfileMenu(store: PDFStyle.store)
            }
        }
        #endif

        #if os(macOS)
        // Settings ▸ Style: Follow shared style, and one light and one dark profile.
        Settings {
            Form {
                DSStyleSettingsSection(store: PDFStyle.store, appName: "PDF Markup")
            }
            .formStyle(.grouped)
            .frame(width: 460)
            .devStyle(PDFStyle.store, requested: nil)
        }
        #endif
    }
}

struct RootView: View {
    @Bindable var library: LibraryModel

    var body: some View {
        NavigationStack {
            HomeView(library: library)
                .navigationDestination(item: $library.openDocument) { request in
                    // A new identity per opened document: SwiftUI otherwise reuses the screen, its
                    // .task never re-runs, and the previous PDF stays loaded under the new title.
                    DocumentScreen(library: library, request: request)
                        .id(request.id)
                }
        }
        .modifier(LibraryPresentations(library: library))
    }
}
