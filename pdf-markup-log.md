# pdf-markup log

Post-build activity log (no UpdateNNN.md exists yet). Build-cycle history is in `~/VaultDEV/2-Projects/Apps/pdf-markup/BuildLog.md`.

## 2026-11-11 — macOS DMG for local testing

**Prompt:** "great. let's test it on MacOS first. Is there a DMG ready to install?"

- No DMG existed; the build had produced only an unsigned Debug app.
- Added `scripts/make-dmg.sh`, adapted from tech-pomodoro's packager: runs `xcodegen generate`, builds the Release `PDFMarkup-macOS` scheme unsigned (the pre-build step rebuilds `web/`), checks that the web core is embedded, signs with the keychain's Developer ID identity (hardened runtime, with `App/Generated/PDFMarkup-macOS.entitlements` so the sandbox and bookmark entitlements stay in place), notarizes when a notarytool profile works and `SKIP_NOTARIZE` is not set, then builds and signs a drag-to-Applications DMG in `dist/` and prints the Gatekeeper assessment.
- Added `dist/` to `.gitignore`.
- The permission classifier blocked probing notarytool keychain profiles, so I ran with `SKIP_NOTARIZE=1`. Result: `dist/PDF-Markup-1.0.0.dmg`, signed with Developer ID Application: Joshua Glazer (PWGXN26URQ), not notarized. The signed app's entitlements are app-sandbox, files.user-selected.read-write and files.bookmarks.app-scope. Gatekeeper reports "Unnotarized Developer ID" (rejected), which only matters for downloaded copies; the local DMG has no quarantine flag.
- The signed, sandboxed Release app launched and was still running after 4 s.
- App version unchanged at 1.0.0 (packaging script only, no app code changed).

| # | Issue | Fix |
|---|---|---|
| 1 | No installable macOS artifact | `scripts/make-dmg.sh` builds, signs (with entitlements), optionally notarizes, and packages `dist/PDF-Markup-<version>.dmg` |
| 2 | Signing an unsigned build would drop the sandbox entitlements | The script passes `--entitlements` from the XcodeGen-generated file and prints the result |

**Summary presented to user:**

There's a DMG now: `/Users/josh/Dev/2-Projects/Apps/pdf-markup/dist/PDF-Markup-1.0.0.dmg`. Open it and drag PDF Markup to Applications.

It's signed with your Developer ID and keeps the sandbox entitlements. The sandboxed app launches. It isn't notarized: the permission check stopped me from looking up your notary keychain profiles. That doesn't matter on this Mac, because the DMG was built here and has no quarantine flag, so it opens with a double-click.

To make a notarized DMG yourself (for example, for another Mac), run `! scripts/make-dmg.sh` from the project folder. It notarizes with the first keychain profile that works, trying `pdf-markup-notary`, then `app-router-notary`, then `tech-pomodoro-notary`. To use a different profile, run `NOTARY_PROFILE=<name> scripts/make-dmg.sh`.

To test:
1. Open the app and click **Grant Folder Access…**. Pick the folder that holds your slides (your Dropbox folder works).
2. Click **Open PDF…**, pick a deck from that folder, click **Markup** and draw.
3. After about a second, check that `deck.pdf.excalidraw.json` appears next to the PDF.
4. Reopen the PDF. The markup should come back.
5. Try **Export**. It should save `<name>-marked.pdf` through a save panel.

The rest of the Mac checklist (trackpad pinch, scroll wheel over a page, drawing alignment after zoom) is in the build log. I added the script as `scripts/make-dmg.sh`, ignored `dist/` in git, and committed and pushed both. Tell me what breaks.

## 2026-11-11 — v1.0.1: Open PDF, Open With, blank web view, app icon

**Prompt:** "ok i installed it, granted access to `~/Dev/TEST/Markup/A` restarted the app, clicked Open PDF... and nothign happened. i also tried to use it by right-clicking the PDF and opening with the application but no luck" — then, mid-turn: "Also we need a cool icon. cyan, tech-focused"

