# Agent folders

The window is Herdr's `main` layout with three changes. In the left sidebar, the agents
list puts your agents in folders that you make. Each folder has a name and a color.
You move an agent with a drag or a right-click, or a folder rule moves it for you.
Each pane has a header that can show a title that a tool sets on the terminal.
The working icons do not turn, so the window draws less often.

This folder has no `preview.png`. A screenshot of a real window shows private names.

## What you see

Left to right:

1. **Sidebar**, 268px wide (44px to 480px), `chrome` color. Top to bottom:
   - Brand bar, 46px: the shipped `workspace-chrome` mod. A drag on it moves the window.
   - Spaces list: the shipped `spaces` mod. It shares the free height with the agents list
     (1:1, each at least 90px).
   - **Agents list** (`agent-folders`), see below.
   - Footer, 69px: the shipped `workspace-chrome` mod with `{ "footer": true }`.
2. **Work area**:
   - Tab bar, 42px: `tabs-static`, a clone of the shipped `tabs` mod with a static working
     icon. A drag on it moves the window.
   - Body, 8px padding, 8px gap:
     - The panes of the shown tab. Each pane is a card: `background` color, 1px `border`
       line, 1px `accent` line when focused, 10px corners, 8px between cards. A single pane
       also has a card. Each card has a 30px header at the top (`pane-labels`), always shown.
     - Files and Changes panel, 368px (280px to 900px), hidden at start: the shipped
       `files` and `changes` mods in a stack.
   - Status bar, 28px: the shipped `workspace-status` mod.

The window has no system title bar. Around the cards is the `canvas` color. Terminal
padding is 14px by 12px.

**Agents list**, `chrome` background, 1px `border` line at the top, 13px text:

- Header row, 41px: "Agents" (11.5px, medium, `dim`). On the right, two 14px icon buttons:
  the sort button (`clock` icon for "by status", `layers` icon for "by space") and
  "New folder" (`folder-plus` icon).
- Groups, each with a 28px header row: a chevron (down when open, right when folded), an
  11px color chip (folders only), the group name and the number of agents.
  - "Pinned" first, if an agent is pinned.
  - Each folder, in your order. A folder always shows, also when empty. An open empty folder
    says "drag agents here".
  - "Unsorted" last, for agents in no folder. It shows only when it has agents, during a
    drag, or when no folders exist. Without folders, this group is "Agents".
- Agent rows, 30px, 8px corners: a 3px by 18px bar in the folder color, the program icon
  (16px), the space name, then "· detail" in `dim` (the tab name or the agent title),
  the machine name for a remote agent, the time since the last status change (`<1m`, `5m`,
  `2h`, `3d`) and the status mark. The focused agent has the `selected` background.
  An idle agent that is not focused has its name in `muted`.
- Sub-agent rows, 26px, under their parent: tree lines in the folder color (alpha `88`),
  a 14px icon, the name and the status mark.
- Narrow rail (sidebar below 160px): one 26px row for each agent with its number and
  status mark, a 3px left edge in the folder color, and "»" at the bottom.

Folder colors: `ansi1`, `ansi3`, `ansi2`, `ansi6`, `ansi4`, `ansi5`, `#e8743b`, `#d6409f`,
`#8b5e3c`, `#7a8794`. The theme colors follow the theme. The hex colors stay the same.

**Pane header** (`pane-labels`), 30px, `background` color, 1px `border` line at the bottom,
12px text, left to right: the program icon (14px), the agent or program name (medium, up
to 260px), the label title (up to 420px), the folder (`~` for home, `dim`), the status mark.

## How it behaves

Agent status in the agents list:

- **working**: a 12px spinner icon (`spinner.svg`), `working` color. The icon does not turn.
  A turning icon (`.spin`) draws the view again about 10 times a second. Without a GPU, each
  draw costs CPU.
- **blocked**: a 14px square with "!", `blocked` color on a `blocked` background at alpha `26`.
- **done**: a 7px dot, `done` color.
- **idle**: a 7px ring, `idle` color.
- A sub-agent with `error` shows as blocked. A sub-agent with `done` shows as idle.

Agent status in the pane header: working is the static spinner icon, blocked is a "Needs you"
pill, done is a 7px dot, idle has no mark. The tab bar also shows the static icon for a
working tab.

Agents list, mouse:

- Click an agent row: `pane.focus` on its pane.
- Click the program icon of an agent with sub-agents: fold or unfold its sub-agents. A folded
  row shows "+N".
