# Agent working rules

## Worktrees and pi start
- If pi starts through `<pi-setup>/bin/pi-wt.mjs`, each new session in a git repo starts in a sibling worktree `<repo>-wt-<ts>`. Set `PI_NO_WORKTREE=1` to turn this off. `PI_WT_NO_SPARE=1` turns off only the spare worktree. The real folder of the user is `<repo>`. Measure and check there.
- If background subagents fail to start, run `node "<pi-setup>/bin/pi-subagents-check.mjs" --launch`. The usual fix is `pi update npm:pi-subagents` and a restart.
- For a slow pi start, check in this sequence: how the user starts pi; the wrapper with a fake pi (`PI_CLI_JS=<fake.cjs> node "<pi-setup>/bin/pi-wt.mjs"`); pi only (`node "<pi-setup>/bin/pi-bench.cjs" <repo>`); then extensions, MCP, and the pi source. Check the CPU load first. Compare against `--no-extensions` in the same minute. `PI_TIMING=1` prints startup timings.
- After `git worktree add`, or after a mission that makes a worktree, run `bash "<pi-setup>/bin/wait-worktree.sh" <dir> [<file>] --max 60s` before the first read.

## Large repos
- Do not use `du`, `ls -R`, or `grep -r` at a repo root. Use `git ls-files | wc -l`, `git count-objects -vH`, or `rg` with paths.
- Put `timeout 60` on slow commands.
- After a test, remove its worktrees, branches, and temp files. Show `git worktree list` as proof.

## General
- For a vague question, give a short answer first (3 to 5 lines). Then offer more detail.
- Before you say that a proposal needs a correction, check the newest source file and the newest session.
- Do not fill an owner field with the user name unless the user says so. Write "not assigned".
- For a report of a recent slowdown, check file dates, package versions, and cache expiry first.
- Quote file paths in shell commands. Put `./` or `--` before a path that starts with a dash.
- In a shell loop over branch names, quote each variable, check each git exit code, and strip CR.
- In Python on Windows, call `sys.stdout.reconfigure(encoding='utf-8')`.
- If a search term has no match, try near spellings and related terms first.
- Before a long subagent run, run one cheap read-only check. Use a short time limit and a progress note. Save partial results at each checkpoint.
- After you start a background run, check the processes and the first log output before you report status. Use `bash "<pi-setup>/bin/bgrun.sh" start <dir> -- <command>` and `bgrun.sh wait <dir> --max 20m` (exit 3 = still running). Do not use long `sleep` calls.
- Before a plan depends on how a tool behaves, check the real runtime or source. Mark each unchecked item as an assumption.
- Before the first draft of a document, ask one short question about the message. Before a rewrite, list the source requirements and check the new draft against them.
- For a new tool with a UI, propose a layout in 3 to 5 lines and get approval before you build it.
- Edit JS and Python files with the edit or write tools. Do not use heredoc patch scripts. Run `node --check` after each JS edit.
- Before you report a UI feature as done, check it on live data and take a screenshot.
- Write a shareable summary short. Check each claim against its primary source and link the source. Run `node "<pi-setup>/bin/claim-check.mjs" <file>` before you publish. The `publish-guard` extension runs it on publish commands.
- If the goal is unclear, choose the most likely meaning, state it in one line, and start. Ask first only if no meaning is likely or each meaning needs a different high-risk step.
- When you search for a document, rank matches by modification date and state the match you chose.
- Before you publish, commit, or push a document for other people, fix or remove each unproved claim. Do not post on a PR without user approval.
- At the start of a long task, state the goal in one line and list the prerequisites.
- If the read tool reports an offset error, check the file with `wc -l` before you trust it.
- Keep reusable tool source in a versioned repository. Use `kiote/pi-setup` for generic tools that belong to this package. Personal helper folders, such as `~/.pi/agent/bin`, hold installed copies, not source. Keep private and work-specific tools in a suitable private repository. If the repository is unclear, ask one short question. All existing push, PR, merge and publication approvals remain required; this rule grants no remote-write authority.
- If a request does not state a default, infer it from the repo layout and state it.
- Test a claim that a tool does not work on Windows before you report it as a blocker.
- If a task has no done-when proof, state the proof you will check, and check it.
- When you give options, give your recommended default with each choice.

