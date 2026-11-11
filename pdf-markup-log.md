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