- Click a sub-agent row: `terminal.peek` on it.
- Hover an agent row: the time changes to a pin button. Click it to pin or unpin.
- Click a group header: fold or unfold the group. The folded state of a folder stays after a
  restart. A folded group shows the mark of its most urgent agent (not idle).
- Drag an agent row to a different group: the agent goes into that folder, or to
  "Unsorted". "Pinned" does not accept a drop. The target header gets the `hover`
  background and a 1px `accent` line. The dragged row is at half opacity.
- Drag a folder header to a different folder header: the folder takes that place.
- Right-click an agent row: a menu (230px by 420px) with "Move to folder" and each folder
  (a check on the current one), "Unsorted", "Use folder rules" (only for a manual choice),
  "New folder…", "Pin to the top" or "Unpin", and "Peek".
- Right-click a folder header: a menu (230px by 360px) with "Edit folder…", the color
  swatches, "Move up", "Move down", "New folder…" and "Delete folder" (`blocked` color).
- "New folder" and "Edit folder…" open a dialog (440px by 380px): Name, Color, Rules
  (comma-separated), a help text, "Cancel" and "Save". Enter saves. Esc closes. A folder
  needs a name. "New folder…" from an agent menu also moves that agent into the new folder.
- Click the sort button: inside each folder, sort by status or keep the space order.
- On the narrow rail, click "»" to open the sidebar again.

Which folder an agent goes to:

1. A manual choice (drag or menu) is the terminal label `agentfolders.folder=<folder id>`.
   `-` keeps the agent out of all folders. The label ends with the terminal.
2. Without a label, the first folder (in folder order) with a matching rule gets the agent.
3. Else the agent is in "Unsorted".

