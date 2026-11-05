---
name: session-search
description: Find past pi sessions by keywords and date, and show their first and last prompts, finished or unfinished status, the git state of their worktree, and the command to resume them. Use when the user asks "find the session about X", "which session did Y yesterday", "list unfinished sessions", "resume the session where we ...", or gives a topic and a date of earlier agent work.
---

# Session search

Use the script. Do not write ad hoc `grep`, `find` or `node` loops over `~/.pi/agent/sessions`: the folder names
start with `-`, the files are large (about 400 MB), and tool output repeats words thousands of times.

```bash
python "<skill-dir>/search.py" <keywords...> [options]
```

`<skill-dir>` is the folder of this SKILL.md. The script reads `PI_SESSIONS_DIR` if it is set.

| Need | Command |
|---|---|
| A topic, last 30 days | `search.py release docker` |
| "Yesterday" or a known day (local time) | `search.py changelog --day 2026-10-15` |
| Recent sessions, newest first | `search.py --since 2` |
| Sessions that stopped in the middle | `search.py --since 7 --unfinished` |
| Spelling variants | `search.py "change-?log" --regex` |
| Machine-readable | add `--json` |

- Keywords are case-insensitive, and any of them counts. A keyword in the user's prompts counts 5 times more.
- A keyword without any match is reported with close words from the prompts, and the closest word is searched too
  (for example "changelogs" becomes "changelog"). Tell the user about the correction.
- The session that runs the search is left out (`PI_SESSION_FILE`).
- Each result shows: the time span, `done` or `UNFINISHED` (the last reply did not end normally), the number of
  prompts, the hits per keyword, the folder with its git state (branch, changed and untracked files, or
  `folder gone`), the first and last prompt, `pi --session <id>`, and the file.

## Answer
Give the best match first, with the folder, the dates, the first prompt, the git state and the resume command. If the
top results are close, show 2 or 3 and say how they differ. If nothing matches, say which keywords and days you
searched, and ask for one more detail (a day, a repo, a word from the first prompt).

Only pi sessions are searched. Copilot CLI sessions are in `~/.copilot/session-state` and are not covered.
