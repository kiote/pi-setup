---
name: mission-mode
description: Write and start a pi-mission-mode mission (mission.json) - field format, /mission commands, .pi path rules, and Windows notes. Use when the user says "create a mission", "mission for X", "/mission start", or asks why a mission does not start.
---

# Mission mode (pi-mission-mode)

Source: https://github.com/kiote/pi-mission-mode (`README.md`, `docs/mission-format.md`, `src/state.ts`). The installed copy is in `<mission-mode-dir>` (for a git install: `~/.pi/agent/git/github.com/kiote/pi-mission-mode`). Read the source only if this file does not answer the question.

Paths: `<pi-setup>` is the absolute root folder of the pi-setup package (the `addendums` extension prints it in the system prompt). If no `pi-setup package root:` line exists, `<pi-setup>` is two folders above this SKILL.md. Mission checks do not expand `~`, so write the full path. `<tmp>` is the OS temp folder (`os.tmpdir()`).

Proven template: `template.json` in this folder. Copy it and change the values.

## mission.json fields

The parser rejects unknown fields. A `REPLACE ME` text anywhere blocks the start. The definition is frozen at start; edits to the file do not change an active mission.

| Field | Rule |
|---|---|
| `goal` | Required, nonempty string. Name the output file. |
| `acceptance` | Required, nonempty string array. Evidence uses 1-based indices. |
| `constraints` | String array. Instructions to the model only, not enforced. |
| `instructions` | String. Sources in order, checkpoint rule, fallback rules. |
| `workspace` | Optional. Must resolve to the cwd of Pi. Usually omit it. |
| `progressFile` | Optional `.md` path inside the workspace. |
| `checks` | Commands (string or `{command, timeoutSeconds, advisory?}`). With no mandatory checks, completion goes to human review. |
| `startupChecks`, `waiters`, `operations` | Optional. See `docs/mission-format.md` and `docs/operations.md`. |
| `limits` | `maxMinutes`, `maxTurns`, `maxContinuations`, `maxConsecutiveNoProgress`, `checkTimeoutSeconds`: positive integer or `null`. |
| `policies` | `noProgress`: `reassess` (default), `pause`, or `stop`. `selfReview`: `true` (default) or `false`, only in versions with PR #2 (see below). |

Proven limits: `60 / 120 / 20 / 6 / null`, `noProgress: reassess`.

### `policies.selfReview` (PR kiote/pi-mission-mode#2)

- With `true`, the first complete report starts one review cycle before the checks: the agent replaces vague claims with exact facts and deletes padding.
- Older versions reject the key (`Unknown policy: selfReview`). Before you add it, run `rg -n selfReview <mission-mode-dir>/src/state.ts`. No match: omit the key.
- Omit the key for documents and answers (the default is `true`). Set `false` only when a check fully proves the result, for example code with tests.

## Acceptance criteria for documents and answers

A gate proves structure only, not that the text is specific.

