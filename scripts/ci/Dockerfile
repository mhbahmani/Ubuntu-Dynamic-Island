# Matching distro packages keep Shell, Mutter, GJS and GTK on one supported stack.
ARG BASE_IMAGE=ubuntu:24.04
FROM node:22-bookworm-slim AS node
FROM ${BASE_IMAGE}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates dbus-daemon dbus-x11 fontconfig fonts-noto-core \
    gir1.2-ecal-2.0 gir1.2-edataserver-1.2 gir1.2-secret-1 gir1.2-soup-3.0 \
    gjs gnome-backgrounds gnome-shell gnome-shell-extension-prefs \
    libgl1-mesa-dri libglib2.0-bin libglx-mesa0 make python3 \
    xauth xvfb zip unzip \
    && rm -rf /var/lib/apt/lists/*
# Install the private Calendar test's activatable services and the SVG loader
# used for symbolic icons and artwork in the minimal desktop image.
RUN apt-get update && apt-get install -y --no-install-recommends evolution-data-server librsvg2-common \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
ARG TEST_UID=1000
RUN if ! getent passwd "$TEST_UID" >/dev/null; then \
      useradd --uid "$TEST_UID" --create-home --shell /bin/sh island-ci; \
    fi
# No systemd, host display/socket mounts, privileged mode or extra capabilities.
# Docker's --user also lets local runs write artifacts under the caller's UID.
USER ${TEST_UID}
WORKDIR /tmp
ENTRYPOINT ["python3", "/source/scripts/ci/run.py"]
