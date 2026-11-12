#!/bin/sh
# System packages only. The extension itself is always installed as the user.
set -eu
missing=''
for package in gir1.2-ecal-2.0 gir1.2-edataserver-1.2; do
    status=$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)
    if [ "$status" != 'install ok installed' ]; then
        missing="$missing $package"
    fi
done
[ -n "$missing" ] || exit 0
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
