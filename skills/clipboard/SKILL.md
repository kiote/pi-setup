---
name: clipboard
description: Copy text to the Windows clipboard and check it. Plain text by default; HTML only when the user asks for it. Use when the user says "copy to clipboard", "copy to buffer", "put it in the clipboard", "so I can paste it in Teams / Outlook / SQL Lab", or says the clipboard is empty or has the wrong format.
---

# Clipboard

Copy from a file, never from an inline string. Check the clipboard from a new process. Do not print the copied text.

Paths: `<skill-dir>` is the folder of this SKILL.md. `<pi-setup>` is the absolute root folder of the pi-setup package (the `addendums` extension prints it in the system prompt). If no `pi-setup package root:` line exists, `<pi-setup>` is two folders above this SKILL.md.

## Rules

1. **Plain text is the default.** Do not put HTML or RTF on the clipboard unless the user asks for "HTML", "rich text", or "formatted tables".
2. **Fit the text to the target.** Markdown symbols do not render when pasted:
   - Teams, Outlook, chat: write a plain-text version. Use CAPITAL section titles, `- ` list lines, bare URLs (`name: https://...`), and no `**`, `#`, `|` tables, or `[text](url)` links. Replace tables with one line for each row.
   - SQL Lab, a terminal, a code box: copy the file as is. Remove inline `--` comments from SQL first.
   - A Markdown target (PR, wiki, GitHub comment): copy the Markdown as is.
3. **Write the text to a file first**, for example `C:/tmp/<topic>/clip.txt` (UTF-8). Keep the file. Give its path to the user as the fallback.
4. **Text for other people (Teams, Outlook, a shared doc): run `node "<pi-setup>/bin/claim-check.mjs" <file>` first.** Fix each FAIL line: add the link or path, or remove the claim. A person or a meeting needs a link to the meeting, the mail, or the thread. Keep open points in the chat, not in the file. The `publish-guard` extension runs the same check on the `-Mode set` call and asks the user before it copies text that fails.
5. **Set, then check in a separate process.** The check must run after the set process exited. A check in the same process can pass while the clipboard is empty later.
6. Report the result in one line: the format, the character count, and the file path. Do not paste the text again in chat unless the user asks.

## Commands (Git Bash)

```bash
CLIP="$(cygpath -w "<skill-dir>/clip.ps1")"
F='C:\tmp\topic\clip.txt'
powershell -NoProfile -STA -ExecutionPolicy Bypass -File "$CLIP" -Mode set -Path "$F" \
  && powershell -NoProfile -STA -ExecutionPolicy Bypass -File "$CLIP" -Mode check -Path "$F"
```

- The check prints `OK plain chars=N formats=...` (exit 0) or `FAIL <reason>` (exit 1).
- The plain check fails if the text differs from the file or if the clipboard also has HTML.

**HTML (only on request).** Write an HTML fragment (no `<html>` or `<body>`) to `C:/tmp/<topic>/clip.html`. Use inline styles on tables. Replace non-ASCII dashes and quotes with ASCII. Then add `-Html` to both commands. The script puts CF_HTML and a plain-text fallback on the clipboard.

## When the check fails

| Output | Action |
|---|---|
| `FAIL run powershell with -STA` | Add `-STA` to the command. |
| `FAIL clipboard text is empty` | Run the set and check commands one more time. If it fails again, tell the user to open the file and copy it by hand. |
| `FAIL text differs from file` | Another program changed the clipboard. Run the set and check commands one more time. |
| `FAIL clipboard has HTML ...` | You used `-Html` or another tool by mistake. Run the plain set command again. |

If the user says the paste looks wrong, ask for the target app. Then make a new version for that app (rule 2). Do not switch to HTML unless the user asks.
