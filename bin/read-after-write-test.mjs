// Test for extensions/read-after-write.ts and bin/read-after-write.mjs.
// Run: node bin/read-after-write-test.mjs (from the pi-setup package root)
// Case A and B replay failures from earlier sessions: bash writes a file (about 700 ms) while
// a parallel read of that file fails with ENOENT after 15 ms.
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { piRoot } from "./pi-root.mjs";

const PI = piRoot();
const req = createRequire(PI + "/package.json");
const { createJiti } = req("jiti");
const piIndex = PI + "/dist/index.js";
const jiti = createJiti(import.meta.url, { alias: { "@earendil-works/pi-coding-agent": piIndex } });
const { createReadTool } = await import(pathToFileURL(piIndex).href);
const lib = await import(new URL("./read-after-write.mjs", import.meta.url).href);

let fails = 0;
const ok = (cond, name, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};
const text = (c) => (c ?? []).map((x) => x.text ?? "").join("\n");

// Load the extension with a fake pi.
const handlers = {};
const fakePi = { on: (ev, fn) => ((handlers[ev] ??= []).push(fn)) };
const ext = await jiti.import(fileURLToPath(new URL("../extensions/read-after-write.ts", import.meta.url)), { default: true });
await ext(fakePi);
const fire = async (ev, e, ctx) => {
  let r;
  for (const h of handlers[ev] ?? []) r = (await h(e, ctx)) ?? r;
  return r;
};

const dir = "C:/tmp/raw-test";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const ctx = { cwd: dir, signal: undefined };

// One parallel batch: [writer, read]. The writer writes `file` after `delay` ms.
async function batch(name, writerTool, readPath, file, delay) {
  const w = { toolCallId: name + "-w", toolName: writerTool, input: { command: "x" } };
  const r = { toolCallId: name + "-r", toolName: "read", input: { path: readPath } };
  await fire("tool_call", w, ctx); // preflight in source order
  await fire("tool_call", r, ctx);
  const writer = (async () => {
    await new Promise((res) => setTimeout(res, delay));
    writeFileSync(file, `content of ${name}\n`);
    await fire("tool_result", { ...w, content: [{ type: "text", text: "ok" }], isError: false }, ctx);
  })();
  const reader = (async () => {
    let res, isError = false;
    try {
      res = await createReadTool(dir).execute(r.toolCallId, r.input);
    } catch (e) {
      res = { content: [{ type: "text", text: String(e.message ?? e) }], details: {} };
      isError = true;
    }
    const patch = await fire("tool_result", { ...r, content: res.content, isError }, ctx);
    return { first: isError, final: patch ? patch : { ...res, isError } };
  })();
  const [, out] = await Promise.all([writer, reader]);
  await fire("turn_end", {}, ctx);
  return { ...out, path: r.input.path };
}

// A: bash writes C:/tmp/jcontent.md, read C:/tmp/jcontent.md.
let a = await batch("A", "bash", `${dir}/jcontent.md`, `${dir}/jcontent.md`, 700);
ok(a.first === true, "A: the first read fails (race is real)");
ok(a.final.isError === false && /content of A/.test(text(a.final.content)), "A: hook returns the file content", text(a.final.content).slice(0, 40));

// B: bash writes /c/tmp/arch.md, read C:/tmp/arch.md, codemode writer too.
let b = await batch("B", "codemode", `${dir}/arch.md`, `${dir}/arch.md`, 300);
ok(b.final.isError === false && /content of B/.test(text(b.final.content)), "B: codemode writer, hook returns the content");

// C: Git Bash /c/ path for read is mapped to C:/.
writeFileSync(`${dir}/c.md`, "c\n");
const c = { toolCallId: "c", toolName: "read", input: { path: "/c/tmp/raw-test/c.md" } };
await fire("tool_call", c, ctx);
ok(c.input.path === "C:/tmp/raw-test/c.md", "C: /c/tmp/... -> C:/tmp/...", c.input.path);

// D: Git Bash /tmp path is mapped to %TEMP% when the file is there.
const tdir = tmpdir().replace(/\\/g, "/");
writeFileSync(`${tdir}/raw-test-d.md`, "d\n");
const d = { toolCallId: "d", toolName: "read", input: { path: "/tmp/raw-test-d.md" } };
await fire("tool_call", d, ctx);
ok(d.input.path === `${tdir}/raw-test-d.md`, "D: /tmp/... -> %TEMP%/...", d.input.path);
rmSync(`${tdir}/raw-test-d.md`, { force: true });

// E: /tmp path that only exists at C:/tmp (written by the write tool) is not changed.
mkdirSync("C:/tmp", { recursive: true });
writeFileSync("C:/tmp/raw-test-e.md", "e\n");
const e = { toolCallId: "e", toolName: "read", input: { path: "/tmp/raw-test-e.md" } };
await fire("tool_call", e, ctx);
ok(e.input.path === "C:/tmp/raw-test-e.md", "E: /tmp/... -> C:/tmp/... when only C:/tmp has the file", e.input.path);
rmSync("C:/tmp/raw-test-e.md", { force: true });

// F: a real missing file with no writer: the hook does not change the error and does not wait.
const t0 = Date.now();
const f = await fire("tool_result", { toolCallId: "f", toolName: "read", input: { path: `${dir}/none.md` }, content: [{ type: "text", text: "ENOENT: no such file" }], isError: true }, ctx);
ok(f === undefined && Date.now() - t0 < 50, "F: no writer -> error kept, no wait");

// G: writer that never ends: Tracker stops at maxMs.
const tr = new lib.Tracker();
tr.start("g", "bash");
const g = await tr.wait({ exists: () => false, maxMs: 300 });
ok(g.why === "timeout" && g.ms >= 300 && g.ms < 1000, "G: wait stops at the time limit", JSON.stringify(g));

// H: writer ends but the file is never written: error kept.
let h = await batch("H", "bash", `${dir}/never.md`, `${dir}/other.md`, 200);
ok(h.final.isError === true, "H: writer wrote another file -> error kept");

rmSync(dir, { recursive: true, force: true });
ok(!existsSync(dir), "cleanup");
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
