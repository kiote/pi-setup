// Agent folders: the agents list in your own colored folders.
// Modified from the `agents` mod of herdr-app (Apache-2.0); see NOTICE in
// https://github.com/kiote/pi-setup/tree/main/herdr/agent-folders
//
// - Folders (name, color, rules, folded) live in shared("agentFolders"), which Herdr saves.
// - A manual choice is a terminal label `agentfolders.folder=<id>` ("-" = keep it out of
//   every folder). It ends with the terminal. Without a label, the first folder whose
//   rule matches takes the agent.
// - Drag an agent onto a folder, or right-click it. Drag a folder header to reorder.
//
// The same mod draws its own popups: props { menu: "agent" | "folder", ... } and
// props { dialog: "folder", id }.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, exec, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, home, notify } from "herdr";

const MOD = "agent-folders";
const LABEL = "agentfolders.folder";
const KEY = "agentFolders";
// Theme colors follow the theme; the hex ones are fixed, so every swatch differs.
const COLORS = ["ansi1", "ansi3", "ansi2", "ansi6", "ansi4", "ansi5", "#e8743b", "#d6409f", "#8b5e3c", "#7a8794"];
const paint = (t, c) => (c ? t[c] ?? (/^#[0-9a-f]{6}$/i.test(c) ? c : null) : null);

// ---- state ---------------------------------------------------------------

function load() {
  const s = shared(KEY);
  const v = s ? JSON.parse(JSON.stringify(s)) : {};
  return { folders: Array.isArray(v.folders) ? v.folders : [], sort: v.sort === "space" ? "space" : "status" };
}
const save = (s) => setShared(KEY, s);
const newId = () => "f" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);

function updateFolder(id, fn) {
  const s = load();
  const f = s.folders.find((x) => x.id === id);
  if (!f) return;
  fn(f, s);
  save(s);
}

function moveFolder(id, toIndex) {
  const s = load();
  const from = s.folders.findIndex((x) => x.id === id);
  if (from < 0) return;
  const [f] = s.folders.splice(from, 1);
  s.folders.splice(Math.max(0, Math.min(toIndex, s.folders.length)), 0, f);
  save(s);
}

// Writes the label on the terminal (also on another machine: `vps/t7`).
async function assign(address, folderId) {
  const r = await exec("hc", ["label", address, `${LABEL}=${folderId ?? "-"}`]);
  if (r.code !== 0) notify({ title: "Agent folders", body: `Could not label ${address}: ${(r.stderr || r.stdout).trim()}`, level: "error" });
}

// ---- rules ---------------------------------------------------------------

const norm = (s) => String(s ?? "").replace(/\\/g, "/").toLowerCase();

function ruleRegex(text) {
  let p = norm(text.trim());
  if (p.startsWith("~")) p = norm(home()) + p.slice(1);
  const body = p.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(body);
}

// "space:foo", "cwd:~/repo/*", "app:pi", "title:...", "tab:..." or plain text (any field).
function ruleMatches(rule, fields) {
  const m = /^(space|cwd|app|title|tab):(.*)$/i.exec(rule.trim());
  const field = m ? m[1].toLowerCase() : null;
  const text = m ? m[2] : rule;
  if (!text.trim()) return false;
  let re;
  try { re = ruleRegex(text); } catch { return false; }
  const values = field ? [fields[field]] : Object.values(fields);
  return values.some((v) => v && re.test(norm(v)));
}

// ---- shared helpers from the shipped agents mod ------------------------------

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

const chip = (t, color, size = 12) => div().size(size).flex_none().rounded(3).bg(paint(t, color) ?? t.dim);

// ---- popups and dialog -------------------------------------------------------

function menuItem(t, id, label, action, opts = {}) {
  return h_flex()
    .id(id)
    .h(29)
    .px(8)
    .gap(9)
    .rounded(7)
    .items_center()
    .text_color(opts.danger ? t.blocked : t.foreground)
    .cursor_pointer()
    .hover((el) => el.bg(t.hover))
    .on_click(action)
    .child(opts.color ? chip(t, opts.color, 11) : div().w(11).flex_none())
    .child(div().flex_1().truncate().child(label))
    .when(Boolean(opts.checked), (el) => el.child(svg("mods/workspace-chrome/check.svg").size(13).flex_none().text_color(t.foreground)));
}

const sep = (t) => div().h(1).my(4).mx(6).bg(t.border);
const caption = (t, text) => div().px(8).pt(4).pb(5).text_size(11).text_color(t.dim).child(text);

function agentMenu(t, p) {
  const s = load();
  const close = () => closeOverlay(p.overlay);
  const term = terminals().find((x) => x.address === p.address);
  const a = agents().find((x) => x.address === p.address);
  const current = p.folder ?? null;
  return v_flex().w_full().p(5).bg(t.popover).text_size(12.8)
    .child(caption(t, "Move to folder"))
    .children(s.folders.map((f) => menuItem(t, `mv-${f.id}`, f.name, () => { assign(p.address, f.id); close(); }, { color: f.color, checked: f.id === current })))
    .child(menuItem(t, "mv-none", "Unsorted", () => { assign(p.address, null); close(); }, { checked: current === null }))
    .when(Boolean(term?.labels?.[LABEL]), (el) => el.child(menuItem(t, "mv-auto", "Use folder rules", () => { exec("hc", ["label", p.address, `${LABEL}=`]); close(); })))
    .child(menuItem(t, "mv-new", "New folder…", () => { close(); openDialog(null, p.address); }))
    .child(sep(t))
    .when(Boolean(a), (el) => el.child(menuItem(t, "pin", a.pinned ? "Unpin" : "Pin to the top", () => { run("terminal.pin", { terminal: p.address, pinned: !a.pinned }); close(); })))
    .child(menuItem(t, "peek", "Peek", () => { run("terminal.peek", { terminal: p.address }); close(); }));
}

function folderMenu(t, p) {
  const s = load();
  const close = () => closeOverlay(p.overlay);
  const i = s.folders.findIndex((f) => f.id === p.id);
  const f = s.folders[i];
  if (!f) return div();
  return v_flex().w_full().p(5).bg(t.popover).text_size(12.8)
    .child(caption(t, f.name))
    .child(menuItem(t, "edit", "Edit folder…", () => { close(); openDialog(f.id); }))
    .child(h_flex().px(8).py(6).gap(5).flex_wrap()
      .children(COLORS.map((c) => div().id(`c-${c.replace("#", "")}`).size(18).rounded(4).bg(paint(t, c)).cursor_pointer()
        .when(c === f.color, (el) => el.border(2).border_color(t.foreground))
        .hover((el) => el.opacity(0.8))
        .on_click(() => { updateFolder(f.id, (x) => { x.color = c; }); close(); }))))
    .child(sep(t))
    .when(i > 0, (el) => el.child(menuItem(t, "up", "Move up", () => { moveFolder(f.id, i - 1); close(); })))
    .when(i < s.folders.length - 1, (el) => el.child(menuItem(t, "down", "Move down", () => { moveFolder(f.id, i + 1); close(); })))
    .child(menuItem(t, "new", "New folder…", () => { close(); openDialog(null); }))
    .child(sep(t))
    .child(menuItem(t, "del", "Delete folder", () => {
      const s2 = load();
      s2.folders = s2.folders.filter((x) => x.id !== f.id);
      save(s2);
      close();
    }, { danger: true }));
}

function openDialog(id, address) {
  openOverlay({ mod: MOD, kind: "dialog", width: 440, height: 380, props: { dialog: "folder", id, address } });
}

// ---- the view ---------------------------------------------------------------

export default class AgentFolders extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.menu) return;
    if (p.dialog) return this.initDialog(p, cx);
    this.folded = new Set();
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pending = new Map();
    this.drag = null;
    this.over = null;
    cx.timer.every(30000, (cx) => cx.notify());
  }

  // ---- dialog ----

  initDialog(p, cx) {
    const f = load().folders.find((x) => x.id === p.id);
    this.color = f?.color ?? COLORS[load().folders.length % COLORS.length];
    this.name = InputState.new({ value: f?.name ?? "" });
    this.rules = InputState.new({ value: (f?.rules ?? []).join(", ") });
    this.focus = "name";
    this.name.on("submit", () => this.submit());
    this.rules.on("submit", () => this.submit());
    this.name.on("focus", (_e, cx) => { this.focus = "name"; cx.notify(); });
    this.rules.on("focus", (_e, cx) => { this.focus = "rules"; cx.notify(); });
    this.name.focus();
    cx.timer.after(600, () => this.name.focus());
    this.handle = cx.focus_handle();
  }

  submit() {
    const p = props();
    const name = this.name.value().trim();
    if (!name) return;
    const rules = this.rules.value().split(",").map((r) => r.trim()).filter(Boolean);
    const s = load();
    let f = s.folders.find((x) => x.id === p.id);
    if (!f) {
      f = { id: newId(), name, color: this.color, rules, folded: false };
      s.folders.push(f);
    } else Object.assign(f, { name, color: this.color, rules });
    save(s);
    if (p.address) assign(p.address, f.id);
    closeOverlay(p.overlay);
  }

  dialog(t, p) {
    const editing = Boolean(load().folders.find((x) => x.id === p.id));
    const label = (text) => div().pt(14).pb(6).text_size(11.5).text_color(t.dim).child(text);
    const field = (state, which) => Input.new(state).h(34).px(10).rounded(8).border_1()
      .border_color(this.focus === which ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground);
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("af-dialog").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(editing ? "Edit folder" : "New folder"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(label("Name"))
      .child(field(this.name, "name"))
      .child(label("Color"))
      .child(h_flex().gap(6).flex_wrap().children(COLORS.map((c) => div().id(`dc-${c.replace("#", "")}`).size(20).rounded(5).bg(paint(t, c)).cursor_pointer()
        .when(c === this.color, (el) => el.border(2).border_color(t.foreground))
        .on_click((_e, cx) => { this.color = c; cx.notify(); }))))
      .child(label("Rules (optional, comma-separated)"))
      .child(field(this.rules, "rules"))
      .child(div().pt(6).text_size(11).text_color(t.dim).child("An agent without a manual folder goes to the first folder with a matching rule. Plain text matches the space, folder, app or title. Use * as a wildcard, ~ for home, or a prefix: space:, cwd:, app:, title:, tab:. Example: cwd:~/projects/web-*, app:claude"))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button("af-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("af-save", "Save", true, () => this.submit())));
  }

  // ---- list ----

  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    // Static on purpose: `.spin` redraws the view ~10 times a second, costly without a GPU.
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  subRow(t, s, shown, color) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("terminal.peek", { terminal: k.address }))
      .children(s.lines.map((l) => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), (el) => el.border_l(1.5).border_color(paint(t, color) ? paint(t, color) + "88" : t.input))
        .when(l === "└" || l === "├", (el) => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), (el) => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, true));
  }

  // The folder id an agent is in: its label (or a choice still on its way), else rules.
  folderOf(a, labels, fields, folders) {
    const ids = new Set(folders.map((f) => f.id));
    const pend = this.pending.get(a.address);
    const label = labels?.[LABEL];
    if (pend !== undefined && pend !== label) return pend === "-" ? null : ids.has(pend) ? pend : null;
    if (pend !== undefined) this.pending.delete(a.address);
    if (label === "-") return null;
    if (label && ids.has(label)) return label;
    for (const f of folders) if ((f.rules ?? []).some((r) => ruleMatches(r, fields))) return f.id;
    return null;
  }

  drop(address, folderId) {
    this.pending.set(address, folderId ?? "-");
    assign(address, folderId);
  }

  endDrag(cx) {
    this.drag = null;
    this.over = null;
    cx.notify();
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    if (p.menu === "agent") return agentMenu(t, p);
    if (p.menu === "folder") return folderMenu(t, p);
    if (p.dialog) return this.dialog(t, p);

    const state = load();
    const folders = state.folders;
    const byStatus = state.sort === "status";
    const collapsed = narrow();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    const termOf = new Map(all.map((x) => [x.address, x]));
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byStatus) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);

    // Names: "space · detail", as the shipped list does.
    const leads = leadPanes(panes());
    const tabLabels = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, title(tab, leads.get(tab.id))]));
    const label = (a) => tabLabels.get(a.tab) ?? (a.title || a.program?.name || "");

    // Where each agent goes.
    const folderOfAgent = new Map();
    for (const a of list) {
      const term = termOf.get(a.address);
      const fields = { space: a.space_name, cwd: term?.cwd, app: [a.app, a.program?.key, a.program?.name].filter(Boolean).join(" "), title: a.title, tab: a.tab_name };
      folderOfAgent.set(a.address, this.folderOf(a, term?.labels, fields, folders));
    }
    const colorOf = (a) => folders.find((f) => f.id === folderOfAgent.get(a.address))?.color ?? null;

    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    const groups = [];
    if (pinned.length) groups.push({ id: "pinned", label: "Pinned", members: pinned });
    for (const f of folders) groups.push({ id: f.id, label: f.name, color: f.color, folder: f, members: rest.filter((a) => folderOfAgent.get(a.address) === f.id) });
    const unsorted = rest.filter((a) => folderOfAgent.get(a.address) == null);
    const draggingAgent = this.drag?.kind === "agent";
    if (unsorted.length || draggingAgent || !folders.length) groups.push({ id: "unsorted", label: folders.length ? "Unsorted" : "Agents", members: unsorted });

    const order = groups.flatMap((g) => g.members);
    setAgentOrder(order.map((a) => a.address));

    const isFolded = (g) => (g.folder ? Boolean(g.folder.folded) : this.folded.has(g.id));
    const toggleFold = (g, cx) => {
      if (g.folder) updateFolder(g.id, (f) => { f.folded = !f.folded; });
      else { this.folded.has(g.id) ? this.folded.delete(g.id) : this.folded.add(g.id); cx.notify(); }
    };
    const dropTarget = (g) => g.id !== "pinned";

    // While a drag is on, rows and headers report which group is under the pointer.
    const hoverGroup = (g) => (_e, cx) => {
      if (!this.drag) return;
      const over = this.drag.kind === "agent" ? (dropTarget(g) ? g.id : null) : g.folder ? g.id : null;
      if (this.over !== over) { this.over = over; cx.notify(); }
    };
    const dropOn = (g) => (_e, cx) => {
      const d = this.drag;
      if (!d) return;
      if (d.kind === "agent" && this.over === g.id && d.from !== g.id && dropTarget(g)) {
        this.drop(d.id, g.folder ? g.id : null);
      } else if (d.kind === "folder" && g.folder && d.id !== g.id) {
        moveFolder(d.id, folders.findIndex((f) => f.id === g.id));
      }
      this.endDrag(cx);
    };
    const highlighted = (g) => this.drag && this.over === g.id && (this.drag.kind === "folder" ? this.drag.id !== g.id : this.drag.from !== g.id);

    const row = (a, i, g, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const color = colorOf(a);
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .when(Boolean(color), (el) => el.border_l(3).border_color(paint(t, color)))
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(a.pinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !a.pinned });
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${a.pinned ? "pin-off" : "pin"}.svg`).size(13));
      const more = label(a);
      const showMore = Boolean(more) && !/^\d+$/.test(more) && more !== a.space_name;
      const dragged = this.drag?.kind === "agent" && this.drag.id === a.address && this.over !== g.id;
      return h_flex()
        .id(`ag-${a.address}`)
        .pl(color ? 6 : 8)
        .pr(8)
        .h(30)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(a.focused, (el) => el.bg(t.selected))
        .when(dragged, (el) => el.opacity(0.5))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_mouse_down("left", () => { this.drag = { kind: "agent", id: a.address, from: g.id }; this.over = g.id; })
        .on_mouse_move(hoverGroup(g))
        .on_mouse_up("left", dropOn(g))
        .on_mouse_down("right", () => openOverlay({ mod: MOD, kind: "popup", width: 230, height: 420, props: { menu: "agent", address: a.address, folder: folderOfAgent.get(a.address) } }))
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .child(div().w(3).h(18).flex_none().rounded(2).bg(paint(t, color) ?? t.dim + "00"))
        .when(Boolean(pic), (el) => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, (el) => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center()
          .child(div().min_w(0).max_w(showMore ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(a.space_name || more))
          .when(showMore, (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`))))
        .when(Boolean(machine), (el) => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(subs.length > 0 && this.folded.has(a.address), (el) => el.child(div().text_size(11).text_color(t.dim).child(`+${subs.length}`)))
        .when(this.hovered === a.address && !this.drag, (el) => el.child(pin))
        .when((this.hovered !== a.address || this.drag) && Boolean(when), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, true));
    };

    const withKids = (g) => (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, g, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, colorOf(a)))];
    };

    const header = (g) => {
      const open = !isFolded(g);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      const hot = highlighted(g);
      return h_flex()
        .id(`hd-${g.id}`)
        .px(8)
        .mt(6)
        .h(28)
        .flex_none()
        .gap(7)
        .items_center()
        .rounded(7)
        .text_size(11.5)
        .font_medium()
        .cursor_pointer()
        .when(hot, (el) => el.bg(t.hover).border(1).border_color(t.accent))
        .when(this.drag?.kind === "folder" && this.drag.id === g.id && this.over !== g.id, (el) => el.opacity(0.5))
        .hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", () => {
          if (g.folder) { this.drag = { kind: "folder", id: g.id }; this.over = g.id; }
        })
        .on_mouse_move(hoverGroup(g))
        .on_mouse_up("left", dropOn(g))
        .when(Boolean(g.folder), (el) => el.on_mouse_down("right", () => openOverlay({ mod: MOD, kind: "popup", width: 230, height: 360, props: { menu: "folder", id: g.id } })))
        .on_click((_e, cx) => toggleFold(g, cx))
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
        .when(Boolean(g.color), (el) => el.child(chip(t, g.color, 11)))
        .child(div().truncate().text_color(g.folder ? t.foreground : t.dim).child(g.label))
        .child(div().text_color(t.dim).child(String(g.members.length)))
        .child(div().flex_1())
        .when(!open && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
        .when(g.members.length === 0 && open && Boolean(g.folder) && !this.drag, (el) => el.child(div().text_size(10.5).text_color(t.dim).child("drag agents here")));
    };

    let n = 0;
    const rows = collapsed
      ? order.flatMap((a) => withKids(groups.find((g) => g.members.includes(a)))(a, n++))
      : groups.flatMap((g) => [header(g), ...(isFolded(g) ? [] : g.members.flatMap(withKids(g)))]);

    const iconButton = (id, glyph, tip, action) => div()
      .id(id)
      .p(3)
      .rounded(5)
      .text_size(11)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_click(action)
      .child(svg(`mods/workspace-chrome/${glyph}.svg`).size(14));

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .on_mouse_up("left", (_e, cx) => { if (this.drag) this.endDrag(cx); })
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .pl(16)
            .pr(10)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .gap(4)
            .child(div().flex_1().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(iconButton("af-sort", byStatus ? "clock" : "layers", byStatus ? "Inside folders: by status (click for space order)" : "Inside folders: by space (click for status order)", () => {
              const s = load();
              s.sort = byStatus ? "space" : "status";
              save(s);
            }))
            .child(iconButton("af-new", "folder-plus", "New folder", () => openDialog(null))),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status.")),
      )
      .child(v_flex().id("af-list").flex_1().min_h(0).px(collapsed ? 0 : 8).pb(10).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
