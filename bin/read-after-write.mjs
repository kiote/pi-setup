// Logic for extensions/read-after-write.ts. Test: node bin/read-after-write-test.mjs (from the pi-setup package root)
// 1. Git Bash paths (/tmp/..., /c/...) -> Windows paths for the read tool.
// 2. A read that fails with ENOENT while a sibling write call of the same batch still runs:
//    wait until the writers finish or the file appears, then the hook reads again.
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";

// Tools that can create a file. Pi runs sibling calls of one assistant message in parallel.
export const WRITERS = new Set(["bash", "powershell", "write", "edit", "codemode"]);

const fwd = (p) => p.replace(/\\/g, "/");

// Windows paths that a Git Bash style path can mean, the most likely first.
export function candidates(path, cwd = process.cwd(), bashTmp = fwd(tmpdir())) {
  const p = String(path ?? "").trim();
  const out = [];
  const tmp = /^\/tmp(\/|$)/.exec(p);
  const drive = /^\/([a-zA-Z])(\/|$)/.exec(p);
  if (tmp) out.push(bashTmp + p.slice(4)); // Git Bash /tmp = %TEMP%
  else if (drive) out.push(`${drive[1].toUpperCase()}:/${p.slice(3)}`);
  out.push(fwd(isAbsolute(p) ? resolve(p) : resolve(cwd, p))); // what the read tool does by itself
  return [...new Set(out)];
}

// The first candidate that exists, or null.
export function existing(path, cwd, bashTmp) {
  return candidates(path, cwd, bashTmp).find((c) => existsSync(c)) ?? null;
}

// The path that the read tool gets: a converted path only for a Git Bash path.
export function mapPath(path, cwd, bashTmp) {
  const c = candidates(path, cwd, bashTmp);
  if (c.length < 2) return path;
  return c.find((x) => existsSync(x)) ?? c[0];
}

export function isEnoent(content) {
  const t = Array.isArray(content) ? content.map((c) => c?.text ?? "").join("\n") : String(content ?? "");
  return /\bENOENT\b|no such file or directory/i.test(t);
}

// Tracks write calls that run now.
export class Tracker {
  running = new Map(); // toolCallId -> toolName
  start(id, name) {
    if (WRITERS.has(name)) this.running.set(id, name);
  }
  end(id) {
    this.running.delete(id);
  }
  clear() {
    this.running.clear();
  }
  // Wait until no writer runs or exists() is true. Resolves with the wait in ms and the reason.
  async wait({ exists, maxMs = 120000, stepMs = 100, signal } = {}) {
    const t0 = Date.now();
    for (;;) {
      if (exists?.()) return { ms: Date.now() - t0, why: "file" };
      if (this.running.size === 0) return { ms: Date.now() - t0, why: "writers-done" };
      if (signal?.aborted) return { ms: Date.now() - t0, why: "aborted" };
      if (Date.now() - t0 >= maxMs) return { ms: Date.now() - t0, why: "timeout" };
      await new Promise((r) => setTimeout(r, stepMs));
    }
  }
}
