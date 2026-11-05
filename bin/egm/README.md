# goldfish-check

A review gate for pi-mission-mode `checks`. A "goldfish" is a reviewer with no memory of the mission conversation (Elephant-Goldfish Model, EGM).

## What it does

The script starts one new pi process with `-p --no-session -ne --no-mcp -ns -np -nc --no-themes --tools read,grep,find,ls` in the current folder. These flags give the reviewer no session, extensions, MCP, skills, templates, or AGENTS.md, and only read-only tools. The reviewer receives the target file path, the mission goal and acceptance criteria, the persona prompt (`--append-system-prompt`), and the path of `egm/resources/document_standards/`. The reviewer must end with `COUNTS: blocker=<n> major=<n> nit=<n>`, and the exit code comes from these counts.

## Usage

`<pi-setup>` is the absolute root folder of the pi-setup package. Mission checks do not expand `~`, so write the full path.

Mission `checks` entry:

```json
{ "command": "node \"<pi-setup>/bin/goldfish-check.mjs\" \"<pi-setup>/bin/egm/README.md\" --mission .pi/goldfish-live/mission.json --persona comprehension", "timeoutSeconds": 600 }
```

Direct command (run it from the mission workspace, because `--mission` and code searches use the current folder):

```
node "<pi-setup>/bin/goldfish-check.mjs" "<pi-setup>/bin/egm/README.md" --mission .pi/goldfish-live/mission.json --persona comprehension --out <tmp>/goldfish/readme.comprehension.md
```

## Options

| Option | Default | Meaning |
|---|---|---|
| `--mission <file>` | none | JSON with `goal` and `acceptance` at top level or under `mission`. Without it, the reviewer judges the file against its own stated goal. |
| `--persona <name>` | `design_critic` | A file `egm/<name>.md`. `design_critic`: architecture, scalability, cost, and risks that the design does not address. `zoom_out`: simplicity, YAGNI, reuse of existing code. `comprehension`: undefined terms, acronyms, and gaps for a new reader. |
| `--fail-on blocker\|major` | `blocker` | The lowest severity that makes the check fail. |
| `--model <pattern>` | none (pi default) | Passed to pi. |
| `--out <file>` | see Exit codes | The report file. |
| `--timeout <sec>` | `600` | Stops pi after this time. |

The script finds the pi CLI in this order: env `PI_CLI_JS`; `<PI_PACKAGE_ROOT>/dist/bundle/cli.js`; `<npm root -g>/@earendil-works/pi-coding-agent/dist/bundle/cli.js`.

## Exit codes

- `0`: no finding at or above `--fail-on`.
- `1`: one or more findings at or above `--fail-on`.
- `2`: a run or parse error: bad option, missing target or persona file, a missing or bad JSON `--mission` file, no goal or acceptance in the mission file, pi exit code not 0, timeout, or no `COUNTS` line.

The script writes the report only after it reads the `COUNTS` line. The default path is `<tmp>/goldfish/<target name without extension>.<persona>.md`, where `<tmp>` is the OS temp folder (`os.tmpdir()`).

## Limits

- One check run is one pi agent run, with several model requests. Measured: 30 to 90 s.
- The reviewer is not deterministic.
- The reviewer almost always reports Major items. With `--fail-on major`, the mission can loop until `maxContinuations` or `maxMinutes` stops it.
- The persona prompts were written for design documents and proposals. On other files, some findings may not apply.
- `zoom_out` searches the current folder for code to reuse. Run it from the repo or worktree that the document describes.

## Source and license

The persona files are copied without change from https://github.com/google/elephant-goldfish-model, commit `464db031`. License: Apache-2.0, Copyright Google LLC. See `LICENSE` and `NOTICE`.
