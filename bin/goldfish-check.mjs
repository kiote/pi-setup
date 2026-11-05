#!/usr/bin/env node
// Goldfish review gate for pi-mission-mode `checks`.
// Runs one fresh-context pi (no session, no extensions, no MCP, no skills,
// no AGENTS.md, read-only tools) with an EGM persona prompt
// (https://github.com/google/elephant-goldfish-model, Apache-2.0; see egm/NOTICE).
//
// Usage:
//   node goldfish-check.mjs <target file> [--mission <mission.json>] [--persona design_critic]
//        [--fail-on blocker|major] [--model <pattern>] [--out <report.md>] [--timeout <sec>]
//
// Exit: 0 = no finding at or above --fail-on, 1 = findings, 2 = run or parse error.

import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// pi CLI: env PI_CLI_JS, else <PI_PACKAGE_ROOT>/dist/bundle/cli.js,
// else <npm root -g>/@earendil-works/pi-coding-agent/dist/bundle/cli.js.
// dist/bundle/cli.js is the "pi" bin entry in the package.json of pi-coding-agent.
function resolvePiCli() {
  if (process.env.PI_CLI_JS) return process.env.PI_CLI_JS;
  let root = process.env.PI_PACKAGE_ROOT;
  if (!root) {
    try {
      const npmRoot = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      root = path.join(npmRoot, "@earendil-works", "pi-coding-agent");
    } catch (e) {
      die(`cannot run "npm root -g" (${e.message}); set PI_CLI_JS or PI_PACKAGE_ROOT`);
    }
  }
  const cli = path.join(root, "dist", "bundle", "cli.js");
  if (!existsSync(cli)) die(`pi CLI not found: ${cli}; set PI_CLI_JS or PI_PACKAGE_ROOT`);
  return cli;
}

function die(msg) {
  console.error(`goldfish-check: ${msg}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const opt = { persona: "design_critic", failOn: "blocker", timeout: 600 };
let target;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => (i + 1 < argv.length ? argv[++i] : die(`missing value for ${a}`));
  if (a === "--mission") opt.mission = next();
  else if (a === "--persona") opt.persona = next();
  else if (a === "--fail-on") opt.failOn = next().toLowerCase();
  else if (a === "--model") opt.model = next();
  else if (a === "--out") opt.out = next();
  else if (a === "--timeout") opt.timeout = Number(next());
  else if (a.startsWith("--")) die(`unknown option ${a}`);
  else if (!target) target = a;
  else die(`unexpected argument ${a}`);
}
if (!target) die("usage: goldfish-check.mjs <target file> [--mission <mission.json>] [--persona name]");
if (!["blocker", "major"].includes(opt.failOn)) die("--fail-on must be blocker or major");
target = path.resolve(target);
if (!existsSync(target)) die(`target not found: ${target}`);

const personaFile = path.join(HERE, "egm", `${opt.persona}.md`);
if (!existsSync(personaFile)) die(`persona not found: ${personaFile}`);

// Target Standard = mission goal + acceptance (mission.json or a mission checkpoint).
let standard = "No standard given. Judge the document against its own stated goal and audience.";
if (opt.mission) {
  let j;
  try {
    j = JSON.parse(readFileSync(opt.mission, "utf8"));
  } catch (e) {
    die(`cannot read mission file ${opt.mission}: ${e.message}`);
  }
  const m = j.mission && j.mission.goal ? j.mission : j;
  if (!m.goal || !Array.isArray(m.acceptance)) die(`no goal/acceptance in ${opt.mission}`);
  standard = [
    `Goal: ${m.goal}`,
    "Acceptance criteria:",
    ...m.acceptance.map((c, n) => `${n + 1}. ${c}`),
  ].join("\n");
}

const prompt = `Mode: REVIEW

Target file: ${target.replace(/\\/g, "/")}
Target scope: full file.

Target Standard:
${standard}

Document standards folder: ${path.join(HERE, "egm", "resources", "document_standards").replace(/\\/g, "/")}
A persona path that starts with resources/document_standards/ means a file in this folder.

Goldfish context: the target file, and local files that it links or cites, if you need them to check a claim. Your working directory is the caller's workspace; use grep, find, and ls there for code searches. You have only read-only tools (read, grep, find, ls). Do not guess the content of a URL that you cannot open; report the claim as unchecked instead.

Report findings in the output format of your persona. Report only findings that a fresh reader can act on. Do not report formatting nits unless they break an acceptance criterion.

The last line of your answer must be exactly:
COUNTS: blocker=<n> major=<n> nit=<n>`;

const args = [
  resolvePiCli(), "-p", "--no-session", "-ne", "--no-mcp", "-ns", "-np", "-nc", "--no-themes",
  "--tools", "read,grep,find,ls",
  "--append-system-prompt", personaFile,
];
if (opt.model) args.push("--model", opt.model);
args.push(prompt);

const started = Date.now();
const child = spawn(process.execPath, args, {
  cwd: process.cwd(),
  env: { ...process.env, PI_NO_WORKTREE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let out = "", err = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (err += d));
const timer = setTimeout(() => {
  child.kill();
  die(`timeout after ${opt.timeout}s`);
}, opt.timeout * 1000);

child.on("close", (code) => {
  clearTimeout(timer);
  const secs = Math.round((Date.now() - started) / 1000);
  if (code !== 0) die(`pi exited ${code} after ${secs}s\n${err.slice(-2000)}`);
  const m = out.match(/COUNTS:\s*blocker=(\d+)\s+major=(\d+)\s+nit=(\d+)\s*$/i);
  if (!m) die(`no COUNTS line in reviewer output after ${secs}s\n${out.slice(-2000)}`);
  const [blocker, major, nit] = m.slice(1).map(Number);

  const outFile =
    opt.out ||
    path.join(os.tmpdir(), "goldfish", `${path.basename(target, path.extname(target))}.${opt.persona}.md`);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, out);

  const failing = blocker + (opt.failOn === "major" ? major : 0);
  console.log(out.trim());
  console.log(
    `\ngoldfish-check: persona=${opt.persona} blocker=${blocker} major=${major} nit=${nit} ` +
      `fail-on=${opt.failOn} time=${secs}s report=${outFile.replace(/\\/g, "/")}`
  );
  console.log(failing > 0 ? "RESULT: FAIL" : "RESULT: PASS");
  process.exit(failing > 0 ? 1 : 0);
});
