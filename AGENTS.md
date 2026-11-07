# Repository instructions

Read [AGENT.md](AGENT.md) for the full engineering and commit rules, and
[docs/HANDOFF.md](docs/HANDOFF.md) for the current implementation state.

## Installation and packaging

- Whenever adding, renaming, moving, or removing a runtime module or asset,
  update `install.sh` and `build.sh` as needed so both deliver the complete runtime.
- Root JavaScript files are runtime modules. Both scripts copy all root `.js`
  files; place development/test helpers under `scripts/` or `tests/`.
- If new runtime files live outside the existing copied directories, explicitly
  include them in both scripts. Update other copy paths used by previews/tests.
- Run `node --test tests/install.test.mjs` and verify ZIP contents after changing
  runtime file layout. A successful source preview does not verify installation.
- Keep installation per-user and preserve the previous install. Test with a
  temporary `XDG_DATA_HOME`; never replace the user's install merely to run tests.
