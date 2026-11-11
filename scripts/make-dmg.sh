#!/bin/bash
#
# make-dmg.sh — build the macOS app from the XcodeGen project, sign it (sandbox entitlements
# included), and package a drag-to-Applications DMG in dist/.
#
# Signing tier adapts to the keychain:
#   • "Developer ID Application" identity present  -> hardened-runtime signed
#       + a notarytool profile present             -> notarized & stapled
#   • neither                                      -> ad-hoc signed (local use)
#
# Overrides:
#   SIGN_IDENTITY="Developer ID Application: Name (TEAMID)"   pin the identity
#   NOTARY_PROFILE="pdf-markup-notary"                        notarytool keychain profile to use
#   SKIP_NOTARIZE=1                                           sign but don't submit to Apple
#   SKIP_SIGN=1                                               ad-hoc only (local use)
#
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

APP_NAME="PDF Markup"
SCHEME="PDFMarkup-macOS"
PROJECT="App/PDFMarkup.xcodeproj"
ENTITLEMENTS="App/Generated/PDFMarkup-macOS.entitlements"
VERSION="$(awk '/MARKETING_VERSION:/ {print $2; exit}' App/project.yml)"

DIST="$ROOT/dist"
DERIVED="$ROOT/.build/xcode-release"
APP="$DIST/$APP_NAME.app"
DMG="$DIST/PDF-Markup-${VERSION}.dmg"
mkdir -p "$DIST"

echo "==> pdf-markup packager (version $VERSION)"

# 1. Regenerate the Xcode project (and the entitlements file) from App/project.yml.
echo "==> xcodegen generate"
(cd App && xcodegen generate >/dev/null)
[ -f "$ENTITLEMENTS" ] || { echo "missing $ENTITLEMENTS" >&2; exit 1; }

# 2. Build Release unsigned; step 4 signs with the entitlements. The pre-build step rebuilds web/.
echo "==> xcodebuild -scheme $SCHEME -configuration Release"
xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration Release \
    -derivedDataPath "$DERIVED" \
    CODE_SIGNING_ALLOWED=NO \
    build >/dev/null

BUILT="$DERIVED/Build/Products/Release/$APP_NAME.app"
[ -d "$BUILT" ] || { echo "no app bundle at $BUILT" >&2; exit 1; }
[ -f "$BUILT/Contents/Resources/web/index.html" ] || { echo "web core not embedded in $BUILT" >&2; exit 1; }

# 3. Stage the bundle in dist/.
echo "==> staging $APP"
rm -rf "$APP"
cp -R "$BUILT" "$APP"

# 4. Sign. --entitlements is essential: without it the sandbox and bookmark entitlements are dropped.
if [ -n "${SKIP_SIGN:-}" ]; then
    SIGN_IDENTITY=""
elif [ -z "${SIGN_IDENTITY:-}" ]; then
    SIGN_IDENTITY="$(security find-identity -v -p codesigning \
        | grep 'Developer ID Application' | head -1 \
        | sed -E 's/.*"(.*)".*/\1/' || true)"
fi

if [ -n "${SIGN_IDENTITY:-}" ]; then
    echo "==> signing (hardened runtime): $SIGN_IDENTITY"
    codesign --force --options runtime --timestamp --entitlements "$ENTITLEMENTS" --sign "$SIGN_IDENTITY" "$APP"
    SIGNED_REAL=1
else
    echo "==> no Developer ID identity; ad-hoc signing (local use only)"
    codesign --force --entitlements "$ENTITLEMENTS" --sign - "$APP"
    SIGNED_REAL=0
fi
codesign --verify --strict --verbose=2 "$APP"
echo "==> entitlements in the signed app:"
codesign -d --entitlements - --xml "$APP" 2>/dev/null | plutil -p - | sed 's/^/    /'

# 5. Notarize the app (only with Developer ID + a working notarytool profile).
NOTARIZED=0
have_profile() { xcrun notarytool history --keychain-profile "$1" >/dev/null 2>&1; }
if [ "$SIGNED_REAL" = 1 ] && [ -z "${SKIP_NOTARIZE:-}" ]; then
    for candidate in "${NOTARY_PROFILE:-pdf-markup-notary}" "notarytool" "app-router-notary" "tech-pomodoro-notary"; do
        if have_profile "$candidate"; then NOTARY_PROFILE="$candidate"; break; fi
    done
fi
if [ "$SIGNED_REAL" = 1 ] && [ -z "${SKIP_NOTARIZE:-}" ] && [ -n "${NOTARY_PROFILE:-}" ] && have_profile "$NOTARY_PROFILE"; then
    echo "==> notarizing the app via profile '$NOTARY_PROFILE'"
    ZIP="$DIST/PDF-Markup-notarize.zip"
    /usr/bin/ditto -c -k --keepParent "$APP" "$ZIP"
    xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$APP"
    rm -f "$ZIP"
    NOTARIZED=1
elif [ "$SIGNED_REAL" = 1 ]; then
    echo "==> skipping notarization (SKIP_NOTARIZE set, or no notarytool profile found)"
fi

# 6. Drag-to-Applications DMG.
echo "==> building DMG"
STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "PDF Markup $VERSION" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"
[ -f "$DMG" ] || { echo "hdiutil produced no DMG at $DMG" >&2; exit 1; }

if [ "$SIGNED_REAL" = 1 ]; then
    echo "==> signing the DMG"
    codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG"
    codesign --verify --strict --verbose=2 "$DMG"
fi

# 7. The DMG needs its own notarization ticket.
if [ "$NOTARIZED" = 1 ]; then
    echo "==> notarizing the DMG"
    xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$DMG"
fi

echo
echo "==> Gatekeeper assessment"
spctl -a -vvv -t exec "$APP" 2>&1 | sed 's/^/    app  /' || true
spctl -a -vvv -t open --context context:primary-signature "$DMG" 2>&1 | sed 's/^/    dmg  /' || true

echo
echo "==> DONE"
echo "    App: $APP"
echo "    DMG: $DMG"
if [ "$NOTARIZED" = 1 ]; then
    echo "    Signing: Developer ID + notarized + stapled"
elif [ "$SIGNED_REAL" = 1 ]; then
    echo "    Signing: Developer ID, NOT notarized (fine on this Mac; Gatekeeper warns on others)"
else
    echo "    Signing: ad-hoc (first launch: right-click ▸ Open)"
fi
