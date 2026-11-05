#!/usr/bin/env node
// Check that pi-subagents can start background children with the installed Pi.
//
// Why: after a Pi update (1.1.0), pi-subagents 0.73.1 needed an export that the new Pi did not have, and every
// background child failed before it started. The fix was `pi update npm:pi-subagents`. A version pin would not have
// helped: the extension was too OLD for the new Pi, and pi-subagents declares "*" for its Pi peers.
//
//   node pi-subagents-check.mjs            versions + the launch preflight of pi-subagents + an import of each alias
//   node pi-subagents-check.mjs --launch   also start one real background child through `pi -p` (uses a model, ~1 min)
//   node pi-subagents-check.mjs --if-changed
//                                          for the pi-wt.mjs wrapper: silent unless Pi or pi-subagents changed since
//                                          the last check; then run the quick check and print one line
// Exit code 0 = ok, 1 = problem (the message says what to run).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { piRoot } from "./pi-root.mjs";

const HOME = os.homedir();
let PI_ROOT;
try {
  PI_ROOT = piRoot();
} catch (err) {
  console.error(`pi-subagents-check: cannot find the pi install (${err.message}). Set PI_PACKAGE_ROOT to the @earendil-works/pi-coding-agent folder.`);
  process.exit(1);
}
const PI_CLI = path.join(PI_ROOT, "dist/bundle/cli.js");
const EXT_ROOT = path.join(HOME, ".pi/agent/npm/node_modules/pi-subagents");
const STAMP = path.join(HOME, ".pi/agent/.pi-subagents-check.json");
const FIX = "Run: pi update npm:pi-subagents   then restart pi and run this check again.";
const args = new Set(process.argv.slice(2));

const version = (dir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version; } catch { return null; }
};
const url = (p) => pathToFileURL(p).href;

async function quickCheck() {
  const pi = version(PI_ROOT), ext = version(EXT_ROOT);
  const problems = [];
  if (!pi) problems.push(`Pi package not found at ${PI_ROOT}`);
  if (!ext) problems.push(`pi-subagents not found at ${EXT_ROOT}`);
  let aliases = {};
  if (!problems.length) {
    // The same preflight that pi-subagents runs before it starts a background child.
    try {
      const mod = await import(url(path.join(EXT_ROOT, "src/runs/background/runner-aliases.js")));
      const r = mod.resolveHostPeerAliases(PI_ROOT);
      aliases = r.aliases;
      if (r.missing.length) problems.push(`the Pi package does not provide ${r.missing.join(", ")}`);
    } catch (e) {
      problems.push(`pi-subagents has no usable launch preflight (${e.message.split("\n")[0]}); its layout changed`);
    }
    // Load each alias target: a declared export can still point to a broken or missing module.
    for (const [spec, target] of Object.entries(aliases)) {
      try { await import(url(target)); } catch (e) { problems.push(`${spec} does not load: ${e.message.split("\n")[0]}`); }
    }
  }
  return { pi, ext, ok: problems.length === 0, problems, aliases: Object.keys(aliases).length };
}

function newestFiles(dirs, since) {
  const out = [];
  const walk = (d, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      try {
        if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1); }
        else if (fs.statSync(p).mtimeMs >= since) out.push(p);
      } catch {}
    }
  };
  for (const d of dirs) walk(d, 0);
  return out;
}

async function launchCheck() {
  // One real background child, started by a pi session in print mode. The proof is the child's own output file
  // under the pi-subagents temp folders, not the parent's answer (a model could claim success without a child).
  const { DIRS } = await import(url(path.join(EXT_ROOT, "src/shared/types.js")));
  const marker = `SUBAGENT_SMOKE_${Date.now().toString(36).toUpperCase()}`;
  const prompt = [
    "This is an automatic check of the subagent tool. Do only this:",
    `1. If the subagent tool is not available, call subagents_enable first.`,
    `2. Start ONE background child with the subagent tool (async: true). Its task: "Reply with exactly ${marker} and nothing else. Use no tools."`,
    "3. Wait for it with bg_wait, then reply with the child's exact output.",
    "If a launch or runtime error occurs, reply with SUBAGENT_SMOKE_FAIL and the error text. Do not try another method.",
  ].join("\n");
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-check-"));
  const since = Date.now();
  const r = spawnSync(process.execPath, [PI_CLI, "-p", "--no-session", "--model", process.env.PI_CHECK_MODEL || "github-copilot/claude-haiku-5.5", prompt],
    { cwd, encoding: "utf8", timeout: 300_000, env: { ...process.env, PI_NO_WORKTREE: "1" }, windowsHide: true });
  fs.rmSync(cwd, { recursive: true, force: true });
  const answer = `${r.stdout || ""}${r.stderr || ""}`.trim();
  const childFiles = newestFiles([DIRS.async, DIRS.results], since)
    .filter((f) => { try { return fs.statSync(f).size < 5e6 && fs.readFileSync(f, "utf8").includes(marker); } catch { return false; } });
  // The task text also contains the marker ("Task: Reply with exactly <marker> ..."); only the child's answer is a
  // line that is exactly the marker.
  const proof = childFiles.find((f) => fs.readFileSync(f, "utf8").split(/\r?\n/).some((l) => l.trim() === marker));
  return {
    ok: Boolean(proof) && !answer.includes("SUBAGENT_SMOKE_FAIL") && r.status === 0,
    timedOut: r.error?.code === "ETIMEDOUT",
    answer: answer.slice(-600),
    proof,
    files: childFiles.length,
  };
}

async function main() {
  if (args.has("--if-changed")) {
    const pi = version(PI_ROOT), ext = version(EXT_ROOT);
    let last = {};
    try { last = JSON.parse(fs.readFileSync(STAMP, "utf8")); } catch {}
    if (last.pi === pi && last.ext === ext && last.ok) return 0;
    const c = await quickCheck();
    fs.writeFileSync(STAMP, JSON.stringify({ pi: c.pi, ext: c.ext, ok: c.ok, at: new Date().toISOString() }));
    if (c.ok) console.error(`[pi-subagents-check] Pi ${c.pi} + pi-subagents ${c.ext}: background children can start.`);
    else console.error(`[pi-subagents-check] Pi ${c.pi} + pi-subagents ${c.ext}: BACKGROUND CHILDREN WILL FAIL: ${c.problems.join("; ")}. ${FIX}`);
    return c.ok ? 0 : 1;
  }

  const c = await quickCheck();
  console.log(`Pi ${c.pi ?? "?"}, pi-subagents ${c.ext ?? "?"}`);
  console.log(c.ok ? `preflight: ok (${c.aliases} aliases resolve and load)` : `preflight: FAIL\n  - ${c.problems.join("\n  - ")}\n${FIX}`);
  let ok = c.ok;
  if (args.has("--launch") && c.ok) {
    console.log("launch: starting one background child through pi -p ...");
    const l = await launchCheck();
    if (l.ok) console.log(`launch: ok (child output: ${l.proof})`);
    else console.log(`launch: FAIL${l.timedOut ? " (timeout after 5 min)" : ""}; child files with the marker: ${l.files}\n--- pi answer (end) ---\n${l.answer}\n${FIX}`);
    ok = ok && l.ok;
  }
  if (ok) fs.writeFileSync(STAMP, JSON.stringify({ pi: c.pi, ext: c.ext, ok: true, at: new Date().toISOString() }));
  return ok ? 0 : 1;
}

process.exitCode = await main();
