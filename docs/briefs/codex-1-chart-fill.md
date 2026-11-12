# Codex task 1: themed chart fill

Run after task 3 (`codex-3-fixes.md`), from the repository root:

    codex exec --full-auto "$(cat docs/briefs/codex-1-chart-fill.md)"

(`--full-auto` lets Codex edit files in the repository. Drop it to approve each step.)

## Context

Ubuntu Island is a GNOME Shell 46 extension. Read `AGENTS.md` first and follow
it (performance first, no per-frame timers, keep commits out of this task).
Palettes live in `services/themes.js` (seeds plus derived tokens).
`scripts/theme-css.mjs` generates the per-theme block at the end of
`stylesheet.css` between the BEGIN and END markers; regenerate it with
`node scripts/theme-css.mjs`, never edit that block by hand. The theme class
`ubuntu-island-theme-<id>` sits on the expanded card, so the System tab charts
are inside it. St CSS has no CSS variables or pseudo-elements, but it does
support custom properties read from JS, for example
`node.lookup_color('-ubuntu-island-chart-up', false)` returning `[found, color]`.

## Goal

Make the System tab charts carry the theme instead of a flat 16% fill.

1. In `ui/charts.js` `_paint()`, replace the flat area fill with a vertical
   Cairo linear gradient: the series colour at about 0.32 alpha along the line's
   peak side, fading to 0 at the baseline. Use `import Cairo from 'cairo';`
   (GJS ESM) and `new Cairo.LinearGradient(x0, y0, x1, y1)` with
   `addColorStopRGBA`. Keep the existing line stroke (0.95 alpha, 1.5 × scale
   width), the one-point dot case, the baseline, and the gap handling (`flush`).
   For the network chart (two series mirrored around the middle), each series
   fades toward the centre baseline on its own side.
2. The network chart currently hardcodes download and upload colours
   (`[0.42, 0.8, 0.92]` and `[0.85, 0.66, 0.98]`), and the rate labels use fixed
   CSS colours (`.ubuntu-island-network-down` `#6bcced`,
   `.ubuntu-island-network-up` `#d9a8fa`). Add two derived tokens to each theme
   in `services/themes.js`: `chartDown` (a light tint of the accent) and
   `chartUp` (the accent's hue rotated about 150°, same lightness range, so the
   two stay distinguishable). Both need contrast of at least 4.5:1 against the
   tint top, bottom and midpoint, because they also colour the rate text. Emit
   them per theme from `scripts/theme-css.mjs`: rate label colours, plus custom
   properties `-ubuntu-island-chart-down` and `-ubuntu-island-chart-up` on
   `.ubuntu-island-history-network`. In `charts.js`, read them with
   `get_theme_node().lookup_color(...)`, falling back to today's colours when
   they're not found. Do not touch `themeSwatchCss` in `themes.js`.
3. No extra repaints: colours are read inside `_paint()` from the theme node,
   which already repaints on style changes. Do not add timers or signal
   handlers.

## Tests and checks

- Extend `tests/appearance.test.mjs`: the new tokens are valid hex, meet the
  contrast rule for every theme, differ from each other, and the generated CSS
  contains both custom properties for every theme.
- Run `node scripts/theme-css.mjs`, `node --test`, and `make check`. If a
  nested GNOME session is available, run `make smoke` and look at the System
  tab captures (`theme-*`, `frosted-*`).

## Report

When done, summarise the files changed and the derived colours for graphite,
ocean and berry. Do not commit.
