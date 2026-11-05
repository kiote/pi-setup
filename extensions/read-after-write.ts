// read-after-write: stop read failures on files that a sibling call writes, and on Git Bash paths.
// Cause: pi runs the tool calls of one assistant message in parallel. A read in the same message as
// the bash call that writes the file runs first and fails with ENOENT (seen in earlier sessions).
// - tool_call (read): change /tmp/... and /c/... to Windows paths.
// - tool_result (read, ENOENT): wait until the sibling write calls end or the file appears
//   (max 120 s), then read again with the built-in read tool and replace the error.
// A wait in tool_call is not possible: pi runs all tool_call hooks of a batch before any call executes.
// Test: node bin/read-after-write-test.mjs (from the pi-setup package root). Log: ~/.pi/agent/logs/read-after-write.jsonl.
// Off for one session: PI_READ_AFTER_WRITE=off.
import { createReadTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

type Lib = {
  Tracker: new () => {
    running: Map<string, string>;
    start(id: string, name: string): void;
    end(id: string): void;
    clear(): void;
    wait(o: { exists: () => boolean; maxMs?: number; signal?: AbortSignal }): Promise<{ ms: number; why: string }>;
  };
  mapPath(path: string, cwd: string): string;
  existing(path: string, cwd: string): string | null;
  isEnoent(content: unknown): boolean;
};

const LIB = fileURLToPath(new URL("../bin/read-after-write.mjs", import.meta.url));
const LOG_DIR = join(homedir(), ".pi", "agent", "logs");
const log = (rec: Record<string, unknown>) => {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, "read-after-write.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n");
  } catch {}
};

export default async function (pi: ExtensionAPI) {
  if (process.env.PI_READ_AFTER_WRITE === "off") return;
  const lib = (await import(pathToFileURL(LIB).href)) as Lib;
  const tracker = new lib.Tracker();

  pi.on("tool_call", (event, ctx) => {
    tracker.start(event.toolCallId, event.toolName);
    if (event.toolName !== "read") return undefined;
    const input = event.input as { path?: string };
    if (typeof input?.path !== "string") return undefined;
    const mapped = lib.mapPath(input.path, ctx.cwd);
    if (mapped !== input.path) {
      log({ kind: "map", from: input.path, to: mapped });
      input.path = mapped;
    }
    return undefined;
  });

  pi.on("tool_result", async (event, ctx) => {
    tracker.end(event.toolCallId);
    if (event.toolName !== "read" || !event.isError || !lib.isEnoent(event.content)) return undefined;
    const input = { ...(event.input as { path: string; offset?: number; limit?: number }) };
    const writers = [...tracker.running.values()];
    if (!writers.length) return undefined;
    const w = await tracker.wait({ exists: () => !!lib.existing(input.path, ctx.cwd), signal: ctx.signal });
    const found = lib.existing(input.path, ctx.cwd);
    log({ kind: "wait", path: input.path, writers, waitMs: w.ms, why: w.why, found });
    if (!found) return undefined;
    try {
      const r = await createReadTool(ctx.cwd).execute(event.toolCallId, { ...input, path: found }, ctx.signal);
      return { content: r.content, details: r.details, isError: false };
    } catch (e) {
      log({ kind: "retry-error", path: found, error: String(e) });
      return undefined;
    }
  });

  // Calls that never get a tool_result (blocked or aborted) must not stay "running".
  pi.on("turn_end", () => tracker.clear());
}
