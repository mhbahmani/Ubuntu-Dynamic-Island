.DEFAULT_GOAL := help

PYTHON ?= python3
NODE ?= node
GJS ?= gjs
PREVIEW_ARGS ?=
WEATHER_PREVIEWS := preview-sun-day preview-clouds-day preview-rain-day preview-snow-day preview-night preview-clouds-night preview-rain-night preview-snow-night
UUID := ubuntu-island@mhbahmani.github.io

.PHONY: help preview preview-offline preview-offline-edge preview-commute preview-commute-map preview-live preview-headless install build enable disable prefs status logs test syntax check-schema schemas check prefs-test weather-cache-test smoke verify media-test
.PHONY: $(WEATHER_PREVIEWS)

help:
	@printf '%s\n' \
	  'Ubuntu Island development commands' \
	  '  make preview             Full sample preview; all modules and notch data enabled' \
	  '  make preview-offline     Preview the disconnected icon; host network unchanged' \
	  '  make preview-offline-edge Preview the split amber edge and unplugged symbol' \
	  '  make preview-commute-map Open the route editor immediately' \
	  '  make preview-commute     Driving routes with sample estimates; no API key' \
	  '  make preview-agents      Agent sessions and Quick Ask with safe sample data' \
	  '  make preview-calendar    Interactive Jalali, Gregorian and Hijri calendar' \
	  '  make preview-live        Live weather/routes/metrics, sample device controls' \
	  '  make preview-headless    Save a preview screenshot without a window' \
	  '  make preview-sun-day         Animated sunny weather sample' \
	  '  make preview-clouds-day      Animated cloudy weather sample' \
	  '  make preview-rain-day        Animated rainy weather sample' \
	  '  make preview-snow-day        Animated snowy weather sample' \
	  '  make preview-night       Animated clear-night weather sample' \
	  '  make preview-clouds-night / preview-rain-night / preview-snow-night' \
	  '  make install             Install per-user, backing up the previous version' \
	  '  make build               Build the versioned extension ZIP' \
	  '  make enable / disable    Enable or disable the installed extension' \
	  '  make prefs               Open installed extension preferences' \
	  '  make status / logs       Inspect the installed extension or session logs' \
	  '  make check               Node tests, syntax checks and schema validation' \
	  '  make test                Node tests only' \
	  '  make smoke               Isolated GNOME rendering and interaction checks' \
	  '  make media-test          Private D-Bus playback and track-list checks' \
	  '  make agents-test         Local broker, hooks, setup and safe launch checks' \
	  '  make prefs-test          Real GTK preferences checks (requires a display)' \
	  '  make weather-cache-test  GJS cache integration checks in a temporary folder' \
	  '  make verify              All checks above plus packaging' \
	  '' \
	  'Example: make preview PREVIEW_ARGS="--duration 15"' \
	  'Preview defaults: 1600x1000 at 200%; use PREVIEW_ARGS="--scale 1" for 100%' \
	  'Custom preview: make preview-agents PREVIEW_ARGS="--size 1920x1080 --scale 2"' \
	  'After installing changed code on Wayland, log out/in before testing it.'

preview:
	$(PYTHON) tests/preview.py $(PREVIEW_ARGS)

preview-offline:
	$(PYTHON) tests/preview.py --connection offline $(PREVIEW_ARGS)

preview-offline-edge:
	$(PYTHON) tests/preview.py --connection offline --offline-style edge $(PREVIEW_ARGS)

preview-commute:
	$(PYTHON) tests/preview.py --tab commute $(PREVIEW_ARGS)

preview-commute-map:
	$(PYTHON) tests/preview.py --tab commute --edit-route $(PREVIEW_ARGS)

preview-live:
	$(PYTHON) tests/preview.py --live $(PREVIEW_ARGS)

preview-headless:
	$(PYTHON) tests/preview.py --headless $(PREVIEW_ARGS)

# Scene demos bypass power saver only inside the isolated preview.
$(WEATHER_PREVIEWS): preview-%:
	$(PYTHON) tests/preview.py --tab weather --scene $(patsubst %-day,%,$*) --ignore-power-saver $(PREVIEW_ARGS)

install:
	./install.sh

build:
	./build.sh

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

prefs:
	gnome-extensions prefs $(UUID)

status:
	gnome-extensions info $(UUID)

logs:
	journalctl --user -b --no-pager -g 'Ubuntu Island|ubuntu-island|Island Preview|Island Smoke'

test:
	$(NODE) --test

syntax:
	@set -e; for file in *.js services/*.js helpers/agents/*.js scripts/*.mjs tests/*.mjs tests/fixtures/*.js tests/fixtures/*.mjs; do $(NODE) --check "$$file"; done
	$(PYTHON) -c "import ast, pathlib; [ast.parse(p.read_text(), filename=str(p)) for p in pathlib.Path('tests').glob('*.py')]"

check-schema:
	glib-compile-schemas --strict --dry-run schemas

schemas:
	glib-compile-schemas --strict schemas

check: test syntax check-schema

prefs-test: schemas
	GSETTINGS_BACKEND=memory GI_TYPELIB_PATH=/usr/lib/gnome-shell/girepository-1.0 LD_LIBRARY_PATH=/usr/lib/gnome-shell $(GJS) -m tests/prefs-smoke.mjs

weather-cache-test:
	XDG_CACHE_HOME=$$(mktemp -d /tmp/island-weather-cache-XXXXXX) $(GJS) -m tests/weather-native.mjs

smoke:
	$(PYTHON) tests/smoke.py

media-test:
	dbus-run-session -- $(GJS) -m tests/media-dbus.mjs

verify: check prefs-test weather-cache-test media-test smoke build

.PHONY: preview-agents agents-test
preview-agents:
	$(PYTHON) tests/preview.py --tab agents $(PREVIEW_ARGS)

.PHONY: preview-calendar
preview-calendar:
	$(PYTHON) tests/preview.py --tab calendar $(PREVIEW_ARGS)

agents-test:
	$(NODE) --test tests/agents*.test.mjs
