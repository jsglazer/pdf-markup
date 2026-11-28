import DevStyleKit

/// DevStyle (https://github.com/jsglazer/devstyle): the app's one style store. On macOS it reads the
/// shared style folder through the App Group `PWGXN26URQ.com.jsglazer.devstyle`, keeps PDF Markup's
/// own choice in UserDefaults (`DevStylePreference`) and re-applies within a moment when another
/// app or an edit changes the folder. iOS has no shared folder (an iOS App Group must start with
/// `group.`), so it uses DevStyle's built-in profiles and this app's own choice.
@MainActor
enum PDFStyle {
    static let store = DevStyleStore()
}
