# Session-search output and repository-backed tooling

## Goal
Save session-search reports as UTF-8 files so agents can read bounded portions without printing raw session text through inline commands. Preserve the existing local Pi and Copilot search use cases. Keep reusable tool source in a repository and personal helper folders as installed copies.

## Scope
- `skills/session-search/search.py`
- `skills/session-search/SKILL.md`
- `bin/session-search-test.py`
- `addendums/agents-generic.md`
- README, changelog and package manifest
- This specification

Use the existing spec format. Tests use synthetic sessions only. Do not copy real prompts, session identifiers, local user paths, private guidance or internal endpoints into public source or history.

## Exclusions
No change to publication approvals, model choices, credentials, tool grants, client configuration or unrelated package resources. Do not install the whole extension package. Do not weaken existing permission checks. Do not scan real session stores during the test suite. Do not overwrite private skill notes during installation.

## Required behavior

### File output
1. Add `--output PATH` to the existing CLI. Keep text and `--json` report modes.
2. With this flag, write the complete selected report as UTF-8 with LF newlines. Preserve valid non-ASCII text. The file receives the report, not a path receipt or diagnostic.
3. File mode prints only a short location receipt on stdout. It must not also print session prompts or the report body. Errors go to stderr with a nonzero exit.
4. Without the flag, retain the existing stdout modes. Keep the existing UTF-8 console protection.
5. The destination must be a new file in an existing parent directory. Refuse an existing file, directory or symbolic link without modifying it. Do not add an overwrite flag in this change. Do not modify session input files.
6. Render the report before creating the destination. On a write error, do not report success. Record any newly created partial-file outcome clearly; do not delete or replace unrelated paths.
7. Keep the existing keyword scoring, close-word correction, date filters, limits, active-session exclusion, optional Git status and resume-command behavior. Do not expand this task into general parser redesign.

### Preserve Copilot support
The repository currently has a Pi-only script, while the local installation also searches Copilot CLI event files. Bring that generic support into the repository before installation. Keep `COPILOT_SESSIONS_DIR`, `--pi-only`, the client label, the Copilot resume command and finished/unfinished classification. Retain `PI_SESSIONS_DIR` for Pi data. Do not copy machine-specific folder-count comments or private examples.

Use synthetic input fixtures for the supported event forms. Keep the existing top-level JSON report structure; a client label is additive. A missing Copilot store must not prevent a Pi search.

### Skill instructions
Make file output the normal workflow for agent searches. Tell the agent to choose a new local temporary file outside source repositories, then read a bounded portion. Explain that text and JSON reports use UTF-8 and that existing destinations are refused. Tell the agent not to print raw session text through ad hoc `python -c` or shell loops.

Document both clients, their environment-variable roots, and `--pi-only`. Keep examples generic and link behavioral descriptions to the script. Do not claim a fixed size for every user's session store.

### Repository-first rule
Replace the existing new-script-location rule with a concise repository-first rule. Reusable tooling starts in versioned repository source. Generic tools belonging to this package use `kiote/pi-setup`. Personal helper folders, such as `~/.pi/agent/bin`, are installed copies rather than authoritative source.

Private and work-specific tooling belongs in a suitable private repository. Ask one short question if the repository is unclear. State that all existing push, PR, merge and publication approvals remain required. This rule grants no new remote-write authority.

## Distribution
Use version `0.6.0` for the additive CLI capability and preserved Copilot support. Include this spec in the package. Keep unrelated source and extension registration unchanged.

The coordinator installs the script from a checked merged commit with a byte backup. Personal skill guidance receives only the new generic output section and command option; preserve unrelated private notes. The personal agent instructions receive only the repository-first replacement at the existing script-location rule. Preserve their original line endings and rule-line count. Record source commit and hashes outside the public repository.

## Acceptance criteria
- A1: Text and JSON file modes produce valid UTF-8, preserve multilingual text and emoji, use LF endings, and emit no report body on stdout.
- A2: Existing stdout modes remain functional under a restricted console encoding. Output notes, ranking, dates, result limits, current-session exclusion and resume fields retain their intended behavior.
- A3: Existing destinations and output errors return nonzero without changing prior destination bytes or any input session. Include a filename with spaces and non-ASCII characters. Test existing links where supported; record a skip when the platform prevents link creation.
- A4: Synthetic Pi and Copilot sessions cover both clients, `--pi-only`, custom roots, missing Copilot data and finished/unfinished filtering. The installed Copilot use cases remain available.
- A5: The skill gives file-first and bounded-read instructions without private content or stale machine-specific size claims.
- A6: The repository-first rule states source ownership, installed-copy behavior and private-repository boundaries, while preserving all remote-write approvals. The generic addendum still loads correctly.
- A7: Add fail-first regressions before implementation. Python syntax checks and the new suite pass. After rebase, run the existing README package suites once on final source. Report failed and skipped checks.
- A8: Working files, Git blobs and the package archive match byte for byte. The archive includes the script, test and spec, but no real sessions, logs or credentials. Verify the archive directly rather than parsing combined npm warnings and JSON.
- A9: Fresh correctness and private-data reviewers check the final source, new history and test evidence. Every public claim has code or test support.
- A10: After the approved PR merge, a fresh checkout reproduces the new CLI behavior. The local script matches merged source, Copilot behavior remains, and unrelated personal skill notes and agent rules remain byte-identical. Verify the installed file workflow before marking the two tasks done.

## Source links
- [Search CLI](../skills/session-search/search.py)
- [Skill instructions](../skills/session-search/SKILL.md)
- [Synthetic tests](../bin/session-search-test.py)
- [Generic agent rules](../addendums/agents-generic.md)
- [Package manifest](../package.json)

## Plan
1. Scout the public and installed scripts and guidance. Confirm the smallest file-output contract and the Copilot-preservation delta.
2. One worker edits the scoped files in an isolated worktree. Add synthetic regressions, implement the changes, and use no external dependency.
3. Commit with the public identity and sign-off after a self-scan. Fetch and rebase on current origin/main before final tests. Verify exact committed bytes before tests and packing.
4. Save command results, source hashes, diffs, archive checks and cleanup evidence outside the repository. Fresh reviewers check the same spec.
5. The coordinator opens and merges the approved PR after required checks pass, verifies a fresh checkout, installs only the checked changes with backups, and checks the live task state before completion.