- Do not write "at least N rows" or "prefer more rows" as targets. Give a maximum length (words or rows). If you need a minimum, write that it is a floor and that weak rows must be removed.
- Ask for exact items in each criterion: "each access item names the group or scenario and the link or path to request it", not "covers access".
- Say what to write when no source has the exact fact: "unknown; ask <role>". Do not allow a general sentence instead.
- Ask for exact facts with short plain context. Do not ask for "impact" sentences without numbers.
- In a gate script, you can also fail on vague words in table cells, for example `/\b(various|several|some|relevant|appropriate|etc)\b/i`, if the deliverable must be exact.
- For each deliverable that people other than the user will read, add a check to `checks`: `{ "command": "node \"<pi-setup>/bin/claim-check.mjs\" <output file>", "timeoutSeconds": 60 }`. Exit 1 lists numbers and named meetings or people with no link, and markers such as "not checked" or "Open points". Mission checks bypass `tool_call` hooks, so this check is the only automatic claim check inside a mission. The `publish-guard` extension checks again when the agent uploads or copies the file.
- For a document or design deliverable, you can add a fresh-context review (EGM "goldfish" persona, no mission conversation) to `checks`: `{ "command": "node \"<pi-setup>/bin/goldfish-check.mjs\" <output file> --mission .pi/<slug>/mission.json", "timeoutSeconds": 900 }`. Exit 1 = a Blocker finding; exit 2 = a run error; the report goes to `<tmp>/goldfish/`. Personas (`--persona`): `design_critic` (default; facts, risks, unproved claims), `comprehension` (undefined terms, gaps for a new reader), `zoom_out` (simplicity, reuse; it searches the cwd, so run it from the repo that the document describes). Usage and options: `<pi-setup>/bin/egm/README.md`. One run usually takes 30 to 90 s, but one run took 478 s; set `timeoutSeconds` to 900. One run is one pi agent run with several model requests. Keep the default `--fail-on blocker`: the reviewer almost always reports Major items, and `major` can loop the mission. Run `design_critic` by default.
- Default for document missions: add 2 goldfish checks with different models, so that the lenses are decorrelated. The first is the entry above (default model). The second is the same entry plus `--model <provider/model> --out <tmp>/goldfish/<slug>.second.md`, with a model from a different family. Set `limits` in the mission. After the mission, record in the mission retro which lens found each real blocker, so that the value of the second lens is measured. Blocker severity is not stable between runs, so use the finding text, not only the exit code. Do not use the local `source_checker` persona as a lens. For an important document, use the parallel wrapper below instead of separate checks.
- Parallel reviews: use one advisory check: `{ "command": "node \"<pi-setup>/bin/goldfish-multi.mjs\" <output file> --mission .pi/<slug>/mission.json --timeout 600", "advisory": true, "timeoutSeconds": 900 }`. This replaces the separate review entries above. Requires pi-mission-mode PR #3 (`ec62a28`) or later; reload an idle session after the update. It runs two explicit `github-copilot/claude-opus-5.5` lenses and one `github-copilot/gpt-6.1-sol` lens concurrently. All lenses finish even if one fails. Exit 2 (run error) takes precedence over exit 1 (findings); exit 0 means all lenses passed. Each run has a unique folder under `<tmp>/goldfish/`, with `combined.md`, `summary.json`, and per-lens reports and logs. Counts can include duplicate findings. Read the combined report, including Major findings, before acceptance. The plugin returns advisory output once for correction or rebuttal, including exit 0. Exit 2 or timeout pauses the mission. Keep mandatory checks for the final result: they run after a fresh completion report. Advisory-only missions require human review. Review results persist across resume; later edits do not automatically request another review. Tests: `node --test "<pi-setup>/bin/goldfish-multi.test.mjs"`.
- After the mission, read the output yourself before you report it as done. Check 3 random claims against their sources.

## Commands (Pi must be idle)

- `/mission init [file]` - writes a placeholder file; never overwrites.
- `/mission start <file>` - the argument is the **file**, relative to the cwd. `/mission start .pi` fails with ENOENT. Example: `/mission start .pi/<slug>/mission.json`.
- `/mission start --yes <file>` - skips the approval dialog (required without a UI).
- `/mission status | check | pause | resume | stop`. Escape pauses. Resume only from the same workspace.

## .pi path rules

- Put each mission in `<worktree>/.pi/<slug>/mission.json`, with `progressFile: ".pi/<slug>/PROGRESS.md"`. The extension writes `STATE.json` next to it.
- Default progress path: `.pi/missions/<id>/PROGRESS.md`. A path outside the workspace (also through a symlink) is rejected.
- The extension also writes `.pi/mission-owner.json` (workspace lease) and `.pi/mission-operations.json` (operation ledger).
- The workspace is the cwd of Pi, which is usually a `<repo>-wt-<ts>` worktree, not `<repo>`. Start the mission in the worktree that holds the file. Output files outside the workspace (for example in `<tmp>`) are allowed; only `progressFile` and file waiters must be inside.
- `.pi/` may not be in the repo `.gitignore`. Then mission files show as untracked. Do not commit them.

## Windows notes

- Commands run in bash. Old versions used `/bin/bash`, which fails on Windows with `spawn /bin/bash ENOENT`. The fix (`PI_MISSION_BASH` or Git Bash) is merged upstream (PR #1, 5634c9c). The installed copy can be older but have the same change as a local patch. Check: `rg -n PI_MISSION_BASH <mission-mode-dir>/src/verify.ts`. No match: use `"checks": []`.
- With `"checks": []`, a complete report goes to human review. Check each acceptance item yourself before you tell the user the mission is done.

## Before you give the start command

1. Run `node -e "JSON.parse(require('fs').readFileSync('<file>'))"`.
2. Check that no `REPLACE ME` text remains and every field is in the table above.
3. For a document or an answer, check each acceptance item against "Acceptance criteria for documents and answers".
4. Give the user the exact `/mission start .pi/<slug>/mission.json` line and the worktree where Pi must run.

## Start the mission in herdr

- Start a mission in a herdr tab, not in a separate Windows Terminal window or a `*-start.ps1` script. Run `bash "<pi-setup>/bin/mission-herdr.sh" <worktree> .pi/<slug>/mission.json`. It sets `PI_NO_WORKTREE=1`, opens a tab in the herdr workspace of the repo, starts pi, and sends `/mission start --yes <file>`. Check that it prints `OK <pane>`.
- `herdr agent start ... -- <args>` fails for pi on Windows when `pi` is a PowerShell function. Send the command as a prompt instead. In Git Bash, set `MSYS_NO_PATHCONV=1` before a herdr call with `/mission ...`.
