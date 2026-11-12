# Agent session titles, waiting states and parent relationships

Investigation: 2026-11-13. Target: Ubuntu Island on GNOME Shell 46.

## Status and scope

This is an implementation plan, not an implementation. The user asked to wait
while other agents finish their work, then hand this task to another session.
Start implementation only when the user explicitly asks to implement this plan.

Before implementing, read the current `AGENTS.md`, `README.md` and
`docs/HANDOFF.md`, inspect `git status`, and re-check the relevant code. Other
agents were editing themes, navigation, metrics and smoke fixtures during this
investigation. Preserve their changes; do not reset, stash, overwrite or commit
their work. Reconcile with their final implementation rather than restoring an
older layout or theme. Do not install into the host session or push unless asked.

Implement these three connected improvements:

1. Display Claude's actual session title and follow renames.
2. Distinguish waiting for delegated/background work from finishing a task.
3. Show that a Codex session was started by a particular Claude session.

Keep the existing correct window activation behavior: clicking that Codex row
opens the Claude Desktop window hosting the parent session.

## Findings and evidence

### The incorrect name comes from a temporary directory

The affected Claude session is named **Codex 3 fixes review**. Its local
`custom-title.json` contains that title, and its transcript also has matching
custom-title records. The same session recorded working directories in both the
repository and a temporary `scratchpad/before` directory.

`fromAgentHook()` in `services/agents-model.js` derives `label` from the basename
of `raw.cwd`. `AgentStore.apply()` overwrites the row with each new event, and
`ui/agents-view.js` displays `session.label`. Thus a directory change can rename
the row to **before** even though Claude's saved title is correct. The installed
model matched the working-tree model when checked; this was not a stale-install
explanation. Existing `docs/MODULES.md` explicitly describes project-folder
headings and no title collection; update that historical behavior as part of
the requested change.

### Stop currently means finished unconditionally

`fromAgentHook()` maps `Stop` directly to `finished` and discards background-task
metadata. The installed Island hook configuration also omits `SubagentStart`
and `SubagentStop`.

The affected session launched **Codex through a background Bash command**, not
Claude's native Agent tool. Its tool-result metadata contains background task
IDs. Supporting only native subagent hooks would therefore miss this case.

A read-only reproduction against the actual model supplied a Stop event with
`cwd: '/scratchpad/before'`, the correct title and a running background task. The
result was still `{label: 'before', state: 'finished'}`.

Claude's documented Stop input includes `background_tasks`, with task ID, type
and status. The documentation distinguishes response completion from waiting
for background work. It also documents native subagent lifecycle hooks and an
optional `session_title` on SessionStart. These are provider capabilities, not
proof that every installed version emits every field. The exact live Stop
payload was not captured during this investigation. Verify compatibility before
depending on it. Sources:

