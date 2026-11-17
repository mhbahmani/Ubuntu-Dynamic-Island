#!/bin/sh
# Dependency setup and backed-up per-user installation for Ubuntu Island.
set -eu
UUID='ubuntu-island@mhbahmani.github.io'
SRC=$(CDPATH= cd -- "$(dirname -- "$0")/../extension" && pwd)
if [ "$(id -u)" -eq 0 ]; then
    printf '%s\n' 'Run make install as your regular desktop user; only package installation requests administrator authentication.' >&2
    exit 1
fi
case "${INSTALL_DEPS:-1}" in
    1) sh "$(dirname -- "$0")/install-dependencies.sh" ;;
    0) printf '%s\n' 'Skipping system dependency installation (INSTALL_DEPS=0).' ;;
    *) printf '%s\n' 'INSTALL_DEPS must be 0 or 1.' >&2; exit 2 ;;
esac
BASE="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
DEST="$BASE/$UUID"
mkdir -p "$BASE"
if [ -e "$DEST" ]; then
    BAK="$DEST.backup.$(date +%Y%m%d%H%M%S)"
    mv "$DEST" "$BAK"
    printf 'Previous installation backed up to: %s\n' "$BAK"
fi
mkdir "$DEST"
# helpers/agents includes the visibility-scoped title metadata reader.
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

# Own our font files: another extension may remove its fonts on disable.
FONT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/fonts/ubuntu-island-vazir-v30.1.0"
mkdir -p "$FONT_DIR"
cp "$SRC"/assets/fonts/*.ttf "$SRC/assets/fonts/OFL.txt" "$FONT_DIR/"
fc-cache "$FONT_DIR"
