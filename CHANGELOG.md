# Changelog

## [0.6.0] - Unreleased

### Added
- `session-search --output PATH`: save text or JSON reports as UTF-8 with LF newlines.
  The destination must be a new file in an existing folder. Stdout shows only its location.
- Copilot CLI session search, client labels, resume commands and `--pi-only`.
- Synthetic session-search tests and the [output spec](specs/session-search-output.md).

### Changed
- Session-search guidance uses a saved report and bounded file reads.
- The generic script rule requires repository source and installed helper copies.
  Private tools stay in private repositories. Publication approvals do not change.

## [0.5.0] - Unreleased

### Added
- `git-safe-pull.sh`: the default duplicate-copy update and an opt-in fast-forward
  update with a retained stash backup and exact-ID restore.
- `git-safe-pull-discovery.mjs`: bounded, read-only discovery of nested repositories.
  It excludes current and common Git metadata and stops before nested metadata.
- Local-only tests, the generic spec, and fresh-clone recovery instructions.
  Optional installation copies only the two runtime files, with backups first.

## [0.4.0] - 2026-11-09

### Added
- `herdr/taskbar-badge/`: source and build script for `hc-badge.exe` (Windows-only). It sets a dot on the
  herdr-app taskbar button: orange for `blocked`, green for `done`, or no dot.

### Changed
- `agent-folders` runs `hc-badge` on Windows when the badge state changes. Without `hc-badge` on PATH, it
  logs once and works as before.

## [0.3.0] - 2026-11-09

### Added
- Extension `herdr-static-working`: a static pi working indicator (one frame) in herdr-core terminals.
  It runs only when `HC_TERMINAL_ID` is set. Test: `bin/herdr-static-working-test.mjs`.
- `herdr/agent-folders/mods/tabs-static/`: a clone of the herdr-app `tabs` mod with a static working icon.

### Changed
- `agent-folders`, `pane-labels` and `tabs-static` show a static working icon (no `.spin`). This saves
  CPU on a machine without a GPU.
- `layouts/main-titles.json` uses the mod `tabs-static` (was `tabs`).

## [0.2.0] - 2026-11-05

### Added
- `herdr/agent-folders/`: herdr-app layout `main-titles` with the mods `agent-folders` (agents list in folders)
  and `pane-labels` (pane header with the `pane.title` label). Modified from herdr-app (Apache-2.0, see
  `herdr/agent-folders/NOTICE` and `herdr/agent-folders/LICENSE`). `RECIPE.md` in the herdr share format.

## [0.1.0] - 2026-11-05

### Added
- Initial release.
- Extensions: `addendums`, `ask-guard`, `hc-session-label`, `outbound-guard`, `publish-guard`,
  `read-after-write`, `subagent-root-status`, `title-last-active`.
- Skills: `clipboard`, `mission-mode`, `scratchpad`, `session-search`.
- Prompt addendums in `addendums/`: `ste100`, `coordination`, `sdd`, `agents-generic` (env `PI_SETUP_ADDENDUMS`).
- Helper scripts in `bin/` and their tests. EGM persona files in `bin/egm/` (Apache-2.0, see `bin/egm/LICENSE` and `bin/egm/NOTICE`).