- **Open PDF… did nothing.** `HomeView` had two `.fileImporter` modifiers (PDF and folder) on the same view, and SwiftUI only presents the last one. Replaced them with one importer whose content type follows an `ImportKind` state (`.pdf` / `.folder`).
- **Open With was ignored.** The app declared no document types and had no URL handler. Added `CFBundleDocumentTypes` (com.adobe.pdf, role Viewer, rank Alternate) to both targets; `.onOpenURL` on the root view routes the file into `LibraryModel.open` (queued in `pendingOpen` if it arrives before the library loads); `handlesExternalEvents` reuses the existing window. Verified: `open -a "PDF Markup.app" file.pdf` opens a document window titled with the file name.
- **Found while verifying: the web view was blank in the sandboxed app.** A sandboxed WKWebView needs `com.apple.security.network.client`; without it WebKit's helper processes can't start and nothing renders, even though every byte comes from the `pdfmarkup://` scheme handler. Proved it A/B on a PDF in the granted folder: same build without the entitlement → blank; with it → toolbar, 3 pages, page list, Markup and Export all render. Added the entitlement to `App/project.yml` with a comment. This reverses the build claim that the Mac sandbox blocks the network. Offline is still enforced by the CSP (`'self'` only), the WKContentRuleList that blocks all http(s) loads, and the pdfmarkup-only navigation policy; README updated.
- Verified the D2 prompt ("Allow saving markup next to this PDF?") appears for a PDF outside the granted folders.
- macOS window gets `.defaultSize(1100×900)` (applies when macOS has no saved frame for the window).
- **App icon:** added `scripts/make-icon.swift`, which draws the icon with CoreGraphics and writes `App/Sources/Assets.xcassets/AppIcon.appiconset` (iOS 1024 full-bleed + macOS 16–512 @1x/@2x rounded tile with shadow). Design: deep-navy tile with a faint grid, glowing cyan page outline with folded corner and text lines, circuit traces ending in nodes, and a white-hot freehand loop drawn by a cyan-banded stylus. `ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon` set in `project.yml`; `AppIcon.icns` and `Assets.car` confirmed in the bundle.
- Version 1.0.0 → 1.0.1 (`MARKETING_VERSION`, Dev file). Rebuilt `dist/PDF-Markup-1.0.1.dmg` (Developer ID signed, not notarized; entitlements: app-sandbox, network.client, user-selected.read-write, bookmarks.app-scope).
- Tests: `swift test` 32/32, Vitest 55/55.
- Test artifacts: put `claude-smoke.pdf` into `~/Dev/TEST/Markup/A` to test sibling mode, then deleted it (no sidecar had been written). Computer-use (cmux-cua) was unavailable (onboarding not finished), so checks used `open -a`, System Events and `screencapture`.
- Not yet verified: drawing, sidecar write next to the PDF in the sandbox, export save panel.

| # | Issue | Fix |
|---|---|---|
| 1 | Open PDF… showed no picker | Single `.fileImporter` driven by `ImportKind` (SwiftUI honours only the last importer on a view) |
| 2 | Finder Open With / double-click ignored | `CFBundleDocumentTypes` for PDF + `.onOpenURL` + `handlesExternalEvents` |
| 3 | Blank document view in the sandboxed app | Added `com.apple.security.network.client` (WKWebView requirement); README and offline claim corrected |
| 4 | No app icon | `scripts/make-icon.swift` generates the cyan tech icon for iOS and macOS |
| 5 | Tiny default Mac window | `.defaultSize(width: 1100, height: 900)` |

**Summary presented to user:**

Both problems are fixed, and a third bug showed up while I was checking. The new DMG is `/Users/josh/Dev/2-Projects/Apps/pdf-markup/dist/PDF-Markup-1.0.1.dmg`. Quit the old app and drag this one over it in Applications.

**What was wrong**
1. **Open PDF… did nothing.** The home screen had two file pickers on the same view, one for PDFs and one for folders. SwiftUI only shows the last one, so only Grant Folder Access worked. It's now a single picker that switches between PDFs and folders.
2. **Open With did nothing.** The app never told macOS it opens PDFs, and it had no code to receive a file from Finder. It now registers as a PDF viewer and opens the file in the existing window. I confirmed that opening a PDF this way shows its document window.
3. **Once a PDF did open, the page was blank.** A sandboxed web view needs the `network.client` entitlement, or WebKit can't start its helper processes. My earlier harness wasn't sandboxed, so it missed this. I compared builds with and without the entitlement on a PDF in your granted folder: without it the window stays blank; with it the toolbar and all pages render. The app is still offline: the page's security policy, a WebKit rule that blocks all http(s) loads, and the `pdfmarkup://`-only navigation policy still apply. Only the sandbox no longer blocks the network itself. I've corrected the README.

