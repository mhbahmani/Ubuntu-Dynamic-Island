#!/bin/sh
# Download a public GitHub checkout, then use the regular per-user installer.
# Keep execution inside main so an incomplete piped script cannot start installing.

fail() {
    printf 'Ubuntu Island: %s\n' "$*" >&2
    exit 1
}

usage() {
    cat <<'EOF'
Usage: sh install-github.sh [--repo OWNER/REPO] [--ref BRANCH|TAG|COMMIT]

Installs from the repository's default branch unless --ref is given.
Run as your desktop user. INSTALL_DEPS=0 skips Calendar package installation.
EOF
}

main() {
    set -eu
    if [ "${1:-}" = --local ] && [ "$#" -eq 2 ]; then
        sh "$2/scripts/install.sh"
        return
    fi
    repository='mhbahmani/Ubuntu-Dynamic-Island'
    revision=''
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --repo|--ref)
                [ "$#" -ge 2 ] && [ -n "$2" ] || fail "$1 requires a value."
                case "$1" in
                    --repo) repository=$2 ;;
                    --ref) revision=$2 ;;
                esac
                shift 2 ;;
            -h|--help) usage; exit 0 ;;
            *) fail "Unknown option: $1" ;;
        esac
    done
    case "$repository" in
        ''|*[!A-Za-z0-9_./-]*|/*|*/|*/*/*|*..*) fail 'Use --repo OWNER/REPO with a public GitHub repository.' ;;
        */*) ;;
        *) fail 'Use --repo OWNER/REPO with a public GitHub repository.' ;;
    esac
    case "$revision" in
        *[!A-Za-z0-9_./-]*|/*|*/|*..*|-*) fail 'Invalid branch, tag or commit.' ;;
    esac
    [ "$(id -u)" -ne 0 ] || fail 'Run as your regular desktop user, not root.'
    case "${INSTALL_DEPS:-1}" in
        0|1) ;;
        *) fail 'INSTALL_DEPS must be 0 or 1.' ;;
    esac
    for tool in curl tar mktemp glib-compile-schemas fc-cache; do
        command -v "$tool" >/dev/null 2>&1 || fail "Missing $tool; install it and try again."
    done

    download_dir=$(mktemp -d "${TMPDIR:-/tmp}/ubuntu-island-install.XXXXXX")
    trap 'rm -rf -- "$download_dir"' EXIT
    trap 'exit 130' INT
    trap 'exit 143' HUP TERM
    archive_url="https://api.github.com/repos/$repository/tarball"
    if [ -n "$revision" ]; then archive_url="$archive_url/$revision"; fi
    printf 'Downloading Ubuntu Island from %s (%s)...\n' "$repository" "${revision:-default branch}"
    if ! curl --fail --silent --show-error --location \
        --proto '=https' --proto-redir '=https' --max-redirs 5 \
        --connect-timeout 15 --max-time 180 --retry 2 --retry-max-time 300 \
        --output "$download_dir/source.tar.gz" "$archive_url"; then
        fail 'Download failed. Check the repository/ref and connection, then retry. Nothing was installed.'
    fi
    mkdir "$download_dir/source"
    if ! tar --extract --gzip --file "$download_dir/source.tar.gz" \
        --directory "$download_dir/source" --strip-components=1 \
        --no-same-owner --no-same-permissions; then
        fail 'Could not extract the download. Nothing was installed.'
    fi
    checkout="$download_dir/source"
    runtime="$checkout/extension"
    [ -d "$runtime" ] || runtime="$checkout"
    for file in scripts/install.sh scripts/install-dependencies.sh; do
        [ -f "$checkout/$file" ] || fail "Incomplete download: missing $file. Nothing was installed."
    done
    for file in extension.js prefs.js metadata.json stylesheet.css; do
        [ -f "$runtime/$file" ] || fail "Incomplete download: missing $file. Nothing was installed."
    done
    for directory in ui preferences services helpers assets schemas; do
        [ -d "$runtime/$directory" ] || fail "Incomplete download: missing $directory. Nothing was installed."
    done
    grep -Eq '"uuid"[[:space:]]*:[[:space:]]*"ubuntu-island@mhbahmani.github.io"' \
        "$runtime/metadata.json" || fail 'The download is not Ubuntu Island. Nothing was installed.'
    sh "$download_dir/source/scripts/install.sh"
}

main "$@"
