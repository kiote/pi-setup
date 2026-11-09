# Git safe pull

## Goal
Keep the generic safe-pull source, tests and installation instructions in this repository. A fresh checkout must contain everything needed to run the helper. Local installations are copies, not the source of truth.

## Scope
- `bin/git-safe-pull.sh`: the existing-compatible mode and an explicit `--stash-local` mode.
- `bin/git-safe-pull-discovery.mjs`: a read-only Node.js directory walker for the opt-in preflight.
- `bin/git-safe-pull-test.mjs` and `bin/git-safe-pull-discovery-test.mjs`: isolated tests.
- README, changelog and package manifest: usage, restoration, test commands, package contents and a minor version increment.

## Exclusions
No application-specific ship script, private configuration, credentials, internal endpoints, session logs or machine-specific source paths belong in this change. Do not change extension registration or install unrelated extensions. No dependency package is needed; use the existing Node.js runtime and standard library.

The helper is not a security sandbox. Run it only when no other process changes the same checkout. Do not claim atomic protection against arbitrary concurrent filesystem writes. A stash restore can conflict. Retain the backup and require inspection in that case.

## Required behavior

### Existing-compatible mode
Without `--stash-local`, retain the prior helper behavior: fetch the target, remove only supported worktree-only copies with content equal to that target, and run the requested pull. Preserve differing and staged content. Keep the existing tested failure report. Do not silently enable stashing for callers of this mode.

### Opt-in update
1. Accept optional `-C <directory>`, then `--stash-local`, then `--ff-only`, optional `-q` or `--quiet`, and either no operands or one remote plus one branch. Reject other options and refspec forms before worktree mutation.
2. Check prerequisites and unfinished Git state. Fetch and resolve one target commit. Refuse a non-fast-forward target before cleanup or stash.
3. Check changed paths and local status against protected nested repositories and in-checkout current/common metadata before any cleanup or stash. Use conservative case-insensitive ancestor and descendant matching on Windows.
4. Keep supported duplicate-copy cleanup literal and byte-based. Do not remove differing content or staged changes as duplicates.
5. Save remaining tracked, staged and untracked changes in a named include-untracked stash. Record its exact object ID. Print the ID and recovery command before the update. Keep this stash and all older stashes on success and failure.
6. Advance only to the pinned fetched commit. Use fast-forward-only, no-squash, no-autostash and no-overwrite-ignore controls. Disable automatic recursive submodule updates for this command only. Verify HEAD equals the target before declaring update success.
7. Apply the exact saved stash with `--index`. Preserve staged, unstaged and untracked state when Git can apply it cleanly. Do not use stash pop, stash drop, reset --hard, clean or forced conflict resolution.
8. On a returned update failure, attempt non-destructive restoration. On restoration conflict, stop with nonzero status, preserve conflict evidence and the backup, and print recovery guidance. Do not report success after either failure. A retained stash provides manual recovery after process termination; automatic termination recovery is not promised.
9. Keep ignored files unstashed. Refuse their overwrite. Refuse remaining unstashable changes and protected-path updates. Do not change persistent Git configuration.

### Read-only discovery
- Resolve the discovery module relative to the shell script, not a particular home or checkout path. Check Node.js and the module before worktree mutation.
- Use Node.js filesystem APIs to enumerate directories. Do not execute code from the inspected repository.
- Detect a nested `.git` file or directory before opening that nested worktree's contents. Record the nested root as protected and prune it. A gitfile may point to a metadata directory with any name inside the nested worktree. Do not enter that metadata.
- Exclude the current repository's actual Git directory and common Git directory, including relocated metadata inside the checkout. Also return in-checkout metadata paths as protected roots so status or target changes cannot send them through cleanup or stash. Obtain these paths from the current Git repository, not from assumptions about directory names. Validate complete-result counts without assuming that every protected metadata path was enumerated.
- Protect a detected nested bare repository conservatively. Do not enter its object or reference storage.
- Do not follow directory symlinks or junctions. Treat a dangling `.git` marker conservatively. Preserve filenames containing spaces, brackets, colons where supported, and newlines.
- Limit directory discovery to 10,000 directories and a depth of 64. Count the root at depth zero. Stop before mutation when a limit is exceeded. Keep a bounded runtime at the caller. See the [discovery limits](../bin/git-safe-pull-discovery.mjs).
- A filesystem error, unavailable prerequisite, timeout, malformed result or incomplete result must stop the update before cleanup or stash. Produce a complete result only after discovery succeeds. Validate the result at the shell boundary. Limit retained output to 4 MiB plus one overflow byte. Reject overflow before parsing. Check both producer and consumer status; an early pipe close is not success. Keep the 30-second runtime limit and two-second kill grace. Do not rely on a platform-specific file-size ulimit. See the [shell boundary checks](../bin/git-safe-pull.sh).
- No discovery code may modify the inspected directory. A test may inject a read failure without changing system permissions.