- [Stop input](https://code.claude.com/docs/en/hooks#stop-input)
- [SubagentStart](https://code.claude.com/docs/en/hooks#subagentstart)
- [SubagentStop](https://code.claude.com/docs/en/hooks#subagentstop)
- [SessionStart input](https://code.claude.com/docs/en/hooks#sessionstart-input)

### The parent relationship is directly observable

The running Codex process inherited `CLAUDE_CODE_SESSION_ID` matching the named
Claude session. Its observed ancestry was:

```text
Claude Desktop -> Claude -> shell -> Codex
```

`CLAUDE_CODE_HOST_SESSION_ID` did not match the Claude session ID in this case;
do not substitute it for `CLAUDE_CODE_SESSION_ID`. These environment details are
local observations, not a guaranteed public protocol. Validate them defensively
and retain a fallback for versions that do not supply them. Never hardcode the
observed UUIDs, PIDs, temporary paths or session title.

## Implementation plan

### 1. Keep session title separate from project and working directory

- Extend normalized metadata to distinguish a session title from its stable
  project fallback. Ordinary status updates with no title must not overwrite a
  previously resolved title with a directory basename.
- Prefer an explicit provider title. For the affected Claude version, a small
  per-session `custom-title.json` file is available beside the session transcript.
  Use bounded asynchronous metadata reads outside GNOME Shell; do not scan or
  parse conversation bodies just to discover a name.
- Resolve metadata using the session ID and correct provider configuration/profile.
  Validate paths and handle missing, malformed, replaced and inaccessible files.
  Title-file layout is version-dependent: unsupported layouts must degrade to
  the stable project name without breaking status delivery.
- Use rename events if available; otherwise use a narrowly scoped file monitor
  while a visible consumer needs titles, plus a refresh when the Agents tab opens.
  Handle atomic file replacement, coalesce events and cancel late reads. No
  periodic filesystem scans or hidden title-refresh timer.
- Use the provider's stable project-root metadata when available, or retain the
  initial reliable project name. A later `cd` into `before` must not rename it.
- Sanitize and bound displayed titles. Preserve the session reference and full-ID
  menu, so sessions with identical titles remain distinguishable.

### 2. Model waiting independently from response completion

- Normalize only necessary background-task fields: IDs, kinds and lifecycle
  status. Do not forward prompts, command bodies, transcript contents or task
  descriptions into Shell or logs.
- Track native subagent start/stop events and background shell tasks. Reconcile
  the tracked set with authoritative Stop snapshots when available. Missing
  metadata is not equivalent to a confirmed empty task list.
- Distinguish the parent agent's events from child-context events. A child's
  tool completion must not mark the parent finished or overwrite its title.
- Show **Waiting for Codex** for a confirmed Codex delegation, **Waiting for
  subagent** for native Claude subagents, and **Waiting for background task**
  when only generic background work is known. Represent multiple outstanding
  tasks accurately; completing one must not clear the others.
- A child merely existing does not mean the parent is waiting. Keep **Working**
  while the parent is doing work, and enter waiting only with lifecycle evidence.
  Preserve approval/input attention states when appropriate.
- Resume/finish transitions must follow actual events. Do not infer that the
  parent finished merely because the last child stopped. Handle failures,
  cancellations, duplicates, out-of-order events, session closure and reconnects.
- Waiting sessions must not trigger completion notifications, contribute to the
  finished count, or be removed by **Clear finished**. Update summary/notch
  behavior deliberately so waiting is not accidentally shown as idle or done.

### 3. Record a verified parent-session link

- Extend relay/model metadata with an optional parent reference, scoped by
  provider, profile and session ID. Explicit inherited session metadata is the
  preferred signal for this Claude-to-Codex case; corroborate with available
  process ancestry and reject self-links, cycles and ambiguous associations.
- Reuse the existing bounded ancestry collection at hook time. A shared terminal,
  desktop window, project name or title is insufficient evidence of parentage.
  Handle process exit and PID reuse; do not introduce a process polling loop.
- Allow the child to arrive before the parent and resolve the link later without
  duplicating rows. Keep relationships bounded by existing session limits and
  clean them up appropriately on expiry/disable.
- Preserve useful historical attribution when a parent is hidden or finishes,
  without implying that it is still active. Parent renames should update the
  relationship description. Do not alter window matching based on this label.

### 4. Add a compact visual relationship cue

- Keep the child's existing Codex icon, title, status and session reference.
- Add a subdued branch glyph and **From Claude** label alongside the existing
  status details. Avoid an extra permanent full-height row if the compact layout
  can accommodate the cue. Allow readable wrapping at enlarged text sizes.
- Hover/focus explains **Started by Codex 3 fixes review**; include the relationship
  in accessible text and session details. Use the current parent title, not a
  cached literal. The main row click still opens the verified host window.
- Keep row actors, keyboard focus and ordering stable during updates. Do not
  reparent/reorder rows whenever a relationship or status changes. This request
  does not require a collapsible session tree or additional navigation page.
- Use current theme tokens and generated-theme workflow from `AGENTS.md`.
  If a new status needs an icon, provide the matching asset or an explicit
  supported mapping; the current view constructs icons from state names.

## Likely code touchpoints

- `helpers/agents/relay.js`: collect sanitized title/parent/task metadata.
- `helpers/agents/bridge.js`: lifecycle and any persistent metadata-monitor ownership.
- `services/agents-model.js`: normalization, stable title merge, waiting state,
  parent references, counts, cleanup and out-of-order handling.
- `services/agents-setup-model.js`: register additional owned Claude hooks;
  preserve unrelated user hooks and keep upgrades/removal idempotent.
- `services/agents.js` and `extension.js`: visibility/lifecycle integration and
  notification behavior, if required by the chosen metadata-reader design.
- `ui/agents-view.js`, `ui/pill.js`, agent icons and theme source: waiting status,
  compact parent cue, accessibility and counts.
- `tests/agents.test.mjs`, native agent tests, preview fixtures and documentation.

Choose module boundaries after reading the current tree. Keep provider I/O out
of pure model code and blocking work out of Shell. No new SDK dependency is
required merely to read a small local metadata record.

## Verification and acceptance

1. A named session remains **Codex 3 fixes review** after changing its working
   directory to `scratchpad/before`. Renaming it updates the existing row and
   the child's parent description. Missing metadata keeps a useful stable fallback.
2. A Stop event with an active Codex background task shows **Waiting for Codex**,
   not **Task finished**. Test native subagents and generic shell tasks too.
3. Test multiple children, completion/failure/cancellation, resumed parent work,
   missing fields on older versions, duplicate/late events and child-context hooks.
4. The Codex row shows **From Claude** only with a verified relationship. Test
   unrelated sessions sharing a window/project, profile separation, child-first
   arrival, parent rename/removal and ambiguous metadata.
5. Waiting is reflected consistently in summaries, notch counts, notifications
   and Clear finished. Clicking the Codex child still opens Claude Desktop.
6. Verify narrow/default widths, 100%/200% scale, enlarged text, keyboard access,
   hover stability, live updates and hidden/disable cleanup in isolated native previews.
7. Run relevant model/native tests and `make check`; run the appropriate smoke
   checks against the current fixtures. Other agents are addressing earlier smoke
   failures, so reassess the current baseline rather than assuming they remain.
8. Verify there is no hidden polling, unbounded metadata read, transcript-content
   forwarding or late callback after disable. If runtime layout/assets change,
   run installer tests and verify ZIP contents as required by `AGENTS.md`.
9. Update `docs/MODULES.md` and `docs/HANDOFF.md` to describe the final behavior,
   provider-version fallbacks, hook upgrade needs and what was actually tested.
   Report any live-provider uncertainty separately from fixture-test results.

Do not modify the user's live hooks or installed extension merely to test this.
Use temporary provider configurations and private preview sessions. A live
acceptance check can be performed when the user authorizes installation/setup.
