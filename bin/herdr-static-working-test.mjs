// Test for extensions/herdr-static-working.ts (SPEC v0.5 S6).
// Run: node bin/herdr-static-working-test.mjs [extension path]   (default: extensions/herdr-static-working.ts)
// Loads the extension with the jiti of the pi install and a fake pi, and fires session_start.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { piRoot } from "./pi-root.mjs";

const PI = piRoot();
const req = createRequire(PI + "/package.json");
const { createJiti } = req("jiti");
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: {
    "@earendil-works/pi-coding-agent": PI + "/dist/index.js",
    "@earendil-works/pi-ai": PI + "/dist/core/extensions/pi-ai-extension-view.js",
    typebox: req.resolve("typebox"),
  },
});
const EXT = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../extensions/herdr-static-working.ts", import.meta.url));

let fails = 0;
const ok = (cond, name, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};

// Sets HC_TERMINAL_ID (undefined = unset), loads the extension with a fake pi, fires session_start
// with a fake ctx, and returns the recorded setWorkingIndicator calls.
async function run(terminalId, hasUI) {
  if (terminalId === undefined) delete process.env.HC_TERMINAL_ID;
  else process.env.HC_TERMINAL_ID = terminalId;
  const handlers = {};
  const fakePi = { on: (ev, fn) => ((handlers[ev] ??= []).push(fn)) };
  const mod = await jiti.import(EXT);
  await mod.default(fakePi);
  const calls = [];
  const ctx = {
    hasUI,
    mode: hasUI ? "tui" : "print",
    ui: {
      setWorkingIndicator: (options) => calls.push(options),
      theme: { fg: (color, text) => `<${color}>${text}</${color}>` },
    },
  };
  for (const h of handlers.session_start ?? []) await h({ type: "session_start", reason: "startup" }, ctx);
  return { calls, events: Object.keys(handlers) };
}

const saved = process.env.HC_TERMINAL_ID;
try {
  {
    const { calls } = await run("t-test", true);
    ok(calls.length === 1, "(a) HC_TERMINAL_ID set: one setWorkingIndicator call", `calls=${calls.length}`);
    const frames = calls[0]?.frames;
    ok(Array.isArray(frames) && frames.length === 1, "(a) HC_TERMINAL_ID set: one frame", `frames=${JSON.stringify(frames)}`);
    ok(typeof frames?.[0] === "string" && frames[0].length > 0, "(a) HC_TERMINAL_ID set: frame is a non-empty string");
  }
  {
    const { calls, events } = await run(undefined, true);
    ok(calls.length === 0, "(b) HC_TERMINAL_ID unset: no setWorkingIndicator call", `calls=${calls.length}`);
    ok(events.length === 0, "(b) HC_TERMINAL_ID unset: no handler registered", `events=${JSON.stringify(events)}`);
  }
  {
    const { calls } = await run("", true);
    ok(calls.length === 0, "(b) HC_TERMINAL_ID empty: no setWorkingIndicator call", `calls=${calls.length}`);
  }
  {
    const { calls } = await run("t-test", false);
    ok(calls.length === 0, "(c) hasUI false: no setWorkingIndicator call", `calls=${calls.length}`);
  }
} finally {
  if (saved === undefined) delete process.env.HC_TERMINAL_ID;
  else process.env.HC_TERMINAL_ID = saved;
}

console.log(fails ? `FAIL ${fails} check(s)` : "PASS all");
process.exit(fails ? 1 : 0);
