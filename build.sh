#!/bin/sh
# Builds an installable, versioned extension zip with compiled schemas.
set -eu
cd "$(dirname -- "$0")"
UUID='ubuntu-island@mhbahmani.github.io'
VERSION=$(sed -n 's/.*"version": \([0-9]*\).*/\1/p' metadata.json)
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/schemas"
cp extension.js island.js card.js charts.js pill.js widgets.js prefs.js metadata.json stylesheet.css "$STAGE/"
cp -R services "$STAGE/services"
cp schemas/*.xml "$STAGE/schemas/"
glib-compile-schemas --strict "$STAGE/schemas"
OUT="$PWD/$UUID.v$VERSION.shell46.zip"
(cd "$STAGE" && zip -qr "$OUT" .)
printf 'Built %s\n' "$OUT"
