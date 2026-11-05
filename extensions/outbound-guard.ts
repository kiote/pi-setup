// outbound-guard: stop agent code that can send email or post messages without a human click.
// Gates bash, powershell, write, and edit. With UI: asks the user. Without UI (print mode,
// pi-subagents children): blocks. Origin: an unsolicited email send in an earlier session.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEND: [string, RegExp][] = [
  ["Outlook/.NET .Send()", /\.Send\s*\(/], // case-sensitive: COM/.NET only, not JS ws.send()
  ["Outlook SendAndReceive (flushes the Outbox)", /SendAndReceive/i],
  ["Outlook COM", /Outlook\.Application|0006F03A-0000-0000-C000-000000000046/i],
  ["classic Outlook start (flushes the Outbox)", /OUTLOOK\.EXE/i],
  ["SMTP send", /Send-MailMessage|\bsmtplib\b|\bSmtpClient\b|nodemailer/i],
  ["Graph mail send", /\/sendMail\b|\/messages\/[^\s'"\/]+\/(?:send|reply|replyAll|forward)\b/i],
];
const TEAMS_POST = /\/(?:chats|channels)\/\S+\/messages/i;
const HTTP_POST = /-X\s*POST|--request\s+POST|-Method\s+Post|method\s*[:=]\s*['"]post|requests\.post|\.post\s*\(/i;
const SCRIPT = /[^\s'"`;|&<>()]+\.(?:ps1|psm1|py|mjs|cjs|js|ts|sh|vbs|bat|cmd)\b/gi;
const ENCODED = /\s-e(?:nc(?:odedcommand)?)?\s+([A-Za-z0-9+/=]{16,})/gi;

let self = "";
try { self = resolve(fileURLToPath(import.meta.url)).toLowerCase(); } catch {}

const winPath = (p: string) => p.replace(/^\/([a-z])\//i, "$1:/");

// Text of script files that a shell command names, so `write x.ps1` + `powershell -File x.ps1` is caught.
function scripts(cmd: string, cwd: string): string {
  const out: string[] = [];
  for (const m of cmd.matchAll(SCRIPT)) {
    const p = winPath(m[0]);
    const full = isAbsolute(p) ? p : resolve(cwd, p);
    try {
      if (full.toLowerCase() === self || !existsSync(full)) continue;
      if (statSync(full).size > 1_000_000) continue;
      out.push(readFileSync(full, "utf8"));
    } catch {}
  }
  return out.join("\n");
}

// powershell -EncodedCommand <base64 UTF-16LE>
function decoded(cmd: string): string {
  return [...cmd.matchAll(ENCODED)]
    .map((m) => { try { return Buffer.from(m[1], "base64").toString("utf16le"); } catch { return ""; } })
    .join("\n");
}

export function findSend(toolName: string, input: any, cwd: string): string | undefined {
  let text: string;
  if (toolName === "bash" || toolName === "powershell") {
    const cmd = String(input?.command ?? "");
    text = [cmd, decoded(cmd), scripts(cmd, cwd)].join("\n");
  } else if (toolName === "write") {
    text = String(input?.content ?? "");
  } else if (toolName === "edit") {
    const edits = Array.isArray(input?.edits) ? input.edits : [input ?? {}];
    text = edits.map((e: any) => String(e?.newText ?? "")).join("\n"); // new text only: removing send code is fine
  } else return undefined;
  for (const [name, re] of SEND) if (re.test(text)) return name;
  if (TEAMS_POST.test(text) && HTTP_POST.test(text)) return "Teams message post";
  return undefined;
}

export default function (pi: ExtensionAPI) {
  // Off for one session: start pi with PI_OUTBOUND_GUARD=off. An agent cannot change the env of its own pi process.
  if (process.env.PI_OUTBOUND_GUARD === "off") return;
  pi.on("tool_call", async (event, ctx) => {
    const hit = findSend(event.toolName, event.input, ctx.cwd);
    if (!hit) return undefined;
    const reason =
      `outbound-guard: this ${event.toolName} call contains code that can send a message (${hit}). ` +
      `It needs explicit approval from the user. Do not try to work around this block.`;
    if (!ctx.hasUI) return { block: true, reason };
    const where = event.toolName === "bash" || event.toolName === "powershell"
      ? String((event.input as any).command ?? "").slice(0, 400)
      : String((event.input as any).path ?? "");
    const ok = await ctx.ui.confirm(
      "outbound-guard: possible email/Teams send",
      `${event.toolName}: ${hit}\n${where}\n\nAllow this call?`,
    );
    return ok ? undefined : { block: true, reason };
  });
}
