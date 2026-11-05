---
name: scratchpad
description: Persistent topic-based scratchpad shared by all sessions for saving, recalling, and scratching (discarding) research results, ideas, and notes. Use when the user says "remember this", "save this", "save to scratchpad", "note this", "scratch X", "drop that idea", or asks "review what we have regarding X", "what did we find about X", "check scratchpad", "list scratchpad topics".
---

# Scratchpad

Folder: `~/.pi/agent/scratchpad/`, or the folder in env `PI_SCRATCHPAD_DIR` if it is set. Create the folder if it does not exist.
One file per topic: `<topic-slug>.md` (lowercase, hyphens, e.g. `build-cache-ideas.md`).

Each topic file starts with this header:
```
# <Topic title>

**Summary:** <one line: what this topic covers>
**Aliases:** <other names the user may use>

---

```
Entries follow the `---` line, newest first:
```
## YYYY-MM-DD — <short entry title>
**Context:** <question or task, cwd/project if relevant>
<findings: bullets/tables, exact commands, paths, IDs, links>
**Decision / next steps:** <if any>
```

## Find a topic
1. List topics: `rg -n -m2 "^# |^\*\*Summary" <folder> --glob "!_scratched/**"` (title and summary of each file).
2. Match the user's words to file names, titles, summaries, and aliases.
3. If no file matches, search content: `rg -l -i "<keywords>" <folder>`.
4. If more than one topic matches, or none, ask the user.

## Save
1. Find the topic. If the user names no topic, choose the best match and tell the user.
2. If no topic fits, create a new topic file with the header above.
3. Get the date with `date +%F`.
4. Re-read the file just before the edit (other sessions share it). Insert the entry directly below the header `---` with the `edit` tool. Do not overwrite the file with `write`.
5. If the topic already has an entry on the same subject, update that entry instead of adding a duplicate.
6. Save facts, not chat. Keep exact identifiers. Update **Summary**/**Aliases** if the scope changed.
7. Tell the user the topic and entry title.

## Review ("review what we have regarding X")
1. Find the topic and read the whole file.
2. Give a short summary: key findings, decisions, open next steps, and the date of the newest entry.
3. Skip scratched items (see below). Say how many scratched items exist; show them only if the user asks.
4. Say when notes are old and may be stale. Also mention related topics found by the content search.

## Scratch ("scratch X", "drop that idea", "X is wrong")
Scratching is the normal way to discard an idea. It keeps a short trace so the same dead end is not explored again.
1. Find the exact item: a whole entry, one bullet/row, or a whole topic. If unclear, show the candidates and ask.
2. Show the user what will be scratched. Then scratch it with `edit`:
   - **Entry:** change its title to `## ~~YYYY-MM-DD — <title>~~ — SCRATCHED YYYY-MM-DD: <reason>`, replace the body with one line `<what was tried / why dropped>`, and move the entry to a `## Scratched` section at the end of the file (create it if missing).
   - **Bullet or row:** wrap the text in `~~ ~~` and add ` — scratched YYYY-MM-DD: <reason>`.
   - **Topic:** move the file to `<folder>/_scratched/` and add `**Scratched:** YYYY-MM-DD — <reason>` under the title. Topic lists and searches ignore `_scratched/` unless the user asks.
3. Ask for the reason if the user gives none; "no reason" is allowed.
4. If a later entry corrects an earlier one, offer to scratch the earlier one.

## Unscratch / purge
- **Unscratch:** restore the item (remove `~~`, the SCRATCHED note, move back) when the user asks.
- **Purge:** delete scratched items or `_scratched/` files permanently only when the user says "purge" or "delete for good". Confirm the list first.

## PR index
File: `pr-index.md` in the scratchpad folder. It has one table row for each pull request: PR link or number, repo, title, branch / worktree, scratchpad topic → entry title, session id(s), state, date of the last update.
- **Look up first.** When the user gives a PR number or URL, run `rg -n "<number>" <folder>/pr-index.md` before any other search. If a row exists, read the linked topic entry, then the session (`pi --session <id>`, or `session-search` with the id). Use `session-search` with the PR number only if no row exists.
- **Add or update a row** when a session creates a PR, works on a PR (push, review replies, build fixes, rebase), discusses a PR that the user names, or saves a scratchpad entry that names a PR. Put the current session id (`PI_SESSION_FILE` contains it) first in the session cell.
- One row for each PR. Change the existing row: do not add a second row. Update the state (open, draft, merged, abandoned) and the date. Write `?` for facts that you do not know.
- Re-read `pr-index.md` just before the edit (other sessions change it). Use the `edit` tool, not `write`.
- PRs of other people that are only named for reference get a row with state `reference only`.

## Maintenance
- Rename, merge, split, or delete topics and entries only when the user asks.

## Learned from retrospectives
### PR index
- Before you edit a row in pr-index.md, run `rg -n "<number>" pr-index.md` and copy the exact row text. Use it as oldText in the edit tool. If the edit fails, re-read the file and try again.
