#!/bin/sh
# Install Ubuntu Island from GitHub or a local checkout.
# Keep execution inside main so an incomplete piped script cannot start installing.

fail() {
    printf 'Ubuntu Island: %s\n' "$*" >&2
    exit 1
}

usage() {
    cat <<'EOF'
Usage: sh install.sh [--repo OWNER/REPO] [--dev | --ref BRANCH|TAG|COMMIT]
       sh install.sh --local CHECKOUT

Install the latest published GitHub release by default. Use --dev for master,
--ref for a specific revision, or make install to install your local checkout.
Run as your desktop user. INSTALL_DEPS=0 skips Calendar package installation.
EOF
}

progress() {
    if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != dumb ]; then
        printf '\033[1;36m%-10s\033[0m %s\n' "$1" "$2"
    else
        printf '%-10s %s\n' "$1" "$2"
    fi
}

calendar_dependencies() {
    missing=''
    for package in gir1.2-ecal-2.0 gir1.2-edataserver-1.2; do
        status=$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)
        if [ "$status" != 'install ok installed' ]; then
            missing="$missing $package"
        fi
    done
    [ -n "$missing" ] || return 0
    apt=$(command -v apt-get) || {
        printf '%s\n' 'Calendar dependencies require apt-get on Ubuntu.' >&2
        exit 1
    }
    command -v pkexec >/dev/null || {
        printf '%s\n' 'Install policykit-1 or ask an administrator to install gir1.2-ecal-2.0 and gir1.2-edataserver-1.2, then rerun make install.' >&2
        exit 1
    }
    printf 'Installing missing Calendar dependencies:%s\n' "$missing"
    printf '%s\n' 'Ubuntu may ask for administrator authentication for this package installation.'
    # Only fixed package names are split here. Never elevate the checkout script or
    # the per-user file/font installation. Refuse package removals.
    # shellcheck disable=SC2086
    pkexec "$apt" --assume-yes --no-remove install $missing
    for package in $missing; do
        [ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)" = 'install ok installed' ] || {
            printf 'Calendar dependency installation did not complete: %s\n' "$package" >&2
            exit 1
        }
    done
}

check_runtime() {
    for file in extension.js prefs.js metadata.json stylesheet.css assets/ubuntu-island.desktop; do
        [ -f "$1/$file" ] || fail "Missing $file. Nothing was installed."
    done
    for dir in ui preferences services helpers assets schemas; do
        [ -d "$1/$dir" ] || fail "Missing $dir. Nothing was installed."
    done
    grep -Eq '"uuid"[[:space:]]*:[[:space:]]*"ubuntu-island@mhbahmani.github.io"' \
        "$1/metadata.json" || fail 'Unexpected extension identity. Nothing was installed.'
}

