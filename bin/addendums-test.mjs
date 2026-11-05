// Test for extensions/addendums.ts (SPEC AC5).
// Run: node bin/addendums-test.mjs (from the package root or any folder).
// Finds the pi install with env PI_PACKAGE_ROOT, then `<npm root -g>/@earendil-works/pi-coding-agent`,
// and loads the extension with the jiti of that install, as pi does.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function piRoot() {
  if (process.env.PI_PACKAGE_ROOT) return process.env.PI_PACKAGE_ROOT;
  const globalRoot = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  return join(globalRoot, "@earendil-works", "pi-coding-agent");
}

const PI = piRoot();
if (!existsSync(join(PI, "package.json"))) {
  console.error(`FAIL pi install not found at ${PI}. Set PI_PACKAGE_ROOT.`);
  process.exit(1);
}
const req = createRequire(join(PI, "package.json"));
const { createJiti } = req("jiti");
const piIndex = join(PI, "dist", "index.js");
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { "@earendil-works/pi-coding-agent": piIndex },
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/");
const EXT = join(ROOT, "extensions", "addendums.ts");
const NAMES = ["ste100", "coordination", "sdd", "agents-generic"];
// The first line of each file identifies its text in the result.
const head = Object.fromEntries(
  NAMES.map((n) => [n, readFileSync(join(ROOT, "addendums", `${n}.md`), "utf8").split(/\r?\n/)[0]]),
);
const ROOT_LINE = `pi-setup package root: ${ROOT}`;

let fails = 0;
const ok = (cond, name, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};

const mod = await jiti.import(EXT);
ok(typeof mod.buildAddendumText === "function" && typeof mod.default === "function", "extension exports buildAddendumText and default");
ok(mod.PACKAGE_ROOT === ROOT, "PACKAGE_ROOT resolves to the package root", mod.PACKAGE_ROOT);

const warnings = [];
const warn = (m) => warnings.push(m);

// Unset: all four texts, in order, root line last, no `<pi-setup>` left.
const all = mod.buildAddendumText(undefined, ROOT, warn);
const pos = NAMES.map((n) => all.indexOf(head[n]));
ok(pos.every((p) => p >= 0), "unset: all 4 texts present", JSON.stringify(pos));
ok(pos.every((p, i) => i === 0 || p > pos[i - 1]), "unset: texts in order ste100, coordination, sdd, agents-generic");
ok(!all.includes("<pi-setup>"), "unset: no `<pi-setup>` remains");
ok(all.includes(`${ROOT}/bin/`), "unset: `<pi-setup>` replaced by the package root");
ok(all.trimEnd().endsWith(ROOT_LINE), "unset: root line at the end");
ok(mod.buildAddendumText("", ROOT, warn) === all, "empty value = unset");

// ste100 only.
const ste = mod.buildAddendumText("ste100", ROOT, warn);
ok(ste.includes(head.ste100), "ste100: STE100 text present");
ok(NAMES.slice(1).every((n) => !ste.includes(head[n])), "ste100: no other text");
ok(ste.trimEnd().endsWith(ROOT_LINE) && !ste.includes("<pi-setup>"), "ste100: root line present, no `<pi-setup>`");

// none.
ok(mod.buildAddendumText("none", ROOT, warn) === "", "none: nothing appended");
ok(warnings.length === 0, "no warnings so far", JSON.stringify(warnings));

// Unknown names: ignored, one warning.
const mixed = mod.buildAddendumText("sdd, bogus,also-bogus", ROOT, warn);
ok(mixed.includes(head.sdd) && !mixed.includes(head.ste100), "list: sdd only, unknown names ignored");
ok(warnings.length === 1 && /bogus, also-bogus/.test(warnings[0]), "list: one warning for unknown names", warnings[0]);

// The registered handler, through a fake pi object, with each env value.
const BASE = "BASE SYSTEM PROMPT";
async function runHandler(envValue) {
  const saved = process.env.PI_SETUP_ADDENDUMS;
  if (envValue === undefined) delete process.env.PI_SETUP_ADDENDUMS;
  else process.env.PI_SETUP_ADDENDUMS = envValue;
  try {
    const handlers = {};
    const fakePi = { on: (ev, fn) => ((handlers[ev] ??= []).push(fn)) };
    const factory = await jiti.import(EXT, { default: true });
    await factory(fakePi);
    const list = handlers.before_agent_start ?? [];
    if (list.length === 0) return { count: 0, result: undefined };
    const result = await list[0]({ type: "before_agent_start", messageType: "user", prompt: "hi", systemPrompt: BASE }, {});
    return { count: list.length, result };
  } finally {
    if (saved === undefined) delete process.env.PI_SETUP_ADDENDUMS;
    else process.env.PI_SETUP_ADDENDUMS = saved;
  }
}

const hAll = await runHandler(undefined);
ok(hAll.count === 1 && hAll.result?.systemPrompt === `${BASE}\n\n${all}`, "handler (unset): returns base + all addendums");
const hSte = await runHandler("ste100");
ok(hSte.result?.systemPrompt === `${BASE}\n\n${ste}`, "handler (ste100): returns base + STE100 only");
const hNone = await runHandler("none");
ok(hNone.count === 0 && hNone.result === undefined, "handler (none): no handler, prompt unchanged");

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
