// Measure the interactive pi start in a pseudo terminal (the agent shell has no TTY).
// Usage: node bin/pi-bench.cjs [cwd]   (path relative to the pi-setup package root)
// Runs the npm shim `pi` (NOT the PowerShell `pi` function / pi-wt.mjs wrapper),
// with PI_TIMING=1 and PI_STARTUP_BENCHMARK=1, so pi exits after init.
// To time the wrapper too, run: PI_CLI_JS=<fake.cjs> node bin/pi-wt.mjs
// Needs node-pty: a local install, else the global one (`npm install -g node-pty`).
const pty = (() => {
  try { return require("node-pty"); } catch {}
  const npmRoot = require("node:child_process").execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
  return require(require("node:path").join(npmRoot, "node-pty"));
})();
const cwd = process.argv[2] || process.cwd();
const t0 = Date.now();
const p = pty.spawn(process.env.ComSpec || "cmd.exe", ["/c", "pi"], {
  name: "xterm-256color", cols: 200, rows: 60, cwd,
  env: { ...process.env, PI_TIMING: "1", PI_STARTUP_BENCHMARK: "1" },
});
let out = "";
p.onData((d) => { out += d; });
const kill = setTimeout(() => { console.log("TIMEOUT after 120 s"); p.kill(); }, 120_000);
p.onExit(({ exitCode }) => {
  clearTimeout(kill);
  const text = out.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
  for (const line of text.split(/\r?\n/)) if (/^\s+\S.*: \d+ms$|TOTAL|Startup Timings/.test(line)) console.log(line);
  console.log(`WALL ${Date.now() - t0} ms, exit ${exitCode}, cwd ${cwd}`);
});
