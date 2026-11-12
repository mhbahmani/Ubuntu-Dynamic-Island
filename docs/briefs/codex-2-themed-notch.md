# Codex task 2: themed notch

Run after tasks 3 and 1, from the repository root:

    codex exec --full-auto "$(cat docs/briefs/codex-2-themed-notch.md)"

(`--full-auto` lets Codex edit files in the repository. Drop it to approve each step.)

## Context

Ubuntu Island is a GNOME Shell 46 extension. Read `AGENTS.md` first and follow
it. Palettes live in `services/themes.js`; `scripts/theme-css.mjs` generates
the per-theme CSS block at the end of `stylesheet.css` (regenerate with
`node scripts/theme-css.mjs`, never edit that block by hand). Each theme already
has the tokens `accent`, `secondary`, `heading` and `focus`. Today the theme
class `ubuntu-island-theme-<id>` is applied only to the expanded card in
`extension.js` `_applyAppearance()`. The collapsed notch (`ui/pill.js`, root
actor style class `ubuntu-island-pill`) is not themed.

## Goal

Let the collapsed notch pick up the theme while keeping status colours that
carry meaning.

1. In `extension.js` `_applyAppearance()`, also apply the
   `ubuntu-island-theme-<id>` class to the pill's root actor (`this._pill.actor`).
   Preserve any other classes on it, the same way the card code does. Check
   `ui/pill.js` for code that rewrites the pill root's style classes, and make
   sure the theme class survives those updates (for example, re-add it in that
   path or switch to add/remove of individual classes). Live theme changes must
   update the notch immediately.
2. In `scripts/theme-css.mjs`, generate per-theme notch rules using selectors
   of the form `.ubuntu-island-pill.ubuntu-island-theme-<id> ...`. The theme
   class is on the pill itself, so use a compound selector, not a descendant
   one.
   - Music icon `.ubuntu-island-pill-music`: the accent.
   - Agents `.ubuntu-island-pill-agents` and commute `.ubuntu-island-pill-commute`
     indicators: the `heading` token.
   - Pill keyboard focus ring (`.ubuntu-island-pill:focus`, today an inset 2px
     `#ffb38a` box-shadow): the `focus` token, same width.
   - Keep these unchanged, because their colours carry meaning: download/upload
     arrows (`.ubuntu-island-pill-download`, `-upload`), weather, connection
     warning, the CPU status dot, and plain notch text.
   - St applies `:focus` on a compound class selector fine. Avoid chained
     pseudo-classes.
3. Make sure the base (unthemed) rules keep working when no theme class is
   present.

## Tests and checks

- Extend `tests/appearance.test.mjs` so the generated CSS contains, for every
  theme, the notch music accent rule and the notch focus ring with that theme's
  `focus` colour, and contains no themed rule for the download/upload/weather/
  connection/cpu-dot selectors.
- Add an assertion to `tests/fixtures/smoke-extension.js` where the theme loop
  runs (search for `ubuntu-island-theme-`): the pill actor
  (`this._pill.actor`) has the current theme class after each change.
- Run `node scripts/theme-css.mjs`, `node --test`, `make check`, and
  `make smoke` if a nested GNOME session is available.

## Report

When done, summarise the files changed and any pill code path that rewrites
classes. Do not commit.