## Distribution and installation
The shell script and discovery module must work together from an arbitrary checkout or copied folder, including a path with spaces. Tests must load the repository files by relative paths, not a pre-existing personal installation. Use generated fixtures and local remotes only.

Document recovery from a fresh clone. Also document optional installation of only the two runtime files into an existing local helper directory, with a backup of old files. Do not instruct users to overwrite unrelated files or load the whole extension package merely to use this helper.

The package includes the runtime files, tests and this spec. Use version `0.5.0` for this additive release. Keep all existing package resources and unrelated source unchanged.

## Acceptance criteria
- A1: Default-mode regression cases pass. The opt-in mode does not change default callers.
- A2: Opt-in fixture tests cover clean updates, disjoint edits, staged plus unstaged edits in the same file, untracked content, literal filenames and retained prior stashes.
- A3: Invalid arguments, unfinished Git state, fetch failure and divergence refuse without worktree/index mutation. Hostile inherited settings do not defeat fast-forward-only behavior.
- A4: Update failure, restore conflict and a zero-exit merge that does not advance HEAD return failure with retained exact-ID recovery evidence. No false success appears.
- A5: Ignored-file collisions, dirty submodules, nested repositories and Windows case variants refuse safely. Include a new target file under a case-variant ignored nested path.
- A6: Discovery tests prove that nested gitfile metadata inside its own worktree is not enumerated. Also test relocated current/common metadata, ordinary `.git` directories, bare repositories, symlinks or junctions where available, and dangling markers. Report unsupported platform tests as skipped, not passed.
- A7: Directory and depth limits, read errors, missing Node/module, timeout and malformed or incomplete helper results refuse before mutation. Keep the existing 120-second [integration-test subprocess limit](../bin/git-safe-pull-test.mjs).
- A8: Measure the new walker and the current implementation on the same generated tree. Save results outside the repository. Do not claim an unproved cause for a prior timeout or publish machine-specific benchmark claims.
- A9: New syntax checks, discovery tests and generic integration tests pass. Existing package tests listed in README pass once on the final rebased source. Save commands, exit codes, hashes and logs before review.
- A10: A fresh correctness reviewer and a fresh private-data reviewer check the final diff and test evidence. The public diff and new commit history contain no private source, logs, credentials or internal references.
- A11: A package-content check includes both runtime files and the spec. A fresh checkout after merge runs the helper without the development worktree or a personal helper source.
- A12: The local installed runtime files match the merged repository bytes. Keep installation backups and record the source commit. Do not enable an external caller until its local fixture check passes.

## Plan
1. Scout the public package layout, local candidate source and remaining metadata issue. Confirm a minimal read-only walker interface and split generic tests from private integration tests.
2. One worker edits only the scoped files in an isolated worktree. Add regressions before implementation, preserve generic behavior, and use no external dependency.
3. Rebase on current origin/main before the final test pass. Save test and package evidence outside the repository.
4. Fresh reviewers check correctness and private-data exclusions against this spec. Resolve findings before publication.
5. The coordinator creates a signed-off commit and a normal PR. After required checks and review pass, merge the PR and verify the remote commit.
6. The coordinator verifies a fresh checkout, installs only the runtime files with backups, checks the local caller in fixtures, and removes only task-created worktrees and fixtures.