Rules: `space:`, `cwd:`, `app:`, `title:` or `tab:` before the text, or no prefix (any
field). `*` is a wildcard. `~` is the home folder. A rule matches a part of the value, not
case-sensitive. `\` and `/` are the same. Example: `cwd:~/projects/web-*, app:claude`.

Sort by status (the default): blocked, then done, then working, then idle. A parent takes
the rank of its most urgent sub-agent. Equal ranks: the most recent status change first.
A done agent that you look at turns idle, but it keeps its place until you leave it.

The list draws again each 30 seconds to update the times.

Pane header: hover shows four buttons on the right: split right, split down, zoom (or
unzoom) and close. A click on the header focuses the pane. Any tool can set the title:
`hc label <terminal> pane.title=<title>`. `pane.title=` removes it.

## Built from

The agent list order goes to `setAgentOrder`, so the agent keys follow the list.

Layout `layouts/main-titles.json`, a clone of the shipped `main` layout (`cloned_from`
main 0.1.12). Root `row`, `canvas` background, `"titlebar": "none"`,
`"traffic_lights": [12, 16]`, `terminal_padding` `[14, 12]`, 1px `border` divider:

- `sidebar` column (px 268, min 44, max 480, `chrome`, not resizable):
  - `brand` block (px 46, `window_drag`): mod `workspace-chrome`.
  - `sidebar-lists` column: `spaces` block (weight 1, min 90) with mod `spaces`, and
    `agents` block (weight 1, min 90) with mod `agent-folders`.
  - `sidebar-footer` block (px 69): mod `workspace-chrome`, props `{ "footer": true }`.
- `work` column (not resizable):
  - `tabs` block (px 42, `window_drag`): mod `tabs-static`.
  - `work-body` row (padding 8, gap 8):
    - `main` block: `{ "tab": "active" }` with `pane`: header mod `pane-labels` (height 30,
      position top, reveal always), background `background`, border 1 `border`, focus 1
      `accent`, radius 10, gap 8, `lone: true`.
    - `panel` column (px 368, min 280, max 900, hidden): `panel-body` stack with `files`
      and `changes` blocks (mods `files` and `changes`), active `files`.
  - `status` block (px 28): mod `workspace-status`.

Mod `mods/agent-folders/` (`mod.json`: `"place": "none"`). One `View` class with three
roles, chosen by `props()`:

- no props: the list.
- `{ menu: "agent", address, folder, overlay }` or `{ menu: "folder", id, overlay }`: a popup
  menu, opened with `openOverlay({ mod: "agent-folders", kind: "popup", ... })`.
- `{ dialog: "folder", id, address, overlay }`: the folder dialog, `kind: "dialog"`.

It uses `agents`, `terminals`, `panes`, `focused`, `spaces`, `run`, `exec`, `theme`,
`shared`, `setShared`, `setAgentOrder`, `openOverlay`, `closeOverlay`, `props`, `window`,
`layout`, `home` and `notify` from `herdr`, `InputState` and `Input` from `gpui-base`, and
`localStorage`. Commands: `pane.focus`, `terminal.peek`, `terminal.pin`, `layout.resize`.
Program: `exec("hc", ["label", <address>, "agentfolders.folder=<id>"])`. State:
`shared("agentFolders")` = `{ folders: [{ id, name, color, rules, folded }], sort:
"status" | "space" }`. The time of each status change is in `localStorage` key `changed`.
Icons: `check`, `spinner`, `pin`, `pin-off`, `chevron-down`, `chevron-right`, `clock`,
`layers` and `folder-plus` from `mods/workspace-chrome/`.

Mod `mods/pane-labels/` (`mod.json`: `"place": "none"`), a pane header with
`props()` = `{ pane, terminal }`. It uses `panes`, `props`, `run`, `theme`, `home` and
`terminals` from `herdr`. Commands: `pane.focus`, `pane.split` (`right`, `down`),
`pane.zoom`, `pane.close`. Art: `close.svg`, `split-down.svg`, `split-right.svg`,
`zoom.svg` and `unzoom.svg` in its folder, and `mods/workspace-chrome/spinner.svg`.

Mod `mods/tabs-static/`, a clone of the shipped `tabs` mod (`mod.json`: `"place": "none"`,
`"cloned_from": {"name": "tabs", "version": "0.1.12"}`). Two changes: the working icon has
no `.spin(900)`, and the window button icons load from `mods/tabs-static/` (`win-min.svg`,
`win-max.svg`, `win-restore.svg`, `win-close.svg`).

All three mods show the working icon without `.spin`, to save CPU on a machine without a GPU.

## Watch out

- `agent-folders` runs the program `hc` (`hc label`). The mod makes no network calls
  itself. For an agent on another machine, `hc` writes the label on that machine.
- Both mods read icons from the shipped `workspace-chrome` mod. If that mod is not there,
  the icons do not show.
- A label write can fail (for example, the terminal is gone). Then a toast says
  "Could not label …". After a drag, the row shows the new folder from a local "pending"
  value. After a failed write, the row keeps the new folder until the mod restarts.
  A menu move has no pending value.
- A drag starts on mouse down. The mod finds the target from mouse moves over rows and
  headers. A release outside a header or row of a different group cancels the drag.
- A deleted folder can stay in a terminal label. The mod ignores an unknown folder id, so
  the agent goes to the rules or to "Unsorted".
- Rules are text with wildcards, not full regular expressions. An invalid rule matches
  nothing.
- "Pinned" and "Unsorted" fold only until the mod starts again. Folders keep their fold.
- The agents list always uses the compact blocked mark "!". The "Needs you" pill in the
  list code is not used. The pane header shows "Needs you".
- The narrow rail and the "»" button use `sidebar.width` and `sidebar.collapsed` in shared
  state, as the shipped `agents` mod does.
- The layout expects the shipped mods `workspace-chrome`, `spaces`, `pane`, `files`,
  `changes` and `workspace-status`. `tabs-static` reads `mods/pane/close.svg`.
- `tabs-static` is a clone. herdr-app updates do not change it. Fixes in the shipped `tabs`
  mod do not come to it. To get them, clone `tabs` again, remove `.spin(900)`, and change
  the `mods/tabs/` icon paths to `mods/tabs-static/`.
- The working icons do not turn. The working state shows only by the icon and its color.

## Done when

- `herdr-app check` passes for `mods/agent-folders`, `mods/pane-labels` and `mods/tabs-static`.
- `herdr-app do layout.switch '{"name":"main-titles"}'` shows the sidebar with "Agents" and
  the sort and "New folder" buttons.
- "New folder" with the name "Test" and the rule `app:pi` adds a "Test" header, and a running
  pi agent moves into it.
- A drag of an agent to "Unsorted" sets the label: `hc get <terminal> --json` shows
  `"agentfolders.folder": "-"` in `labels`.
- The agent menu "Use folder rules" removes the label, and the agent goes back to "Test".
- A right-click on "Test" opens the folder menu. A color swatch changes the chip color.
- `hc label <terminal> pane.title=Build` shows "Build" in the pane header.
  `hc label <terminal> pane.title=` removes it.
- A sidebar below 160px shows numbered rows. "»" opens the sidebar again.
