#!/bin/sh
# Xcode pre-build step (D10): build the web core and copy web/dist into the app bundle's resources as
# "web/". Everything the WKWebView loads comes from this folder through the pdfmarkup:// scheme handler.
# Set SKIP_WEB_BUILD=1 to reuse an existing web/dist.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$REPO/web"
# Xcode build phases run with a minimal PATH; add the usual Node install locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if [ "${SKIP_WEB_BUILD:-0}" != "1" ]; then
  if [ ! -d "$WEB/node_modules" ]; then
    (cd "$WEB" && npm ci)
  fi
  (cd "$WEB" && npm run build)
fi

if [ ! -f "$WEB/dist/index.html" ]; then
  echo "error: $WEB/dist/index.html is missing; run 'npm run build' in web/" >&2
  exit 1
fi

DEST="${TARGET_BUILD_DIR:?}/${UNLOCALIZED_RESOURCES_FOLDER_PATH:?}/web"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$WEB/dist/." "$DEST/"
echo "Embedded web core into $DEST"