install_local() (
    runtime=$1/extension
    check_runtime "$runtime"
    uuid=ubuntu-island@mhbahmani.github.io
    data=${XDG_DATA_HOME:-"$HOME/.local/share"}
    base="$data/gnome-shell/extensions"
    dest="$base/$uuid"
    fonts="$data/fonts/ubuntu-island-vazir-v30.1.0"
    progress 'Prepare' 'Ubuntu Island · GNOME Shell 46'
    if [ "${INSTALL_DEPS:-1}" = 1 ]; then calendar_dependencies; fi

    mkdir -p "$base"
    # Serialize upgrades, including the backup and rename, across installers.
    exec 9<"$base"
    flock -x 9
    stage=$(mktemp -d "$base/.ubuntu-island.XXXXXX")
    backup=''
    cleanup() {
        if [ -n "$backup" ] && [ -d "$backup" ] && [ ! -e "$dest" ]; then mv -T -- "$backup" "$dest"; fi
        rm -rf -- "$stage"
    }
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM

    progress 'Install' 'Extension files, settings, launcher and fonts'
    for entry in extension.js prefs.js metadata.json stylesheet.css ui preferences services helpers assets; do
        cp -R -- "$runtime/$entry" "$stage/"
    done
    mkdir "$stage/schemas"
    cp "$runtime"/schemas/*.xml "$stage/schemas/"
    glib-compile-schemas --strict "$stage/schemas"
    mkdir -p "$data/applications" "$fonts"
    cp "$stage/assets/ubuntu-island.desktop" "$data/applications/"
    cp "$stage"/assets/fonts/*.ttf "$stage/assets/fonts/OFL.txt" "$fonts/"
    fc-cache "$fonts"
    if [ -e "$dest" ] || [ -L "$dest" ]; then
        backup="$dest.backup.$(date +%Y%m%d%H%M%S).${stage##*.}"
        mv -T -- "$dest" "$backup"
        progress 'Backup' "$backup"
    fi
    mv -T -- "$stage" "$dest"
    progress 'Installed' "$dest"
    printf '\nOn Wayland, log out and back in, then run\n  gnome-extensions enable %s\n' "$uuid"
)

fetch() {
    curl --fail --silent --show-error --location \
        --proto '=https' --proto-redir '=https' --max-redirs 5 \
        --connect-timeout 15 --max-time 180 --retry 2 --retry-max-time 300 "$@"
}

download_checkout() (
    download_dir=$(mktemp -d "${TMPDIR:-/tmp}/ubuntu-island-install.XXXXXX")
    trap 'rm -rf -- "$download_dir"' EXIT
    trap 'exit 130' INT
    trap 'exit 143' HUP TERM
    api="https://api.github.com/repos/$repository"
    if [ -z "$revision" ]; then
        command -v python3 >/dev/null || fail 'Python 3 is required to read GitHub release metadata.'
        if ! status=$(fetch --write-out '%{http_code}' --max-filesize 4194304 \
            --output "$download_dir/release.json" "$api/releases/latest"); then
            if [ "$status" = 404 ]; then
                fail "No published release found for $repository. Use --dev to install master. Nothing was installed."
            fi
            fail 'Could not look up the latest GitHub release. Nothing was installed.'
        fi
        tag=$(python3 - "$download_dir/release.json" <<'PYTAG'
import json
import sys
from urllib.parse import quote

with open(sys.argv[1]) as response:
    tag = json.load(response)["tag_name"]
if not isinstance(tag, str) or not tag:
    sys.exit(1)
print(quote(tag, safe=""))
PYTAG
        ) || fail 'GitHub returned invalid release metadata. Nothing was installed.'
        revision="refs/tags/$tag"
    fi
    progress 'Download' "$repository ($revision)"
    if ! fetch --output "$download_dir/source.tar.gz" "$api/tarball/$revision"; then
        fail 'Download failed. Check the repository/ref and connection, then retry. Nothing was installed.'
    fi
    mkdir "$download_dir/source"
    if ! tar --extract --gzip --file "$download_dir/source.tar.gz" \
        --directory "$download_dir/source" --strip-components=1 \
        --no-same-owner --no-same-permissions; then
        fail 'Could not extract the download. Nothing was installed.'
    fi
    checkout="$download_dir/source"
    if [ -d "$checkout/extension" ]; then
        [ -f "$checkout/scripts/install.sh" ] || fail 'Missing installer. Nothing was installed.'
        check_runtime "$checkout/extension"
        sh "$checkout/scripts/install.sh" --local "$checkout"
    else
        # Older releases have a flat source tree and their own per-user installer.
        check_runtime "$checkout"
        for file in install.sh install-dependencies.sh; do
            [ -f "$checkout/scripts/$file" ] || fail "Missing $file. Nothing was installed."
        done
        sh "$checkout/scripts/install.sh"
    fi
)

main() {
    set -eu
    repository='mhbahmani/Ubuntu-Dynamic-Island'
    revision=''
    local_checkout=''
    remote_option=''
    dev=''
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --dev) dev=1; remote_option=1; shift ;;
            --local|--repo|--ref)
                [ "$#" -ge 2 ] && [ -n "$2" ] || fail "$1 requires a value."
                case "$1" in
                    --local) local_checkout=$2 ;;
                    --repo) repository=$2; remote_option=1 ;;
                    --ref) revision=$2; remote_option=1 ;;
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
    [ -z "$dev" ] || [ -z "$revision" ] || fail 'Choose either --dev or --ref.'
    if [ -n "$dev" ]; then revision=refs/heads/master; fi
    case "$revision" in
        *[!A-Za-z0-9_./-]*|/*|*/|*..*|-*) fail 'Invalid branch, tag or commit.' ;;
    esac
    [ "$(id -u)" -ne 0 ] || fail 'Run as your regular desktop user, not root.'
    case "${INSTALL_DEPS:-1}" in
        0|1) ;;
        *) fail 'INSTALL_DEPS must be 0 or 1.' ;;
    esac
    [ -z "$local_checkout" ] || [ -z "$remote_option" ] || fail 'Choose --local or a GitHub source.'
    for tool in mktemp glib-compile-schemas fc-cache flock; do
        command -v "$tool" >/dev/null 2>&1 || fail "Missing $tool; install it and try again."
    done

    if [ -n "$local_checkout" ]; then
        install_local "$local_checkout"
    else
        for tool in curl tar; do
            command -v "$tool" >/dev/null || fail "Missing $tool; install it and try again."
        done
        download_checkout
    fi
}

main "$@"
