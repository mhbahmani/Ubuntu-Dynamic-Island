#!/bin/sh
# Builds an installable, versioned extension zip with compiled schemas.
set -eu
cd "$(dirname -- "$0")/.."
UUID='ubuntu-island@mhbahmani.github.io'
VERSION=$(sed -n 's/.*"version": \([0-9]*\).*/\1/p' metadata.json)
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/schemas"
# helpers/agents includes the visibility-scoped title metadata reader.
# Match install.sh and keep development files out of the package.
cp extension.js prefs.js metadata.json stylesheet.css "$STAGE/"
cp -R ui preferences "$STAGE/"
cp -R services "$STAGE/services"
cp -R helpers "$STAGE/helpers"
cp -R assets "$STAGE/assets"
cp schemas/*.xml "$STAGE/schemas/"
glib-compile-schemas --strict "$STAGE/schemas"
mkdir -p dist
OUT="$PWD/dist/$UUID.v$VERSION.shell46.zip"
# Replace the archive so removed or moved modules cannot survive a rebuild.
ARCHIVE="$STAGE/$UUID.zip"
(cd "$STAGE" && zip -qr "$ARCHIVE" .)
mv "$ARCHIVE" "$OUT"
printf 'Built %s\n' "$OUT"
