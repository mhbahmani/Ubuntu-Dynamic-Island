# Claude working guide

Read [AGENT.md](AGENT.md) first: it is the canonical engineering and contribution
guide for this repository. Then read [docs/HANDOFF.md](docs/HANDOFF.md) for current
state and [README.md](README.md) for commands. Follow current user instructions
when they supersede older notes.

## Tab layout

- Design common tab layouts to fit without scrolling where possible. Prefer
  better grouping, compact spacing and progressive disclosure over taller tabs.
- Keep text readable and controls usable. Retain scrolling for long lists,
  enlarged text and small displays; never hide or clip overflow. Keep navigation
  and primary actions outside scrolling content.
- Verify native layouts at narrow/default widths, 100%/200% scale and enlarged
  text, including access to overflowing content.

## Working rules

- Performance is the priority: keep GNOME Shell responsive, reuse service caches
  and timers, stop hidden work, bound asynchronous I/O, and clean up on disable.
- Discover APIs through https://github.com/public-apis/public-apis, then verify
  provider documentation, Iran coverage, free-tier limits, and fallback behavior.
- Keep each logical change in its own commit with a short imperative Conventional
  Commit subject. No co-author or assistant attribution. Do not push unless asked.
- Preserve user edits and reference images. Exclude generated ZIPs, compiled
  schemas, and caches. Validate changes with the relevant Makefile targets.
- Do not weaken privacy or sandboxing, expose credentials, or claim untested live
  routing accuracy or hardware behavior. See AGENT.md for the complete rules.
