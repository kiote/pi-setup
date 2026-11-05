// Windows: Node scripts that run spawnSync("npm", ...) or execFileSync("npx", ...) without a shell fail with
// ENOENT, because npm and npx are npm.cmd and npx.cmd. Preload this file to run them through a shell, without a
// change to the repository:
//   node --import file:///<pi-setup>/bin/npm-shell.mjs <script> [args]   (<pi-setup> = absolute package root)
// First used for the pi-subagents smoke test (test/smoke/clean-install.mjs).
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const SHIMS = new Set(["npm", "npx", "pnpm", "yarn"]);
const needsShell = (command) => process.platform === "win32" && SHIMS.has(String(command));

for (const name of ["spawnSync", "spawn", "execFileSync", "execFile"]) {
  const original = childProcess[name];
  childProcess[name] = function (command, args, options, ...rest) {
    if (!needsShell(command)) return original.call(this, command, args, options, ...rest);
    if (!Array.isArray(args)) return original.call(this, command, [], { ...(args || {}), shell: true }, options, ...rest);
    return original.call(this, command, args, { ...(options || {}), shell: true }, ...rest);
  };
}
syncBuiltinESMExports(); // `import { spawnSync } from "node:child_process"` then sees the wrapper too