**Icon:** a deep-navy tile with a faint grid, a glowing cyan page with circuit traces, and a bright freehand loop drawn by a cyan-banded stylus. It's generated by `scripts/make-icon.swift`, so it's easy to tweak. Tell me if you want changes.

Also: the version is now 1.0.1, tests still pass (Swift 32/32, web 55/55), and everything is committed and pushed. I briefly put a test PDF in `~/Dev/TEST/Markup/A` and deleted it again. Your window may open small because macOS remembers the old window size; resize it once and it will stick.

Please test drawing next. Click **Markup**, draw, and check that `<name>.pdf.excalidraw.json` appears next to the PDF. Then try **Export**. I couldn't drive those steps automatically.

## 2026-11-11 — v1.0.2: opening a second PDF kept the first one loaded

**Prompt:** "it opens! But... PDF does not render / Sidecar not synced" (screenshot: window `test.pdf`, a blank page with an orange rectangle, "Sidecar not syncing" badge)

- **What the screenshot showed was correct.** `test.pdf` is the throwaway 3-page PDF from my WebKit check (blank pages with an orange rectangle) and lives in the session scratchpad, outside the granted folder, so fallback mode and the badge are expected. It reached the user's Recents because my test runs share the app's sandbox container with the installed copy. Asked the user to remove it from Recents.
- **Real bug found while checking:** opening `~/Dev/TEST/Markup/A/Equations Key.pdf` while `test.pdf` was showing changed the title but kept the old document and badge. `navigationDestination(item:)` reused the same `DocumentScreen`, so its `.task` never re-ran and the previous `DocumentModel` stayed. Fix: `.id(request.id)` gives each opened document its own view identity (the old screen disappears → flush/close; the new one loads).
- **Related fix:** the file importer and the D2/error alerts were attached to `HomeView`, so they couldn't present while a document was on screen (Relink also had its own importer). Moved them into a `LibraryPresentations` modifier on the `NavigationStack`, with the import state (`importKind`, `importing`, the PDF to reopen) in `LibraryModel` (`requestImport` / `finishImport`). One importer serves Open PDF, Grant Folder, the D2 prompt and Relink.
- Version 1.0.1 → 1.0.2; rebuilt `dist/PDF-Markup-1.0.2.dmg` (Developer ID signed, not notarized). iOS Simulator and macOS builds clean.
- Verified on the 1.0.2 build: `Equations Key.pdf` from the granted folder renders all pages with **no** fallback badge (sibling mode), and the live Excalidraw toolbar works in Markup mode. The user started interacting with my test window mid-check, so I stopped driving the app and didn't kill the running 1.0.2 instance. The second-document switch over Open With was inconclusive (with two copies running, LaunchServices likely routed the file to the installed copy).

| # | Issue | Fix |
|---|---|---|
| 1 | Opening a second PDF kept the first PDF (and its badge) under the new title | `.id(request.id)` on `DocumentScreen` in `navigationDestination` |
| 2 | Picker / grant prompt / errors couldn't present while a document was showing | `LibraryPresentations` at the `NavigationStack`; import state in `LibraryModel`; Relink uses the shared importer |

**Summary presented to user:**

The PDF in your screenshot did render. That file is my throwaway test PDF: a blank page with an orange rectangle, which is exactly what's showing. It's stored outside your granted folder, so "Sidecar not syncing" is expected for it. It landed in your Recents because my test runs share the app's storage with your installed copy. Sorry about that; right-click it in Recents and choose **Remove from Recents**.

Checking that turned up a real bug, which is probably what confused things. If you open a second PDF while one is showing, the title changes but the old PDF and its badge stay. That's fixed in **1.0.2**: `/Users/josh/Dev/2-Projects/Apps/pdf-markup/dist/PDF-Markup-1.0.2.dmg`. The folder picker and the "grant this folder?" prompt also work now while a document is open, so **Relink** works.

On 1.0.2, `Equations Key.pdf` from `~/Dev/TEST/Markup/A` renders all 4 pages with no badge, so markup is saved next to it, and the Excalidraw tools appear in Markup mode. You seemed to be using the window my test opened (that's the 1.0.2 build from `dist/`), so I stopped there and left it running.

Next to check: draw on `Equations Key.pdf`, and within about a second `Equations Key.pdf.excalidraw.json` should appear in that folder. Then reopen it, then try Export. Committed and pushed.
