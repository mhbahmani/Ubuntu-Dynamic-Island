# Codex task 3: hover line, smoke failure, notch bandwidth

Run this one before tasks 1 and 2, from the repository root:

    codex exec --full-auto "$(cat docs/briefs/codex-3-fixes.md)"

Read `AGENTS.md` first and follow it: performance first, no per-frame
timers, clean up on disable, and never weaken a test to make it pass. Do not
commit. Do the three parts in order and report each one separately.

Theme CSS note: `scripts/theme-css.mjs` generates the per-theme block at the
end of `stylesheet.css`. Regenerate it with `node scripts/theme-css.mjs` after
changing the script, and never edit that block by hand.

## Part 1: remove the hover line under tabs

The user doesn't want the faint line that appears under a tab on hover. The
sliding selection marker (`.ubuntu-island-tab-slider`) is enough.

- Remove the hover marker preview: the base rule
  `.ubuntu-island-tab:hover .ubuntu-island-tab-marker` in `stylesheet.css`, and
  the per-theme rule emitted by `scripts/theme-css.mjs`
  (`${sel('.ubuntu-island-tab:hover .ubuntu-island-tab-marker')} ...`).
  Regenerate the CSS.
- Keep these unchanged: the hover text colour, the keyboard-focus marker
  (`.ubuntu-island-tab:focus .ubuntu-island-tab-marker`) and the transparent
  selected-tab marker.
- Update `tests/appearance.test.mjs`. It currently asserts the hover preview
  exists for every theme; change that to assert the generated CSS contains no
  `:hover .ubuntu-island-tab-marker` rule.
- Update the wording in `AGENTS.md` and `docs/HANDOFF.md` that mentions hover
  previews.

## Part 2: fix the `make smoke` failure

Failure seen on the user's machine:

    [Island Smoke] FAIL Agent focus failed: expanded=true grab=true focused=Ubuntu Island

This comes from the block in `tests/fixtures/smoke-extension.js` that calls
`this._openAgent({...agentSession, pids:[targetWindow.get_pid()]})` and then
expects the island collapsed, the grab released and the target window focused.

1. **Regression or pre-existing?** First find out whether this is a regression
   from the latest uncommitted work. Use `git stash`, or a worktree at `HEAD`,
   and run `make smoke` there. Restore the work afterward. The uncommitted work
   added a sliding tab marker in `ui/card.js` (`_checkTabSlider()` in the
   fixture runs earlier and toggles `disable-animations`) and theme CSS changes.
2. **Leading hypothesis** (verify it; don't assume): `extension.js`
   `_openAgent()` re-reads the session from `this._states.agents.sessions` by
   id. It then requires `this._agentWindows.resolve(current) === window`, using
   the stored session's PIDs rather than the PIDs passed in. When those differ,
   it silently does nothing, and the island stays expanded with the grab held.
   Also check `_activateAgent()`'s idle callback, and whether
   `_checkTabSlider()` leaves state behind (the page, `disable-animations`, a
   pending idle) that changes timing.
3. **Fix the root cause in product code** if real users can hit it. Otherwise
   fix the fixture, and explain why the fixture was wrong. Keep the
   assertion's intent: after opening an agent, the island collapses, releases
   its grab, and the agent window (or its transient) is focused.
4. Run `make smoke` until it passes end to end.

## Part 3: bandwidth in the collapsed notch

Today:
- `services/proc.js` `formatRate()` switches units at 1024 but always prints
  one decimal, so 1000–1023.9 KiB/s shows as "1000.3 KiB/s".
- `ui/pill.js` turns that text into "1000.3K" with a regex.
- `_fitNetwork()` reserves only the width of "500K" and grows the slot for
  longer text, so the notch width changes with traffic.

Goal: every value fits a fixed reserved width that is no wider than needed.
The notch must never change size because of a rate value.

1. Add a pure `compactRate(bytesPerSecond)` to `services/format.js`. It returns
   at most 4 visible characters: a number plus a one-letter binary unit (B, K,
   M, G).
   - Format: integers from 10 upward, one decimal below 10 for K/M/G
     (`0B`, `512B`, `9.5K`, `12K`, `999K`, `1.0M`, `9.9M`, `120M`, `1.0G`).
   - Never show 1000 or more of a unit: switch to the next unit once the
     rounded value would reach 1000, so 1000.3 KiB/s shows as `1.0M`.
   - Handle non-finite or negative input as `—`.
   Add Node tests covering these boundaries, including 999.4K/999.6K,
   1023.9K, 9.95M and 0.
2. Feed the notch numbers rather than parsing strings. Check whether the system
   snapshot from `services/system.js` already carries raw bytes per second; if
   not, add numeric `rxBps`/`txBps` fields next to the formatted strings. Then
   remove the regex in `pill.js` and use `compactRate`.
3. Fix the same boundary bug in `formatRate()` (used by the System tab): never
   display 1000 or more of a unit (1000.3 KiB/s should read "1.0 MiB/s"). Add
   tests for it.
4. In `_fitNetwork()`, reserve a constant width for each rate label: the
   widest of the format's worst-case templates (`888B`, `888K`, `8.8M`, `888M`,
   `8.8G`) measured with the label's own Pango layout (tabular figures are
   already on), plus the existing small gap. Never size from the current text.
   Recompute only when the scale or style changes; the existing `style-changed`
   handler and the scale in the cache key already cover that. The width must not
   depend on traffic.
5. Verify at 100% and 200% scale and with large text that the notch keeps one
   width while rates go from 0 to GiB/s. Add a smoke assertion that cycles
   rates through `0`, `999K`, `1.0M` and `120M` (inject them the way the fixture
   does elsewhere) and checks the pill width doesn't change.

## Checks and report

Run `node --test`, `make check` and `make smoke`. Report what caused the
smoke failure, the fix, and the measured reserved rate width at 100% and 200%.
Do not commit.
