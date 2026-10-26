#!/bin/sh
# Non-destructive per-user installation for Ubuntu Island.
set -eu
UUID='ubuntu-island@example.local'
SRC=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BASE="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
DEST="$BASE/$UUID"
mkdir -p "$BASE"
if [ -e "$DEST" ]; then
    BAK="$DEST.backup.$(date +%Y%m%d%H%M%S)"
    mv "$DEST" "$BAK"
    printf 'Previous installation backed up to: %s\n' "$BAK"
fi
mkdir "$DEST"
cp -R "$SRC/extension.js" "$SRC/island.js" "$SRC/card.js" "$SRC/charts.js" "$SRC/pill.js" "$SRC/widgets.js" \
      "$SRC/prefs.js" "$SRC/metadata.json" "$SRC/stylesheet.css" "$SRC/services" "$DEST/"
mkdir "$DEST/schemas"
cp "$SRC"/schemas/*.xml "$DEST/schemas/"
glib-compile-schemas --strict "$DEST/schemas"
printf 'Installed to: %s\n' "$DEST"
printf 'Under Wayland, log out and back in; then run:\n  gnome-extensions enable %s\n' "$UUID"