## Questions and approvals
The `extensions/ask-guard.ts` hook checks the end of each run. It corrects low-risk permission questions, repeated requests for approved actions, unwanted offers, and meaning questions with a named default. It rechecks the answer, with at most two continuations per user prompt. It logs questions that it keeps and warns if the correction budget runs out. `without plan approval` is not a request for plan approval. Test: `node "<pi-setup>/bin/ask-guard-test.mjs"` (includes synthetic transcripts and real Pi loop tests with fake model output). Log: `~/.pi/agent/logs/ask-guard.jsonl`.
- Low-risk steps: do them without a question, check them, and report them in one line. Low risk means reads, checks, tests, temp files, a local commit, a local update with a backup, and personal files (skills, scratchpad, notes, todos, links, clipboard).
- High-risk steps: a push, a PR, or a merge in a shared repo; a delete of user data or tasks; a sent mail, message, or post; a reviewer or invite; a shared file; an admin consent. Ask about them one time, in the plan. State the end state, for example "PR only" or "PR, merge after the checks pass, and cleanup".
- An approval covers the selected plan or option up to its stated end state, for the same repo and PR. A push or PR approval covers merge and cleanup only if no narrower limit applies. Preserve "no merge", "PR only", "local only", "PR and stop", separate approval requests, and later refusals. "yes", "do it", "A", "2", and "lgtm" approve the referenced option, not unrelated actions. "so what now" means continue an already-approved plan; it does not grant new high-risk authority. A request to diagnose or fix failed checks does not by itself approve the first push.
- Do not offer a step that you recommend against. Give its command in one line instead.
- If the step is low value, drop the offer. Do not end with "Do you want me to …?".
- If the user asks to see a plan first, ask for the plan approval. That question is correct.

## Pull requests
- When the user asks about the state of a PR, list all unresolved threads, the build status, and the policies. Then fix the clear items without a new request.
- Before each push, rebase on the default branch. Build and run the changed test projects locally. Fix any break before you push. If CI tests fail, compare them with the latest run on the default branch. Report if the default branch is broken.
- In each plan for a PR, state the target repo, the account, and the reason for the repo.
- Rebase on the default branch before the first full test run. Run `git fetch origin` and check recent PRs on the target files before work and before each push. Never push before the rebase is finished. Run the full test suite one time only.
- Create a normal PR unless the user asks for a draft. Do not ask if the PR must be a draft. For the merge question, see "Questions and approvals".
- After you open a PR or push to it, check the comments and the CI status with a bounded poll. Report each review item and fix the clear ones. For each failed check, give the cause and say if main or a flaky test causes it.
- Before you give next steps from a past session, check the live PR state and the newer sessions or scratchpad entry dates first.
- Before you draft a question to a person, search the code and the configs for the answer. Ask the person only if the search gives no answer.
- On a failing CI check, compare the failing tests with the latest run on the default branch and with the changed files of the PR before any fix or rebase.
- Before you report the state of a GitHub PR, run `gh pr view --json isDraft,reviewDecision,comments`. Do not report a state from memory.
- At the start of a session on a PR, read the scratchpad entry of the PR first. After each push, update that entry.
- If a task changes a repo document and the prompt does not state the PR convention (version bump, commit count, squash), read the repo README for it or ask one short question before you open the PR. Skip this for small tasks.
- After a PR passes its checks, merge it if the user approved the push, the PR, or the merge (see "Questions and approvals"). If there was no approval, ask one time. Then finish the merge and the cleanup.

## Shells and Windows
- Put complex PowerShell in a script file. In Git Bash, set `MSYS_NO_PATHCONV=1` for args that start with `/`.
- Do not send `read` in the same tool batch as the call that creates the file (see `read-after-write`).
- A Node script that runs `npm`/`npx` without a shell fails on Windows with ENOENT. Run it with `node --import "file:///<pi-setup>/bin/npm-shell.mjs" <script>`.
- Stop a process by port with `netstat` + `taskkill`. List user scheduled tasks with `powershell -NoProfile -File "<pi-setup>/bin/list-user-tasks.ps1"`.
- A headless browser for a test uses a profile folder in `%TEMP%` with the prefix `pi-edge-<task>-`. Give its script a `--stop` option. `<pi-setup>/bin/edge-reaper.ps1` stops such browsers after 8 h.
- For `rg` with `\n`, add `-U`. Run `git ls-files --eol` before a scripted splice.

## Git
- Limit `git add --renormalize` to named paths. Do not use `.`. Run `git ls-files --eol` first.
- Run worktree removal from the main repo folder, not from the worktree that the session uses. Git cannot delete the folder of a worktree in use. Tell the user to delete the empty folder later.

## Missions
- Read the `mission-mode` skill (`<pi-setup>/skills/mission-mode/SKILL.md`) for the field format, the `/mission start <file>` command, and the `.pi` path rules. Copy its `template.json`. Do not search the repo or the docs for the term "mission".
- If you use herdr, start each mission in a herdr tab with `bash "<pi-setup>/bin/mission-herdr.sh" <worktree> .pi/<slug>/mission.json`. Do not use a Windows Terminal window or a start script.
- Do not close a mission as completed until a host-side gate has passed. Read acceptance.status first. Do not trust the worker's own report.
- To start a mission or a subagent workflow, write the workflow script to a file first, for example `C:/tmp/<topic>/mission.js`. Run `node --check` on it. Then call `subagent` with `workflow: "<path>"`. Do not use `workflow: true` with an inline ```js block, because the call fails when the message has no visible text.
- If a task needs an email or message draft or other output, and the prompt does not give the full recipient list and a done-when check, ask one short question first. Skip this for small or clear tasks.
- When you edit a file with the edit tool, use a unique multi-line anchor as oldText. If the edit fails, re-read the file and try again.
- "Mission": a `pi-mission-mode` `mission.json` file. See "Missions". Do not search the repo for the term.
