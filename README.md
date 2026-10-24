# Ubuntu Dynamic Island (GNOME Shell 46)

A macOS-style Dynamic Island for Ubuntu 24.04-class GNOME Shell **46.0**,
Wayland: media with artwork, CPU/RAM/network meters, audio output and
Bluetooth controls.

## Trees

- **`ubuntu-island/`** — the current implementation (single-surface morph,
  event-driven services, preferences, tests, packaging). See its `README.md`.
- `ubuntu-island-gnome46-prototype/` — the original Milestone A prototype
  (PanelMenu popup, polling services), kept for reference.
- `ubuntu-island-gnome46-extension/` — an intermediate copy of the prototype.
- `HARNESS_SPEC.md` — the full design, constraints, milestones, and the
  A01–A18 acceptance suite the implementation targets.

Target environment: `XDG_CURRENT_DESKTOP=ubuntu:GNOME`,
`gnome-shell --version = 46.0`, `XDG_SESSION_TYPE=wayland`.

## Quick start

```bash
cd ubuntu-island
./install.sh
# log out and back in (Wayland), then:
gnome-extensions enable ubuntu-island@example.local
```

Development checks: `node --test` and `node --check` inside `ubuntu-island/`.
