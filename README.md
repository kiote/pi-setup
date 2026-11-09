# pi-setup

A [pi](https://pi.dev) package. It contains the generic parts of a personal pi setup:
guard extensions, system prompt addendums, skills, and helper scripts.

## Install

Install from git:

```bash
pi install git:github.com/kiote/pi-setup
```

Install from a local folder:

```bash
pi install /path/to/pi-setup
```

Try the package for one run only:

```bash
pi -e git:github.com/kiote/pi-setup
pi -e /path/to/pi-setup
```

A git install puts the package in `~/.pi/agent/git/github.com/kiote/pi-setup`.

Requirements: Node.js and pi (`@earendil-works/pi-coding-agent`, peer dependency). Python 3 for `session-search`.
Bash (Git Bash on Windows) for the `.sh` scripts.

## Extensions (`extensions/`)

- `addendums.ts`: appends the selected files in `addendums/` to the system prompt. See `PI_SETUP_ADDENDUMS`.
- `ask-guard.ts`: stops a run that ends with a permission question for a low-risk step, or with an offer of a step that the agent does not recommend. Log: `~/.pi/agent/logs/ask-guard.jsonl`.
- `hc-session-label.ts`: tells herdr-app (`hc` CLI) which pi session file runs in its terminal. Runs only in a herdr-app terminal. The default `hc.exe` path is Windows-only; set `HC_EXE` on other systems.
- `herdr-static-working.ts`: shows a static pi working indicator (one frame, no animation) in a herdr-core terminal. Runs only when `HC_TERMINAL_ID` is set.
- `outbound-guard.ts`: stops agent code that can send email or post messages without a human click. With UI, it asks the user. Without UI, it blocks.
- `publish-guard.ts`: runs `bin/claim-check.mjs` on a file before a clipboard copy or a command that matches `PI_PUBLISH_GUARD_PATTERN`.
- `read-after-write.ts`: retries a `read` that fails because a parallel call still writes the file. It also changes Git Bash paths (`/tmp/...`, `/c/...`) to Windows paths (that part is for Windows). Log: `~/.pi/agent/logs/read-after-write.jsonl`.
- `subagent-root-status.ts`: keeps the root program status at "working" while background subagent runs are active (for herdr-app).
- `title-last-active.ts`: adds the time of the last agent activity to the terminal title.

## Prompt addendums (`addendums/`)

These files are not prompt templates. `extensions/addendums.ts` loads them. The manifest has `"prompts": []`, so pi loads no prompt templates from this package.

- `ste100.md`: response language rules (ASD-STE100 Simplified Technical English).
- `coordination.md`: coordination rules.
- `sdd.md`: mandatory spec-driven development.
- `agents-generic.md`: generic agent working rules (worktrees, large repos, questions, pull requests, shells, git, missions).

## Skills (`skills/`)

- `clipboard` (Windows-only): copies a file to the Windows clipboard and checks it. Files: `SKILL.md`, `clip.ps1`.
- `mission-mode`: writes and starts a [pi-mission-mode](https://github.com/kiote/pi-mission-mode) mission. Files: `SKILL.md`, `template.json` (a neutral example mission).
- `scratchpad`: a topic-based scratchpad for all sessions. Folder: `~/.pi/agent/scratchpad/` or `PI_SCRATCHPAD_DIR`.
- `session-search`: finds past pi sessions by keywords and date. Files: `SKILL.md`, `search.py` (Python 3).

## Scripts (`bin/`)

- `addendums-test.mjs`: test for `extensions/addendums.ts`.
- `ask-guard-test.mjs`: test for `extensions/ask-guard.ts`. It also runs `ask-guard-regression-test.mjs` (with `ask-guard-fixtures.json`) and `ask-guard-runtime-test.mjs` (real pi loader, fake model).
- `bgrun.sh`: starts a long run in the background and waits for it in short steps (`start`, `wait`, `status`, `stop`).
- [`claim-check.mjs`](bin/claim-check.mjs): checks text for claims that need source references before publication. Used by `publish-guard.ts`, `clipboard`, and `mission-mode`.
- `edge-reaper.ps1` (Windows-only): stops orphan headless browsers that tests left behind.
- `egm/`: review persona prompts for `goldfish-check.mjs` (third-party, see below): `comprehension.md`, `design_critic.md`, `zoom_out.md`, `source_checker.md` (local persona), `README.md`, `NOTICE`, `LICENSE`, and `resources/document_standards/` (`feature-spec-standard.md`, `heilmeier-standard.md`, `implementation-readiness-standard.md`, `re-implementation-standard.md`, `zoom-out-standard.md`).
- `git-safe-pull.sh` and `git-safe-pull-discovery.mjs`: update a Git checkout. Default mode removes only supported local copies that equal the target. `--stash-local` also saves and restores local edits. See [Git safe pull](#git-safe-pull).
- `goldfish-check.mjs`: review gate for mission `checks`. Runs one fresh-context pi with an EGM persona.
- `goldfish-multi.mjs`: runs `goldfish-check.mjs` with more than one model in parallel. Test: `goldfish-multi.test.mjs`.
- `herdr-static-working-test.mjs`: test for `extensions/herdr-static-working.ts`.
- `list-user-tasks.ps1` (Windows-only): lists scheduled tasks that are not Windows system tasks.
- `mission-herdr.sh` (Windows-only, Git Bash `cygpath`; needs herdr): starts a mission in a new herdr tab.
- `npm-shell.mjs` (Windows-only effect): preload that lets Node scripts run `npm`/`npx` without a shell.
- `pi-bench.cjs` (Windows-only, uses `cmd.exe`; needs `node-pty`): measures the interactive pi start.
- `pi-root.mjs`: finds the pi install folder (`PI_PACKAGE_ROOT`, else `<npm root -g>/@earendil-works/pi-coding-agent`).
- `pi-subagents-check.mjs`: checks that pi-subagents can start background children with the installed pi.
- `pi-wt.mjs`: starts pi in a new sibling git worktree for each new session (see below).
- `read-after-write.mjs`: logic for `extensions/read-after-write.ts`. Test: `read-after-write-test.mjs` (Windows-only).
- `wait-worktree.sh`: waits until a new git worktree is ready before the first read.

## herdr-app mods (`herdr/`)

`herdr/agent-folders/` is a layout with three mods for [herdr-app](https://herdr.dev), in the herdr share format:

- `layouts/main-titles.json`: the herdr `main` layout with the three mods below.
- `mods/agent-folders/`: the agents list in folders that you make (name, color, optional rules). Drag an agent to a folder, or right-click it. A manual choice is the terminal label `agentfolders.folder`.
- `mods/pane-labels/`: a pane header that also shows the terminal label `pane.title`. Any tool sets it with `hc label <terminal> pane.title=<title>`.
- `mods/tabs-static/`: a clone of the shipped `tabs` mod. herdr-app updates do not change it.
- `RECIPE.md`: the brief to build the layout and mods again. `NOTICE` and `LICENSE`: see below.

The working icons in the three mods are static. A turning icon draws the window again about 10 times a second, and without a GPU each draw costs CPU.

To add them:

1. Copy `herdr/agent-folders/layouts/main-titles.json` into `~/.config/herdr-app/layouts/`. Never overwrite a file. If the name is taken, rename the new file.
2. Copy the three folders in `herdr/agent-folders/mods/` into `~/.config/herdr-app/mods/`. Never overwrite a folder. If a name is taken, rename the new folder, its `mod` names in the layout, and its own paths: the `mods/pane-labels/` icon paths in `pane-labels/main.js`, the `mods/tabs-static/` icon paths in `tabs-static/main.js`, or the `MOD` constant in `agent-folders/main.js`.
3. Check each mod: `herdr-app check ~/.config/herdr-app/mods/agent-folders`, `herdr-app check ~/.config/herdr-app/mods/pane-labels` and `herdr-app check ~/.config/herdr-app/mods/tabs-static`.
4. Show the layout: `herdr-app do layout.switch '{"name":"main-titles"}'`. `ctrl-shift-l` goes back to your layout.

`agent-folders` runs a program: `hc label` (to keep the folder choice on the terminal). The mod makes no network calls itself. For an agent on another machine, `hc` writes the label on that machine. The three mods read icons from shipped mods (`workspace-chrome`, and for `tabs-static` also `pane`, `files`, and `changes`).

The folder has no `preview.png`, because a screenshot of a real window shows private names.

The mods and the layout are modified copies of herdr-app files (`agents`, `pane` and `tabs` mods, `main` layout), Apache-2.0. See `herdr/agent-folders/NOTICE` and `herdr/agent-folders/LICENSE`.

`herdr/taskbar-badge/` (Windows-only): source and build script for `hc-badge.exe`. It puts a dot on the herdr-app taskbar button: orange when an agent is blocked, green when an agent is done. `agent-folders` runs it when it is on PATH. See `herdr/taskbar-badge/README.md`.

## Configuration

| Variable | Effect |
|---|---|
| `PI_SETUP_ADDENDUMS` | Addendums to append. Unset or empty: all (`ste100,coordination,sdd,agents-generic`). `none`: no addendum. Else a comma list of names. |
| `PI_PACKAGE_ROOT` | Folder of the pi install. Set it: the scripts then do not run `npm root -g` (about 1 to 2 s on Windows at each `pi-wt.mjs` start). |
| `PI_CLI_JS` | Path of the pi `cli.js` that `pi-wt.mjs` and `goldfish-check.mjs` start. Use it to test the wrapper with a fake pi. |
| `PI_PUBLISH_GUARD_PATTERN` | Extra case-insensitive regex. A command that matches it is a publish command for `publish-guard.ts`. |
| `PI_PUBLISH_GUARD=off` | Turns off `publish-guard.ts` for one session. |
| `PI_ASK_GUARD=off` | Turns off `ask-guard.ts`. |
| `PI_OUTBOUND_GUARD=off` | Turns off `outbound-guard.ts`. |
| `PI_READ_AFTER_WRITE=off` | Turns off `read-after-write.ts`. |
| `PI_HC_SESSION_LABEL=0` | Turns off `hc-session-label.ts`. `HC_EXE` sets the `hc` path. |
| `PI_SUBAGENT_ROOT_STATUS` | `1`: run `subagent-root-status.ts` outside herdr-app. `0`: turn it off. |
| `PI_PROGRAM_STATUS=0` | Turns off `subagent-root-status.ts`. |
| `PI_TITLE_LAST_ACTIVE=0` | Turns off `title-last-active.ts`. |
| `PI_NO_WORKTREE=1` | `pi-wt.mjs` starts pi in the current folder (no new worktree). |
| `PI_WT_NO_SPARE=1` | `pi-wt.mjs` does not use or build a spare worktree. |
| `PI_WT_KEEP=1` | `pi-wt.mjs` keeps an unused worktree after pi exits. |
| `PI_WT_USER` | User name in the worktree branch `<user>/wt-<timestamp>`. Default: the OS user name. |
| `PI_NO_SUBAGENTS_CHECK=1` | `pi-wt.mjs` does not run `pi-subagents-check.mjs --if-changed`. |
| `PI_CHECK_MODEL` | Model for `pi-subagents-check.mjs --launch`. |
| `PI_SCRATCHPAD_DIR` | Folder of the `scratchpad` skill. |
| `PI_SESSIONS_DIR` | Sessions folder for `session-search`. Default: `~/.pi/agent/sessions`. |
| `BGRUN_FIRST_CHECK` | Seconds before the first status check after [`bgrun.sh start`](bin/bgrun.sh). Default: 60. |

Changes to `PI_SETUP_ADDENDUMS` or to an addendum file apply after `/reload` or a restart.

### The `<pi-setup>` placeholder

Addendums and skills write `<pi-setup>` for the absolute package root, for example `node "<pi-setup>/bin/claim-check.mjs"`.
`addendums.ts` replaces `<pi-setup>` in the addendum files and adds the line `pi-setup package root: <path>` to the system prompt.
With `PI_SETUP_ADDENDUMS=none`, this line is not added. Then replace `<pi-setup>` in skill commands with the package path yourself.

### Use `pi-wt.mjs` as a wrapper

`pi-wt.mjs` starts each new pi session in a sibling worktree `<repo>-wt-<timestamp>`. It passes other commands to pi unchanged.

PowerShell (`$PROFILE`):

```powershell
$env:PI_PACKAGE_ROOT = "$(npm root -g)/@earendil-works/pi-coding-agent"
function pi { node "$HOME/.pi/agent/git/github.com/kiote/pi-setup/bin/pi-wt.mjs" @args }
```

Bash (`~/.bashrc`):

```bash
export PI_PACKAGE_ROOT="$(npm root -g)/@earendil-works/pi-coding-agent"
alias pi='node ~/.pi/agent/git/github.com/kiote/pi-setup/bin/pi-wt.mjs'
```

For a local install, use the local package path. To turn the worktree off for one run, set `PI_NO_WORKTREE=1`.

## Git safe pull

The source is in `bin/`. The [spec](specs/git-safe-pull.md) defines the limits.
You do not need pi or a package install to use this helper.

Requirements: Bash 4 or later (Git Bash on Windows), Node.js 18 or later, Git with
`rev-parse --path-format=absolute` and `merge --no-overwrite-ignore`, and the usual
Bash tools, including GNU `timeout`, `head`, `mktemp`, `cmp` and `wc`. Keep the two runtime
files in the same folder. The helper finds the module beside the shell script.

To restore the source from a fresh public clone:

```bash
git clone https://github.com/kiote/pi-setup.git
cd pi-setup
git rev-parse HEAD                    # Record the source commit.
bash bin/git-safe-pull.sh -C /path/to/checkout --ff-only
```

Without `--stash-local`, the helper fetches, removes supported worktree-only copies
that have the same bytes as the target, and runs `git pull` with your arguments.
It keeps staged and differing content. This mode keeps the older line-based status
parser; do not rely on it for names with newlines.

To save local changes before a fast-forward update, use this exact option order:

```bash
bash bin/git-safe-pull.sh -C /path/to/checkout --stash-local --ff-only
bash bin/git-safe-pull.sh -C /path/to/checkout --stash-local --ff-only --quiet origin main
```

`-C` is optional. Give both the remote and branch, or neither to use the upstream.
Other options and refspecs are not accepted in this mode. The helper checks nested
repositories, submodules, unfinished Git operations and the fetched target before
cleanup or stash. It does not enter nested Git metadata. It also protects current
and common Git metadata if these directories are inside the checkout. Discovery stops above
10,000 directories, depth 64, or 30 seconds. A failed or incomplete scan stops the
update. Ignored files stay outside the stash and must not be overwritten.

The helper saves tracked, staged and untracked edits in a named stash. It prints
the exact stash ID and a recovery command before it updates. It then applies that
ID with `git stash apply --index`. It keeps this backup and all older stashes, even
after success. Inspect the result before you remove a backup yourself.

If the update or restore fails, inspect the output, `git status`, and the retained
stash. A restore conflict can leave conflict entries. Do not apply the stash again
until you inspect that state. Use the printed command for manual recovery; do not
use `stash pop`, `reset --hard` or `clean` as a recovery shortcut.

Run only when no other process changes the checkout. This helper is not a security
sandbox. It does not promise atomic checks against concurrent filesystem changes
or automatic recovery after termination.

### Optional copy of only the runtime files

Use an existing helper folder. First make a separate backup folder, then copy only
these two files. Run this from the fresh clone. Replace the example paths:

```bash
helper_dir=/path/to/existing/helpers
backup_dir=/path/to/new/helper-backup
test -d "$helper_dir" && mkdir "$backup_dir" || exit 1
for file in git-safe-pull.sh git-safe-pull-discovery.mjs; do
  if test -e "$helper_dir/$file"; then
    cp -p -- "$helper_dir/$file" "$backup_dir/$file" || exit 1
  fi
done
git rev-parse HEAD > "$backup_dir/source-commit.txt" || exit 1
for file in git-safe-pull.sh git-safe-pull-discovery.mjs; do
  cp -- "bin/$file" "$helper_dir/$file" || exit 1
  cmp -- "bin/$file" "$helper_dir/$file" || exit 1
done
```

Do not install the whole package or change pi settings for this helper. Do not
replace other files in the helper folder. Keep the backup until you check the new
files. Call the shell file with Bash, as in the examples above.

## Tests

Run from the package root:

```bash
node bin/ask-guard-test.mjs
node bin/read-after-write-test.mjs   # Windows-only
node bin/addendums-test.mjs
node bin/goldfish-multi.test.mjs
node bin/herdr-static-working-test.mjs
node --test bin/git-safe-pull-discovery-test.mjs
node bin/git-safe-pull-test.mjs
```

The package tests find pi through `PI_PACKAGE_ROOT` or `npm root -g`.
On Windows, if Node cannot spawn `npm` or `npx`, use the existing preload:
`node --import ./bin/npm-shell.mjs bin/ask-guard-test.mjs` (also for the other package tests).

The [integration suite](bin/git-safe-pull-test.mjs) uses only generated repositories
and local remotes. It loads runtime files from this checkout, not from an installed
copy. Set `SAFE_PULL_TEST_BASH` or `SAFE_PULL_TEST_GIT` if these tools are not on PATH.
Its fixtures and evidence use the system temporary folder. Set `SAFE_PULL_TEST_TMPDIR`
and `SAFE_PULL_TEST_EVIDENCE` to other folders outside the repository if needed.
Each integration subprocess has a 120-second limit. Failed integration runs keep
evidence and fixtures; successful runs save evidence before cleanup.

The [discovery suite](bin/git-safe-pull-discovery-test.mjs) uses the system temporary
folder and removes its fixtures after each test, including failed tests. It does not
use those environment variables. Unsupported link tests report a skip.

## Not included

- The herdr and Orca extensions (`herdr-agent-state.ts`, `orca-agent-status.ts`, `orca-prefill.ts`, `orca-titlebar-spinner.ts`). The herdr and Orca apps install them.
- Private and work-specific skills and scripts.

## Third-party

- `bin/egm/`: persona prompts from [google/elephant-goldfish-model](https://github.com/google/elephant-goldfish-model), Apache-2.0, Copyright Google LLC. See `bin/egm/LICENSE` and `bin/egm/NOTICE`. `source_checker.md` is not from EGM.
- `socratic-method` skill by Hayal Oezkan, MIT. Not copied here. Get it from [malkreide/socratic-method-skill](https://github.com/malkreide/socratic-method-skill).
- Recommended companion packages (not included):
  - [pi-mission-mode](https://github.com/kiote/pi-mission-mode): `pi install git:github.com/kiote/pi-mission-mode`. Needed by the `mission-mode` skill.
  - [pi-subagents](https://www.npmjs.com/package/pi-subagents): `pi install npm:pi-subagents`. Used by `subagent-root-status.ts` and `pi-subagents-check.mjs`.
  - [pi-mcp-adapter](https://www.npmjs.com/package/pi-mcp-adapter): `pi install npm:pi-mcp-adapter`.

## License

MIT. See `LICENSE`. Third-party files keep their own license (see above).
