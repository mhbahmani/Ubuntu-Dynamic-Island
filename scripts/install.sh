#!/bin/sh
# Non-destructive per-user installation for Ubuntu Island.
set -eu
UUID='ubuntu-island@mhbahmani.github.io'
SRC=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BASE="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
DEST="$BASE/$UUID"
mkdir -p "$BASE"
if [ -e "$DEST" ]; then
    BAK="$DEST.backup.$(date +%Y%m%d%H%M%S)"
    mv "$DEST" "$BAK"
    printf 'Previous installation backed up to: %s\n' "$BAK"
fi
mkdir "$DEST"
# Keep the runtime layout in sync with build.sh and the isolated previews.
cp "$SRC/extension.js" "$SRC/prefs.js" "$SRC/metadata.json" "$SRC/stylesheet.css" "$DEST/"
cp -R "$SRC/ui" "$SRC/preferences" "$SRC/services" "$SRC/assets" "$SRC/helpers" "$DEST/"
mkdir "$DEST/schemas"
cp "$SRC"/schemas/*.xml "$DEST/schemas/"
glib-compile-schemas --strict "$DEST/schemas"
printf 'Installed to: %s\n' "$DEST"
printf 'Under Wayland, log out and back in; then run:\n  gnome-extensions enable %s\n' "$UUID"

mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/applications"
cp "$SRC/assets/ubuntu-island.desktop" "${XDG_DATA_HOME:-$HOME/.local/share}/applications/ubuntu-island.desktop"
