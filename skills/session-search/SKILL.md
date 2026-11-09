---
name: session-search
description: Find past Pi and Copilot CLI sessions by keywords and date. Show prompts, finished or unfinished status, the git state of the worktree, and the resume command. Use when the user asks to find or resume a past session, or to list unfinished sessions.
---

# Session search

Use [search.py](search.py). Do not write ad hoc `grep`, `find` or `node` loops over session stores.
Folder names can start with `-`. Files can be large, and tool output can repeat words many times.

## Save the report first

1. Choose a new file in an existing local temporary folder outside source repositories.
2. Run the script with `--output PATH`. Add `--json` for a JSON report.
3. Use the file read tool to read a bounded portion, for example lines 1 to 80. Read more only if needed.

```bash
python "<skill-dir>/search.py" <keywords...> --output "<temp-dir>/new-session-report.txt" [options]
```

`<skill-dir>` is the folder of this SKILL.md. Replace `<temp-dir>` with an existing temporary folder.
Choose a new report name for each run. Both text and JSON files use UTF-8 and LF newlines.
The script refuses existing files, directories and links. It does not create parent folders.
On success, stdout shows only the report location. On failure, check stderr and the exit code.
A write or close failure can leave a new partial file. Do not use that file as a complete report.
Without `--output`, the script writes the report to stdout.

Do not print raw session text through ad hoc `python -c` commands or shell loops.
Keep reports local. Do not add them to source repositories or publication artifacts.

## Search options

Add `--output "<temp-dir>/new-session-report.txt"` to each search below.

| Need | Search arguments |
|---|---|
| A topic, [last 30 days](search.py) | `release docker` |
| A known day (local time) | `changelog --day 2026-10-15` |
| Recent sessions, newest first | `--since 2` |
| Unfinished sessions | `--since 7 --unfinished` |
| Spelling variants | `"change-?log" --regex` |
| Pi sessions only | `--pi-only` |
| JSON report | `--json` |
| Fewer results | `--limit 3` |
| No git status check | `--no-git` |

The [script](search.py) uses these roots:

| Client | Environment variable | Default |
|---|---|---|
| Pi | `PI_SESSIONS_DIR` | `~/.pi/agent/sessions` |
| Copilot CLI | `COPILOT_SESSIONS_DIR` | `~/.copilot/session-state` |

- Keywords are case-insensitive. Any keyword can match. Each hit in a user prompt adds 5 points to the score.
- If a keyword has no match, the script reports close words from the prompts and searches the closest word too.
  For example, `changelogs` can become `changelog`. Tell the user about the correction.
- The current Pi session is left out when `PI_SESSION_FILE` identifies it.
- Each result shows dates, status, prompt count, keyword hits, folder, git state, first and last prompts, and file.
- Pi results use `pi --session <id>`. A Pi session is finished when its last assistant stop reason is `stop`.
- Copilot results have a `[copilot]` label and use `copilot --resume <id>`.
  A Copilot session is finished when its last activity is a turn end or session shutdown.
  A later user message, assistant message or tool completion makes it unfinished.
- JSON results have a `tool` field for the client. A missing Copilot store does not prevent a Pi search.

## Answer

Give the best match first, with the folder, dates, first prompt, git state and resume command.
If the top results are close, show 2 or 3 and state how they differ.
If nothing matches, state which keywords and days you searched. Ask for one more detail, such as a day or repository.
