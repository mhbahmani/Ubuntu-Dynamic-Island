# Claude working guide

Read [AGENTS.md](AGENTS.md) first and follow its engineering, interaction,
verification and Git rules. It is the canonical guide; this file is the Claude
Code entry point. Use README and the handoff for orientation, then verify claims
against the working tree. Current user instructions override historical briefs.

## Start from the implementation

- Inspect `git status --short` and preserve existing edits. Check the relevant
  source and tests before treating an old plan or failure report as current work.
- [extension.js](extension.js) owns services and shared state;
  [ui/island.js](ui/island.js), [ui/card.js](ui/card.js) and
  [ui/pill.js](ui/pill.js) own the surface, tabs and notch.
  [prefs.js](prefs.js) and `preferences/` run outside GNOME Shell.
- Desktop Calendar events, Notifications and agent titles/waiting/parent links
  are implemented. Use `services/`, `helpers/calendar/`, `helpers/agents/` and
  their tests when changing them; do not restart their historical implementation
  plans. Preserve bounded I/O, visibility lifecycles and shared observers.
- Follow the schema for setting types/defaults and actual settings handlers for
  live behavior. Theme values are string IDs; edit `services/themes.js` and run
  `node scripts/theme-css.mjs` rather than editing generated CSS.

## Check and deliver

- Use [Makefile](Makefile) for actual check dependencies and
  `python3 tests/preview.py --help` for native preview modes. Run checks relevant
  to the change and report results/skips; never infer a current pass from docs.
- Preserve stable tab dimensions, fixed navigation, reachable overflow and focus.
  Verify UI changes at narrow/default widths, 100%/200% scale and enlarged text.
- Use isolated previews and temporary installation tests. `make install` can
  request administrator authentication for Calendar packages; `INSTALL_DEPS=0`
  skips that step. Do not replace the user's install merely to test a change.
- Commit only when asked, stage only task changes, and use short Conventional
  Commit messages without attribution. Never push or open a PR unless requested.
