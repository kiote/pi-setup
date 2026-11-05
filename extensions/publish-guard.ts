// publish-guard: run bin/claim-check.mjs on text before it leaves the machine.
// Gates bash/powershell calls that publish a file: clipboard copy, or a command that matches the optional
// regex in env PI_PUBLISH_GUARD_PATTERN (for example an upload command of your own publish tool).
// Findings + UI: the user decides ("publish anyway?"). Findings + no UI (subagents, missions): block.
// Off for one session: PI_PUBLISH_GUARD=off. Origin: unverified claims published in earlier sessions.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath, pathToFileURL } from "node:url";

type Finding = { rule: string; line: number; hit: string; text: string; why: string };
type Checker = {
  publishTargets(cmd: string, cwd: string): { kind: string; files: string[] } | null;
  checkFile(path: string): { findings: Finding[]; warnings: Finding[]; blocks: number };
};

const CHECKER = fileURLToPath(new URL("../bin/claim-check.mjs", import.meta.url));
let mod: Promise<Checker> | undefined;
const load = () => (mod ??= import(pathToFileURL(CHECKER).href) as Promise<Checker>);

export default function (pi: ExtensionAPI) {
  if (process.env.PI_PUBLISH_GUARD === "off") return;
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash" && event.toolName !== "powershell") return undefined;
    const cmd = String((event.input as any)?.command ?? "");
    if (!/clip|pbcopy/i.test(cmd) && !process.env.PI_PUBLISH_GUARD_PATTERN) return undefined;
    const c = await load();
    const t = c.publishTargets(cmd, ctx.cwd);
    if (!t || !t.files.length) return undefined;
    const lines: string[] = [];
    let n = 0;
    for (const f of t.files) {
      const r = c.checkFile(f);
      n += r.findings.length;
      for (const x of r.findings.slice(0, 8)) lines.push(`${x.rule} ${f}:${x.line} [${x.hit}] ${x.text.slice(0, 110)}`);
      if (r.findings.length > 8) lines.push(`... ${r.findings.length - 8} more in ${f}`);
    }
    if (!n) return undefined;
    const reason =
      `publish-guard: ${t.kind} of text with ${n} unsourced or unchecked claims.\n${lines.join("\n")}\n` +
      `Fix each claim: add its link or path, or remove it. Keep open points in the chat, not in the shared text. ` +
      `Run: node "${CHECKER.replace(/\\/g, "/")}" <file>. If the user says a claim is fine, ask the user to approve the publish. ` +
      `Do not work around this block.`;
    if (!ctx.hasUI) return { block: true, reason };
    const ok = await ctx.ui.confirm(
      `publish-guard: ${t.kind} with ${n} unsourced claims`,
      `${lines.join("\n")}\n\nPublish anyway?`,
    );
    return ok ? undefined : { block: true, reason };
  });
}
