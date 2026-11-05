#!/usr/bin/env node
// pi-root: find the folder of the installed pi package (@earendil-works/pi-coding-agent).
// Order: env PI_PACKAGE_ROOT, then `<npm root -g>/@earendil-works/pi-coding-agent`.
// Set PI_PACKAGE_ROOT to skip the `npm root -g` call (about 1 s on Windows).
//   import { piRoot } from "./pi-root.mjs";   piRoot() -> absolute path (forward slashes)
//   node pi-root.mjs                          prints the path; exit 1 if it cannot be found
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = "@earendil-works/pi-coding-agent";
let cached;

export function piRoot() {
  if (cached) return cached;
  let root = process.env.PI_PACKAGE_ROOT;
  if (!root) {
    const npmRoot = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
    if (!npmRoot) throw new Error("pi-root: `npm root -g` gave no output; set PI_PACKAGE_ROOT");
    root = `${npmRoot}/${PACKAGE}`;
  }
  cached = resolve(root).replace(/\\/g, "/");
  return cached;
}

const isMain = (() => { try { return resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1] || "").toLowerCase(); } catch { return false; } })();
if (isMain) {
  try {
    console.log(piRoot());
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exit(1);
  }
}
