#!/usr/bin/env node
// Launch pi in a fresh git worktree for every new session.
//
// - Inside the main checkout of a git repo: start pi in a sibling worktree
//   `<repo>-wt-<timestamp>` on branch `<user>/wt-<timestamp>` at HEAD
//   (same relative subdirectory).
// - Fast start: a pre-built spare worktree `<repo>-wt-spare` is claimed
//   (git worktree move + branch rename + reset to HEAD). If no spare is
//   available, fall back to `git worktree add`. After start, a new spare is
//   built in a hidden background process.
// - When pi exits and the worktree has no changes and no new commits, it is
//   recycled as the spare (or removed) in a background process.
// - Pass through unchanged (no worktree) when:
//     * PI_NO_WORKTREE=1
//     * not inside a git repo, or already inside a linked worktree
//     * a subcommand (install, update, list, ...) or a non-new-session flag
//       (-c, -r, --session, --fork, -p, --mode, --help, --version, ...)
// - PI_WT_NO_SPARE=1 disables the spare logic.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync, closeSync, statSync, unlinkSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { piRoot } from "./pi-root.mjs";

// Resolved only when pi starts: with PI_CLI_JS set, pi-wt needs no pi install and no npm.
const piCli = () => process.env.PI_CLI_JS || `${piRoot()}/dist/bundle/cli.js`;
const SELF = fileURLToPath(import.meta.url);

const args = process.argv.slice(2);

const SUBCOMMANDS = new Set(["install", "remove", "uninstall", "update", "list", "config", "auth"]);
const PASSTHROUGH_FLAGS = new Set([
  "-c", "--continue", "-r", "--resume", "--session", "--session-id", "--fork",
  "-p", "--print", "--mode", "--export", "--list-models",
  "-h", "--help", "-v", "--version",
]);

