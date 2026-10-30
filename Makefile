.DEFAULT_GOAL := help

PYTHON ?= python3
NODE ?= node
GJS ?= gjs
PREVIEW_ARGS ?=
WEATHER_PREVIEWS := preview-sun-day preview-clouds-day preview-rain-day preview-snow-day preview-night preview-clouds-night preview-rain-night preview-snow-night
UUID := ubuntu-island@mhbahmani.github.io

.PHONY: help preview preview-live preview-headless install build enable disable prefs status logs test syntax check-schema schemas check prefs-test weather-cache-test smoke verify
.PHONY: $(WEATHER_PREVIEWS)

help:
	@printf '%s\n' \
	  'Ubuntu Island development commands' \
	  '  make preview             Interactive sample Weather preview; no installation' \
	  '  make preview-live        Interactive preview with real weather requests' \
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
	  '  make prefs-test          Real GTK preferences checks (requires a display)' \
	  '  make weather-cache-test  GJS cache integration checks in a temporary folder' \
	  '  make verify              All checks above plus packaging' \
	  '' \
	  'Example: make preview PREVIEW_ARGS="--duration 15"' \
	  'After installing changed code on Wayland, log out/in before testing it.'

preview:
	$(PYTHON) tests/preview.py $(PREVIEW_ARGS)

preview-live:
	$(PYTHON) tests/preview.py --live $(PREVIEW_ARGS)

preview-headless:
	$(PYTHON) tests/preview.py --headless $(PREVIEW_ARGS)

# Scene demos bypass power saver only inside the isolated preview.
$(WEATHER_PREVIEWS): preview-%:
	$(PYTHON) tests/preview.py --scene $(patsubst %-day,%,$*) --ignore-power-saver $(PREVIEW_ARGS)

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
	@set -e; for file in *.js services/*.js scripts/*.mjs tests/*.mjs tests/fixtures/*.js tests/fixtures/*.mjs; do $(NODE) --check "$$file"; done
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

verify: check prefs-test weather-cache-test smoke build