function git(cwd, ...a) {
  const r = spawnSync("git", a, { cwd, encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
}

function runPi(cwd) {
  checkSubagentsAfterUpdate();
  let cli;
  try { cli = piCli(); } catch (e) {
    console.error(`pi-wt: cannot find pi: ${e?.message ?? e}. Set PI_PACKAGE_ROOT or PI_CLI_JS.`);
    return Promise.resolve(1);
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: "inherit" });
    // Let pi handle Ctrl+C itself.
    process.on("SIGINT", () => {});
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

function spawnBg(bgArgs) {
  const c = spawn(process.execPath, [SELF, ...bgArgs], {
    detached: true, stdio: "ignore", windowsHide: true,
  });
  c.unref();
}

// After a Pi or pi-subagents update, check once that background subagent children can start (Pi 1.1.0 broke
// pi-subagents 0.73.1). Unchanged versions cost two small file reads; the check itself runs only after a change.
function checkSubagentsAfterUpdate() {
  if (process.env.PI_NO_SUBAGENTS_CHECK || (args.length && SUBCOMMANDS.has(args[0]))) return;
  try {
    const ver = (f) => JSON.parse(readFileSync(f, "utf8")).version;
    const root = piRoot();
    const extDir = path.join(os.homedir(), ".pi/agent/npm/node_modules/pi-subagents");
    const stamp = path.join(os.homedir(), ".pi/agent/.pi-subagents-check.json");
    let last = {};
    try { last = JSON.parse(readFileSync(stamp, "utf8")); } catch {}
    if (last.ok && last.pi === ver(path.join(root, "package.json")) && last.ext === ver(path.join(extDir, "package.json"))) return;
    spawnSync(process.execPath, [path.join(path.dirname(SELF), "pi-subagents-check.mjs"), "--if-changed"],
      { stdio: "inherit", timeout: 60_000, windowsHide: true, env: { ...process.env, PI_PACKAGE_ROOT: root } });
  } catch {} // a check problem must never block pi
}

function shouldCreateWorktree(cwd) {
  if (process.env.PI_NO_WORKTREE) return false;
  if (args.length && SUBCOMMANDS.has(args[0])) return false;
  for (const a of args) {
    if (a === "--") break;
    if (PASSTHROUGH_FLAGS.has(a.split("=")[0])) return false;
  }
  const gitDir = git(cwd, "rev-parse", "--absolute-git-dir");
  const commonDir = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (!gitDir || !commonDir) return false; // not a git repo
  if (path.resolve(gitDir) !== path.resolve(commonDir)) return false; // already a linked worktree
  if (!git(cwd, "rev-parse", "--verify", "HEAD")) return false; // no commits yet
  return true;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const userName = () => (process.env.PI_WT_USER || os.userInfo().username || "user").toLowerCase();
const sparePath = (top) => path.join(path.dirname(top), `${path.basename(top)}-wt-spare`);

// ---- spare lock (one background spare job per repo) ----
function lockPath(top) {
  const common = git(top, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return path.join(common, "pi-wt-spare.lock");
}
function acquireLock(file) {
  try {
    if (existsSync(file) && Date.now() - statSync(file).mtimeMs > 15 * 60_000) unlinkSync(file); // stale
  } catch {}
  try { closeSync(openSync(file, "wx")); return true; } catch { return false; }
}
function releaseLock(file) { try { unlinkSync(file); } catch {} }

// Claim the spare worktree: atomic move first (so two launches cannot both get it).
function claimSpare(top, wtPath, branch, base) {
  if (process.env.PI_WT_NO_SPARE) return false;
  const spare = sparePath(top);
  if (!existsSync(spare)) return false;
  if (git(top, "worktree", "move", spare, wtPath) === null) return false;
  const ok =
    git(wtPath, "branch", "-m", branch) !== null &&
    git(wtPath, "reset", "-q", "--hard", base) !== null;
  if (!ok) {
    git(top, "worktree", "remove", "--force", wtPath);
    return false;
  }
  return true;
}

// Background: build a new spare worktree if none exists.
function makeSpare(top) {
  const spare = sparePath(top);
  const lock = lockPath(top);
  if (existsSync(spare) || !acquireLock(lock)) return;
  const tmp = `${spare}-tmp-${process.pid}`;
  const branch = `${userName()}/wt-spare-${stamp()}`;
  try {
    git(top, "worktree", "prune");
    if (git(top, "worktree", "add", "-q", "-b", branch, tmp, "HEAD") === null) throw new Error("add");
    if (existsSync(spare) || git(top, "worktree", "move", tmp, spare) === null) throw new Error("move");
  } catch {
    git(top, "worktree", "remove", "--force", tmp);
    git(top, "branch", "-D", branch);
  } finally {
    releaseLock(lock);
  }
}

// Background: recycle an unused worktree as the spare, or remove it.
function recycle(top, wtPath, branch) {
  const spare = sparePath(top);
  const lock = lockPath(top);
  if (!process.env.PI_WT_NO_SPARE && !existsSync(spare) && acquireLock(lock)) {
    try {
      git(wtPath, "clean", "-fdxq");
      if (!existsSync(spare) && git(top, "worktree", "move", wtPath, spare) !== null) {
        git(spare, "branch", "-m", `${userName()}/wt-spare-${stamp()}`);
        return;
      }
    } finally {
      releaseLock(lock);
    }
  }
  git(top, "worktree", "remove", "--force", wtPath);
  git(top, "branch", "-D", branch);
}

async function main() {
  // Internal background modes.
  if (args[0] === "--pi-wt-make-spare") {
    await new Promise((r) => setTimeout(r, 5000)); // let pi start first
    return makeSpare(args[1]);
  }
  if (args[0] === "--pi-wt-recycle") return recycle(args[1], args[2], args[3]);

  const cwd = process.cwd();
  if (!shouldCreateWorktree(cwd)) process.exit(await runPi(cwd));

  const top = git(cwd, "rev-parse", "--show-toplevel");
  const rel = path.relative(top, cwd);
  const base = git(top, "rev-parse", "HEAD");
  // Two launches in the same second get the same stamp (a launcher can start several pi at once). Then the second
  // `worktree add` fails; take the next free name, so that pi never falls back to the real repo folder.
  let ts, branch, wtPath, how, add;
  for (let n = 1; n <= 9; n++) {
    ts = stamp() + (n > 1 ? `-${n}` : "");
    branch = `${userName()}/wt-${ts}`;
    wtPath = path.join(path.dirname(top), `${path.basename(top)}-wt-${ts}`);
    how = "spare";
    if (!existsSync(wtPath) && claimSpare(top, wtPath, branch, base)) break;
    how = "new";
    add = spawnSync("git", ["worktree", "add", "-q", "-b", branch, wtPath, "HEAD"], { cwd: top, encoding: "utf8" });
    if (add.status === 0) break;
  }
  if (how === "new" && add.status !== 0) {
    process.stderr.write(add.stderr || "");
    console.error("[pi-wt] git worktree add failed; starting pi in the current directory.");
    process.exit(await runPi(cwd));
  }
  console.error(`[pi-wt] worktree (${how}): ${wtPath}  (branch ${branch})`);
  if (!process.env.PI_WT_NO_SPARE) spawnBg(["--pi-wt-make-spare", top]);

  const target = rel && existsSync(path.join(wtPath, rel)) ? path.join(wtPath, rel) : wtPath;
  const code = await runPi(target);

  // Recycle or remove an untouched worktree in the background.
  const dirty = git(wtPath, "status", "--porcelain");
  const ahead = git(wtPath, "rev-list", "--count", `${base}..HEAD`);
  if (dirty === "" && ahead === "0" && !process.env.PI_WT_KEEP) {
    spawnBg(["--pi-wt-recycle", top, wtPath, branch]);
    console.error(`[pi-wt] unused worktree ${wtPath} is recycled in the background`);
  } else {
    console.error(`[pi-wt] kept worktree ${wtPath}  (branch ${branch})`);
  }
  process.exit(code);
}

main();
